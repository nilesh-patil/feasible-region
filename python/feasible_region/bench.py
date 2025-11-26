"""Bench CLI: ``python -m feasible_region.bench``.

Times the same solve on every engine that shares the contract - the
pure-Python reference, the native extension called from Python (PyO3 boundary
included), and optionally the Rust core in-process (a ``feasible-core``
example binary, no Python anywhere) - and records one ``feasible-bench/v1``
JSON. The recorded file backs the Section 07 figures the way ``traces/``
backs the earlier ones: numbers on the page replay a committed run, they are
never computed at read time.

Every timed problem first passes a parity gate: both Python-visible engines
must report the same status, the same pivot count, and objectives within
1e-6, so a timing difference is a runtime difference, never an algorithmic
one. Methodology (deliberately boring): a discarded warmup, batches
calibrated to at least 10 ms so timer resolution never shows in a sample,
median and quartiles over the samples rather than a best-of (a minimum
advertises a machine's luckiest moment), and the GC left exactly as a caller
would find it.

Random problems are dense product-mix LPs: every coefficient positive, every
row ``le``, so the origin is feasible (phase 2 only, like every figure in the
post) and the region is bounded by construction. ``b = A @ x0 + slack`` for a
drawn interior point ``x0``, the standard construction for guaranteed-feasible
instances.

Alongside ``--out`` this always writes ``problems.json``, the wire-format
payload the other two harness legs consume: the ``feasible-core`` example
binary (``--rust-bin``) reads it here, and ``bench/wasm.mjs`` replays it
through the browser build afterwards, merging an engine into the same
record. Regenerable from the seeds, so never committed.

Flags: ``--out FILE`` (required), ``--rust-bin PATH`` (the prebuilt
``feasible-core`` bench example; omit to record Python engines only),
``--quick`` (tiny sweep, smoke-test budget).
"""

from __future__ import annotations

import argparse
import json
import platform
import random
import statistics
import subprocess
import sys
import time
from pathlib import Path

from . import fixtures
from ._types import Constraint, Direction, LinearProgram, Op, PivotRule, SolveOptions

SCHEMA = "feasible-bench/v1"

# One batch must dwarf both perf_counter's tick and the cost of the loop
# bookkeeping around the call.
MIN_BATCH_NS = 10_000_000
# Samples per (problem, engine): enough for stable quartiles, capped so the
# slowest pure-Python cell stays inside the run budget.
MAX_SAMPLES = 20
MIN_SAMPLES = 5
ENGINE_BUDGET_NS = 4_000_000_000

# The square sweep. Above n = 192 the reference engine's per-cell interpreter
# cost puts a single solve near half a second and the sweep past its budget.
SIZES = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160, 192]
SEEDS_PER_SIZE = 3
QUICK_SIZES = [4, 8]

PARITY_TOL = 1e-6


def random_lp(m: int, n: int, seed: int) -> LinearProgram:
    """A dense, origin-feasible, bounded product-mix LP.

    All coefficients are drawn positive and every row is ``le``, so x = 0 is
    feasible and the region is bounded; ``b`` is set from a drawn interior
    point so the instance is never trivially tight at the origin.
    """
    rng = random.Random(seed)
    a = [[rng.uniform(0.2, 1.0) for _ in range(n)] for _ in range(m)]
    x0 = [rng.uniform(1.0, 10.0) for _ in range(n)]
    constraints = [
        Constraint(row, Op.Le, sum(c * x for c, x in zip(row, x0)) + rng.uniform(0.5, 2.0))
        for row in a
    ]
    objective = [rng.uniform(1.0, 5.0) for _ in range(n)]
    return LinearProgram(Direction.Maximize, objective, constraints)


