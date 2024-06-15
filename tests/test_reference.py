"""Behavioural tests for the pure-Python reference solver.

Covers: topic21 optimum & exact Dantzig vertex path, statquest, minimize-direction
negation, Ge/Eq two-phase, unbounded/infeasible statuses, Klee-Minty vertex count,
degeneracy under Bland / DantzigNaive / safeguarded Dantzig, duals, and input
validation errors.
"""

import pytest

import feasible_region as fr
from feasible_region import (
    Constraint,
    Direction,
    LinearProgram,
    Op,
    PivotRule,
    SolveError,
    SolveOptions,
    Status,
)
from feasible_region.reference import solve

from conftest import (
    EXPECTED,
    build_degenerate1,
    build_lp,
    solve_fixture,
)

APPROX = dict(abs=1e-6)


def _vertices(trace):
    return [list(step["vertex"]) for step in trace["steps"]]


def _pivot_count(trace):
    # Every step with a non-null `entering` performed a pivot; the terminal
    # optimal/infeasible step carries entering=None.
    return sum(1 for s in trace["steps"] if s["entering"] is not None)


# --------------------------------------------------------------------------- #
# topic21 — the canonical regression anchor.
# --------------------------------------------------------------------------- #
def test_topic21_optimum():
    sol = solve_fixture("topic21")
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([9.0, 9.0, 4.0], **APPROX)
    assert sol.objective_value == pytest.approx(22.0, **APPROX)


def test_topic21_exact_dantzig_vertex_path():
    sol = solve_fixture("topic21", record_trace=True)
    trace = sol.trace
    assert trace is not None
    verts = _vertices(trace)
    # pytest>=8 dropped nested pytest.approx; compare per-vertex (same tolerance).
    assert verts == [
        pytest.approx(v, **APPROX)
        for v in [[0, 0, 0], [8, 0, 0], [12, 3, 0], [12, 3, 4], [9, 9, 4]]
    ]
    assert len(trace["steps"]) == 5
    assert _pivot_count(trace) == 4


def test_topic21_iterations_counter():
    sol = solve_fixture("topic21")
    assert sol.iterations == 4


def test_topic21_snaps_to_exact_integers():
    # output values within eps of an integer are snapped.
    sol = solve_fixture("topic21")
    assert sol.x == [9.0, 9.0, 4.0]
    assert sol.objective_value == 22.0


def test_fixtures_registry_topic21_solves_to_22():
    from feasible_region import fixtures

    sol = solve(fixtures.by_name("topic21"), SolveOptions())
    assert sol.status is Status.Optimal
    assert sol.objective_value == pytest.approx(22.0, **APPROX)
    assert sol.x == pytest.approx([9.0, 9.0, 4.0], **APPROX)


# --------------------------------------------------------------------------- #
# statquest — single-pivot phase-2 walk.
# --------------------------------------------------------------------------- #
def test_statquest_optimum_and_path():
    sol = solve_fixture("statquest", record_trace=True)
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([4.0, 0.0], **APPROX)
    assert sol.objective_value == pytest.approx(12.0, **APPROX)
    # pytest>=8 dropped nested pytest.approx; compare per-vertex (same tolerance).
    assert _vertices(sol.trace) == [pytest.approx(v, **APPROX) for v in [[0, 0], [4, 0]]]


# --------------------------------------------------------------------------- #
# Direction handling — Minimize negates in and out; x unchanged.
# --------------------------------------------------------------------------- #
def test_minimize_direction_negates_objective_value():
    # minimize -(3x1+2x2) over the statquest polytope == maximize 3x1+2x2.
    lp = LinearProgram(
        direction=Direction.Minimize,
        objective=[-3.0, -2.0],
        constraints=[
            Constraint([1.0, 1.0], Op.Le, 4.0),
            Constraint([1.0, 3.0], Op.Le, 6.0),
        ],
    )
    sol = solve(lp, SolveOptions())
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([4.0, 0.0], **APPROX)
    # internal max value is 12, negated back on the way out.
    assert sol.objective_value == pytest.approx(-12.0, **APPROX)


def test_minimize_reaches_true_minimum():
    # minimize x1+x2 s.t. x1>=2, x2>=1  -> (2,1), value 3  (Ge rows -> phase 1).
    lp = LinearProgram(
        direction=Direction.Minimize,
        objective=[1.0, 1.0],
        constraints=[
            Constraint([1.0, 0.0], Op.Ge, 2.0),
            Constraint([0.0, 1.0], Op.Ge, 1.0),
        ],
    )
    sol = solve(lp, SolveOptions())
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([2.0, 1.0], **APPROX)
    assert sol.objective_value == pytest.approx(3.0, **APPROX)


# --------------------------------------------------------------------------- #
# Ge / Eq constraints via the two-phase method.
# --------------------------------------------------------------------------- #
def test_ge_constraint_two_phase():
    # maximize x1 s.t. x1>=2, x1<=5  -> x1=5 (the >= makes the origin infeasible).
    lp = LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0],
        constraints=[
            Constraint([1.0], Op.Ge, 2.0),
            Constraint([1.0], Op.Le, 5.0),
        ],
    )
    sol = solve(lp, SolveOptions())
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([5.0], **APPROX)
    assert sol.objective_value == pytest.approx(5.0, **APPROX)


def test_eq_constraint_two_phase():
    # maximize x1+x2 s.t. x1+x2=3, x1<=2  -> objective pinned to 3, x feasible.
    lp = LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[
            Constraint([1.0, 1.0], Op.Eq, 3.0),
            Constraint([1.0, 0.0], Op.Le, 2.0),
        ],
    )
    sol = solve(lp, SolveOptions())
    assert sol.status is Status.Optimal
    assert sol.objective_value == pytest.approx(3.0, **APPROX)
    assert sol.x[0] + sol.x[1] == pytest.approx(3.0, abs=1e-9)
    assert sol.x[0] <= 2.0 + 1e-9
    assert all(v >= -1e-9 for v in sol.x)


