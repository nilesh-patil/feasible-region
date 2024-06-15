"""Brute-force polytope geometry.

`feasible_region.geometry.enumerate_geometry(lp)` returns
`{vertices: [[f64]], edges: [[int,int]], bounded: bool}` for teaching-scale LPs
(n <= 3). Checks: every vertex is feasible and pinned by >= n independent tight
constraints; every edge joins two vertices sharing >= n-1 tight constraints; and
the 2D statquest region is a convex-ordered quadrilateral.
"""

import math

import numpy as np
import pytest

from feasible_region import Op

from conftest import build_lp, geometry_of

TOL = 1e-6


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _tight(lp, v):
    """Return (normals, ids) for constraints (incl. x_i>=0 bounds) tight at v."""
    normals, ids = [], []
    for k, con in enumerate(lp.constraints):
        lhs = sum(float(a) * float(b) for a, b in zip(con.coeffs, v))
        if abs(lhs - float(con.rhs)) <= TOL:
            normals.append([float(a) for a in con.coeffs])
            ids.append(("c", k))
    n = len(lp.objective)
    for i in range(n):
        if abs(float(v[i])) <= TOL:
            e = [0.0] * n
            e[i] = 1.0
            normals.append(e)
            ids.append(("b", i))
    return normals, ids


def _rank(normals):
    if not normals:
        return 0
    return int(np.linalg.matrix_rank(np.array(normals, dtype=float), tol=1e-7))


def _feasible(lp, v):
    for xi in v:
        if xi < -TOL:
            return False
    for con in lp.constraints:
        lhs = sum(float(a) * float(b) for a, b in zip(con.coeffs, v))
        if con.op is Op.Le and lhs > float(con.rhs) + TOL:
            return False
        if con.op is Op.Ge and lhs < float(con.rhs) - TOL:
            return False
        if con.op is Op.Eq and abs(lhs - float(con.rhs)) > TOL:
            return False
    return True


def _dedup_edges(edges):
    seen = set()
    out = []
    for e in edges:
        key = frozenset((int(e[0]), int(e[1])))
        if len(key) == 2 and key not in seen:
            seen.add(key)
            out.append((int(e[0]), int(e[1])))
    return out


# --------------------------------------------------------------------------- #
# Shape of the geometry object.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", ["topic21", "statquest"])
def test_geometry_shape(name):
    lp = build_lp(name)
    n = len(lp.objective)
    geo = geometry_of(lp)

    assert set(("vertices", "edges", "bounded")).issubset(geo)
    assert isinstance(geo["bounded"], bool)
    assert len(geo["vertices"]) >= 1
    for v in geo["vertices"]:
        assert len(v) == n
    nv = len(geo["vertices"])
    for e in geo["edges"]:
        assert len(e) == 2
        assert 0 <= int(e[0]) < nv
        assert 0 <= int(e[1]) < nv
        assert int(e[0]) != int(e[1])


# --------------------------------------------------------------------------- #
# Vertices satisfy all constraints and are genuine polytope corners.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", ["topic21", "statquest"])
def test_vertices_are_feasible_and_pinned(name):
    lp = build_lp(name)
    n = len(lp.objective)
    geo = geometry_of(lp)
    assert geo["bounded"] is True
    for v in geo["vertices"]:
        assert _feasible(lp, v), "infeasible vertex %r" % (v,)
        normals, _ = _tight(lp, v)
        # a vertex is the intersection of >= n independent facets.
        assert _rank(normals) == n


# --------------------------------------------------------------------------- #
# Edges connect adjacent vertices (share >= n-1 independent tight facets).
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", ["topic21", "statquest"])
def test_edges_connect_adjacent_vertices(name):
    lp = build_lp(name)
    n = len(lp.objective)
    geo = geometry_of(lp)
    verts = geo["vertices"]
    edges = _dedup_edges(geo["edges"])
    assert edges, "polytope should have at least one edge"

    for a, b in edges:
        _, ids_a = _tight(lp, verts[a])
        _, ids_b = _tight(lp, verts[b])
        common = set(ids_a) & set(ids_b)
        normals = []
        for con_id in common:
            kind, idx = con_id
            if kind == "c":
                normals.append([float(c) for c in lp.constraints[idx].coeffs])
            else:
                e = [0.0] * n
                e[idx] = 1.0
                normals.append(e)
        assert _rank(normals) >= n - 1


# --------------------------------------------------------------------------- #
# 2D statquest polygon is a convex-ordered quadrilateral.
# --------------------------------------------------------------------------- #
def test_statquest_vertices_are_the_four_corners():
    lp = build_lp("statquest")
    geo = geometry_of(lp)
    got = {tuple(round(c, 6) for c in v) for v in geo["vertices"]}
    expected = {(0.0, 0.0), (4.0, 0.0), (3.0, 1.0), (0.0, 2.0)}
    assert got == expected


def test_statquest_polygon_is_convex_ordered():
    lp = build_lp("statquest")
    geo = geometry_of(lp)
    verts = [list(v) for v in geo["vertices"]]
    edges = _dedup_edges(geo["edges"])
    nv = len(verts)

    # Each vertex of a simple polygon has degree exactly 2.
    deg = {i: 0 for i in range(nv)}
    adj = {i: [] for i in range(nv)}
    for a, b in edges:
        deg[a] += 1
        deg[b] += 1
        adj[a].append(b)
        adj[b].append(a)
    assert all(deg[i] == 2 for i in range(nv))
    assert len(edges) == nv  # a single closed quadrilateral

    # Walk the single cycle and confirm the traversal is convex.
    order = [0]
    prev, cur = None, 0
    for _ in range(nv - 1):
        nxt = [x for x in adj[cur] if x != prev][0]
        order.append(nxt)
        prev, cur = cur, nxt
    assert sorted(order) == list(range(nv))  # one cycle through every vertex

    pts = [verts[i] for i in order]
    signs = []
    for i in range(nv):
        a = pts[i]
        b = pts[(i + 1) % nv]
        c = pts[(i + 2) % nv]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        signs.append(cross)
    all_ccw = all(s >= -1e-9 for s in signs)
    all_cw = all(s <= 1e-9 for s in signs)
    assert all_ccw or all_cw, "polygon edge order is not convex"


def test_bounded_flag_true_for_bounded_region():
    assert geometry_of(build_lp("topic21"))["bounded"] is True
    assert geometry_of(build_lp("statquest"))["bounded"] is True