def _measure(fn) -> dict:
    """Per-call nanoseconds for ``fn``: median and quartiles over batched samples.

    Calibrates the batch size until one batch clears MIN_BATCH_NS, then sizes
    the sample count to the engine budget. The warmup batch is run and
    discarded before calibration counts.
    """
    fn()  # warmup, discarded

    loops = 1
    while True:
        t0 = time.perf_counter_ns()
        for _ in range(loops):
            fn()
        elapsed = time.perf_counter_ns() - t0
        if elapsed >= MIN_BATCH_NS:
            break
        loops *= 2

    samples_target = max(MIN_SAMPLES, min(MAX_SAMPLES, ENGINE_BUDGET_NS // max(elapsed, 1)))
    samples: list[float] = []
    for _ in range(samples_target):
        t0 = time.perf_counter_ns()
        for _ in range(loops):
            fn()
        samples.append((time.perf_counter_ns() - t0) / loops)

    q1, med, q3 = statistics.quantiles(samples, n=4) if len(samples) > 1 else (samples[0],) * 3
    return {
        "median_ns": med,
        "q1_ns": q1,
        "q3_ns": q3,
        "loops": loops,
        "samples": len(samples),
    }


def _parity(name: str, lp: LinearProgram, opts: SolveOptions) -> dict:
    """Solve once on each Python-visible engine and gate on agreement."""
    from . import solve as top_solve
    from .reference import solve as ref_solve

    ref = ref_solve(lp, opts)
    nat = top_solve(lp, opts, backend="native")
    if ref.status is not nat.status:
        raise SystemExit(f"parity: {name}: status {ref.status} != {nat.status}")
    if ref.iterations != nat.iterations:
        raise SystemExit(f"parity: {name}: pivots {ref.iterations} != {nat.iterations}")
    if abs(ref.objective_value - nat.objective_value) > PARITY_TOL:
        raise SystemExit(
            f"parity: {name}: objective {ref.objective_value} != {nat.objective_value}"
        )
    return {"status": ref.status.value, "pivots": ref.iterations}


def _time_python_engines(lp: LinearProgram, opts: SolveOptions) -> dict:
    from . import _native
    from .reference import solve as ref_solve

    core = _native()
    if core is None:
        raise SystemExit("bench needs the native extension built (pixi run build-py)")
    return {
        "reference": _measure(lambda: ref_solve(lp, opts)),
        "native": _measure(lambda: core.solve(lp, opts)),
    }


def _wire_lp(lp: LinearProgram) -> dict:
    """The LP in the lowercase wire vocabulary ``feasible-core`` deserializes."""
    return {
        "direction": lp.direction.value,
        "objective": lp.objective,
        "constraints": [
            {"coeffs": c.coeffs, "op": c.op.value, "rhs": c.rhs} for c in lp.constraints
        ],
        "var_names": lp.var_names,
    }


def _payload(problems: list[tuple[str, LinearProgram, PivotRule]]) -> dict:
    """The wire payload both non-Python harness legs replay."""
    return {
        "min_batch_ns": MIN_BATCH_NS,
        "min_samples": MIN_SAMPLES,
        "max_samples": MAX_SAMPLES,
        "engine_budget_ns": ENGINE_BUDGET_NS,
        "problems": [
            {"name": name, "pivot_rule": rule.value, "lp": _wire_lp(lp)}
            for name, lp, rule in problems
        ],
    }


def _rust_results(problems_path: Path, rust_bin: str) -> dict:
    """Run the in-process core bench binary over the same problems."""
    out = subprocess.run(
        [rust_bin, str(problems_path)], capture_output=True, text=True, check=True
    ).stdout
    return {r["name"]: r for r in json.loads(out)["results"]}


def _machine() -> dict:
    """The disclosure block: a number without its machine is an anecdote."""
    info = {
        "os": f"{platform.system()} {platform.release()}",
        "arch": platform.machine(),
        "python": platform.python_version(),
    }
    if platform.system() == "Darwin":
        for key, cmd in [
            ("cpu", ["sysctl", "-n", "machdep.cpu.brand_string"]),
            ("cores", ["sysctl", "-n", "hw.ncpu"]),
        ]:
            probe = subprocess.run(cmd, capture_output=True, text=True)
            if probe.returncode == 0:
                info[key] = probe.stdout.strip()
    rustc = subprocess.run(["rustc", "--version"], capture_output=True, text=True)
    if rustc.returncode == 0:
        info["rustc"] = rustc.stdout.strip()
    # The shipped profile: sized for the wasm budget, not tuned for speed.
    info["rust_profile"] = "release (opt-level=z, lto, codegen-units=1)"
    return info


def _serialize(obj: dict) -> str:
    """Canonical JSON: 2-space indent, schema field order, trailing newline."""
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="feasible_region.bench")
    parser.add_argument("--out", required=True, help="target JSON file")
    parser.add_argument("--rust-bin", help="prebuilt feasible-core bench example binary")
    parser.add_argument("--quick", action="store_true", help="tiny sweep, smoke budget")
    args = parser.parse_args(argv)

    opts = SolveOptions()
    sizes = QUICK_SIZES if args.quick else SIZES
    seeds = 1 if args.quick else SEEDS_PER_SIZE

    problems: list[tuple[str, LinearProgram, PivotRule]] = []
    scaling = []
    for size in sizes:
        for seed in range(1, seeds + 1):
            name = f"random-{size}x{size}-s{seed}"
            lp = random_lp(size, size, seed)
            gate = _parity(name, lp, opts)
            row = {"name": name, "m": size, "n": size, "seed": seed, **gate}
            row["engines"] = _time_python_engines(lp, opts)
            scaling.append(row)
            problems.append((name, lp, PivotRule.Dantzig))
        print(f"sized {size}x{size}", file=sys.stderr)

    fixture_rows = []
    for name in fixtures.FIXTURES:
        lp = fixtures.by_name(name)
        rule = fixtures.FIXTURE_RULES[name]
        fx_opts = SolveOptions(pivot_rule=rule)
        gate = _parity(name, lp, fx_opts)
        m = len(lp.constraints)
        n = len(lp.objective)
        row = {"name": name, "m": m, "n": n, **gate}
        row["engines"] = _time_python_engines(lp, fx_opts)
        fixture_rows.append(row)
        problems.append((name, lp, rule))
        print(f"fixture {name}", file=sys.stderr)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    problems_path = out.parent / "problems.json"
    problems_path.write_text(json.dumps(_payload(problems)) + "\n")

    if args.rust_bin:
        rust = _rust_results(problems_path, args.rust_bin)
        for row in scaling + fixture_rows:
            hit = rust.get(row["name"])
            if hit is None:
                continue
            if hit["pivots"] != row["pivots"]:
                raise SystemExit(
                    f"parity: {row['name']}: in-process pivots "
                    f"{hit['pivots']} != {row['pivots']}"
                )
            row["engines"]["rust"] = {k: hit[k] for k in
                                      ("median_ns", "q1_ns", "q3_ns", "loops", "samples")}

    doc = {
        "schema": SCHEMA,
        "machine": _machine(),
        "method": {
            "min_batch_ns": MIN_BATCH_NS,
            "samples": [MIN_SAMPLES, MAX_SAMPLES],
            "statistic": "median with q1/q3 over batched samples, warmup discarded",
            "parity_gate": "status, pivot count, objective within 1e-6",
        },
        "scaling": scaling,
        "fixtures": fixture_rows,
    }
    out.write_text(_serialize(doc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
