"""Contract types: exact enum members, frozen dataclass fields/defaults, and the
public package surface."""

import dataclasses
import enum

import pytest

import feasible_region as fr
from feasible_region import (
    Constraint,
    Direction,
    LinearProgram,
    Op,
    PivotRule,
    Solution,
    SolveError,
    SolveOptions,
    Status,
)


# --------------------------------------------------------------------------- #
# Enums — exact member names, nothing extra.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "cls, members",
    [
        (Direction, ["Maximize", "Minimize"]),
        (Op, ["Le", "Ge", "Eq"]),
        (PivotRule, ["Dantzig", "Bland", "DantzigNaive"]),
        (Status, ["Optimal", "Unbounded", "Infeasible"]),
    ],
)
def test_enum_members_exact(cls, members):
    assert issubclass(cls, enum.Enum)
    assert [m.name for m in cls] == members
    for name in members:
        assert getattr(cls, name).name == name


def test_no_unexpected_enum_members():
    assert set(m.name for m in Direction) == {"Maximize", "Minimize"}
    assert set(m.name for m in Op) == {"Le", "Ge", "Eq"}
    assert set(m.name for m in PivotRule) == {"Dantzig", "Bland", "DantzigNaive"}
    assert set(m.name for m in Status) == {"Optimal", "Unbounded", "Infeasible"}


# --------------------------------------------------------------------------- #
# Dataclasses — fields present, frozen, correct defaults.
# --------------------------------------------------------------------------- #
def test_linear_program_is_frozen_dataclass():
    lp = LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[Constraint([1.0, 1.0], Op.Le, 4.0)],
    )
    assert dataclasses.is_dataclass(lp)
    assert lp.var_names is None  # default
    fields = {f.name for f in dataclasses.fields(lp)}
    assert fields == {"direction", "objective", "constraints", "var_names"}
    with pytest.raises(dataclasses.FrozenInstanceError):
        lp.objective = [2.0]


def test_constraint_is_frozen_dataclass():
    c = Constraint([1.0, 2.0], Op.Ge, 3.0)
    assert dataclasses.is_dataclass(c)
    assert c.coeffs == [1.0, 2.0]
    assert c.op is Op.Ge
    assert c.rhs == 3.0
    assert {f.name for f in dataclasses.fields(c)} == {"coeffs", "op", "rhs"}
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.rhs = 9.0


def test_solve_options_defaults():
    opts = SolveOptions()
    assert opts.pivot_rule is PivotRule.Dantzig
    assert opts.max_iterations == 10_000
    assert opts.record_trace is False
    assert {f.name for f in dataclasses.fields(opts)} == {
        "pivot_rule",
        "max_iterations",
        "record_trace",
    }


def test_solve_options_is_frozen():
    opts = SolveOptions()
    assert dataclasses.is_dataclass(opts)
    with pytest.raises(dataclasses.FrozenInstanceError):
        opts.max_iterations = 5


def test_solve_options_overrides():
    opts = SolveOptions(
        pivot_rule=PivotRule.Bland, max_iterations=30, record_trace=True
    )
    assert opts.pivot_rule is PivotRule.Bland
    assert opts.max_iterations == 30
    assert opts.record_trace is True


def test_solution_defaults():
    sol = Solution(status=Status.Optimal, x=[1.0], objective_value=1.0)
    assert dataclasses.is_dataclass(sol)
    assert sol.duals is None
    assert sol.iterations == 0
    assert sol.trace is None
    assert {f.name for f in dataclasses.fields(sol)} == {
        "status",
        "x",
        "objective_value",
        "duals",
        "iterations",
        "trace",
    }


def test_solution_is_frozen():
    sol = Solution(status=Status.Optimal, x=[1.0], objective_value=1.0)
    with pytest.raises(dataclasses.FrozenInstanceError):
        sol.objective_value = 2.0


# --------------------------------------------------------------------------- #
# SolveError — an Exception carrying `.kind`.
# --------------------------------------------------------------------------- #
def test_solve_error_is_exception_subclass():
    assert issubclass(SolveError, Exception)


def test_solve_error_carries_kind():
    # Constructed via the same one-word vocabulary the three consumers share.
    err = SolveError("DimensionMismatch")
    assert isinstance(err, Exception)
    assert err.kind == "DimensionMismatch"


# --------------------------------------------------------------------------- #
# Public package surface.
# --------------------------------------------------------------------------- #
def test_top_level_reexports_present():
    for name in [
        "Direction",
        "Op",
        "PivotRule",
        "Status",
        "LinearProgram",
        "Constraint",
        "SolveOptions",
        "Solution",
        "SolveError",
        "solve",
    ]:
        assert hasattr(fr, name), "missing top-level export: %s" % name
    assert callable(fr.solve)


def test_version_is_string():
    assert isinstance(fr.__version__, str)
    assert fr.__version__  # non-empty


def test_submodules_importable():
    import feasible_region.reference  # noqa: F401
    import feasible_region.fixtures  # noqa: F401
    import feasible_region.geometry  # noqa: F401
    import feasible_region.traces  # noqa: F401


def test_backend_reports_reference_without_native():
    # this pins the reference-only scenario, so it only applies when
    # the native _core is NOT importable. Skip (never fail) once the wheel is built,
    # so `pixi run test-native` stays green after build-py.
    b = fr.backend()
    assert b in ("native", "reference")
    if b == "native":
        pytest.skip("native _core is built; the reference-default path is not exercised")
    assert b == "reference"


def test_fixtures_registry_contract():
    from feasible_region import fixtures

    expected = {
        "topic21",
        "statquest",
        "kleeminty3",
        "degenerate1",
        "unbounded1",
        "infeasible1",
        "shortestpath",
        "maxflow",
    }
    assert isinstance(fixtures.FIXTURES, dict)
    assert expected.issubset(set(fixtures.FIXTURES))
    lp = fixtures.by_name("topic21")
    assert isinstance(lp, LinearProgram)
    assert lp.direction is Direction.Maximize
    assert len(lp.objective) == 3
