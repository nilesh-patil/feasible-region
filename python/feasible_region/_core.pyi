"""Type stub for the native extension.

The compiled ``feasible_region._core`` module (PyO3/maturin) presents exactly
the same ``solve`` signature as ``feasible_region.reference``, so the native and
reference backends are one checkable API. Built into the source tree by
``pixi run build-py``; absent in a pure-sdist / reference-only install.
"""

from ._types import LinearProgram, Solution, SolveOptions

def solve(lp: LinearProgram, opts: SolveOptions) -> Solution: ...
