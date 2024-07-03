//! Determinism (A5).
//!
//! The same fixture solved twice MUST serialize to BYTE-IDENTICAL trace JSON.
//! This is the anchor for the golden fixtures and it is *verified*, never
//! assumed: serde_json's shortest-float formatting is deterministic given a
//! Vec/BTreeMap-only output structure (the workspace bans HashMap on output
//! paths, plus randomness/time/threads), so two solves of one LP+options must
//! produce the same bytes. This is a within-Rust guarantee — it makes no claim
//! about equality with the Python reference bytes (that is structural).

mod common;
use common::*;

use feasible_core::{solve, SolveOptions};

fn serialized_trace(name: &str) -> String {
    let v = load(name);
    let lp = lp_from(&v);
    let opts = SolveOptions {
        pivot_rule: rule_from(&v),
        max_iterations: 10_000,
        record_trace: true,
    };
    let sol = solve(&lp, &opts).unwrap_or_else(|e| panic!("{name}: solve returned Err({e:?})"));
    let trace = sol
        .trace
        .unwrap_or_else(|| panic!("{name}: record_trace=true but Solution.trace is None"));
    serde_json::to_string(&trace).expect("serialize trace")
}

#[test]
fn every_fixture_double_solve_is_byte_identical() {
    for &name in TRACE_FIXTURES {
        let first = serialized_trace(name);
        let second = serialized_trace(name);
        assert_eq!(
            first, second,
            "{name}: trace JSON is not byte-identical across two solves",
        );
    }
}
