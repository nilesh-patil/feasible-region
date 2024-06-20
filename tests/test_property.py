"""Property-based tests over random feasible, bounded LPs.

A deterministic generator (``random.Random(seed)``, fixed & logged seeds so any
failure reproduces) draws small-integer maximize LPs with 2-4 vars and 2-6 ``<=``
constraints. Feasibility is free — every constraint has ``rhs >= 0`` so the origin
is feasible — and boundedness is enforced by *rejecting* draws SciPy HiGHS
classifies as unbounded.

For each generated LP the reference solver MUST satisfy the four invariants:
  * **optimum at a vertex** — ``x`` saturates ``n`` independent constraints;
  * **no constraint violated** — feasible to ``1e-9``;
  * **rule agreement** — Dantzig and Bland agree on ``objective_value`` (1e-6);
  * **oracle agreement** — ``objective_value`` within ``1e-6`` of SciPy HiGHS.
"""

import random

import pytest

np = pytest.importorskip("numpy")
scipy_optimize = pytest.importorskip("scipy.optimize")
linprog = scipy_optimize.linprog

from feasible_region import (
    Constraint,
    Direction,
    LinearProgram,
    Op,
    PivotRule,
    SolveOptions,
    Status,
)
from feasible_region.reference import solve

from conftest import dot

pytestmark = pytest.mark.oracle

# A fixed batch of seeds — the pytest parameter id logs each one, so a red run
# points straight at the reproducing seed.
SEEDS = list(range(60))

_OPTIMAL = 0
_ACTIVE_TOL = 1e-6  # a snapped optimum sits ~exactly on its tight constraints


def _scipy_max(lp):
    """(status_code, maximised optimum) from HiGHS for an all-``le`` maximize LP."""
    c = [-float(v) for v in lp.objective]  # linprog minimises
    A_ub = [[float(v) for v in con.coeffs] for con in lp.constraints]
    b_ub = [float(con.rhs) for con in lp.constraints]
    res = linprog(c=c, A_ub=A_ub, b_ub=b_ub, bounds=[(0, None)] * len(c), method="highs")
    return res.status, (-res.fun if res.status == _OPTIMAL else None)


def _generate(seed):
    """Draw one random feasible, bounded maximize LP for ``seed``."""
    rng = random.Random(seed)
    for _ in range(400):  # rejection budget; unbounded draws are redrawn
        n = rng.randint(2, 4)
        m = rng.randint(2, 6)
        objective = [float(rng.randint(-5, 6)) for _ in range(n)]
        constraints = [
            Constraint(
                [float(rng.randint(-3, 5)) for _ in range(n)],
                Op.Le,
                float(rng.randint(0, 10)),
            )
            for _ in range(m)
        ]
        lp = LinearProgram(Direction.Maximize, objective, constraints)
        status, opt = _scipy_max(lp)
        if status == _OPTIMAL:  # bounded & feasible
            return lp, opt
    raise AssertionError("seed %d: generator exhausted its bounded-draw budget" % seed)


def _assert_feasible(lp, x, tol=1e-9):
    assert len(x) == len(lp.objective)
    assert all(xi >= -tol for xi in x), "negative variable in %r" % (x,)
    for con in lp.constraints:
        assert dot(con.coeffs, x) <= con.rhs + tol, "constraint %r violated by %r" % (con, x)


def _saturates_a_vertex(lp, x, tol=_ACTIVE_TOL):
    """True iff the tight constraints (incl. ``x_i >= 0``) pin all n variables.

    A basic feasible solution lies where ``>= n`` linearly independent constraint
    normals are active; rank of the active-normal matrix ``== n`` is that pinning.
    """
    n = len(lp.objective)
    rows = []
    for con in lp.constraints:
        if abs(dot(con.coeffs, x) - con.rhs) <= tol:
            rows.append([float(v) for v in con.coeffs])
    for j in range(n):
        if abs(x[j]) <= tol:  # the nonnegativity bound x_j >= 0 is tight
            rows.append([1.0 if k == j else 0.0 for k in range(n)])
    if not rows:
        return False
    return int(np.linalg.matrix_rank(np.array(rows, dtype=float))) == n


@pytest.mark.parametrize("seed", SEEDS)
def test_generated_lp_satisfies_invariants(seed):
    lp, oracle_opt = _generate(seed)

    dantzig = solve(lp, SolveOptions(pivot_rule=PivotRule.Dantzig))
    bland = solve(lp, SolveOptions(pivot_rule=PivotRule.Bland))

    # The draw is bounded & feasible, so both rules must reach Optimal.
    assert dantzig.status is Status.Optimal, "seed %d: Dantzig -> %s" % (seed, dantzig.status)
    assert bland.status is Status.Optimal, "seed %d: Bland -> %s" % (seed, bland.status)

    # (2) no constraint violated — feasibility to 1e-9.
    _assert_feasible(lp, dantzig.x, tol=1e-9)
    _assert_feasible(lp, bland.x, tol=1e-9)

    # (1) optimum at a vertex — the returned x is a basic feasible solution.
    assert _saturates_a_vertex(lp, dantzig.x), "seed %d: Dantzig x=%r not a vertex" % (seed, dantzig.x)
    assert _saturates_a_vertex(lp, bland.x), "seed %d: Bland x=%r not a vertex" % (seed, bland.x)

    # (3) rule agreement — Dantzig and Bland agree on the value within 1e-6
    # (they may land on different optimal vertices; the value is what must match).
    assert dantzig.objective_value == pytest.approx(bland.objective_value, abs=1e-6), (
        "seed %d: Dantzig %r vs Bland %r" % (seed, dantzig.objective_value, bland.objective_value)
    )

    # (4) oracle agreement — objective within 1e-6 of SciPy HiGHS.
    assert dantzig.objective_value == pytest.approx(oracle_opt, abs=1e-6), (
        "seed %d: ours %r vs HiGHS %r" % (seed, dantzig.objective_value, oracle_opt)
    )


def test_generator_is_deterministic_per_seed():
    # Fixed seeds must reproduce the same LP (the "logged seeds" guarantee).
    lp_a, opt_a = _generate(7)
    lp_b, opt_b = _generate(7)
    assert lp_a == lp_b
    assert opt_a == pytest.approx(opt_b, abs=1e-12)
