//! Deterministic seeded cross-rule sweep.
//!
//! proptest is deliberately NOT pulled into feasible-core: the oracle-backed
//! properties (optimum-at-a-vertex via matrix rank, agreement with scipy HiGHS)
//! need numpy/scipy that only exist on the Python side, and the Python
//! native-parity fuzz sweep already drives THIS core through the PyO3 binding
//! against the reference + HiGHS over random LPs. So a proptest dependency would
//! not earn its weight here. Instead a tiny fixed-seed LCG (test-only — never in
//! the solver, so the no-randomness rule stands) draws GUARANTEED bounded &
//! feasible maximize LPs (a box on every variable) and pins the two invariants
//! checkable without an oracle:
//!   * Dantzig and Bland agree on `objective_value` within 1e-6 (they may reach
//!     different optimal vertices; the value must match);
//!   * the returned `x` is feasible to 1e-9 (no constraint violated).

use feasible_core::{
    solve, Constraint, Direction, LinearProgram, Op, PivotRule, SolveOptions, Status,
};

/// A small linear-congruential generator (constants from Knuth's MMIX). Test
/// scaffolding only; seeds are fixed so any failure reproduces.
struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Self {
        Lcg(seed
            .wrapping_mul(2862933555777941757)
            .wrapping_add(3037000493))
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0
    }
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        let span = (hi - lo + 1) as u64;
        lo + (self.next_u64() % span) as i64
    }
}

/// Draw a bounded, feasible maximize LP: a `0 <= x_j <= b_j` box on every
/// variable guarantees a compact feasible region containing the origin, so both
/// pivot rules must reach Optimal regardless of the extra random rows.
fn draw(seed: u64) -> LinearProgram {
    let mut rng = Lcg::new(seed);
    let n = rng.range(2, 4) as usize;
    let extra = rng.range(1, 4) as usize;

    let objective: Vec<f64> = (0..n).map(|_| rng.range(-5, 6) as f64).collect();
    let mut constraints: Vec<Constraint> = Vec::new();

    // Box each variable -> bounded & feasible.
    for j in 0..n {
        let mut coeffs = vec![0.0; n];
        coeffs[j] = 1.0;
        constraints.push(Constraint {
            coeffs,
            op: Op::Le,
            rhs: rng.range(1, 10) as f64,
        });
    }
    // A few extra le rows with rhs >= 0 (origin stays feasible).
    for _ in 0..extra {
        let coeffs: Vec<f64> = (0..n).map(|_| rng.range(-3, 5) as f64).collect();
        constraints.push(Constraint {
            coeffs,
            op: Op::Le,
            rhs: rng.range(0, 10) as f64,
        });
    }

    LinearProgram {
        direction: Direction::Maximize,
        objective,
        constraints,
        var_names: None,
    }
}

fn is_feasible(lp: &LinearProgram, x: &[f64]) -> bool {
    if x.len() != lp.objective.len() {
        return false;
    }
    if x.iter().any(|&v| v < -1e-9) {
        return false;
    }
    for con in &lp.constraints {
        let lhs: f64 = con.coeffs.iter().zip(x).map(|(a, b)| a * b).sum();
        let ok = match con.op {
            Op::Le => lhs <= con.rhs + 1e-9,
            Op::Ge => lhs >= con.rhs - 1e-9,
            Op::Eq => (lhs - con.rhs).abs() <= 1e-9,
        };
        if !ok {
            return false;
        }
    }
    true
}

fn opts(rule: PivotRule) -> SolveOptions {
    SolveOptions {
        pivot_rule: rule,
        max_iterations: 10_000,
        record_trace: false,
    }
}

#[test]
fn dantzig_and_bland_agree_and_stay_feasible_over_a_seeded_sweep() {
    for seed in 0..200u64 {
        let lp = draw(seed);
        let dantzig = solve(&lp, &opts(PivotRule::Dantzig))
            .unwrap_or_else(|e| panic!("seed {seed}: Dantzig -> Err({e:?})"));
        let bland = solve(&lp, &opts(PivotRule::Bland))
            .unwrap_or_else(|e| panic!("seed {seed}: Bland -> Err({e:?})"));

        assert!(
            matches!(dantzig.status, Status::Optimal),
            "seed {seed}: bounded LP but Dantzig -> {:?}",
            dantzig.status,
        );
        assert!(
            matches!(bland.status, Status::Optimal),
            "seed {seed}: bounded LP but Bland -> {:?}",
            bland.status,
        );
        assert!(
            is_feasible(&lp, &dantzig.x),
            "seed {seed}: Dantzig x infeasible: {:?}",
            dantzig.x,
        );
        assert!(
            is_feasible(&lp, &bland.x),
            "seed {seed}: Bland x infeasible: {:?}",
            bland.x,
        );
        assert!(
            (dantzig.objective_value - bland.objective_value).abs() <= 1e-6,
            "seed {seed}: Dantzig {} vs Bland {} disagree on the optimum",
            dantzig.objective_value,
            bland.objective_value,
        );
    }
}
