"""Traces CLI: ``python -m feasible_region.traces``.

Regenerates a canonical, byte-stable ``feasible-trace/v1`` JSON per named
fixture, each carrying the optional ``geometry`` object (this CLI is the only
producer of ``geometry`` and ``result.duals``). Defaults to the reference
backend so traces regenerate with no compiled extension present.

Flags: ``--out DIR`` (required), ``--only NAME``, ``--check`` (regenerate and
diff against ``DIR``, non-zero exit on drift), ``--central-path`` (also emit
``centralpath-<fixture>.json``), ``--backend reference|native``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import centralpath, fixtures, geometry
from ._types import PivotRule, SolveOptions, Status

# The DantzigNaive cycling artifact: the degenerate1
# Chvátal LP re-run with no leaving tie-break, truncated at the 30-iteration cap.
NAIVE_NAME = "degenerate1-naive"
NAIVE_CAP = 30


def _serialize(obj: dict) -> str:
    """Canonical JSON: 2-space indent, schema field order, trailing newline."""
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def _solve(name: str, backend: str):
    lp = fixtures.by_name(name)
    opts = SolveOptions(pivot_rule=fixtures.FIXTURE_RULES[name], record_trace=True)
    if backend == "native":
        from . import solve as top_solve

        return lp, top_solve(lp, opts, backend="native")
    from .reference import solve as ref_solve

    return lp, ref_solve(lp, opts)


def build_trace(name: str, backend: str = "reference") -> dict:
    lp, sol = _solve(name, backend)
    trace = sol.trace
    # Optional, Python-CLI-only objects.
    trace["result"]["duals"] = sol.duals if sol.status is Status.Optimal else None
    if len(lp.objective) <= 3:
        trace["geometry"] = geometry.enumerate_geometry(lp)
    return trace


def build_naive_trace() -> dict:
    """The ``degenerate1-naive`` truncated cycling trace.

    The public ``solve()`` raises ``IterationLimit`` at the cap and emits no
    trace, so this drives the reference engine's private step iterator directly
    and stamps the additive ``result.status = "truncated"``. The
    LP has n = 4 > 3, so no ``geometry`` is attached.
    """
    from .reference import _Simplex

    lp = fixtures.by_name("degenerate1")
    opts = SolveOptions(
        pivot_rule=PivotRule.DantzigNaive,
        max_iterations=NAIVE_CAP,
        record_trace=True,
    )
    engine = _Simplex(lp, opts)
    status = _drive_truncated(engine)
    return {
        "schema": "feasible-trace/v1",
        "problem": engine._echo_problem(),
        "steps": engine.steps,
        "result": _naive_result(engine, status),
    }


def _drive_truncated(engine) -> str:
    """Run the engine like ``_Simplex.run`` but capture the cap hit as a step.

    Mirrors the driver loop, except that reaching ``max_iterations`` records the
    pending (but unapplied) entering column as a final ``truncated`` step rather
    than raising. Returns the wire ``result.status`` string.
    """
    from .reference import EPS

    while True:
        entering = engine._choose_entering()
        if entering is None:
            if engine.phase == 1:
                if engine._artificial_sum() > EPS:
                    engine._record(None, None)
                    return "infeasible"
                engine._enter_phase2()
                continue
            engine._record(None, None)
            return "optimal"

        leaving_row = engine._choose_leaving(entering)
        if leaving_row is None:
            engine._record(entering, None)
            return "unbounded"

        if engine.iter_count >= engine.max_iterations:
            # Cap hit mid-cycle: a pivot was still available (entering != null),
            # but it is not applied. leaving == null so the membership rule
            # (scoped to non-final steps) skips this terminal step.
            engine._record(entering, None)
            return "truncated"

        engine._record(entering, engine.basis[leaving_row])
        engine._pivot(leaving_row, entering)
        engine.iter_count += 1


def _naive_result(engine, status: str) -> dict:
    """Build ``result`` for the naive run; on truncation echo the final step."""
    final = engine.steps[-1]
    if status == "truncated":
        # result.x / objective_value echo the final (mid-cycle) step.
        return {
            "status": "truncated",
            "x": list(final["vertex"]),
            "objective_value": final["objective_value"],
            "duals": None,
        }
    optimal = status == "optimal"
    return {
        "status": status,
        "x": list(final["vertex"]) if optimal else [],
        "objective_value": final["objective_value"] if optimal else 0.0,
        "duals": engine._compute_duals() if optimal else None,
    }


def _trace_for(name: str, backend: str) -> dict:
    """Dispatch to the standard builder, or the truncated naive builder."""
    if name == NAIVE_NAME:
        return build_naive_trace()
    return build_trace(name, backend)


def _all_names() -> list[str]:
    """Every golden trace file: the named fixtures plus the naive cycling artifact."""
    return list(fixtures.FIXTURES) + [NAIVE_NAME]


def _central_path_file(name: str) -> dict | None:
    lp = fixtures.by_name(name)
    if not centralpath.supported(lp):
        return None
    # A central path is only meaningful toward a finite optimum.
    from .reference import solve as ref_solve

    if ref_solve(lp, SolveOptions()).status is not Status.Optimal:
        return None
    return centralpath.trace(lp, name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="feasible_region.traces")
    parser.add_argument("--out", required=True, help="target directory")
    parser.add_argument("--only", help="regenerate a single fixture")
    parser.add_argument("--check", action="store_true", help="diff against --out, no writes")
    parser.add_argument(
        "--central-path",
        dest="central_path",
        action="store_true",
        help="also emit centralpath-<fixture>.json",
    )
    parser.add_argument("--backend", default="reference", choices=["reference", "native"])
    args = parser.parse_args(argv)

    if args.only and args.only not in _all_names():
        print("unknown fixture: %s" % args.only, file=sys.stderr)
        return 2
    names = [args.only] if args.only else _all_names()

    out = Path(args.out)

    if args.check:
        drift = False
        for name in names:
            expected = _serialize(_trace_for(name, args.backend))
            target = out / (name + ".json")
            if not target.exists() or target.read_text() != expected:
                print("drift: %s" % name, file=sys.stderr)
                drift = True
        return 1 if drift else 0

    out.mkdir(parents=True, exist_ok=True)
    for name in names:
        (out / (name + ".json")).write_text(_serialize(_trace_for(name, args.backend)))
        # Central paths only exist for the small le-only fixtures; the
        # naive artifact reuses degenerate1's LP, which has none.
        if args.central_path and name != NAIVE_NAME:
            cp = _central_path_file(name)
            if cp is not None:
                (out / ("centralpath-%s.json" % name)).write_text(_serialize(cp))
    return 0


if __name__ == "__main__":
    sys.exit(main())
