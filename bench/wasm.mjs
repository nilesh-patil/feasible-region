// The fourth engine in feasible-bench/v1: the committed browser build
// (docs/wasm/), driven through its shipped interface. `solve_json` takes and
// returns JSON strings, so every timed call pays serde both ways - that toll
// is the interface, so it belongs in the number.
//
// Runs under Node so the record is reproducible headlessly; Node and Chrome
// share the V8 engine, and the merged record discloses the exact versions.
// Timing uses process.hrtime.bigint() (no browser timer clamping), with the
// same methodology as the other legs: one discarded warmup, batches
// calibrated past min_batch_ns, sample count sized to the engine budget,
// median and quartiles ("exclusive" positions, matching statistics.quantiles).
//
// Usage: node bench/wasm.mjs
//   reads  bench/problems.json  (written by python -m feasible_region.bench)
//   merges engines.wasm into    bench/results.json, gated on pivot parity.

import { readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmJs = join(root, "docs", "wasm", "feasible_core.js");
const wasmBin = join(root, "docs", "wasm", "feasible_core_bg.wasm");

const mod = await import(pathToFileURL(wasmJs).href);
await mod.default(await readFile(wasmBin));

const payload = JSON.parse(await readFile(join(root, "bench", "problems.json"), "utf8"));
const resultsPath = join(root, "bench", "results.json");
const record = JSON.parse(await readFile(resultsPath, "utf8"));

function quantiles(sorted) {
  const n = sorted.length;
  if (n === 1) return [sorted[0], sorted[0], sorted[0]];
  const at = (p) => {
    let h = p * (n + 1);
    h = Math.min(Math.max(h, 1), n);
    const lo = Math.floor(h) - 1;
    const hi = Math.min(lo + 1, n - 1);
    return sorted[lo] + (h - Math.floor(h)) * (sorted[hi] - sorted[lo]);
  };
  return [at(0.25), at(0.5), at(0.75)];
}

function measure(fn) {
  fn(); // warmup, discarded

  let loops = 1;
  let elapsed;
  for (;;) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < loops; i++) fn();
    elapsed = Number(process.hrtime.bigint() - t0);
    if (elapsed >= payload.min_batch_ns) break;
    loops *= 2;
  }

  const budget = Math.floor(payload.engine_budget_ns / Math.max(elapsed, 1));
  const target = Math.min(Math.max(budget, payload.min_samples), payload.max_samples);
  const samples = [];
  for (let s = 0; s < target; s++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < loops; i++) fn();
    samples.push(Number(process.hrtime.bigint() - t0) / loops);
  }
  samples.sort((a, b) => a - b);
  const [q1, med, q3] = quantiles(samples);
  return { median_ns: med, q1_ns: q1, q3_ns: q3, loops, samples: samples.length };
}

const rows = new Map(
  [...record.scaling, ...record.fixtures].map((row) => [row.name, row]),
);

for (const problem of payload.problems) {
  const row = rows.get(problem.name);
  if (!row) continue;

  const lpJson = JSON.stringify(problem.lp);
  const optsJson = JSON.stringify({
    pivot_rule: problem.pivot_rule,
    max_iterations: 10000,
    record_trace: false,
  });

  const parity = JSON.parse(mod.solve_json(lpJson, optsJson));
  if (parity.error) throw new Error(`${problem.name}: ${parity.error}`);
  if (parity.iterations !== row.pivots) {
    throw new Error(`parity: ${problem.name}: wasm pivots ${parity.iterations} != ${row.pivots}`);
  }

  row.engines.wasm = measure(() => mod.solve_json(lpJson, optsJson));
  process.stderr.write(`wasm ${problem.name}\n`);
}

record.machine.node = `node ${process.version}, V8 ${process.versions.v8}`;
record.machine.wasm_binary_bytes = (await stat(wasmBin)).size;

await writeFile(resultsPath, JSON.stringify(record, null, 2) + "\n");
