"""Shared test scaffolding for the ``feasible_region`` pure-Python reference suite.

Two jobs:

1. Put the (un-installed) package on ``sys.path`` so ``import feasible_region``
   resolves to ``<build>/python/feasible_region`` during the TDD red phase and
   after the reference implementation lands.
2. Provide *one* place that builds every named fixture LP with
   its EXACT coefficients, plus the pinned expected results, so no test file
   re-encodes an LP (and drifts).

The ``feasible_region`` types are imported lazily *inside* the constructors so
that this conftest imports cleanly even while the package does not yet exist —
the red-phase failures then surface per test-module as honest
``ModuleNotFoundError: feasible_region`` collection errors rather than a single
conftest import blow-up.
"""

import os
import sys

# --------------------------------------------------------------------------- #
# 1. sys.path shim -> <build>/python  (package is NOT pip-installed)
# --------------------------------------------------------------------------- #
_HERE = os.path.dirname(os.path.abspath(__file__))          # <build>/tests
_BUILD_ROOT = os.path.dirname(_HERE)                        # <build>
PYTHON_SRC = os.path.join(_BUILD_ROOT, "python")           # <build>/python

if PYTHON_SRC not in sys.path:
    sys.path.insert(0, PYTHON_SRC)


# --------------------------------------------------------------------------- #
# 2. Marker registration (pyproject-free)
# --------------------------------------------------------------------------- #
def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "oracle: cross-checks the solver against scipy HiGHS / property invariants",
    )


# --------------------------------------------------------------------------- #
# Fixture catalogue metadata (pure data — needs no feasible_region import).
# `rule`/`status` are stored as the *member name* of PivotRule / Status and are
# resolved via getattr() inside tests, so this dict stays import-safe.
# --------------------------------------------------------------------------- #
FIXTURE_NAMES = [
    "topic21",
    "statquest",
    "kleeminty3",
    "degenerate1",
    "unbounded1",
    "infeasible1",
    "shortestpath",
    "maxflow",
]

# Bounded & feasible -> a finite optimum exists (oracle + geometry targets).
BOUNDED_FEASIBLE = [
    "topic21",
    "statquest",
    "kleeminty3",
    "degenerate1",
    "shortestpath",
    "maxflow",
]
UNBOUNDED = ["unbounded1"]
INFEASIBLE = ["infeasible1"]

EXPECTED = {
    "topic21": dict(
        n=3, m=5, rule="Dantzig", status="Optimal",
        x=[9.0, 9.0, 4.0], objective=22.0,
        pivots=4, steps=5,
        path=[[0, 0, 0], [8, 0, 0], [12, 3, 0], [12, 3, 4], [9, 9, 4]],
        bounded=True, two_phase=False,
    ),
    "statquest": dict(
        n=2, m=2, rule="Dantzig", status="Optimal",
        x=[4.0, 0.0], objective=12.0,
        pivots=1, steps=2, path=[[0, 0], [4, 0]],
        bounded=True, two_phase=False,
    ),
    "kleeminty3": dict(
        n=3, m=3, rule="Dantzig", status="Optimal",
        x=[0.0, 0.0, 10000.0], objective=10000.0,
        pivots=7, steps=8, distinct_vertices=8,
        bounded=True, two_phase=False,
    ),
    "degenerate1": dict(
        n=4, m=3, rule="Bland", status="Optimal",
        x=[1.0, 0.0, 1.0, 0.0], objective=1.0,
        bounded=True, two_phase=False,
    ),
    "unbounded1": dict(
        n=2, m=2, rule="Dantzig", status="Unbounded",
        x=None, objective=None, steps=2, bounded=False, two_phase=False,
    ),
    "infeasible1": dict(
        n=2, m=2, rule="Dantzig", status="Infeasible",
        x=None, objective=None, bounded=False, two_phase=True,
    ),
    "shortestpath": dict(
        n=3, m=5, rule="Dantzig", status="Optimal",
        x=[1.0, 3.0, 4.0], objective=4.0,
        bounded=True, two_phase=False,
    ),
    "maxflow": dict(
        n=8, m=12, rule="Dantzig", status="Optimal",
        x=[6.0, 2.0, 6.0, 0.0, 4.0, 2.0, 4.0, 4.0], objective=8.0,
        bounded=True, two_phase=True,
    ),
}


