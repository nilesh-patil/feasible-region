//! Acceptance criteria (A1-A5).
//!
//! Headline behaviours pinned as named tests: the topic21 canonical walk, the
//! unbounded/infeasible statuses, the Klee-Minty exponential vertex count, the
//! three degeneracy branches (Bland / DantzigNaive / safeguarded Dantzig), and a
//! generic feasible-trace/v1 structural-invariant validator over every fixture.

mod common;
use common::*;

use feasible_core::{solve, Solution, SolveError, SolveOptions, Status};
use std::collections::BTreeSet;

fn options(
    rule: feasible_core::PivotRule,
    max_iterations: u32,
    record_trace: bool,
) -> SolveOptions {
    SolveOptions {
        pivot_rule: rule,
        max_iterations,
        record_trace,
    }
}

fn solve_traced(name: &str) -> Solution {
    let v = load(name);
    let lp = lp_from(&v);
    let opts = options(rule_from(&v), 10_000, true);
    solve(&lp, &opts).unwrap_or_else(|e| panic!("{name}: solve returned Err({e:?})"))
}

fn pivot_count(sol: &Solution) -> usize {
    sol.trace
        .as_ref()
        .unwrap()
        .steps
        .iter()
        .filter(|s| s.entering.is_some())
        .count()
}

// --------------------------------------------------------------------------- //
// A1 — topic21 optimum + hand-derived Dantzig vertex walk (exact, post-snap).
// --------------------------------------------------------------------------- //
#[test]
fn a1_topic21_optimum_and_canonical_vertex_walk() {
    let sol = solve_traced("topic21");
    assert!(matches!(sol.status, Status::Optimal));
    assert_eq!(sol.x, vec![9.0, 9.0, 4.0]);
    assert_eq!(sol.objective_value, 22.0);

    let walk: Vec<Vec<f64>> = sol
        .trace
        .unwrap()
        .steps
        .iter()
        .map(|s| s.vertex.clone())
        .collect();
    assert_eq!(
        walk,
        vec![
            vec![0.0, 0.0, 0.0],
            vec![8.0, 0.0, 0.0],
            vec![12.0, 3.0, 0.0],
            vec![12.0, 3.0, 4.0],
            vec![9.0, 9.0, 4.0],
        ],
        "A1: (0,0,0)->(8,0,0)->(12,3,0)->(12,3,4)->(9,9,4)",
    );
}

// --------------------------------------------------------------------------- //
// A2 — statquest optimum, unbounded1, infeasible1 (via phase 1).
// --------------------------------------------------------------------------- //
#[test]
fn a2_statquest_optimum() {
    let sol = solve_traced("statquest");
    assert!(matches!(sol.status, Status::Optimal));
    assert_eq!(sol.x, vec![4.0, 0.0]);
    assert_eq!(sol.objective_value, 12.0);
}

#[test]
fn a2_unbounded1_reports_unbounded() {
    let sol = solve_traced("unbounded1");
    assert!(matches!(sol.status, Status::Unbounded));
    assert!(sol.x.is_empty(), "non-optimal x is empty");
    let trace = sol.trace.unwrap();
    let last = trace.steps.last().unwrap();
    assert!(
        last.entering.is_some() && last.leaving.is_none(),
        "unbounded final step: entering != null, leaving == null",
    );
}

#[test]
fn a2_infeasible1_reports_infeasible() {
    let sol = solve_traced("infeasible1");
    assert!(matches!(sol.status, Status::Infeasible));
    assert!(sol.x.is_empty());
    let trace = sol.trace.unwrap();
    let last = trace.steps.last().unwrap();
    assert!(
        last.entering.is_none() && last.leaving.is_none(),
        "infeasible final step: both null (phase 1 ended with aux objective > eps)",
    );
}

// --------------------------------------------------------------------------- //
// A3 — Klee-Minty: Dantzig visits all 2^3 vertices; Bland <= that.
// --------------------------------------------------------------------------- //
#[test]
fn a3_kleeminty3_dantzig_visits_eight_distinct_vertices() {
    let sol = solve_traced("kleeminty3");
    let trace = sol.trace.as_ref().unwrap();
    assert_eq!(trace.steps.len(), 8, "8 steps");
    assert_eq!(pivot_count(&sol), 7, "7 pivots");

    let mut distinct: BTreeSet<Vec<String>> = BTreeSet::new();
    for step in &trace.steps {
        distinct.insert(step.vertex.iter().map(|v| format!("{v:.6}")).collect());
    }
    assert_eq!(
        distinct.len(),
        8,
        "Dantzig must visit all 2^3 = 8 cube vertices",
    );
}

#[test]
fn a3_kleeminty3_bland_pivot_count_not_more_than_dantzig() {
    let lp = lp_from(&load("kleeminty3"));
    let dantzig = solve(
        &lp,
        &options(feasible_core::PivotRule::Dantzig, 10_000, true),
    )
    .unwrap();
    let bland = solve(&lp, &options(feasible_core::PivotRule::Bland, 10_000, true)).unwrap();
    assert!(
        pivot_count(&bland) <= pivot_count(&dantzig),
        "Bland ({}) must not exceed Dantzig ({}) on the cube",
        pivot_count(&bland),
        pivot_count(&dantzig),
    );
}

