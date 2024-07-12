//! feasible-wasm — the browser build.
//!
//! Exactly one solving entry point crosses the FFI boundary:
//! `solve_json(lp_json, options_json) -> String`. It deserializes a
//! [`LinearProgram`] and [`SolveOptions`] from JSON, runs the shared
//! `feasible-core` simplex, and serializes the outcome back to a JSON string —
//! a [`Solution`] (with `trace` when requested) on success, or the frozen
//! `{"error":"<code>"}` shape on any failure.
//!
//! No-panic across the boundary is by CONSTRUCTION, not by rescue: `feasible-core`
//! is panic-free on every validated input (its two `expect`s are statically
//! unreachable once `validate` passes — every constraint row owns a slack or an
//! artificial column), and every fallible step on the JS-reachable path here is a
//! `match`/`Result` with an explicit error arm. There is deliberately NO
//! `catch_unwind`: the release profile is `panic = "abort"`, so a hypothetical
//! trap cannot be caught anyway, and the guard would only cost binary size. The
//! error path is hand-built (never re-enters serde) so serialization can never be
//! the thing that fails while reporting a failure.

use wasm_bindgen::prelude::*;

use feasible_core::{solve, LinearProgram, SolveError, SolveOptions};

/// The crate's semantic version (mirrored to the workspace version by hand at
/// release time). wasm-bindgen transfers an owned `String` across
/// the FFI boundary; the underlying value is the `&'static str` produced by
/// `CARGO_PKG_VERSION`.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// Solve a JSON-encoded LP and return a JSON string.
///
/// On `Ok`, returns the serialized [`Solution`] (its `status` is lowercased by
/// serde's `rename_all`, its `trace` present iff `record_trace` was set). On any
/// failure, returns the frozen error object `{"error":"<code>"}` where `<code>`
/// is one of the FROZEN vocabulary:
/// - `DimensionMismatch` | `IterationLimit` | `EmptyProblem` — the exact
///   [`SolveError`] variant names (identical to Python's `SolveError.kind`);
/// - `InvalidInput` — either JSON string failed to deserialize;
/// - `SerializeFailed` — the `Solution` failed to serialize (unreachable: it is
///   plain `f64`/`Vec`/enum data with no non-finite-only serializer traps).
///
/// This function never panics: no `unwrap`/`expect`, no panicking index, and the
/// core it calls is panic-free on validated input.
#[wasm_bindgen]
pub fn solve_json(lp_json: &str, options_json: &str) -> String {
    let lp: LinearProgram = match serde_json::from_str(lp_json) {
        Ok(lp) => lp,
        Err(_) => return error_json("InvalidInput"),
    };
    let opts: SolveOptions = match serde_json::from_str(options_json) {
        Ok(opts) => opts,
        Err(_) => return error_json("InvalidInput"),
    };
    match solve(&lp, &opts) {
        Ok(solution) => match serde_json::to_string(&solution) {
            Ok(json) => json,
            Err(_) => error_json("SerializeFailed"),
        },
        Err(err) => error_json(solve_error_code(err)),
    }
}

/// Map a [`SolveError`] to its frozen wire code — the exact variant identifier,
/// so the WASM error vocabulary equals the Python `SolveError.kind`.
/// Written by hand (rather than serializing the enum) to keep the error path off
/// serde entirely.
fn solve_error_code(err: SolveError) -> &'static str {
    match err {
        SolveError::DimensionMismatch => "DimensionMismatch",
        SolveError::IterationLimit => "IterationLimit",
        SolveError::EmptyProblem => "EmptyProblem",
    }
}

/// Hand-build the frozen `{"error":"<code>"}` response without touching serde.
///
/// Every `code` this crate passes is a fixed ASCII identifier (`[A-Za-z]+`), so it
/// contains no character that JSON string syntax would require escaping; a literal
/// concatenation is therefore valid JSON. Keeping this off serde guarantees the
/// error path can itself never fail to serialize.
fn error_json(code: &str) -> String {
    let mut out = String::with_capacity(code.len() + 11);
    out.push_str("{\"error\":\"");
    out.push_str(code);
    out.push_str("\"}");
    out
}
