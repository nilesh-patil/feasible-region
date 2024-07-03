#![allow(dead_code)]
//! Shared helpers for the feasible-core integration suite: locate and load the
//! committed golden traces, rebuild a `LinearProgram` from a trace's `problem`
//! block (exercising the serde wire mapping), and compare f64 fields
//! within the 1e-9 cross-impl tolerance. Each test binary pulls this
//! in with `mod common;` — Cargo does not treat `tests/common/mod.rs` as its own
//! test binary, so these helpers are not double-run.

use feasible_core::{LinearProgram, PivotRule};
use serde_json::Value;
use std::path::PathBuf;

pub const EPS: f64 = 1e-9;

/// The eight fixtures that re-solve to a full `feasible-trace/v1` trace
/// (optimal / unbounded / infeasible). `degenerate1-naive` is deliberately NOT
/// here: it is a Python-CLI truncated artifact the public `solve()` never emits
/// golden_parity.rs asserts it returns Err(IterationLimit).
pub const TRACE_FIXTURES: &[&str] = &[
    "statquest",
    "topic21",
    "kleeminty3",
    "degenerate1",
    "infeasible1",
    "unbounded1",
    "maxflow",
    "shortestpath",
];

/// `<repo>/traces`, resolved from this crate's manifest dir so tests are
/// CWD-independent.
pub fn traces_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../traces")
}

pub fn load(name: &str) -> Value {
    let path = traces_dir().join(format!("{name}.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}.json is not valid JSON: {e}"))
}

/// Rebuild the LP from a committed trace's `problem` block via serde — this also
/// verifies the wire-format enum renames (maximize/le/dantzig-naive/…).
pub fn lp_from(trace: &Value) -> LinearProgram {
    serde_json::from_value(trace["problem"].clone()).expect(
        "trace `problem` block must deserialize into LinearProgram (serde wire format)",
    )
}

/// The rule every step in the file was recorded under.
pub fn rule_from(trace: &Value) -> PivotRule {
    match trace["steps"][0]["rule"].as_str().expect("steps[0].rule") {
        "dantzig" => PivotRule::Dantzig,
        "bland" => PivotRule::Bland,
        "dantzig-naive" => PivotRule::DantzigNaive,
        other => panic!("unknown pivot rule in trace: {other}"),
    }
}

pub fn approx(got: f64, want: f64, ctx: &str) {
    assert!(
        (got - want).abs() <= EPS,
        "{ctx}: {got} vs {want} exceeds 1e-9",
    );
}

pub fn approx_vec(got: &Value, want: &Value, ctx: &str) {
    let g = got
        .as_array()
        .unwrap_or_else(|| panic!("{ctx}: expected an array, got {got}"));
    let w = want
        .as_array()
        .unwrap_or_else(|| panic!("{ctx}: committed value is not an array"));
    assert_eq!(g.len(), w.len(), "{ctx}: length {} vs {}", g.len(), w.len());
    for (k, (a, b)) in g.iter().zip(w).enumerate() {
        approx(
            a.as_f64().unwrap(),
            b.as_f64().unwrap(),
            &format!("{ctx}[{k}]"),
        );
    }
}

pub fn approx_tableau(got: &Value, want: &Value, ctx: &str) {
    let g = got.as_array().expect("tableau is an array of rows");
    let w = want
        .as_array()
        .expect("committed tableau is an array of rows");
    assert_eq!(
        g.len(),
        w.len(),
        "{ctx}: row count {} vs {}",
        g.len(),
        w.len()
    );
    for (r, (a, b)) in g.iter().zip(w).enumerate() {
        approx_vec(a, b, &format!("{ctx} row {r}"));
    }
}
