"""Pure-Python reference simplex.

A dense-tableau two-phase simplex, deliberately readable: this module is the
reference the Rust core and WASM build are validated against. Correctness and
clarity outrank speed. numpy is never touched.

Tableau layout, one shared column ordering both cores build:

    [ 0 .. n-1 ]            original decision variables (objective order)
    [ n .. n+s-1 ]          one slack per le/ge row  (le: +1, ge: -1 surplus)
    [ n+s .. N-1 ]          one artificial per row that needs a phase-1 basis
    [ N ]                   right-hand side (b)

Rows are the m constraints followed by one cost / reduced-cost row (index m).
Artificial columns are retained for the whole solve (kept non-basic in phase 2)
so the tableau width N+1 is constant across every recorded step.
"""

from __future__ import annotations

from ._types import (
    Direction,
    LinearProgram,
    Op,
    PivotRule,
    Solution,
    SolveError,
    SolveOptions,
    Status,
)

EPS = 1e-9


def solve(lp: LinearProgram, opts: SolveOptions = SolveOptions()) -> Solution:
    """Solve ``lp`` with semantics identical to the Rust core."""
    _validate(lp)
    engine = _Simplex(lp, opts)
    status = engine.run()
    return engine.build_solution(status)


# --------------------------------------------------------------------------- #
# Input validation — runs before any tableau is built.
# --------------------------------------------------------------------------- #
def _validate(lp: LinearProgram) -> None:
    n = len(lp.objective)
    if n == 0:
        raise SolveError("EmptyProblem")
    for con in lp.constraints:
        if len(con.coeffs) != n:
            raise SolveError("DimensionMismatch")
    if lp.var_names is not None and len(lp.var_names) != n:
        raise SolveError("DimensionMismatch")


def _snap(v: float) -> float:
    """Output snapping: tiny -> 0.0, near-integer -> that integer."""
    if abs(v) < EPS:
        return 0.0
    nearest = round(v)
    if abs(v - nearest) < EPS:
        return float(nearest)
    return v


