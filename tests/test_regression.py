"""Regression tests for two fixed reference-solver bugs.

Each test reproduces a bug that shipped green against the maximize/le-only fixture
catalogue but broke on Ge/Eq systems — the classes the golden fixtures never cover:

  * **Phase-1 artificials left basic** — after phase 1 the solver never drove a
    still-basic artificial out, so it later reported a super-optimal
    *infeasible* vertex, or a false ``Unbounded`` on a bounded feasible LP.
  * **Wrong duals** — shadow prices were read off the ``-1`` surplus of a ``ge``
    row and off the internally-maximized ``-objective`` for Minimize, so strong
    duality ``dot(b, y) == dot(c, x)`` failed for every ``ge`` / Minimize problem.

These are rule-independent, so the artificial cases sweep all three pivot rules.
"""

import pytest

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

RULES = [PivotRule.Bland, PivotRule.Dantzig, PivotRule.DantzigNaive]
APPROX = dict(abs=1e-9)


def _assert_feasible(lp, x):
    assert all(xi >= -1e-9 for xi in x), "negative variable in %r" % (x,)
    for con in lp.constraints:
        lhs = dot(con.coeffs, x)
        if con.op is Op.Le:
            assert lhs <= con.rhs + 1e-9, "%r violated by %r" % (con, x)
        elif con.op is Op.Ge:
            assert lhs >= con.rhs - 1e-9, "%r violated by %r" % (con, x)
        else:
            assert abs(lhs - con.rhs) <= 1e-9, "%r violated by %r" % (con, x)


# --------------------------------------------------------------------------- #
# Bug 1 — phase-1 artificial must be driven out before phase 2.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("rule", RULES)
def test_ge_bound_does_not_yield_infeasible_optimum(rule):
    # minimize -x1 s.t. -x1>=0 (forces x1<=0), x1<=2.  Only feasible point is x1=0.
    # Pre-fix: reported Optimal x=[2], obj=-2 — a vertex that violates -x1>=0 with an
    # objective BETTER than the true optimum (0), the artificial absorbing the slack.
    lp = LinearProgram(
        Direction.Minimize, [-1.0],
        [Constraint([-1.0], Op.Ge, 0.0), Constraint([1.0], Op.Le, 2.0)],
    )
    sol = solve(lp, SolveOptions(pivot_rule=rule))
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([0.0], **APPROX)
    assert sol.objective_value == pytest.approx(0.0, **APPROX)
    _assert_feasible(lp, sol.x)


@pytest.mark.parametrize("rule", RULES)
def test_eq_pin_is_not_reported_unbounded(rule):
    # minimize -x1 s.t. -x1=0.  Only x1=0 is feasible; optimum 0, bounded.
    # Pre-fix: false Unbounded (the still-basic artificial had a negative entry in
    # the entering column, so the ratio test found no limiting row).
    lp = LinearProgram(Direction.Minimize, [-1.0], [Constraint([-1.0], Op.Eq, 0.0)])
    sol = solve(lp, SolveOptions(pivot_rule=rule))
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([0.0], **APPROX)
    assert sol.objective_value == pytest.approx(0.0, **APPROX)


@pytest.mark.parametrize("rule", RULES)
def test_mixed_eq_ge_optimum_is_feasible_and_bounded(rule):
    # A mixed Le/Eq/Ge system whose phase 1 ends with a degenerate basic artificial.
    # Pre-fix: Optimal with x=[0.2, 0.1333, 0] while the artificial sat basic at 0.6,
    # so the equality row -3x1-2x3=0 was off by 0.6 — an infeasible "optimum".
    lp = LinearProgram(
        Direction.Maximize, [0.0, 2.0, 0.0],
        [
            Constraint([3.0, 3.0, 1.0], Op.Le, 1.0),
            Constraint([-2.0, 3.0, 1.0], Op.Le, 0.0),
            Constraint([-3.0, 0.0, -2.0], Op.Eq, 0.0),
            Constraint([1.0, -1.0, 1.0], Op.Ge, -5.0),
            Constraint([-2.0, -1.0, 0.0], Op.Le, 10.0),
        ],
    )
    sol = solve(lp, SolveOptions(pivot_rule=rule))
    assert sol.status is Status.Optimal
    _assert_feasible(lp, sol.x)  # the equality must hold exactly, not be absorbed


