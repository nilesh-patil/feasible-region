//! feasible-core — a dense-tableau two-phase simplex solver.
//!
//! The public surface is the type / enum / signature set
//! plus the `feasible-trace/v1` structs, with serde derives
//! matching the wire format. [`solve`] runs a two-phase primal simplex over a
//! dense `Vec<Vec<f64>>` tableau: phase 1 drives out artificial columns to find
//! a feasible vertex, phase 2 optimizes the original objective, and duals are
//! read back from the final cost row on `Status::Optimal`. The problem is always
//! solved internally as a maximization; the reported objective is evaluated
//! against the original coefficients, so minimization falls out for free.
//! Pivot selection follows the requested [`PivotRule`] (Dantzig / Bland /
//! DantzigNaive), with per-rule tie-breaks that make degenerate problems either
//! terminate or cycle deterministically.
//!
//! Determinism rules (workspace): Vec / BTreeMap only on output paths, no
//! HashMap iteration, no randomness, no time, no threads, zero `unsafe`.

use serde::{Deserialize, Serialize};

/// `eps = 1e-9` — one crate const for every comparison.
pub const EPS: f64 = 1e-9;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Maximize,
    Minimize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    Le,
    Ge,
    Eq,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraint {
    pub coeffs: Vec<f64>,
    pub op: Op,
    pub rhs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearProgram {
    pub direction: Direction,
    pub objective: Vec<f64>,
    pub constraints: Vec<Constraint>,
    #[serde(default)]
    pub var_names: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PivotRule {
    Dantzig,
    Bland,
    DantzigNaive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SolveOptions {
    pub pivot_rule: PivotRule,
    pub max_iterations: u32,
    pub record_trace: bool,
}

impl Default for SolveOptions {
    /// Defaults — `{ Dantzig, 10_000, false }`.
    fn default() -> Self {
        SolveOptions {
            pivot_rule: PivotRule::Dantzig,
            max_iterations: 10_000,
            record_trace: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Optimal,
    Unbounded,
    Infeasible,
}

#[derive(Debug, Clone, Serialize)]
pub struct Solution {
    pub status: Status,
    pub x: Vec<f64>,
    pub objective_value: f64,
    pub duals: Option<Vec<f64>>,
    pub iterations: u32,
    pub trace: Option<Trace>,
}

/// The one shared error vocabulary across all three consumers.
/// Default serde serialization uses the exact variant name
/// (`"DimensionMismatch"` etc.), which the WASM `{ "error": … }` response and
/// the Python `SolveError.kind` echo verbatim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SolveError {
    DimensionMismatch,
    IterationLimit,
    EmptyProblem,
}

// --------------------------------------------------------------------------- //
// feasible-trace/v1. The Rust/WASM cores emit `problem` + `steps` +
// `result` only — `geometry` and `result.duals` are Python-CLI-only
// and are intentionally absent here.
// --------------------------------------------------------------------------- //
#[derive(Debug, Clone, Serialize)]
pub struct Trace {
    pub schema: String,
    pub problem: LinearProgram,
    pub steps: Vec<Step>,
    pub result: TraceResult,
}

#[derive(Debug, Clone, Serialize)]
pub struct Step {
    pub iter: u32,
    pub phase: u8,
    pub tableau: Vec<Vec<f64>>,
    pub basis: Vec<usize>,
    pub vertex: Vec<f64>,
    pub entering: Option<usize>,
    pub leaving: Option<usize>,
    pub objective_value: f64,
    pub rule: PivotRule,
}

#[derive(Debug, Clone, Serialize)]
pub struct TraceResult {
    pub status: Status,
    pub x: Vec<f64>,
    pub objective_value: f64,
}

/// Solve `lp` under `opts` — a dense-tableau, two-phase primal simplex.
///
/// This is a line-accurate port of the pure-Python reference
/// (`python/feasible_region/reference.py`): identical column ordering, tolerance
/// (`EPS`) comparisons, pivot selection, per-rule leaving tie-breaks, artificial
/// drive-out, dual orientation, and output snapping. Fidelity is load-bearing —
/// the committed golden traces must reproduce structurally within 1e-9
/// and a double-solve must serialize byte-identically.
pub fn solve(lp: &LinearProgram, opts: &SolveOptions) -> Result<Solution, SolveError> {
    validate(lp)?;
    let mut engine = Simplex::new(lp, opts);
    let status = engine.run()?;
    Ok(engine.build_solution(status))
}

// ========================================================================== //
// Private implementation — one struct + free functions (no traits, no generics,
// no abstraction layers), mirroring the reference `_Simplex` class 1:1. Zero
// `unsafe`; Vec-only output paths; no HashMap / randomness / time / threads.
// ========================================================================== //

/// Internal objective sign: the solve is always an internal
/// MAXIMIZE, so Minimize negates the objective on the way in.
fn direction_sign(dir: Direction) -> f64 {
    match dir {
        Direction::Maximize => 1.0,
        Direction::Minimize => -1.0,
    }
}

/// Input validation — runs before any tableau is built, matching
/// `reference._validate`.
fn validate(lp: &LinearProgram) -> Result<(), SolveError> {
    let n = lp.objective.len();
    if n == 0 {
        return Err(SolveError::EmptyProblem);
    }
    for con in &lp.constraints {
        if con.coeffs.len() != n {
            return Err(SolveError::DimensionMismatch);
        }
    }
    if let Some(names) = &lp.var_names {
        if names.len() != n {
            return Err(SolveError::DimensionMismatch);
        }
    }
    Ok(())
}

/// Output snapping, matching `reference._snap`: values within
/// `EPS` of zero collapse to `0.0`; values within `EPS` of an integer collapse to
/// that integer; everything else passes through. `f64::round` (half-away) is
/// faithful to Python's `round` here because the `.5` gap far exceeds `EPS`, so
/// the near-integer branch never fires at a rounding tie.
fn snap(v: f64) -> f64 {
    if v.abs() < EPS {
        return 0.0;
    }
    let nearest = v.round();
    if (v - nearest).abs() < EPS {
        return nearest;
    }
    v
}

/// A row needs a phase-1 artificial iff, after `rhs >= 0` normalization, it has no
/// `+1` unit basis column of its own — matches
/// `reference._setup.needs_artificial`.
fn needs_artificial(con: &Constraint) -> bool {
    match con.op {
        Op::Le => con.rhs < 0.0,
        Op::Ge => con.rhs >= 0.0,
        Op::Eq => true,
    }
}

/// Dense two-phase simplex state (mirrors `reference._Simplex`).
///
/// Column order is the one shared layout both cores build:
/// `[0..n)` structural | `[n..n+s)` one slack per le/ge row | `[n+s..N)` one
/// artificial per row that needs a phase-1 basis | column `N` = RHS. Rows are the
/// `m` constraints followed by one cost / reduced-cost row at index `m`.
/// Artificials are retained for the whole solve (kept non-basic in phase 2), so
/// the recorded tableau width `N+1` is constant across every step.
struct Simplex<'a> {
    lp: &'a LinearProgram,
    rule: PivotRule,
    record_trace: bool,
    max_iterations: u32,

    n: usize,
    m: usize,
    /// `N` — total columns excluding the RHS (structural + slack + artificial).
    big_n: usize,
    /// Entering-candidate cutoff: structural + slack columns (`n + s_count`).
    /// Artificials (columns `>= entering_limit`) never enter.
    entering_limit: usize,

    /// Internal (MAXIMIZE-oriented) objective coefficient per structural variable.
    internal_c: Vec<f64>,
    /// Real objective coefficient per column (0 for slack/artificial columns).
    realc: Vec<f64>,
    slack_col: Vec<Option<usize>>,
    artif_col: Vec<Option<usize>>,
    /// `is_artif[c]` — membership test replacing the reference's `artif_set`
    /// (a Vec, never a HashMap, so output paths stay deterministic).
    is_artif: Vec<bool>,
    /// Rows sign-flipped by the `rhs >= 0` normalization, so the
    /// duals re-orient correctly.
    row_flipped: Vec<bool>,

    tableau: Vec<Vec<f64>>,
    basis: Vec<usize>,
    phase: u8,
    iter_count: u32,
    steps: Vec<Step>,
}

impl<'a> Simplex<'a> {
    fn new(lp: &'a LinearProgram, opts: &SolveOptions) -> Self {
        let n = lp.objective.len();
        let m = lp.constraints.len();
        // Internal solve is always MAXIMIZE: negate the objective
        // on the way in for Minimize. The reported value is dot(ORIGINAL
        // objective, snapped vertex) — already correctly oriented — so nothing is
        // negated on the way out (this makes Minimize correct for free).
        let sign = direction_sign(lp.direction);
        let internal_c: Vec<f64> = lp.objective.iter().map(|&c| sign * c).collect();

        let mut engine = Simplex {
            lp,
            rule: opts.pivot_rule,
            record_trace: opts.record_trace,
            max_iterations: opts.max_iterations,
            n,
            m,
            big_n: 0,
            entering_limit: 0,
            internal_c,
            realc: Vec::new(),
            slack_col: vec![None; m],
            artif_col: vec![None; m],
            is_artif: Vec::new(),
            row_flipped: vec![false; m],
            tableau: Vec::with_capacity(m + 1),
            basis: Vec::with_capacity(m),
            phase: 2, // overwritten in `setup` if artificials are needed
            iter_count: 0,
            steps: Vec::new(),
        };
        engine.setup();
        engine
    }

    /// Build the slack / artificial column map, the constraint rows (with the
    /// rhs>=0 normalization), the starting basis, and the initial cost row
    /// (mirrors `reference._setup`).
    fn setup(&mut self) {
        let n = self.n;
        let m = self.m;

        // One slack per le/ge row (eq gets none); slacks start at column n.
        let mut col = n;
        for (i, con) in self.lp.constraints.iter().enumerate() {
            if matches!(con.op, Op::Le | Op::Ge) {
                self.slack_col[i] = Some(col);
                col += 1;
            }
        }
        let s_count = col - n;

        // One artificial per row that needs a phase-1 basis; they follow the
        // slack block in row order.
        let mut acol = n + s_count;
        for (i, con) in self.lp.constraints.iter().enumerate() {
            if needs_artificial(con) {
                self.artif_col[i] = Some(acol);
                acol += 1;
            }
        }
        let a_count = acol - (n + s_count);

        self.big_n = n + s_count + a_count;
        self.entering_limit = n + s_count;

        self.is_artif = vec![false; self.big_n];
        for &c in self.artif_col.iter().flatten() {
            self.is_artif[c] = true;
        }

        self.realc = vec![0.0; self.big_n];
        self.realc[..n].copy_from_slice(&self.internal_c);

        // Build constraint rows. Order: coeffs, slack, rhs, THEN
        // negate the whole row if rhs < 0 (recording `row_flipped`), THEN set the
        // artificial to +1 so it supplies the unit basis column.
        for (i, con) in self.lp.constraints.iter().enumerate() {
            let mut row = vec![0.0f64; self.big_n + 1];
            row[..n].copy_from_slice(&con.coeffs);
            if let Some(sc) = self.slack_col[i] {
                row[sc] = if matches!(con.op, Op::Le) { 1.0 } else { -1.0 };
            }
            row[self.big_n] = con.rhs;
            if row[self.big_n] < 0.0 {
                for v in row.iter_mut() {
                    *v = -*v;
                }
                self.row_flipped[i] = true;
            }
            if let Some(ac) = self.artif_col[i] {
                row[ac] = 1.0;
            }
            self.tableau.push(row);
        }

        let basis: Vec<usize> = (0..m).map(|i| self.basis_col(i)).collect();
        self.basis = basis;

        let cost = if a_count > 0 {
            self.phase = 1;
            self.phase1_cost_row()
        } else {
            self.phase = 2;
            self.phase2_cost_row()
        };
        self.tableau.push(cost);
    }

    /// The initial basis column for row `i`: its artificial if present, else its
    /// slack. Every row owns one or the other (le/ge -> slack, eq -> artificial).
    fn basis_col(&self, i: usize) -> usize {
        self.artif_col[i]
            .or(self.slack_col[i])
            .expect("every row owns a slack or artificial basis column")
    }

    /// Auxiliary phase-1 cost row: maximize `-sum(artificials)`, priced out over
    /// the artificial basics — matches `reference._phase1_cost_row`.
    fn phase1_cost_row(&self) -> Vec<f64> {
        let mut row = vec![0.0f64; self.big_n + 1];
        for &c in self.artif_col.iter().flatten() {
            row[c] = -1.0;
        }
        for (i, &b) in self.basis.iter().enumerate() {
            if self.is_artif[b] {
                for (dst, &s) in row.iter_mut().zip(&self.tableau[i]) {
                    *dst += s;
                }
            }
        }
        row
    }

    /// Real reduced-cost row for the current basis — matches
    /// `reference._phase2_cost_row`.
    fn phase2_cost_row(&self) -> Vec<f64> {
        let mut row = vec![0.0f64; self.big_n + 1];
        row[..self.n].copy_from_slice(&self.realc[..self.n]);
        for (i, &b) in self.basis.iter().enumerate() {
            let cb = self.realc[b];
            if cb != 0.0 {
                for (dst, &s) in row.iter_mut().zip(&self.tableau[i]) {
                    *dst -= cb * s;
                }
            }
        }
        row
    }

    /// Entering-column selection — matches `reference._choose_entering`.
    fn choose_entering(&self) -> Option<usize> {
        let candidates = &self.tableau[self.m][..self.entering_limit];
        if matches!(self.rule, PivotRule::Bland) {
            // Bland: lowest-indexed eligible column.
            return candidates.iter().position(|&c| c > EPS);
        }
        // Dantzig / DantzigNaive: most-positive reduced cost, ties -> lowest index.
        let mut best: Option<usize> = None;
        let mut best_val = EPS;
        for (j, &c) in candidates.iter().enumerate() {
            if c > best_val {
                best_val = c;
                best = Some(j);
            }
        }
        best
    }

    /// Ratio test — matches `reference._choose_leaving`.
    /// Returns the leaving ROW index (or `None` -> unbounded). Eligible rows have
    /// `T[i][entering] > EPS`; the tie set is every row within `EPS` of the min
    /// ratio. DantzigNaive takes the first (lowest ROW index) — the degeneracy
    /// that cycles; Dantzig/Bland take the lowest basic-variable COLUMN index.
    fn choose_leaving(&self, entering: usize) -> Option<usize> {
        let mut min_ratio = f64::INFINITY;
        let mut any = false;
        for row in &self.tableau[..self.m] {
            let a = row[entering];
            if a > EPS {
                any = true;
                let ratio = row[self.big_n] / a;
                if ratio < min_ratio {
                    min_ratio = ratio;
                }
            }
        }
        if !any {
            return None; // nothing limits growth -> unbounded
        }
        let threshold = min_ratio + EPS;

        if matches!(self.rule, PivotRule::DantzigNaive) {
            for (i, row) in self.tableau[..self.m].iter().enumerate() {
                let a = row[entering];
                if a > EPS && row[self.big_n] / a <= threshold {
                    return Some(i); // first (lowest ROW index) in the tie set
                }
            }
            return None; // unreachable: `any` guarantees a tie member
        }
        // Dantzig / Bland: lowest basic-variable index among the tie set.
        let mut best: Option<usize> = None;
        for (i, row) in self.tableau[..self.m].iter().enumerate() {
            let a = row[entering];
            if a > EPS && row[self.big_n] / a <= threshold {
                match best {
                    Some(b) if self.basis[b] <= self.basis[i] => {}
                    _ => best = Some(i),
                }
            }
        }
        best
    }

    /// Gauss-Jordan pivot on `(prow, pcol)`; the cost row (index `m`) updates with
    /// the rest. The `factor != 0.0` guard is EXACT, not `EPS`:
    /// rows already zero in the pivot column are left untouched, preserving exact
    /// zeros — matches `reference._pivot`.
    fn pivot(&mut self, prow: usize, pcol: usize) {
        let piv = self.tableau[prow][pcol];
        let prow_vals: Vec<f64> = self.tableau[prow].iter().map(|&v| v / piv).collect();
        for (i, row) in self.tableau.iter_mut().enumerate() {
            if i == prow {
                continue;
            }
            let factor = row[pcol];
            if factor != 0.0 {
                for (dst, &pv) in row.iter_mut().zip(&prow_vals) {
                    *dst -= factor * pv;
                }
            }
        }
        self.tableau[prow] = prow_vals;
        self.basis[prow] = pcol;
    }

    /// The main driver loop — matches `reference.run`.
    fn run(&mut self) -> Result<Status, SolveError> {
        loop {
            match self.choose_entering() {
                None => {
                    if self.phase == 1 {
                        if self.artificial_sum() > EPS {
                            // Phase-1 optimum still positive -> infeasible.
                            self.record(None, None);
                            return Ok(Status::Infeasible);
                        }
                        self.drive_out_artificials()?;
                        self.enter_phase2();
                        continue;
                    }
                    self.record(None, None); // terminal optimal step
                    return Ok(Status::Optimal);
                }
                Some(entering) => match self.choose_leaving(entering) {
                    None => {
                        self.record(Some(entering), None); // final unbounded step
                        return Ok(Status::Unbounded);
                    }
                    Some(leaving_row) => self.apply_pivot(leaving_row, entering)?,
                },
            }
        }
    }

    /// Record-before-apply a single pivot, honouring the iteration cap. Order per
    /// The cap is checked FIRST (the over-cap step is never
    /// recorded), then the step is recorded with the leaving COLUMN index (not the
    /// row), then the pivot is applied — matches `reference._apply_pivot`.
    fn apply_pivot(&mut self, leaving_row: usize, entering: usize) -> Result<(), SolveError> {
        if self.iter_count >= self.max_iterations {
            return Err(SolveError::IterationLimit);
        }
        let leaving_col = self.basis[leaving_row];
        self.record(Some(entering), Some(leaving_col));
        self.pivot(leaving_row, entering);
        self.iter_count += 1;
        Ok(())
    }

    /// Pivot any still-basic artificial out for a legitimate column
    /// — one forward pass, first `|T[i][j]| > EPS` (ABS: negative pivots allowed
    /// here). These pivots go through `apply_pivot`, still carrying `phase == 1`.
    /// Matches `reference._drive_out_artificials`.
    fn drive_out_artificials(&mut self) -> Result<(), SolveError> {
        for i in 0..self.m {
            if !self.is_artif[self.basis[i]] {
                continue;
            }
            for j in 0..self.entering_limit {
                if self.tableau[i][j].abs() > EPS {
                    self.apply_pivot(i, j)?;
                    break;
                }
            }
        }
        Ok(())
    }

    /// Sum of the RHS over rows whose basic variable is still an artificial
    /// Matches `reference._artificial_sum`.
    fn artificial_sum(&self) -> f64 {
        let mut sum = 0.0;
        for (i, &b) in self.basis.iter().enumerate() {
            if self.is_artif[b] {
                sum += self.tableau[i][self.big_n];
            }
        }
        sum
    }

    /// Switch to phase 2 and rebuild the reduced-cost row for the real objective.
    fn enter_phase2(&mut self) {
        self.phase = 2;
        self.tableau[self.m] = self.phase2_cost_row();
    }

    /// Current vertex: the snapped RHS of each structural basic variable, 0 for
    /// non-basic structurals — matches `reference._vertex`.
    fn vertex(&self) -> Vec<f64> {
        let mut x = vec![0.0f64; self.n];
        for (i, &b) in self.basis.iter().enumerate() {
            if b < self.n {
                x[b] = self.tableau[i][self.big_n];
            }
        }
        for v in x.iter_mut() {
            *v = snap(*v);
        }
        x
    }

    /// `dot(ORIGINAL objective, vertex)` — already correctly oriented for both
    /// directions. Matches `reference._objective`.
    fn objective(&self, vertex: &[f64]) -> f64 {
        let mut sum = 0.0;
        for (&c, &v) in self.lp.objective.iter().zip(vertex) {
            sum += c * v;
        }
        sum
    }

    /// Append a `feasible-trace/v1` step for the current tableau (no-op when
    /// `record_trace` is false, so the WASM hot path allocates nothing). Matches
    /// `reference._record`.
    fn record(&mut self, entering: Option<usize>, leaving: Option<usize>) {
        if !self.record_trace {
            return;
        }
        let vertex = self.vertex();
        let objective_value = snap(self.objective(&vertex));
        // The recorded tableau carries the m constraint rows plus the cost row.
        let tableau = self.tableau[..=self.m].to_vec();
        self.steps.push(Step {
            iter: self.steps.len() as u32,
            phase: self.phase,
            tableau,
            basis: self.basis.clone(),
            vertex,
            entering,
            leaving,
            objective_value,
            rule: self.rule,
        });
    }

    /// Shadow prices `y_i` per constraint, obeying strong duality in
    /// the ORIGINAL orientation. Read the reduced cost off a column that started as
    /// `+e_i` (the artificial when present, else the slack), apply the Minimize
    /// `sign`, and flip rows the rhs>=0 normalization negated. Matches
    /// `reference._compute_duals` — this is the Minimize/`row_flipped` path no
    /// golden fixture covers (FLAG 3).
    fn compute_duals(&self) -> Vec<f64> {
        let cost = &self.tableau[self.m];
        let sign = direction_sign(self.lp.direction);
        let mut duals = Vec::with_capacity(self.m);
        for i in 0..self.m {
            let col = self.artif_col[i]
                .or(self.slack_col[i])
                .expect("every row owns a slack or artificial column for dual read-off");
            let flip = if self.row_flipped[i] { -1.0 } else { 1.0 };
            duals.push(snap(sign * flip * (-cost[col])));
        }
        duals
    }

    /// Assemble the public `Solution`. On `Optimal` the vertex, its
    /// snapped objective, and the duals are populated; otherwise `x` is empty,
    /// objective is 0, duals are `None`. Matches `reference.build_solution`.
    fn build_solution(mut self, status: Status) -> Solution {
        let (x, objective_value, duals) = if status == Status::Optimal {
            let vertex = self.vertex();
            let obj = snap(self.objective(&vertex));
            let duals = self.compute_duals();
            (vertex, obj, Some(duals))
        } else {
            (Vec::new(), 0.0, None)
        };

        let trace = if self.record_trace {
            Some(self.build_trace(status, &x, objective_value))
        } else {
            None
        };

        Solution {
            status,
            x,
            objective_value,
            duals,
            iterations: self.iter_count,
            trace,
        }
    }

    /// Build the recorded `feasible-trace/v1` trace. The echoed `problem` resolves
    /// `var_names`; the core emits no `duals`/`geometry` here
    /// Matches `reference._build_trace`.
    fn build_trace(&mut self, status: Status, x: &[f64], objective_value: f64) -> Trace {
        let (result_x, result_obj) = if status == Status::Optimal {
            (x.to_vec(), objective_value)
        } else {
            (Vec::new(), 0.0)
        };
        Trace {
            schema: String::from("feasible-trace/v1"),
            problem: self.echo_problem(),
            steps: std::mem::take(&mut self.steps),
            result: TraceResult {
                status,
                x: result_x,
                objective_value: result_obj,
            },
        }
    }

    /// Echo the input LP with `var_names` resolved to `Some(...)` — the input's
    /// names when given, else the default `x1..xn`. The input LP is
    /// untouched; only this echoed copy is resolved. Matches `reference._echo_problem`.
    fn echo_problem(&self) -> LinearProgram {
        let names: Vec<String> = match &self.lp.var_names {
            Some(v) if !v.is_empty() => v.clone(),
            _ => (0..self.n).map(|j| format!("x{}", j + 1)).collect(),
        };
        LinearProgram {
            direction: self.lp.direction,
            objective: self.lp.objective.clone(),
            constraints: self.lp.constraints.clone(),
            var_names: Some(names),
        }
    }
}