class _Simplex:
    def __init__(self, lp: LinearProgram, opts: SolveOptions):
        self.lp = lp
        self.opts = opts
        self.rule = opts.pivot_rule
        self.record_trace = opts.record_trace
        self.max_iterations = opts.max_iterations

        self.n = len(lp.objective)
        self.m = len(lp.constraints)
        # Internal objective is always a MAXIMIZE: negate on the
        # way in for Minimize; the reported value is dot(original obj, vertex),
        # which is already correctly oriented, so nothing is negated on the way out.
        sign = 1.0 if lp.direction is Direction.Maximize else -1.0
        self._internal_c = [sign * float(c) for c in lp.objective]

        self.iter_count = 0
        self.steps: list[dict] = []
        self.phase = 2  # overwritten in _setup if artificials are needed

        self._setup()

    # ---- tableau construction ------------------------------------------- #
    def _setup(self) -> None:
        n, m = self.n, self.m
        cons = self.lp.constraints

        # slack column per le/ge row (eq gets none)
        self.slack_col: list[int | None] = [None] * m
        col = n
        for i, con in enumerate(cons):
            if con.op in (Op.Le, Op.Ge):
                self.slack_col[i] = col
                col += 1
        s_count = col - n

        # a row needs an artificial iff, after rhs>=0 normalization, it has no
        # +1 unit basis column of its own.
        def needs_artificial(con: object) -> bool:
            if con.op is Op.Le:
                return con.rhs < 0.0
            if con.op is Op.Ge:
                return con.rhs >= 0.0
            return True  # Eq always needs one

        self.artif_col: list[int | None] = [None] * m
        acol = n + s_count
        for i, con in enumerate(cons):
            if needs_artificial(con):
                self.artif_col[i] = acol
                acol += 1
        a_count = acol - (n + s_count)

        self.N = n + s_count + a_count
        self.artif_set = {c for c in self.artif_col if c is not None}
        # entering candidates: structural + slack columns; artificials never enter.
        self.entering_cols = list(range(n + s_count))
        # real objective coefficient per column (0 for slack/artificial columns).
        self.realc = [0.0] * self.N
        for j in range(n):
            self.realc[j] = self._internal_c[j]

        # build constraint rows; track which rows were sign-flipped by the
        # rhs>=0 normalization so duals re-orient correctly.
        self.row_flipped: list[bool] = [False] * m
        self.tableau: list[list[float]] = []
        for i, con in enumerate(cons):
            row = [0.0] * (self.N + 1)
            for j in range(n):
                row[j] = float(con.coeffs[j])
            if self.slack_col[i] is not None:
                row[self.slack_col[i]] = 1.0 if con.op is Op.Le else -1.0
            row[self.N] = float(con.rhs)
            if row[self.N] < 0.0:  # normalize rhs >= 0
                row = [-v for v in row]
                self.row_flipped[i] = True
            if self.artif_col[i] is not None:  # artificial supplies the +1 basis
                row[self.artif_col[i]] = 1.0
            self.tableau.append(row)

        self.basis = [
            self.artif_col[i] if self.artif_col[i] is not None else self.slack_col[i]
            for i in range(m)
        ]

        if a_count > 0:
            self.phase = 1
            self.tableau.append(self._phase1_cost_row())
        else:
            self.phase = 2
            self.tableau.append(self._phase2_cost_row())

    def _phase1_cost_row(self) -> list[float]:
        """Auxiliary cost row: maximize -sum(artificials), priced out."""
        row = [0.0] * (self.N + 1)
        for c in self.artif_set:
            row[c] = -1.0
        # price out the artificial basics: add each artificial-basis row.
        for i in range(self.m):
            if self.basis[i] in self.artif_set:
                src = self.tableau[i]
                for j in range(self.N + 1):
                    row[j] += src[j]
        return row

    def _phase2_cost_row(self) -> list[float]:
        """Real reduced-cost row for the current basis."""
        row = [0.0] * (self.N + 1)
        for j in range(self.n):
            row[j] = self.realc[j]
        for i in range(self.m):
            cb = self.realc[self.basis[i]]
            if cb != 0.0:
                src = self.tableau[i]
                for j in range(self.N + 1):
                    row[j] -= cb * src[j]
        return row

    # ---- pivot selection ------------------------------------------------ #
    def _choose_entering(self) -> int | None:
        cost = self.tableau[self.m]
        if self.rule is PivotRule.Bland:
            for j in self.entering_cols:  # lowest-indexed eligible column
                if cost[j] > EPS:
                    return j
            return None
        # Dantzig / DantzigNaive: most-positive reduced cost, ties -> lowest index.
        best_j: int | None = None
        best_val = EPS
        for j in self.entering_cols:
            if cost[j] > best_val:
                best_val = cost[j]
                best_j = j
        return best_j

    def _choose_leaving(self, entering: int) -> int | None:
        ratios = []
        for i in range(self.m):
            a = self.tableau[i][entering]
            if a > EPS:
                ratios.append((self.tableau[i][self.N] / a, i))
        if not ratios:
            return None  # nothing limits growth -> unbounded
        min_ratio = min(r for r, _ in ratios)
        tied = [i for r, i in ratios if r <= min_ratio + EPS]
        if self.rule is PivotRule.DantzigNaive:
            return tied[0]  # first row, NO tie-break -> can cycle
        # Dantzig / Bland: lowest basic-variable index (Bland's leaving rule).
        return min(tied, key=lambda i: self.basis[i])

    def _pivot(self, prow: int, pcol: int) -> None:
        """Gauss-Jordan on (prow, pcol); the cost row updates with the rest."""
        piv = self.tableau[prow][pcol]
        prow_vals = [v / piv for v in self.tableau[prow]]
        self.tableau[prow] = prow_vals
        for i in range(self.m + 1):
            if i == prow:
                continue
            row = self.tableau[i]
            factor = row[pcol]
            if factor != 0.0:
                self.tableau[i] = [row[j] - factor * prow_vals[j] for j in range(self.N + 1)]
        self.basis[prow] = pcol

    # ---- driver --------------------------------------------------------- #
    def run(self) -> Status:
        while True:
            entering = self._choose_entering()
            if entering is None:
                if self.phase == 1:
                    if self._artificial_sum() > EPS:
                        self._record(None, None)
                        return Status.Infeasible
                    self._drive_out_artificials()
                    self._enter_phase2()
                    continue
                self._record(None, None)  # terminal optimal step
                return Status.Optimal

            leaving_row = self._choose_leaving(entering)
            if leaving_row is None:
                self._record(entering, None)  # final unbounded step
                return Status.Unbounded

            self._apply_pivot(leaving_row, entering)

    def _apply_pivot(self, leaving_row: int, entering: int) -> None:
        """Record-before-apply a single pivot, honouring the iteration cap.

        Order is cap-checked first (never a wrong answer) and
        the step is recorded *before* the pivot is applied.
        """
        if self.iter_count >= self.max_iterations:
            raise SolveError("IterationLimit")
        self._record(entering, self.basis[leaving_row])
        self._pivot(leaving_row, entering)
        self.iter_count += 1

    def _drive_out_artificials(self) -> None:
        """Pivot any still-basic artificial out for a legitimate column.

        Phase 1 ended with the auxiliary objective at ~0, so every basic artificial
        sits at value ~0 (degenerate — common for Ge/Eq systems and redundant rows).
        Exchange it for any structural/slack column with a nonzero entry in its row,
        so phase 2 starts with all artificials non-basic (the module invariant,
        docstring above). Without this, a lingering basic artificial silently absorbs
        an equality/surplus residual during phase 2 — reporting a super-optimal but
        infeasible vertex, or a false ``Unbounded`` — the exact bug this guards.

        A row with no legitimate column is genuinely redundant; its artificial stays
        basic at 0 and never perturbs phase 2 (all its structural entries are ~0, so
        no ratio test or entering choice ever touches it). One forward pass suffices:
        each pivot clears exactly one basic artificial and creates none (the entering
        column is structural, and is non-basic since a basic column would be zero in
        this row).
        """
        for i in range(self.m):
            if self.basis[i] not in self.artif_set:
                continue
            for j in self.entering_cols:
                if abs(self.tableau[i][j]) > EPS:
                    self._apply_pivot(i, j)
                    break

    def _artificial_sum(self) -> float:
        return sum(
            self.tableau[i][self.N]
            for i in range(self.m)
            if self.basis[i] in self.artif_set
        )

    def _enter_phase2(self) -> None:
        self.phase = 2
        self.tableau[self.m] = self._phase2_cost_row()

    # ---- readouts ------------------------------------------------------- #
    def _vertex(self) -> list[float]:
        x = [0.0] * self.n
        for i in range(self.m):
            b = self.basis[i]
            if b is not None and b < self.n:
                x[b] = self.tableau[i][self.N]
        return [_snap(v) for v in x]

    def _objective(self, vertex: list[float]) -> float:
        return sum(float(c) * v for c, v in zip(self.lp.objective, vertex))

    def _record(self, entering: int | None, leaving: int | None) -> None:
        if not self.record_trace:
            return
        vertex = self._vertex()
        self.steps.append(
            {
                "iter": len(self.steps),
                "phase": self.phase,
                "tableau": [list(row) for row in self.tableau[: self.m + 1]],
                "basis": list(self.basis),
                "vertex": vertex,
                "entering": entering,
                "leaving": leaving,
                "objective_value": _snap(self._objective(vertex)),
                "rule": self.rule.value,
            }
        )

    def _compute_duals(self) -> list[float]:
        """Shadow prices y_i for each constraint, obeying strong
        duality ``dot(b, y) == dot(objective, x)`` in the *original* orientation.

        The reduced-cost row lives on the internal MAXIMIZE of ``sign*objective``
        so two corrections are applied:

        * Column choice — read the reduced cost off a column whose initial value is
          ``+e_i``. The artificial column (always built as ``+1`` after rhs>=0
          normalization) is that column whenever a row has one; an artificial-less
          row's slack is ``+1`` in the built tableau (a plain ``le`` row, or a
          normalized ``ge``-with-negative-rhs whose surplus flipped to ``+1``).
          Reading a ``ge`` row's ``-1`` surplus directly would flip the sign — the
          bug that made every binding ``ge`` dual come out negated.
        * Orientation — multiply by ``sign`` so a Minimize problem's duals are
          re-oriented back from the internally-maximized ``-objective``.
        * Normalization — a row whose rhs was negated has its dual
          taken against ``-b_i`` internally, so flip it back with ``row_flipped``.
        """
        cost = self.tableau[self.m]
        sign = 1.0 if self.lp.direction is Direction.Maximize else -1.0
        duals = []
        for i in range(self.m):
            col = self.artif_col[i] if self.artif_col[i] is not None else self.slack_col[i]
            flip = -1.0 if self.row_flipped[i] else 1.0
            duals.append(_snap(sign * flip * -cost[col]))
        return duals

    def build_solution(self, status: Status) -> Solution:
        if status is Status.Optimal:
            vertex = self._vertex()
            obj = _snap(self._objective(vertex))
            duals = self._compute_duals()
            x = vertex
        else:
            x = []
            obj = 0.0
            duals = None

        trace = self._build_trace(status, x, obj) if self.record_trace else None
        return Solution(
            status=status,
            x=x,
            objective_value=obj,
            duals=duals,
            iterations=self.iter_count,
            trace=trace,
        )

    def _build_trace(self, status: Status, x: list[float], obj: float) -> dict:
        return {
            "schema": "feasible-trace/v1",
            "problem": self._echo_problem(),
            "steps": self.steps,
            "result": {
                "status": status.value,
                "x": x if status is Status.Optimal else [],
                "objective_value": obj if status is Status.Optimal else 0.0,
            },
        }

    def _echo_problem(self) -> dict:
        lp = self.lp
        names = lp.var_names or ["x%d" % (j + 1) for j in range(self.n)]
        return {
            "direction": lp.direction.value,
            "objective": [float(c) for c in lp.objective],
            "constraints": [
                {
                    "coeffs": [float(a) for a in con.coeffs],
                    "op": con.op.value,
                    "rhs": float(con.rhs),
                }
                for con in lp.constraints
            ],
            "var_names": list(names),
        }
