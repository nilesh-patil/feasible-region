"""Shared contract types for both solver backends.

Defined ONCE here and re-exported from ``feasible_region``. The enum *member
names* are the contract vocabulary; the enum *values* are the
lowercase wire strings the ``feasible-trace/v1`` schema serializes, so
``PivotRule.Dantzig.value == "dantzig"`` etc. give the trace field verbatim.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Direction(Enum):
    Maximize = "maximize"
    Minimize = "minimize"


class Op(Enum):
    Le = "le"
    Ge = "ge"
    Eq = "eq"


class PivotRule(Enum):
    Dantzig = "dantzig"
    Bland = "bland"
    DantzigNaive = "dantzig-naive"


class Status(Enum):
    Optimal = "optimal"
    Unbounded = "unbounded"
    Infeasible = "infeasible"


@dataclass(frozen=True)
class Constraint:
    coeffs: list[float]
    op: Op
    rhs: float


@dataclass(frozen=True)
class LinearProgram:
    direction: Direction
    objective: list[float]
    constraints: list[Constraint]
    var_names: list[str] | None = None


@dataclass(frozen=True)
class SolveOptions:
    pivot_rule: PivotRule = PivotRule.Dantzig
    max_iterations: int = 10_000
    record_trace: bool = False


@dataclass(frozen=True)
class Solution:
    status: Status
    x: list[float]
    objective_value: float
    duals: list[float] | None = None
    iterations: int = 0
    trace: dict | None = None


class SolveError(Exception):
    """Raised on malformed input or non-convergence.

    ``kind`` is the shared one-word vocabulary every consumer echoes
    (``DimensionMismatch`` | ``IterationLimit`` | ``EmptyProblem``).
    """

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind
