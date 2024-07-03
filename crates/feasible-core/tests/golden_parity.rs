//! Golden-trace parity.
//!
//! For each committed fixture the Rust core, re-solving from the file's own
//! `problem` block under the file's recorded rule, MUST reproduce the committed
//! trace STRUCTURALLY:
//!   * equal `result.status`;
//!   * equal step count; per step equal `phase`/`basis`/`entering`/`leaving`
//!     (exact int / null) and `rule`;
//!   * every f64 field — `tableau`, `vertex`, `objective_value`, `result.x`,
//!     and the `duals` — within 1e-9.
//!
//! This is STRUCTURAL, not byte-for-byte: the committed files are Python-CLI
//! output carrying `geometry` + `result.duals` the Rust core omits, and floats
//! may differ in the last ULPs. The truncated `degenerate1-naive`
//! fixture is handled specially — the public API returns Err(IterationLimit).

mod common;
use common::*;

use feasible_core::{solve, SolveError, SolveOptions};
use serde_json::Value;

fn check_trace_fixture(name: &str) {
    let committed = load(name);
    let lp = lp_from(&committed);
    let opts = SolveOptions {
        pivot_rule: rule_from(&committed),
        max_iterations: 10_000,
        record_trace: true,
    };

    let sol = solve(&lp, &opts).unwrap_or_else(|e| panic!("{name}: solve returned Err({e:?})"));
    let trace = sol
        .trace
        .as_ref()
        .unwrap_or_else(|| panic!("{name}: record_trace=true but Solution.trace is None"));
    let got: Value = serde_json::to_value(trace).expect("serialize the Rust trace to JSON");

    // result.status
    assert_eq!(
        got["result"]["status"], committed["result"]["status"],
        "{name}: result.status",
    );

    // steps, structural + numeric
    let cs = committed["steps"].as_array().expect("committed steps");
    let gs = got["steps"].as_array().expect("rust steps");
    assert_eq!(
        gs.len(),
        cs.len(),
        "{name}: step count {} != committed {}",
        gs.len(),
        cs.len(),
    );
    for (i, (c, g)) in cs.iter().zip(gs).enumerate() {
        assert_eq!(g["iter"], c["iter"], "{name} step {i}: iter");
        assert_eq!(g["phase"], c["phase"], "{name} step {i}: phase");
        assert_eq!(g["rule"], c["rule"], "{name} step {i}: rule");
        assert_eq!(g["basis"], c["basis"], "{name} step {i}: basis");
        assert_eq!(g["entering"], c["entering"], "{name} step {i}: entering");
        assert_eq!(g["leaving"], c["leaving"], "{name} step {i}: leaving");
        approx_vec(
            &g["vertex"],
            &c["vertex"],
            &format!("{name} step {i}: vertex"),
        );
        approx(
            g["objective_value"].as_f64().unwrap(),
            c["objective_value"].as_f64().unwrap(),
            &format!("{name} step {i}: objective_value"),
        );
        approx_tableau(
            &g["tableau"],
            &c["tableau"],
            &format!("{name} step {i}: tableau"),
        );
    }

    // result.x / objective_value + optional duals (only when optimal)
    if committed["result"]["status"] == "optimal" {
        approx_vec(
            &got["result"]["x"],
            &committed["result"]["x"],
            &format!("{name}: result.x"),
        );
        approx(
            got["result"]["objective_value"].as_f64().unwrap(),
            committed["result"]["objective_value"].as_f64().unwrap(),
            &format!("{name}: result.objective_value"),
        );

        // Duals are OPTIONAL for the core; the committed
        // Python file always carries them. When the core computes them, they must
        // match the golden shadow prices within 1e-9.
        if let Some(duals) = sol.duals.as_ref() {
            let cd = committed["result"]["duals"]
                .as_array()
                .unwrap_or_else(|| panic!("{name}: optimal committed trace lacks result.duals"));
            assert_eq!(duals.len(), cd.len(), "{name}: duals length");
            for (k, (d, c)) in duals.iter().zip(cd).enumerate() {
                approx(*d, c.as_f64().unwrap(), &format!("{name}: dual[{k}]"));
            }
        }
    }
}

#[test]
fn golden_statquest() {
    check_trace_fixture("statquest");
}

#[test]
fn golden_topic21() {
    check_trace_fixture("topic21");
}

#[test]
fn golden_kleeminty3() {
    check_trace_fixture("kleeminty3");
}

#[test]
fn golden_degenerate1() {
    check_trace_fixture("degenerate1");
}

#[test]
fn golden_infeasible1() {
    check_trace_fixture("infeasible1");
}

#[test]
fn golden_unbounded1() {
    check_trace_fixture("unbounded1");
}

#[test]
fn golden_maxflow() {
    check_trace_fixture("maxflow");
}

#[test]
fn golden_shortestpath() {
    check_trace_fixture("shortestpath");
}

/// The truncated cycling artifact: it is produced
/// only by the Python traces CLI driving the reference's private step iterator.
/// Re-solving its `problem` block under DantzigNaive at the recorded cap via the
/// PUBLIC API must return Err(IterationLimit) with NO trace — the core never
/// emits a `"truncated"` trace.
#[test]
fn golden_degenerate1_naive_returns_iteration_limit() {
    let committed = load("degenerate1-naive");
    assert_eq!(
        committed["result"]["status"], "truncated",
        "fixture precondition: degenerate1-naive is the truncated artifact",
    );
    // len(steps) - 1 == max_iterations used for the run.
    let cap = (committed["steps"].as_array().unwrap().len() - 1) as u32;
    assert_eq!(
        cap, 30,
        "degenerate1-naive is generated at max_iterations=30"
    );

    let lp = lp_from(&committed);
    let opts = SolveOptions {
        pivot_rule: rule_from(&committed), // dantzig-naive
        max_iterations: cap,
        record_trace: true,
    };
    match solve(&lp, &opts) {
        Err(SolveError::IterationLimit) => {}
        other => panic!("expected Err(IterationLimit), got {other:?}"),
    }
}
