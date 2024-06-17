"""Named-fixture registry.

Every LP is built from literal numbers — no file
reads. ``FIXTURE_RULES`` pins the pivot rule each fixture is meant to run under
so the traces CLI and equivalence suite pick it automatically.
"""

from __future__ import annotations

from ._types import Constraint, Direction, LinearProgram, Op, PivotRule


def _topic21() -> LinearProgram:
    """maximize x1+x2+x3 s.t. -x1+x2<=5, x1+4x2<=45, 2x1+x2<=27, 3x1-4x2<=24, x3<=4."""
    return LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0, 1.0],
        constraints=[
            Constraint([-1.0, 1.0, 0.0], Op.Le, 5.0),
            Constraint([1.0, 4.0, 0.0], Op.Le, 45.0),
            Constraint([2.0, 1.0, 0.0], Op.Le, 27.0),
            Constraint([3.0, -4.0, 0.0], Op.Le, 24.0),
            Constraint([0.0, 0.0, 1.0], Op.Le, 4.0),
        ],
    )


def _statquest() -> LinearProgram:
    """maximize 3x1+2x2 s.t. x1+x2<=4, x1+3x2<=6."""
    return LinearProgram(
        direction=Direction.Maximize,
        objective=[3.0, 2.0],
        constraints=[
            Constraint([1.0, 1.0], Op.Le, 4.0),
            Constraint([1.0, 3.0], Op.Le, 6.0),
        ],
    )


def _kleeminty3() -> LinearProgram:
    """maximize 100x1+10x2+x3 s.t. x1<=1, 20x1+x2<=100, 200x1+20x2+x3<=10000."""
    return LinearProgram(
        direction=Direction.Maximize,
        objective=[100.0, 10.0, 1.0],
        constraints=[
            Constraint([1.0, 0.0, 0.0], Op.Le, 1.0),
            Constraint([20.0, 1.0, 0.0], Op.Le, 100.0),
            Constraint([200.0, 20.0, 1.0], Op.Le, 10000.0),
        ],
    )


def _degenerate1() -> LinearProgram:
    """maximize 10x1-57x2-9x3-24x4 (Chvatal cycling LP)."""
    return LinearProgram(
        direction=Direction.Maximize,
        objective=[10.0, -57.0, -9.0, -24.0],
        constraints=[
            Constraint([0.5, -5.5, -2.5, 9.0], Op.Le, 0.0),
            Constraint([0.5, -1.5, -0.5, 1.0], Op.Le, 0.0),
            Constraint([1.0, 0.0, 0.0, 0.0], Op.Le, 1.0),
        ],
    )


def _unbounded1() -> LinearProgram:
    """maximize x1+x2 s.t. x1-x2<=1, -x1+x2<=1."""
    return LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[
            Constraint([1.0, -1.0], Op.Le, 1.0),
            Constraint([-1.0, 1.0], Op.Le, 1.0),
        ],
    )


def _infeasible1() -> LinearProgram:
    """maximize x1+x2 s.t. x1+x2<=2, x1+x2>=6 (origin infeasible -> phase 1)."""
    return LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[
            Constraint([1.0, 1.0], Op.Le, 2.0),
            Constraint([1.0, 1.0], Op.Ge, 6.0),
        ],
    )


def _shortestpath() -> LinearProgram:
    """maximize dt s.t. da<=1, db<=4, db-da<=2, dt-da<=6, dt-db<=1 (vars da,db,dt)."""
    return LinearProgram(
        direction=Direction.Maximize,
        objective=[0.0, 0.0, 1.0],
        constraints=[
            Constraint([1.0, 0.0, 0.0], Op.Le, 1.0),
            Constraint([0.0, 1.0, 0.0], Op.Le, 4.0),
            Constraint([-1.0, 1.0, 0.0], Op.Le, 2.0),
            Constraint([-1.0, 0.0, 1.0], Op.Le, 6.0),
            Constraint([0.0, -1.0, 1.0], Op.Le, 1.0),
        ],
        var_names=["da", "db", "dt"],
    )


def _maxflow() -> LinearProgram:
    """maximize fsa+fsb over 8 flow vars; 8 capacity le rows + 4 conservation eq rows."""
    return LinearProgram(
        direction=Direction.Maximize,
        objective=[1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        constraints=[
            Constraint([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], Op.Le, 8.0),
            Constraint([0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], Op.Le, 2.0),
            Constraint([0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0], Op.Le, 6.0),
            Constraint([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0], Op.Le, 3.0),
            Constraint([0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0], Op.Le, 5.0),
            Constraint([0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0], Op.Le, 2.0),
            Constraint([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0], Op.Le, 4.0),
            Constraint([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0], Op.Le, 5.0),
            Constraint([1.0, 0.0, -1.0, 1.0, 0.0, 0.0, 0.0, 0.0], Op.Eq, 0.0),
            Constraint([0.0, 1.0, 0.0, 0.0, -1.0, 1.0, 0.0, 0.0], Op.Eq, 0.0),
            Constraint([0.0, 0.0, 1.0, 0.0, 0.0, -1.0, -1.0, 0.0], Op.Eq, 0.0),
            Constraint([0.0, 0.0, 0.0, -1.0, 1.0, 0.0, 0.0, -1.0], Op.Eq, 0.0),
        ],
        var_names=["fsa", "fsb", "fac", "fda", "fbd", "fcb", "fct", "fdt"],
    )


_BUILDERS = {
    "topic21": _topic21,
    "statquest": _statquest,
    "kleeminty3": _kleeminty3,
    "degenerate1": _degenerate1,
    "unbounded1": _unbounded1,
    "infeasible1": _infeasible1,
    "shortestpath": _shortestpath,
    "maxflow": _maxflow,
}

# Fresh instances so callers can never mutate a shared LP.
FIXTURES: dict[str, LinearProgram] = {name: build() for name, build in _BUILDERS.items()}

FIXTURE_RULES: dict[str, PivotRule] = {
    "topic21": PivotRule.Dantzig,
    "statquest": PivotRule.Dantzig,
    "kleeminty3": PivotRule.Dantzig,
    "degenerate1": PivotRule.Bland,
    "unbounded1": PivotRule.Dantzig,
    "infeasible1": PivotRule.Dantzig,
    "shortestpath": PivotRule.Dantzig,
    "maxflow": PivotRule.Dantzig,
}


def by_name(name: str) -> LinearProgram:
    """Return a freshly-constructed LinearProgram for a named fixture."""
    return _BUILDERS[name]()
