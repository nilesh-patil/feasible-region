//! In-process timing for the core: the third engine in `feasible-bench/v1`.
//!
//! Reads a problem file written by `python -m feasible_region.bench`, times
//! `feasible_core::solve` with no Python (and no FFI) anywhere in the loop,
//! and prints one JSON document to stdout. Methodology mirrors the Python
//! harness: one discarded warmup, batches calibrated past `min_batch_ns`,
//! sample count sized to the engine budget, median and quartiles reported
//! (`statistics.quantiles` "exclusive" positions, so the two harnesses read
//! the same way).
//!
//! Built by `cargo build --release --example bench -p feasible-core`, which
//! means the workspace release profile: opt-level "z", lto, one codegen unit.
//! That is the profile the shipped wasm and wheel actually use, so these are
//! the shipped core's numbers, not a speed-tuned build's.

use std::env;
use std::fs;
use std::time::Instant;

use feasible_core::{solve, LinearProgram, PivotRule, SolveOptions};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Payload {
    min_batch_ns: u128,
    min_samples: usize,
    max_samples: usize,
    engine_budget_ns: u128,
    problems: Vec<Problem>,
}

#[derive(Deserialize)]
struct Problem {
    name: String,
    pivot_rule: PivotRule,
    lp: LinearProgram,
}

fn quantiles(sorted: &[f64]) -> (f64, f64, f64) {
    // statistics.quantiles(n=4), "exclusive": h = p (n + 1), clamped to the
    // sample range, linear interpolation between floor(h) and floor(h) + 1.
    let n = sorted.len();
    if n == 1 {
        return (sorted[0], sorted[0], sorted[0]);
    }
    let at = |p: f64| -> f64 {
        let h = p * (n as f64 + 1.0);
        let h = h.max(1.0).min(n as f64);
        let lo = h.floor() as usize - 1;
        let hi = (lo + 1).min(n - 1);
        sorted[lo] + (h - h.floor()) * (sorted[hi] - sorted[lo])
    };
    (at(0.25), at(0.5), at(0.75))
}

fn measure(payload: &Payload, lp: &LinearProgram, opts: &SolveOptions) -> serde_json::Value {
    solve(lp, opts).expect("warmup solve failed"); // warmup, discarded

    let mut loops: u64 = 1;
    let mut elapsed: u128;
    loop {
        let t0 = Instant::now();
        for _ in 0..loops {
            let _ = solve(lp, opts).expect("timed solve failed");
        }
        elapsed = t0.elapsed().as_nanos();
        if elapsed >= payload.min_batch_ns {
            break;
        }
        loops *= 2;
    }

    let budget = (payload.engine_budget_ns / elapsed.max(1)) as usize;
    let target = budget.max(payload.min_samples).min(payload.max_samples);
    let mut samples: Vec<f64> = Vec::with_capacity(target);
    for _ in 0..target {
        let t0 = Instant::now();
        for _ in 0..loops {
            let _ = solve(lp, opts).expect("timed solve failed");
        }
        samples.push(t0.elapsed().as_nanos() as f64 / loops as f64);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let (q1, med, q3) = quantiles(&samples);
    json!({
        "median_ns": med,
        "q1_ns": q1,
        "q3_ns": q3,
        "loops": loops,
        "samples": samples.len(),
    })
}

fn main() {
    let path = env::args().nth(1).expect("usage: bench <payload.json>");
    let text = fs::read_to_string(&path).expect("payload unreadable");
    let payload: Payload = serde_json::from_str(&text).expect("payload malformed");

    let mut results = Vec::with_capacity(payload.problems.len());
    for problem in &payload.problems {
        let opts = SolveOptions {
            pivot_rule: problem.pivot_rule,
            ..SolveOptions::default()
        };
        let sol = solve(&problem.lp, &opts).expect("parity solve failed");
        let mut entry = measure(&payload, &problem.lp, &opts);
        entry["name"] = json!(problem.name);
        entry["pivots"] = json!(sol.iterations);
        entry["status"] = json!(sol.status);
        results.push(entry);
    }
    println!("{}", json!({ "results": results }));
}
