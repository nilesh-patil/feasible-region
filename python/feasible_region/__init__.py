"""``feasible-region`` — one simplex core, three consumers.

Public surface: the shared contract types, ``solve`` (delegating to the native
``_core`` backend when built, else the pure-Python reference), ``backend()`` to
report which is active, and ``__version__``.
"""

from __future__ import annotations

from . import fixtures, geometry, reference
from ._types import (
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

__all__ = [
    "Direction",
    "Op",
    "PivotRule",
    "Status",
    "Constraint",
    "LinearProgram",
    "SolveOptions",
    "Solution",
    "SolveError",
    "solve",
    "backend",
    "fixtures",
    "geometry",
    "reference",
    "__version__",
]

# Single-sourced from the workspace by hand at release time.
__version__ = "0.1.0"


def _native():
    """Import the compiled Rust extension, or None when it is not built."""
    try:
        from . import _core  # type: ignore  # noqa: F401

        return _core
    except Exception:
        return None


def backend() -> str:
    """Report the active backend: ``"native"`` when the extension is importable."""
    return "native" if _native() is not None else "reference"


def solve(
    lp: LinearProgram,
    opts: SolveOptions | None = None,
    *,
    backend: str = "auto",
) -> Solution:
    """Solve ``lp``, delegating to native when available.

    ``backend="native"`` with no extension present raises rather than silently
    downgrading; ``"reference"`` forces the pure-Python path; ``"auto"`` prefers
    native and falls back to reference.
    """
    if opts is None:
        opts = SolveOptions()

    if backend == "reference":
        return reference.solve(lp, opts)

    if backend == "native":
        native = _native()
        if native is None:
            raise RuntimeError(
                "native backend requested but the _core extension is not built"
            )
        return native.solve(lp, opts)

    # auto
    native = _native()
    if native is not None:
        return native.solve(lp, opts)
    return reference.solve(lp, opts)