# --------------------------------------------------------------------------- #
# LP constructors — EXACT coefficients.
# feasible_region symbols imported lazily so this module stays import-safe.
# --------------------------------------------------------------------------- #
def _sym():
    from feasible_region import Direction, Op, LinearProgram, Constraint
    return Direction, Op, LinearProgram, Constraint


def build_topic21():
    """maximize x1+x2+x3 s.t. -x1+x2<=5, x1+4x2<=45, 2x1+x2<=27, 3x1-4x2<=24, x3<=4."""
    Direction, Op, LP, C = _sym()
    return LP(
        direction=Direction.Maximize,
        objective=[1.0, 1.0, 1.0],
        constraints=[
            C([-1.0, 1.0, 0.0], Op.Le, 5.0),
            C([1.0, 4.0, 0.0], Op.Le, 45.0),
            C([2.0, 1.0, 0.0], Op.Le, 27.0),
            C([3.0, -4.0, 0.0], Op.Le, 24.0),
            C([0.0, 0.0, 1.0], Op.Le, 4.0),
        ],
    )


def build_statquest():
    """maximize 3x1+2x2 s.t. x1+x2<=4, x1+3x2<=6."""
    Direction, Op, LP, C = _sym()
    return LP(
        direction=Direction.Maximize,
        objective=[3.0, 2.0],
        constraints=[
            C([1.0, 1.0], Op.Le, 4.0),
            C([1.0, 3.0], Op.Le, 6.0),
        ],
    )


def build_kleeminty3():
    """maximize 100x1+10x2+x3 s.t. x1<=1, 20x1+x2<=100, 200x1+20x2+x3<=10000."""
    Direction, Op, LP, C = _sym()
    return LP(
        direction=Direction.Maximize,
        objective=[100.0, 10.0, 1.0],
        constraints=[
            C([1.0, 0.0, 0.0], Op.Le, 1.0),
            C([20.0, 1.0, 0.0], Op.Le, 100.0),
            C([200.0, 20.0, 1.0], Op.Le, 10000.0),
        ],
    )


def build_degenerate1():
    """maximize 10x1-57x2-9x3-24x4 s.t.
    0.5x1-5.5x2-2.5x3+9x4<=0, 0.5x1-1.5x2-0.5x3+x4<=0, x1<=1  (Chvatal cycling LP)."""
    Direction, Op, LP, C = _sym()
    return LP(
        direction=Direction.Maximize,
        objective=[10.0, -57.0, -9.0, -24.0],
        constraints=[
            C([0.5, -5.5, -2.5, 9.0], Op.Le, 0.0),
            C([0.5, -1.5, -0.5, 1.0], Op.Le, 0.0),
            C([1.0, 0.0, 0.0, 0.0], Op.Le, 1.0),
        ],
    )


def build_unbounded1():
    """maximize x1+x2 s.t. x1-x2<=1, -x1+x2<=1."""
    Direction, Op, LP, C = _sym()
    return LP(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[
            C([1.0, -1.0], Op.Le, 1.0),
            C([-1.0, 1.0], Op.Le, 1.0),
        ],
    )


def build_infeasible1():
    """maximize x1+x2 s.t. x1+x2<=2, x1+x2>=6  (origin infeasible -> phase 1)."""
    Direction, Op, LP, C = _sym()
    return LP(
        direction=Direction.Maximize,
        objective=[1.0, 1.0],
        constraints=[
            C([1.0, 1.0], Op.Le, 2.0),
            C([1.0, 1.0], Op.Ge, 6.0),
        ],
    )


def build_shortestpath():
    """maximize dt s.t. da<=1, db<=4, db-da<=2, dt-da<=6, dt-db<=1  (vars da,db,dt)."""
    Direction, Op, LP, C = _sym()
    return LP(
        direction=Direction.Maximize,
        objective=[0.0, 0.0, 1.0],
        constraints=[
            C([1.0, 0.0, 0.0], Op.Le, 1.0),
            C([0.0, 1.0, 0.0], Op.Le, 4.0),
            C([-1.0, 1.0, 0.0], Op.Le, 2.0),
            C([-1.0, 0.0, 1.0], Op.Le, 6.0),
            C([0.0, -1.0, 1.0], Op.Le, 1.0),
        ],
        var_names=["da", "db", "dt"],
    )


def build_maxflow():
    """maximize fsa+fsb over 8 flow vars with 8 capacity <= rows and 4 conservation
    = rows (equalities force phase 1).

    Var order: fsa, fsb, fac, fda, fbd, fcb, fct, fdt.
    """
    Direction, Op, LP, C = _sym()
    return LP(
        direction=Direction.Maximize,
        objective=[1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        constraints=[
            # capacities
            C([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], Op.Le, 8.0),  # fsa<=8
            C([0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], Op.Le, 2.0),  # fsb<=2
            C([0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0], Op.Le, 6.0),  # fac<=6
            C([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0], Op.Le, 3.0),  # fda<=3
            C([0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0], Op.Le, 5.0),  # fbd<=5
            C([0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0], Op.Le, 2.0),  # fcb<=2
            C([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0], Op.Le, 4.0),  # fct<=4
            C([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0], Op.Le, 5.0),  # fdt<=5
            # conservation (equalities)
            C([1.0, 0.0, -1.0, 1.0, 0.0, 0.0, 0.0, 0.0], Op.Eq, 0.0),   # fsa+fda=fac
            C([0.0, 1.0, 0.0, 0.0, -1.0, 1.0, 0.0, 0.0], Op.Eq, 0.0),   # fsb+fcb=fbd
            C([0.0, 0.0, 1.0, 0.0, 0.0, -1.0, -1.0, 0.0], Op.Eq, 0.0),  # fac=fcb+fct
            C([0.0, 0.0, 0.0, -1.0, 1.0, 0.0, 0.0, -1.0], Op.Eq, 0.0),  # fbd=fdt+fda
        ],
        var_names=["fsa", "fsb", "fac", "fda", "fbd", "fcb", "fct", "fdt"],
    )


_BUILDERS = {
    "topic21": build_topic21,
    "statquest": build_statquest,
    "kleeminty3": build_kleeminty3,
    "degenerate1": build_degenerate1,
    "unbounded1": build_unbounded1,
    "infeasible1": build_infeasible1,
    "shortestpath": build_shortestpath,
    "maxflow": build_maxflow,
}


def build_lp(name):
    """Return a freshly-constructed LinearProgram for a named fixture."""
    return _BUILDERS[name]()


# --------------------------------------------------------------------------- #
# Solve helpers (reference backend), used across behaviour/trace/oracle suites.
# --------------------------------------------------------------------------- #
def rule_for(name):
    from feasible_region import PivotRule
    return getattr(PivotRule, EXPECTED[name]["rule"])


def status_for(name):
    from feasible_region import Status
    return getattr(Status, EXPECTED[name]["status"])


def options_for(name, record_trace=False, max_iterations=10_000):
    from feasible_region import SolveOptions
    return SolveOptions(
        pivot_rule=rule_for(name),
        max_iterations=max_iterations,
        record_trace=record_trace,
    )


def solve_fixture(name, record_trace=False, max_iterations=10_000):
    """Solve a named fixture through the pure-Python reference under its designated rule."""
    from feasible_region.reference import solve
    return solve(build_lp(name), options_for(name, record_trace, max_iterations))


def geometry_of(lp):
    """Brute-force polytope geometry dict {vertices, edges, bounded} for an LP (n<=3)."""
    from feasible_region import geometry
    return geometry.enumerate_geometry(lp)


# --------------------------------------------------------------------------- #
# Small numeric helpers shared by trace / oracle / geometry tests.
# --------------------------------------------------------------------------- #
def dot(a, b):
    return sum(float(x) * float(y) for x, y in zip(a, b))


def slack_form_width(lp):
    """N = n + s + a:
    s = one slack per le/ge row; a = one artificial per ge/eq row (+ any le with rhs<0)."""
    from feasible_region import Op
    n = len(lp.objective)
    s = sum(1 for c in lp.constraints if c.op in (Op.Le, Op.Ge))
    a = sum(
        1
        for c in lp.constraints
        if c.op in (Op.Ge, Op.Eq) or (c.op is Op.Le and c.rhs < 0)
    )
    return n + s + a
