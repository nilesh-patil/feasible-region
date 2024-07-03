//! Per-mechanism unit coverage exercised through the
//! PUBLIC API + recorded trace, so the assertions pin *behaviour* (the observable
//! pivot the site replays) rather than private field layout, and survive an
//! internal refactor. Covers: SolveOptions default, record_trace on/off,
//! slack-form conversion & two-phase entry, entering selection (Dantzig vs
//! Bland), the ratio test (min-ratio + deterministic tie-break), artificial
//! drive-out, and every SolveError path.

use feasible_core::{
    solve, Constraint, Direction, LinearProgram, Op, PivotRule, SolveError, SolveOptions, Status,
};

fn opts(rule: PivotRule, record_trace: bool) -> SolveOptions {
    SolveOptions {
        pivot_rule: rule,
        max_iterations: 10_000,
        record_trace,
    }
}

fn le(coeffs: Vec<f64>, rhs: f64) -> Constraint {
    Constraint {
        coeffs,
        op: Op::Le,
        rhs,
    }
}

fn maximize(objective: Vec<f64>, constraints: Vec<Constraint>) -> LinearProgram {
    LinearProgram {
        direction: Direction::Maximize,
        objective,
        constraints,
        var_names: None,
    }
}

fn statquest() -> LinearProgram {
    // maximize 3x1+2x2 s.t. x1+x2<=4, x1+3x2<=6
    maximize(
        vec![3.0, 2.0],
        vec![le(vec![1.0, 1.0], 4.0), le(vec![1.0, 3.0], 6.0)],
    )
}

// --------------------------------------------------------------------------- //
// Contract: SolveOptions::default() and record_trace short-circuit.
// The default test is a pure contract check (no solve call).
// --------------------------------------------------------------------------- //
#[test]
fn solve_options_default_is_dantzig_10000_no_trace() {
    let d = SolveOptions::default();
    assert!(matches!(d.pivot_rule, PivotRule::Dantzig));
    assert_eq!(d.max_iterations, 10_000);
    assert!(!d.record_trace);
}

#[test]
fn record_trace_false_allocates_no_trace() {
    let sol = solve(&statquest(), &opts(PivotRule::Dantzig, false)).unwrap();
    assert!(
        sol.trace.is_none(),
        "record_trace=false MUST short-circuit trace allocation",
    );
}

#[test]
fn record_trace_true_produces_a_trace() {
    let sol = solve(&statquest(), &opts(PivotRule::Dantzig, true)).unwrap();
    assert!(sol.trace.is_some());
}

// --------------------------------------------------------------------------- //
// Slack-form conversion + two-phase entry.
// --------------------------------------------------------------------------- //
#[test]
fn le_only_origin_feasible_lp_starts_phase_2_on_slack_basis() {
    // statquest: n=2, two le rows -> slacks at cols 2,3; no artificials; phase 2
    // at the origin.
    let sol = solve(&statquest(), &opts(PivotRule::Dantzig, true)).unwrap();
    let s0 = &sol.trace.as_ref().unwrap().steps[0];
    assert_eq!(s0.phase, 2, "le-only LP skips phase 1");
    assert_eq!(
        s0.basis,
        vec![2, 3],
        "initial basis is the two slack columns"
    );
    assert_eq!(s0.vertex, vec![0.0, 0.0], "starts at the origin");
}

#[test]
fn ge_row_forces_phase_1_with_an_artificial_basis() {
    // x1 >= 2, x1 <= 5: the ge row has no +1 unit column, so it needs a phase-1
    // artificial and the solve starts in phase 1.
    let lp = maximize(
        vec![1.0],
        vec![
            Constraint {
                coeffs: vec![1.0],
                op: Op::Ge,
                rhs: 2.0,
            },
            le(vec![1.0], 5.0),
        ],
    );
    let sol = solve(&lp, &opts(PivotRule::Dantzig, true)).unwrap();
    assert_eq!(sol.trace.as_ref().unwrap().steps[0].phase, 1);
    assert!(matches!(sol.status, Status::Optimal));
    assert_eq!(sol.x, vec![5.0]);
}

// --------------------------------------------------------------------------- //
// Entering-column selection.
// --------------------------------------------------------------------------- //
fn entering_probe() -> LinearProgram {
    // maximize x1 + 3x2 s.t. x1<=1, x2<=1: independent columns, reduced costs
    // [1, 3]. Dantzig must enter col 1 (most positive); Bland must enter col 0
    // (lowest eligible index).
    maximize(
        vec![1.0, 3.0],
        vec![le(vec![1.0, 0.0], 1.0), le(vec![0.0, 1.0], 1.0)],
    )
}

