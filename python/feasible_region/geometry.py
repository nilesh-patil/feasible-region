"""Brute-force polytope geometry.

``enumerate_geometry(lp)`` returns ``{vertices, edges, bounded}`` for a
teaching-scale LP (n <= 3). Vertices are every feasible intersection of n of the
(constraints + x_i>=0 bounds) hyperplanes; two vertices are joined by an edge
when they share >= n-1 independent tight facets. Pure Python, stdlib only.
"""

from __future__ import annotations

from itertools import combinations

from ._types import Direction, LinearProgram, Op, SolveOptions, Status

TOL = 1e-7


def enumerate_geometry(lp: LinearProgram) -> dict:
    n = len(lp.objective)
    # Equality candidates: each constraint as an equality + each bound x_i = 0.
    planes: list[tuple[list[float], float]] = []
    for con in lp.constraints:
        planes.append(([float(a) for a in con.coeffs], float(con.rhs)))
    for i in range(n):
        e = [0.0] * n
        e[i] = 1.0
        planes.append((e, 0.0))

    vertices: list[list[float]] = []
    seen: set = set()
    for combo in combinations(range(len(planes)), n):
        a_mat = [planes[k][0] for k in combo]
        b_vec = [planes[k][1] for k in combo]
        point = _solve_square(a_mat, b_vec)
        if point is None or not _feasible(lp, point):
            continue
        key = tuple(round(v, 7) for v in point)
        if key in seen:
            continue
        seen.add(key)
        vertices.append([float(v) for v in point])

    edges = _edges(lp, vertices, n)
    bounded = _bounded(lp, n)
    return {"vertices": vertices, "edges": edges, "bounded": bounded}


# --------------------------------------------------------------------------- #
# Linear algebra (small, dense, exact-ish — teaching scale).
# --------------------------------------------------------------------------- #
def _solve_square(a_mat: list[list[float]], b_vec: list[float]) -> list[float] | None:
    """Solve an n x n system by Gaussian elimination; None if singular."""
    n = len(b_vec)
    aug = [list(row) + [b_vec[i]] for i, row in enumerate(a_mat)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < TOL:
            return None
        aug[col], aug[pivot] = aug[pivot], aug[col]
        pv = aug[col][col]
        aug[col] = [v / pv for v in aug[col]]
        for r in range(n):
            if r != col and abs(aug[r][col]) > 0.0:
                f = aug[r][col]
                aug[r] = [aug[r][j] - f * aug[col][j] for j in range(n + 1)]
    return [aug[i][n] for i in range(n)]


def _rank(rows: list[list[float]]) -> int:
    if not rows:
        return 0
    mat = [list(r) for r in rows]
    n_rows, n_cols = len(mat), len(mat[0])
    rank = 0
    r = 0
    for c in range(n_cols):
        pivot = None
        for rr in range(r, n_rows):
            if abs(mat[rr][c]) > TOL:
                pivot = rr
                break
        if pivot is None:
            continue
        mat[r], mat[pivot] = mat[pivot], mat[r]
        pv = mat[r][c]
        mat[r] = [v / pv for v in mat[r]]
        for rr in range(n_rows):
            if rr != r and abs(mat[rr][c]) > TOL:
                f = mat[rr][c]
                mat[rr] = [mat[rr][j] - f * mat[r][j] for j in range(n_cols)]
        r += 1
        rank += 1
        if r == n_rows:
            break
    return rank


# --------------------------------------------------------------------------- #
# Feasibility, tight facets, edges, boundedness.
# --------------------------------------------------------------------------- #
def _feasible(lp: LinearProgram, x: list[float]) -> bool:
    for xi in x:
        if xi < -TOL:
            return False
    for con in lp.constraints:
        lhs = sum(float(a) * float(b) for a, b in zip(con.coeffs, x))
        if con.op is Op.Le and lhs > float(con.rhs) + TOL:
            return False
        if con.op is Op.Ge and lhs < float(con.rhs) - TOL:
            return False
        if con.op is Op.Eq and abs(lhs - float(con.rhs)) > TOL:
            return False
    return True


def _tight(lp: LinearProgram, x: list[float], n: int) -> tuple[list[list[float]], list]:
    normals: list[list[float]] = []
    ids: list = []
    for k, con in enumerate(lp.constraints):
        lhs = sum(float(a) * float(b) for a, b in zip(con.coeffs, x))
        if abs(lhs - float(con.rhs)) <= TOL:
            normals.append([float(a) for a in con.coeffs])
            ids.append(("c", k))
    for i in range(n):
        if abs(float(x[i])) <= TOL:
            e = [0.0] * n
            e[i] = 1.0
            normals.append(e)
            ids.append(("b", i))
    return normals, ids


def _normal_of(lp: LinearProgram, cid: tuple, n: int) -> list[float]:
    kind, idx = cid
    if kind == "c":
        return [float(a) for a in lp.constraints[idx].coeffs]
    e = [0.0] * n
    e[idx] = 1.0
    return e


def _edges(lp: LinearProgram, vertices: list[list[float]], n: int) -> list[list[int]]:
    tights = [_tight(lp, v, n)[1] for v in vertices]
    edges: list[list[int]] = []
    for i in range(len(vertices)):
        for j in range(i + 1, len(vertices)):
            common = set(tights[i]) & set(tights[j])
            if not common:
                continue
            normals = [_normal_of(lp, cid, n) for cid in common]
            if _rank(normals) >= n - 1:
                edges.append([i, j])
    return edges


def _bounded(lp: LinearProgram, n: int) -> bool:
    """Bounded iff sup x_i is finite for every i (x >= 0 already bounds below)."""
    from .reference import solve

    for i in range(n):
        obj = [0.0] * n
        obj[i] = 1.0
        probe = LinearProgram(Direction.Maximize, obj, lp.constraints, lp.var_names)
        try:
            sol = solve(probe, SolveOptions())
        except Exception:
            continue
        if sol.status is Status.Unbounded:
            return False
    return True
