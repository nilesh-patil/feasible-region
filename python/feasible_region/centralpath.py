"""Offline interior-point central-path tracer.

For a maximize LP over ``a_k . x <= b_k, x >= 0`` (teaching scale, n <= 3, le
rows only) this follows the log-barrier central path with damped Newton steps as
the barrier parameter ``mu`` decreases geometrically. The race figure REPLAYS
the emitted ``feasible-centralpath/v1`` file; no live solver is involved.

Emits ``{schema, fixture, points, mu_values}``. Pure Python, stdlib only.
"""

from __future__ import annotations

from ._types import Direction, LinearProgram, Op

SCHEMA = "feasible-centralpath/v1"


def supported(lp: LinearProgram) -> bool:
    """The tracer handles small, le-only, maximize programs."""
    return (
        lp.direction is Direction.Maximize
        and len(lp.objective) <= 3
        and all(con.op is Op.Le for con in lp.constraints)
    )


def central_path(lp: LinearProgram, steps: int = 24) -> dict:
    """Return ``{points, mu_values}`` from analytic centre toward the optimum."""
    n = len(lp.objective)
    c = [float(v) for v in lp.objective]
    rows = [[float(a) for a in con.coeffs] for con in lp.constraints]
    rhs = [float(con.rhs) for con in lp.constraints]

    x = _interior_start(rows, rhs, n)
    # Start high enough that the barrier dominates the objective at the first
    # iterate (analytic centre), scaled to the fixture: a fixed mu=1 is already
    # negligible against an objective in the thousands.
    mu = max(1.0, max(abs(b) for b in rhs))
    points: list[list[float]] = []
    mu_values: list[float] = []
    for _ in range(steps):
        x = _center(c, rows, rhs, x, mu)
        points.append([_clean(v) for v in x])
        mu_values.append(mu)
        mu *= 0.6
    return {"points": points, "mu_values": mu_values}


def trace(lp: LinearProgram, fixture: str, steps: int = 24) -> dict:
    body = central_path(lp, steps=steps)
    return {
        "schema": SCHEMA,
        "fixture": fixture,
        "points": body["points"],
        "mu_values": body["mu_values"],
    }


# --------------------------------------------------------------------------- #
# Newton centering for  maximize c.x + mu * ( sum log(b-a.x) + sum log x ).
# --------------------------------------------------------------------------- #
def _interior_start(rows, rhs, n):
    # A tiny strictly-interior guess; scaled down until every slack is positive.
    x = [1.0] * n
    for _ in range(60):
        if all(x[i] > 1e-6 for i in range(n)) and all(
            rhs[k] - sum(rows[k][i] * x[i] for i in range(n)) > 1e-6
            for k in range(len(rows))
        ):
            return x
        x = [v * 0.5 for v in x]
    return [1e-3] * n


def _center(c, rows, rhs, x, mu, iters=40):
    n = len(x)
    for _ in range(iters):
        slack = [rhs[k] - sum(rows[k][i] * x[i] for i in range(n)) for k in range(len(rows))]
        if any(s <= 0 for s in slack) or any(xi <= 0 for xi in x):
            return x  # numerical guard; keep the last good point
        grad = list(c)
        for i in range(n):
            grad[i] += mu / x[i]
        for k in range(len(rows)):
            inv = mu / slack[k]
            for i in range(n):
                grad[i] -= inv * rows[k][i]
        hess = [[0.0] * n for _ in range(n)]
        for i in range(n):
            hess[i][i] += mu / (x[i] * x[i])
        for k in range(len(rows)):
            inv2 = mu / (slack[k] * slack[k])
            for i in range(n):
                for j in range(n):
                    hess[i][j] += inv2 * rows[k][i] * rows[k][j]
        step = _solve(hess, grad)
        if step is None:
            return x
        alpha = _line_search(rows, rhs, x, step)
        x = [x[i] + alpha * step[i] for i in range(n)]
        if max(abs(alpha * step[i]) for i in range(n)) < 1e-10:
            break
    return x


def _line_search(rows, rhs, x, step):
    alpha = 1.0
    n = len(x)
    for _ in range(50):
        cand = [x[i] + alpha * step[i] for i in range(n)]
        ok = all(v > 1e-9 for v in cand) and all(
            rhs[k] - sum(rows[k][i] * cand[i] for i in range(n)) > 1e-9
            for k in range(len(rows))
        )
        if ok:
            return alpha
        alpha *= 0.5
    return 0.0


def _solve(mat, rhs):
    n = len(rhs)
    aug = [list(mat[i]) + [rhs[i]] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-12:
            return None
        aug[col], aug[pivot] = aug[pivot], aug[col]
        pv = aug[col][col]
        aug[col] = [v / pv for v in aug[col]]
        for r in range(n):
            if r != col:
                f = aug[r][col]
                aug[r] = [aug[r][j] - f * aug[col][j] for j in range(n + 1)]
    return [aug[i][n] for i in range(n)]


def _clean(v: float) -> float:
    if abs(v) < 1e-12:
        return 0.0
    return round(v, 10)