#[test]
fn dantzig_enters_the_most_positive_reduced_cost() {
    let sol = solve(&entering_probe(), &opts(PivotRule::Dantzig, true)).unwrap();
    assert_eq!(
        sol.trace.as_ref().unwrap().steps[0].entering,
        Some(1),
        "Dantzig enters col 1 (reduced cost 3)",
    );
}

#[test]
fn bland_enters_the_lowest_index_eligible_column() {
    let sol = solve(&entering_probe(), &opts(PivotRule::Bland, true)).unwrap();
    assert_eq!(
        sol.trace.as_ref().unwrap().steps[0].entering,
        Some(0),
        "Bland enters col 0 (lowest index), never comparing magnitudes",
    );
}

// --------------------------------------------------------------------------- //
// Ratio test. `leaving` is the slack-form COLUMN index of
// the departing basic variable, not a row index.
// --------------------------------------------------------------------------- //
#[test]
fn ratio_test_picks_the_binding_row() {
    // maximize x1 s.t. x1<=5, x1<=2: x1 enters, row 1 (rhs 2) is the tighter
    // ratio; its slack is column 2 (n=1, slacks at cols 1,2).
    let lp = maximize(vec![1.0], vec![le(vec![1.0], 5.0), le(vec![1.0], 2.0)]);
    let sol = solve(&lp, &opts(PivotRule::Dantzig, true)).unwrap();
    assert_eq!(sol.trace.as_ref().unwrap().steps[0].leaving, Some(2));
    assert!(matches!(sol.status, Status::Optimal));
    assert_eq!(sol.x, vec![2.0]);
}

#[test]
fn ratio_tie_breaks_by_lowest_basic_variable_index() {
    // maximize x1 s.t. x1<=1, x1<=1: both rows attain ratio 1. The deterministic
    // tie-break (lowest basic-variable index) leaves row 0's slack
    // (column 1), never row 1's (column 2).
    let lp = maximize(vec![1.0], vec![le(vec![1.0], 1.0), le(vec![1.0], 1.0)]);
    let sol = solve(&lp, &opts(PivotRule::Dantzig, true)).unwrap();
    assert_eq!(
        sol.trace.as_ref().unwrap().steps[0].leaving,
        Some(1),
        "tie-break must leave the lowest-basic-index row (col 1)",
    );
}

// --------------------------------------------------------------------------- //
// Artificial drive-out: phase 2 starts with no basic artificial.
// --------------------------------------------------------------------------- //
#[test]
fn phase_2_starts_with_no_basic_artificial() {
    // maximize x1+x2 s.t. x1+x2 = 3, x1 <= 2. The eq row needs a phase-1
    // artificial; after drive-out no phase-2 step keeps it basic. n=2, one le
    // slack (col 2), so artificial columns are index >= 3.
    let lp = maximize(
        vec![1.0, 1.0],
        vec![
            Constraint {
                coeffs: vec![1.0, 1.0],
                op: Op::Eq,
                rhs: 3.0,
            },
            le(vec![1.0, 0.0], 2.0),
        ],
    );
    let sol = solve(&lp, &opts(PivotRule::Dantzig, true)).unwrap();
    let trace = sol.trace.unwrap();
    let first_artificial = 2usize + 1; // n + slack count
    for step in trace.steps.iter().filter(|s| s.phase == 2) {
        assert!(
            step.basis.iter().all(|&c| c < first_artificial),
            "phase-2 basis {:?} still holds an artificial (col >= {first_artificial})",
            step.basis,
        );
    }
    assert!(matches!(sol.status, Status::Optimal));
    assert!((sol.objective_value - 3.0).abs() <= 1e-9);
}

// --------------------------------------------------------------------------- //
// SolveError paths (A4) — validated BEFORE any tableau is built.
// --------------------------------------------------------------------------- //
#[test]
fn dimension_mismatch_on_constraint_width() {
    let lp = maximize(vec![1.0, 1.0], vec![le(vec![1.0, 1.0, 1.0], 1.0)]);
    assert!(matches!(
        solve(&lp, &opts(PivotRule::Dantzig, false)),
        Err(SolveError::DimensionMismatch)
    ));
}

#[test]
fn dimension_mismatch_on_var_names_length() {
    let lp = LinearProgram {
        direction: Direction::Maximize,
        objective: vec![1.0, 1.0],
        constraints: vec![le(vec![1.0, 1.0], 4.0)],
        var_names: Some(vec!["only_one".to_string()]),
    };
    assert!(matches!(
        solve(&lp, &opts(PivotRule::Dantzig, false)),
        Err(SolveError::DimensionMismatch)
    ));
}

