//! PyO3 binding — exposes `feasible-core`'s `solve` to Python as
//! `feasible_region._core.solve(lp, opts) -> Solution`.
//!
//! Zero API drift: this function ACCEPTS the shared dataclasses from
//! `feasible_region._types` (read attribute-by-attribute) and RETURNS a real
//! `feasible_region._types.Solution`, raising the shared
//! `feasible_region.SolveError` with the same `.kind` vocabulary every consumer
//! echoes. Numeric agreement with the pure-Python reference is
//! STRUCTURAL within 1e-9, never byte-for-byte.
//!
//! Assumes `feasible-core`'s public API exactly as pinned
//! (public struct fields; `Trace: serde::Serialize`); the whole tableau/pivot
//! logic lives there, this module only marshals across the boundary.

use feasible_core::{
    solve as core_solve, Constraint, Direction, LinearProgram, Op, PivotRule, Solution, SolveError,
    SolveOptions, Status,
};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};

/// Canonical home of the shared dataclasses; re-exported from the
/// top-level `feasible_region` package.
const TYPES_MODULE: &str = "feasible_region._types";

#[pymodule]
fn _core(_py: Python<'_>, m: &PyModule) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(solve, m)?)?;
    Ok(())
}

/// `solve(lp, opts) -> Solution`, signature-identical to
/// `feasible_region.reference.solve`.
#[pyfunction]
fn solve(py: Python<'_>, lp: &PyAny, opts: &PyAny) -> PyResult<PyObject> {
    let program = read_program(lp)?;
    let options = read_options(opts)?;
    match core_solve(&program, &options) {
        Ok(sol) => build_solution(py, sol),
        Err(err) => Err(raise_solve_error(py, err)),
    }
}

// --------------------------------------------------------------------------- //
// Python dataclass -> Rust
// --------------------------------------------------------------------------- //

fn read_program(lp: &PyAny) -> PyResult<LinearProgram> {
    let direction = match member_name(lp.getattr("direction")?)?.as_str() {
        "Maximize" => Direction::Maximize,
        "Minimize" => Direction::Minimize,
        other => return Err(PyValueError::new_err(format!("unknown Direction: {other}"))),
    };
    let objective: Vec<f64> = lp.getattr("objective")?.extract()?;

    let mut constraints = Vec::new();
    for con in lp.getattr("constraints")?.iter()? {
        constraints.push(read_constraint(con?)?);
    }

    let var_names_obj = lp.getattr("var_names")?;
    let var_names = if var_names_obj.is_none() {
        None
    } else {
        Some(var_names_obj.extract::<Vec<String>>()?)
    };

    Ok(LinearProgram {
        direction,
        objective,
        constraints,
        var_names,
    })
}

fn read_constraint(con: &PyAny) -> PyResult<Constraint> {
    let coeffs: Vec<f64> = con.getattr("coeffs")?.extract()?;
    let op = match member_name(con.getattr("op")?)?.as_str() {
        "Le" => Op::Le,
        "Ge" => Op::Ge,
        "Eq" => Op::Eq,
        other => return Err(PyValueError::new_err(format!("unknown Op: {other}"))),
    };
    let rhs: f64 = con.getattr("rhs")?.extract()?;
    Ok(Constraint { coeffs, op, rhs })
}

fn read_options(opts: &PyAny) -> PyResult<SolveOptions> {
    let pivot_rule = match member_name(opts.getattr("pivot_rule")?)?.as_str() {
        "Dantzig" => PivotRule::Dantzig,
        "Bland" => PivotRule::Bland,
        "DantzigNaive" => PivotRule::DantzigNaive,
        other => return Err(PyValueError::new_err(format!("unknown PivotRule: {other}"))),
    };
    let max_iterations: u32 = opts.getattr("max_iterations")?.extract()?;
    let record_trace: bool = opts.getattr("record_trace")?.extract()?;
    Ok(SolveOptions {
        pivot_rule,
        max_iterations,
        record_trace,
    })
}

/// The `.name` of a Python `enum.Enum` member — the contract vocabulary
/// The enum *values* are the lowercase wire strings and are
/// never read here.
fn member_name(member: &PyAny) -> PyResult<String> {
    member.getattr("name")?.extract()
}

// --------------------------------------------------------------------------- //
// Rust -> Python dataclass
// --------------------------------------------------------------------------- //

fn build_solution(py: Python<'_>, sol: Solution) -> PyResult<PyObject> {
    let types = py.import(TYPES_MODULE)?;

    let status_name = match sol.status {
        Status::Optimal => "Optimal",
        Status::Unbounded => "Unbounded",
        Status::Infeasible => "Infeasible",
    };
    let status = types.getattr("Status")?.getattr(status_name)?;

    let x = PyList::new(py, &sol.x);
    let duals = match &sol.duals {
        Some(d) => PyList::new(py, d).into_py(py),
        None => py.None(),
    };
    let trace = match &sol.trace {
        // The trace round-trips through the feasible-trace/v1 JSON so the native
        // dict is structurally identical to the reference's:
        // same field names/order via serde, f64 within 1e-9 via json.loads.
        Some(tr) => {
            let json = serde_json::to_string(tr)
                .map_err(|e| PyValueError::new_err(format!("trace serialize failed: {e}")))?;
            py.import("json")?
                .getattr("loads")?
                .call1((json,))?
                .into_py(py)
        }
        None => py.None(),
    };

    let kwargs = PyDict::new(py);
    kwargs.set_item("status", status)?;
    kwargs.set_item("x", x)?;
    kwargs.set_item("objective_value", sol.objective_value)?;
    kwargs.set_item("duals", duals)?;
    kwargs.set_item("iterations", sol.iterations)?;
    kwargs.set_item("trace", trace)?;

    let solution = types.getattr("Solution")?.call((), Some(kwargs))?;
    Ok(solution.into_py(py))
}

/// Raise the shared `feasible_region.SolveError(kind)` so `except SolveError`
/// and `.kind` behave identically to the reference backend.
fn raise_solve_error(py: Python<'_>, err: SolveError) -> PyErr {
    let kind = match err {
        SolveError::DimensionMismatch => "DimensionMismatch",
        SolveError::IterationLimit => "IterationLimit",
        SolveError::EmptyProblem => "EmptyProblem",
    };
    match py
        .import(TYPES_MODULE)
        .and_then(|m| m.getattr("SolveError"))
        .and_then(|cls| cls.call1((kind,)))
    {
        Ok(inst) => PyErr::from_value(inst),
        Err(e) => e,
    }
}