def test_maxflow_two_phase_optimum():
    # equalities force phase 1; deterministic Dantzig optimum.
    sol = solve_fixture("maxflow")
    assert sol.status is Status.Optimal
    assert sol.objective_value == pytest.approx(8.0, **APPROX)
    assert sol.x == pytest.approx(EXPECTED["maxflow"]["x"], **APPROX)


def test_shortestpath_optimum():
    sol = solve_fixture("shortestpath")
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([1.0, 3.0, 4.0], **APPROX)
    assert sol.objective_value == pytest.approx(4.0, **APPROX)


# --------------------------------------------------------------------------- #
# Unbounded / infeasible statuses.
# --------------------------------------------------------------------------- #
def test_unbounded1_reports_unbounded():
    sol = solve_fixture("unbounded1")
    assert sol.status is Status.Unbounded


def test_infeasible1_reports_infeasible():
    sol = solve_fixture("infeasible1")
    assert sol.status is Status.Infeasible
    assert sol.x == []


# --------------------------------------------------------------------------- #
# Klee-Minty — Dantzig visits all 2^3 = 8 vertices.
# --------------------------------------------------------------------------- #
def test_kleeminty3_optimum():
    sol = solve_fixture("kleeminty3")
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([0.0, 0.0, 10000.0], **APPROX)
    assert sol.objective_value == pytest.approx(10000.0, **APPROX)


def test_kleeminty3_visits_eight_distinct_vertices():
    sol = solve_fixture("kleeminty3", record_trace=True)
    verts = _vertices(sol.trace)
    distinct = {tuple(round(v, 6) for v in vertex) for vertex in verts}
    assert len(distinct) == 8
    assert len(sol.trace["steps"]) == 8
    assert _pivot_count(sol.trace) == 7


# --------------------------------------------------------------------------- #
# Degeneracy suite.
# --------------------------------------------------------------------------- #
def test_degenerate1_bland_terminates_optimal():
    lp = build_degenerate1()
    sol = solve(lp, SolveOptions(pivot_rule=PivotRule.Bland))
    assert sol.status is Status.Optimal
    assert sol.x == pytest.approx([1.0, 0.0, 1.0, 0.0], **APPROX)
    assert sol.objective_value == pytest.approx(1.0, **APPROX)


def test_degenerate1_dantzig_naive_hits_iteration_limit():
    lp = build_degenerate1()
    opts = SolveOptions(pivot_rule=PivotRule.DantzigNaive, max_iterations=30)
    with pytest.raises(SolveError) as excinfo:
        solve(lp, opts)
    assert excinfo.value.kind == "IterationLimit"


def test_degenerate1_safeguarded_dantzig_does_not_hang():
    # Safeguarded Dantzig keeps the lowest-basic-index leaving tie-break: it MUST
    # either terminate at the optimum or hit the iteration cap — never hang.
    lp = build_degenerate1()
    opts = SolveOptions(pivot_rule=PivotRule.Dantzig, max_iterations=1000)
    try:
        sol = solve(lp, opts)
    except SolveError as err:
        assert err.kind == "IterationLimit"
    else:
        assert sol.status is Status.Optimal
        assert sol.objective_value == pytest.approx(1.0, **APPROX)
        assert sol.x == pytest.approx([1.0, 0.0, 1.0, 0.0], **APPROX)


# --------------------------------------------------------------------------- #
# Duals — optional, but when present len == m and finite.
# --------------------------------------------------------------------------- #
def test_topic21_duals_contract():
    sol = solve_fixture("topic21")
    if sol.duals is not None:
        assert len(sol.duals) == 5  # m
        assert all(isinstance(v, float) for v in sol.duals)
        # shadow prices of <= rows in a maximisation are non-negative.
        assert all(v >= -1e-6 for v in sol.duals)


def test_duals_none_on_non_optimal():
    sol = solve_fixture("unbounded1")
    assert sol.duals is None


# --------------------------------------------------------------------------- #
# Input validation — errors raised before any tableau is built.
# --------------------------------------------------------------------------- #
def test_dimension_mismatch_on_constraint_width():
    lp = LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[Constraint([1.0, 1.0, 1.0], Op.Le, 1.0)],
    )
    with pytest.raises(SolveError) as excinfo:
        solve(lp, SolveOptions())
    assert excinfo.value.kind == "DimensionMismatch"


def test_dimension_mismatch_on_var_names():
    lp = LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[Constraint([1.0, 1.0], Op.Le, 4.0)],
        var_names=["only_one"],
    )
    with pytest.raises(SolveError) as excinfo:
        solve(lp, SolveOptions())
    assert excinfo.value.kind == "DimensionMismatch"


def test_empty_problem_on_empty_objective():
    lp = LinearProgram(
        direction=Direction.Maximize, objective=[], constraints=[]
    )
    with pytest.raises(SolveError) as excinfo:
        solve(lp, SolveOptions())
    assert excinfo.value.kind == "EmptyProblem"


# --------------------------------------------------------------------------- #
# Top-level backend selection.
# --------------------------------------------------------------------------- #
def test_top_level_solve_uses_reference_fallback():
    sol = fr.solve(build_lp("topic21"), SolveOptions(), backend="reference")
    assert sol.status is Status.Optimal
    assert sol.objective_value == pytest.approx(22.0, **APPROX)


def test_backend_native_without_extension_raises():
    with pytest.raises(Exception):
        fr.solve(build_lp("topic21"), SolveOptions(), backend="native")