#[test]
fn empty_problem_on_empty_objective() {
    let lp = maximize(vec![], vec![]);
    assert!(matches!(
        solve(&lp, &opts(PivotRule::Dantzig, false)),
        Err(SolveError::EmptyProblem)
    ));
}

// --------------------------------------------------------------------------- //
// NUMERICS FLAG 3: the Minimize-sign and
// row_flipped paths are exercised by ZERO golden fixtures — every shipped
// fixture is Maximize with rhs >= 0. These two hand-computed cases (values from
// the reference oracle) are the Rust-side net for that gap; a wrong Minimize
// sign or a mishandled row negation turns them red.
// --------------------------------------------------------------------------- //
fn ge(coeffs: Vec<f64>, rhs: f64) -> Constraint {
    Constraint {
        coeffs,
        op: Op::Ge,
        rhs,
    }
}

/// Feasibility of `x` against `lp` to 1e-9 (implicit `x >= 0` included).
fn is_feasible(lp: &LinearProgram, x: &[f64]) -> bool {
    if x.len() != lp.objective.len() || x.iter().any(|&v| v < -1e-9) {
        return false;
    }
    lp.constraints.iter().all(|con| {
        let lhs: f64 = con.coeffs.iter().zip(x).map(|(a, b)| a * b).sum();
        match con.op {
            Op::Le => lhs <= con.rhs + 1e-9,
            Op::Ge => lhs >= con.rhs - 1e-9,
            Op::Eq => (lhs - con.rhs).abs() <= 1e-9,
        }
    })
}

#[test]
fn m1_minimize_with_ge_is_sign_correct_and_has_duals() {
    // minimize x1+x2 s.t. x1+x2 >= 3 (Ge, rhs >= 0 -> artificial, phase 1). The
    // internal solve maximizes -objective, but objective_value is reported as
    // dot(ORIGINAL objective, vertex), so a correct Minimize sign yields +3, not
    // -3. Oracle (reference.py): x = (3, 0), objective 3, dual [1].
    let lp = LinearProgram {
        direction: Direction::Minimize,
        objective: vec![1.0, 1.0],
        constraints: vec![ge(vec![1.0, 1.0], 3.0)],
        var_names: None,
    };
    let sol = solve(&lp, &opts(PivotRule::Dantzig, false)).unwrap();
    assert!(matches!(sol.status, Status::Optimal));
    assert_eq!(sol.x, vec![3.0, 0.0]);
    assert_eq!(
        sol.objective_value, 3.0,
        "Minimize objective is +3 (dot of original objective and vertex), never -3",
    );
    let duals = sol
        .duals
        .expect("an optimal solve MUST populate duals");
    assert_eq!(duals.len(), 1, "one dual per constraint (m == 1)");
    assert!(
        (duals[0] - 1.0).abs() <= 1e-9,
        "shadow price of x1+x2>=3 under Minimize is +1 (strong duality b·y == c·x == 3), got {}",
        duals[0],
    );
}

#[test]
fn m2_negative_rhs_row_flip_stays_feasible_and_optimal() {
    // maximize x2 s.t. -x1 <= -3, x1+x2 <= 5. The first row's rhs < 0, so the
    // builder negates the whole row (row_flipped): its surplus becomes +1, the
    // row acquires an artificial, and phase 1 runs. A botched flip would drop the
    // x1 >= 3 floor and report objective 5 (x1=0, x2=5) instead of 2. Oracle
    // (reference.py): x = (3, 2), objective 2 — no golden fixture covers this.
    let lp = LinearProgram {
        direction: Direction::Maximize,
        objective: vec![0.0, 1.0],
        constraints: vec![
            Constraint {
                coeffs: vec![-1.0, 0.0],
                op: Op::Le,
                rhs: -3.0,
            },
            le(vec![1.0, 1.0], 5.0),
        ],
        var_names: None,
    };
    let sol = solve(&lp, &opts(PivotRule::Dantzig, false)).unwrap();
    assert!(matches!(sol.status, Status::Optimal));
    assert!(
        is_feasible(&lp, &sol.x),
        "the row-flipped optimum must satisfy x1>=3 and x1+x2<=5: {:?}",
        sol.x,
    );
    assert_eq!(
        sol.objective_value, 2.0,
        "the flipped-row floor binds x2 to 2"
    );
    assert_eq!(sol.x, vec![3.0, 2.0]);
}
