"""Structural invariants of the reference solver's `feasible-trace/v1` output
plus the byte-level determinism guarantee.

Per-step invariants are grouped into a few parametrised checks (pytest still
reports the exact failing assertion) to keep the suite focused. `geometry` and
`result.duals` are Python-CLI-only and are NOT required on reference.solve
traces, so they are not asserted here (see test_cli / test_geometry).
"""

import json

import pytest

from feasible_region.reference import solve

from conftest import (
    EXPECTED,
    FIXTURE_NAMES,
    build_lp,
    dot,
    options_for,
    slack_form_width,
)

EPS = 1e-9
ECHO_SET = ["topic21", "infeasible1", "shortestpath", "maxflow"]  # Le / Ge / Eq mix


def traced(name):
    """Solve a fixture with trace recording under its designated rule."""
    return solve(build_lp(name), options_for(name, record_trace=True)).trace


# --------------------------------------------------------------------------- #
# Top-level object + per-step shape.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_trace_structure(name):
    lp = build_lp(name)
    m = len(lp.constraints)
    n = len(lp.objective)
    n_rows = m + 1
    n_cols = slack_form_width(lp) + 1
    rule_str = {"Dantzig": "dantzig", "Bland": "bland", "DantzigNaive": "dantzig-naive"}[
        EXPECTED[name]["rule"]
    ]

    trace = traced(name)

    # top level
    assert trace["schema"] == "feasible-trace/v1"
    for key in ("problem", "steps", "result"):
        assert key in trace
    assert n >= 1 and m >= 1

    steps = trace["steps"]
    obj = trace["problem"]["objective"]
    phases = []
    for i, step in enumerate(steps):
        # tableau is exactly (m+1) x (N+1)
        assert len(step["tableau"]) == n_rows
        assert all(len(row) == n_cols for row in step["tableau"])
        # basis / vertex lengths
        assert len(step["basis"]) == m
        assert len(step["vertex"]) == n
        # iter sequence is 0,1,2,...
        assert step["iter"] == i
        # rule echoes the option
        assert step["rule"] == rule_str
        # objective_value == dot(original objective, vertex)
        assert step["objective_value"] == pytest.approx(dot(obj, step["vertex"]), abs=1e-6)
        phases.append(step["phase"])

    assert all(p in (1, 2) for p in phases)
    assert all(phases[k] <= phases[k + 1] for k in range(len(phases) - 1))


# --------------------------------------------------------------------------- #
# entering / leaving nullness + range + membership.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_entering_leaving_rules(name):
    lp = build_lp(name)
    N = slack_form_width(lp)
    trace = traced(name)
    steps = trace["steps"]
    status = trace["result"]["status"]

    # non-final steps: both indices present, in range.
    for step in steps[:-1]:
        assert step["entering"] is not None and step["leaving"] is not None
        assert 0 <= step["entering"] < N
        assert 0 <= step["leaving"] < N

    final = steps[-1]
    if status == "optimal":
        assert final["entering"] is None and final["leaving"] is None
    elif status == "unbounded":
        assert final["entering"] is not None and final["leaving"] is None
        assert 0 <= final["entering"] < N
    elif status == "infeasible":
        assert final["entering"] is None and final["leaving"] is None
    else:  # pragma: no cover
        pytest.fail("unexpected result status: %r" % status)

    # membership: leaving column basic before the pivot, entering basic after.
    for i, step in enumerate(steps):
        if step["leaving"] is None:
            continue
        assert i + 1 < len(steps)
        assert step["leaving"] in steps[i]["basis"]
        assert step["entering"] in steps[i + 1]["basis"]


# --------------------------------------------------------------------------- #
# problem echo — the LP as submitted.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", ECHO_SET)
def test_problem_echoes_submitted_lp(name):
    lp = build_lp(name)
    problem = traced(name)["problem"]

    assert problem["direction"] == "maximize"  # every catalogue LP maximises
    assert problem["objective"] == pytest.approx(list(lp.objective), abs=EPS)
    assert len(problem["constraints"]) == len(lp.constraints)

    op_str = {"Le": "le", "Ge": "ge", "Eq": "eq"}
    for echoed, submitted in zip(problem["constraints"], lp.constraints):
        assert echoed["coeffs"] == pytest.approx(list(submitted.coeffs), abs=EPS)
        assert echoed["op"] == op_str[submitted.op.name]
        assert echoed["rhs"] == pytest.approx(submitted.rhs, abs=EPS)


def test_problem_var_names_default_when_unset():
    # topic21 supplies no var_names -> echo defaults to x1..xn.
    assert traced("topic21")["problem"]["var_names"] == ["x1", "x2", "x3"]


def test_problem_var_names_echoed_when_supplied():
    assert traced("shortestpath")["problem"]["var_names"] == ["da", "db", "dt"]
    assert traced("maxflow")["problem"]["var_names"] == [
        "fsa", "fsb", "fac", "fda", "fbd", "fcb", "fct", "fdt",
    ]


# --------------------------------------------------------------------------- #
# result object.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_result_invariants(name):
    lp = build_lp(name)
    n = len(lp.objective)
    trace = traced(name)
    result = trace["result"]

    assert result["status"] in ("optimal", "unbounded", "infeasible")
    assert result["status"] == EXPECTED[name]["status"].lower()

    if result["status"] == "optimal":
        assert len(result["x"]) == n
        # optimal objective equals the terminal step's objective.
        assert result["objective_value"] == pytest.approx(
            trace["steps"][-1]["objective_value"], abs=EPS
        )
    else:
        assert len(result["x"]) == 0


def test_result_len_steps_is_pivots_plus_one():
    # topic21: exactly 4 pivots -> 5 steps.
    assert len(traced("topic21")["steps"]) == 5


# --------------------------------------------------------------------------- #
# Determinism: identical LP + options -> byte-identical JSON.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", ["topic21", "kleeminty3", "maxflow", "infeasible1"])
def test_two_runs_produce_identical_trace(name):
    first = traced(name)
    second = traced(name)
    assert first == second
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
