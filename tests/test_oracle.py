"""Oracle cross-checks against scipy HiGHS.

`linprog` MINIMISES, so a Maximize objective is negated in and the optimum
negated back. Constraints feed as A_ub x <= b_ub (Ge rows negated) / A_eq x =
b_eq, with implicit x >= 0 via bounds=(0, None). The oracle validates
optimality (status + objective + feasibility), never the pivot path.
"""

import pytest

from feasible_region import Direction, Op
from feasible_region.reference import solve
from feasible_region import Status

from conftest import (
    BOUNDED_FEASIBLE,
    INFEASIBLE,
    UNBOUNDED,
    build_lp,
    dot,
    options_for,
)

scipy_optimize = pytest.importorskip("scipy.optimize")
linprog = scipy_optimize.linprog

pytestmark = pytest.mark.oracle

# HiGHS status codes.
_OPTIMAL, _INFEASIBLE, _UNBOUNDED = 0, 2, 3


def _scipy_solve(lp):
    n = len(lp.objective)
    c = [float(v) for v in lp.objective]
    if lp.direction is Direction.Maximize:
        c = [-v for v in c]
    A_ub, b_ub, A_eq, b_eq = [], [], [], []
    for con in lp.constraints:
        row = [float(v) for v in con.coeffs]
        if con.op is Op.Le:
            A_ub.append(row)
            b_ub.append(float(con.rhs))
        elif con.op is Op.Ge:
            A_ub.append([-v for v in row])
            b_ub.append(-float(con.rhs))
        else:  # Eq
            A_eq.append(row)
            b_eq.append(float(con.rhs))
    kwargs = dict(c=c, bounds=[(0, None)] * n, method="highs")
    if A_ub:
        kwargs.update(A_ub=A_ub, b_ub=b_ub)
    if A_eq:
        kwargs.update(A_eq=A_eq, b_eq=b_eq)
    return linprog(**kwargs)


def _oracle_maximum(lp):
    """Return (status_code, maximised optimum) from HiGHS."""
    res = _scipy_solve(lp)
    opt = None
    if res.status == _OPTIMAL:
        opt = -res.fun if lp.direction is Direction.Maximize else res.fun
    return res.status, opt


def _assert_feasible(lp, x, tol=1e-9):
    assert len(x) == len(lp.objective)
    for xi in x:
        assert xi >= -tol, "negative variable %r" % xi
    for con in lp.constraints:
        lhs = dot(con.coeffs, x)
        if con.op is Op.Le:
            assert lhs <= con.rhs + tol
        elif con.op is Op.Ge:
            assert lhs >= con.rhs - tol
        else:
            assert abs(lhs - con.rhs) <= tol


# --------------------------------------------------------------------------- #
# Bounded, feasible fixtures: status match + objective within 1e-6 + our x
# feasible within 1e-9.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", BOUNDED_FEASIBLE)
def test_bounded_feasible_matches_scipy(name):
    lp = build_lp(name)
    sol = solve(lp, options_for(name))
    status_code, oracle_opt = _oracle_maximum(lp)

    assert status_code == _OPTIMAL
    assert sol.status is Status.Optimal
    assert sol.objective_value == pytest.approx(oracle_opt, abs=1e-6)
    _assert_feasible(lp, sol.x, tol=1e-9)


# --------------------------------------------------------------------------- #
# Status agreement on the degenerate corner cases.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", UNBOUNDED)
def test_unbounded_status_matches_scipy(name):
    lp = build_lp(name)
    sol = solve(lp, options_for(name))
    status_code, _ = _oracle_maximum(lp)
    assert sol.status is Status.Unbounded
    assert status_code == _UNBOUNDED


@pytest.mark.parametrize("name", INFEASIBLE)
def test_infeasible_status_matches_scipy(name):
    lp = build_lp(name)
    sol = solve(lp, options_for(name))
    status_code, _ = _oracle_maximum(lp)
    assert sol.status is Status.Infeasible
    assert status_code == _INFEASIBLE