// --------------------------------------------------------------------------- //
// A3 — degeneracy: the three pivot-rule branches.
// --------------------------------------------------------------------------- //
#[test]
fn a3_degenerate1_bland_terminates_at_the_optimum() {
    let lp = lp_from(&load("degenerate1"));
    let sol = solve(
        &lp,
        &options(feasible_core::PivotRule::Bland, 10_000, false),
    )
    .unwrap();
    assert!(matches!(sol.status, Status::Optimal));
    assert_eq!(sol.x, vec![1.0, 0.0, 1.0, 0.0]);
    assert_eq!(sol.objective_value, 1.0);
}

#[test]
fn a3_degenerate1_dantzig_naive_hits_iteration_limit() {
    let lp = lp_from(&load("degenerate1"));
    let result = solve(
        &lp,
        &options(feasible_core::PivotRule::DantzigNaive, 30, false),
    );
    assert!(
        matches!(result, Err(SolveError::IterationLimit)),
        "DantzigNaive drops the leaving tie-break and MUST cycle to the cap, got {result:?}",
    );
}

#[test]
fn a3_degenerate1_safeguarded_dantzig_terminates_or_caps_never_hangs() {
    // Safeguarded Dantzig keeps the lowest-basic-index leaving tie-break: it
    // MUST either reach the optimum or hit the cap — never cycle forever.
    let lp = lp_from(&load("degenerate1"));
    match solve(
        &lp,
        &options(feasible_core::PivotRule::Dantzig, 1_000, false),
    ) {
        Ok(sol) => {
            assert!(matches!(sol.status, Status::Optimal));
            assert_eq!(sol.objective_value, 1.0);
            assert_eq!(sol.x, vec![1.0, 0.0, 1.0, 0.0]);
        }
        Err(SolveError::IterationLimit) => {}
        Err(e) => panic!("unexpected error {e:?}"),
    }
}

// --------------------------------------------------------------------------- //
// feasible-trace/v1 structural invariants for every fixture.
// --------------------------------------------------------------------------- //
#[test]
fn every_fixture_trace_satisfies_the_structural_invariants() {
    for &name in TRACE_FIXTURES {
        let v = load(name);
        let lp = lp_from(&v);
        let n = lp.objective.len();
        let m = lp.constraints.len();
        let sol = solve(&lp, &options(rule_from(&v), 10_000, true))
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        let trace = sol.trace.as_ref().unwrap();

        assert_eq!(trace.schema, "feasible-trace/v1", "{name}: schema");
        assert!(n >= 1 && m >= 1, "{name}: n>=1, m>=1");
        assert!(!trace.steps.is_empty(), "{name}: at least one step");

        let width = trace.steps[0].tableau[0].len();
        let count = trace.steps.len();
        for (i, s) in trace.steps.iter().enumerate() {
            assert_eq!(s.iter as usize, i, "{name} step {i}: iter sequence 0,1,2,…");
            assert_eq!(s.tableau.len(), m + 1, "{name} step {i}: m+1 rows");
            for row in &s.tableau {
                assert_eq!(row.len(), width, "{name} step {i}: rectangular tableau");
            }
            assert_eq!(s.basis.len(), m, "{name} step {i}: |basis| == m");
            assert_eq!(s.vertex.len(), n, "{name} step {i}: |vertex| == n");
            if i > 0 {
                assert!(
                    s.phase >= trace.steps[i - 1].phase,
                    "{name} step {i}: phase must be non-decreasing",
                );
            }
            // Non-final steps carry a real pivot with the membership invariants.
            if i + 1 < count {
                let entering = s.entering.expect("non-final step has entering");
                let leaving = s.leaving.expect("non-final step has leaving");
                assert!(
                    s.basis.contains(&leaving),
                    "{name} step {i}: leaving must be in the basis before the pivot",
                );
                assert!(
                    trace.steps[i + 1].basis.contains(&entering),
                    "{name} step {i}: entering must be in the basis after the pivot",
                );
            }
        }

        // Final-step / result coupling.
        let last = trace.steps.last().unwrap();
        match sol.status {
            Status::Optimal => {
                assert!(
                    last.entering.is_none() && last.leaving.is_none(),
                    "{name}: optimal final step is both null",
                );
                assert_eq!(sol.x.len(), n, "{name}: |result.x| == n when optimal");
                approx(
                    sol.objective_value,
                    last.objective_value,
                    &format!("{name}: result.objective == last step objective"),
                );
            }
            Status::Unbounded => assert!(
                last.entering.is_some() && last.leaving.is_none(),
                "{name}: unbounded final step",
            ),
            Status::Infeasible => assert!(
                last.entering.is_none() && last.leaving.is_none(),
                "{name}: infeasible final step",
            ),
        }
        if !matches!(sol.status, Status::Optimal) {
            assert!(sol.x.is_empty(), "{name}: x empty on non-optimal status");
        }
    }
}