# --------------------------------------------------------------------------- #
# Bug 2 — duals obey strong duality dot(b, y) == dot(c, x).
# --------------------------------------------------------------------------- #
def _strong_duality(lp, sol):
    return dot([c.rhs for c in lp.constraints], sol.duals)


def test_minimize_ge_duals_satisfy_strong_duality():
    # minimize 2x1+3x2 s.t. x1+x2>=10, x1<=8, x2<=8 -> x=(8,2), c.x=22.
    # Correct shadow prices [3,-1,0] give b.y = 30-8+0 = 22 (SciPy marginals agree).
    lp = LinearProgram(
        Direction.Minimize, [2.0, 3.0],
        [
            Constraint([1.0, 1.0], Op.Ge, 10.0),
            Constraint([1.0, 0.0], Op.Le, 8.0),
            Constraint([0.0, 1.0], Op.Le, 8.0),
        ],
    )
    sol = solve(lp, SolveOptions(pivot_rule=PivotRule.Bland))
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([8.0, 2.0], **APPROX)
    assert sol.duals == pytest.approx([3.0, -1.0, 0.0], **APPROX)
    assert _strong_duality(lp, sol) == pytest.approx(sol.objective_value, **APPROX)


def test_maximize_binding_ge_dual_has_correct_sign():
    # maximize -x1 s.t. x1>=2 (binding), x1<=5 -> x=2, c.x=-2.
    # Pre-fix the ge dual came out +1 (read off the -1 surplus); correct is -1.
    lp = LinearProgram(
        Direction.Maximize, [-1.0],
        [Constraint([1.0], Op.Ge, 2.0), Constraint([1.0], Op.Le, 5.0)],
    )
    sol = solve(lp, SolveOptions(pivot_rule=PivotRule.Bland))
    assert sol.status is Status.Optimal
    assert sol.duals == pytest.approx([-1.0, 0.0], **APPROX)
    assert _strong_duality(lp, sol) == pytest.approx(sol.objective_value, **APPROX)


def test_minimize_le_only_duals_satisfy_strong_duality():
    # minimize -3x1-2x2 s.t. x1+x2<=4, x1+3x2<=6 -> c.x=-12; b.y must equal -12.
    lp = LinearProgram(
        Direction.Minimize, [-3.0, -2.0],
        [Constraint([1.0, 1.0], Op.Le, 4.0), Constraint([1.0, 3.0], Op.Le, 6.0)],
    )
    sol = solve(lp, SolveOptions(pivot_rule=PivotRule.Bland))
    assert sol.status is Status.Optimal
    assert sol.objective_value == pytest.approx(-12.0, **APPROX)
    assert _strong_duality(lp, sol) == pytest.approx(sol.objective_value, **APPROX)


def test_negative_rhs_row_duals_satisfy_strong_duality():
    # A negative-rhs Ge row is normalized (row *= -1); its dual must flip back so
    # strong duality still holds. minimize x1+x2 s.t. -x1-x2<=-3 (i.e. x1+x2>=3),
    # x1<=5 -> x=(3,0), c.x=3.
    lp = LinearProgram(
        Direction.Minimize, [1.0, 1.0],
        [Constraint([-1.0, -1.0], Op.Le, -3.0), Constraint([1.0, 0.0], Op.Le, 5.0)],
    )
    sol = solve(lp, SolveOptions(pivot_rule=PivotRule.Bland))
    assert sol.status is Status.Optimal
    assert sol.objective_value == pytest.approx(3.0, **APPROX)
    assert _strong_duality(lp, sol) == pytest.approx(sol.objective_value, **APPROX)
