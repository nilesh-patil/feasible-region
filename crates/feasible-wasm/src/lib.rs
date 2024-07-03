//! feasible-wasm.
//!
//! Later this crate exposes the single `#[wasm_bindgen]` entry point
//! `solve_json(lp_json, options_json) -> String`, linking
//! `feasible-core`. For now it exports only its version, so the wasm build
//! pipeline (wasm-pack -> JS glue) and the site's module import are exercised
//! before the solver is wired in.

use wasm_bindgen::prelude::*;

/// The crate's semantic version (mirrored to the workspace version by hand at
/// release time). wasm-bindgen transfers an owned `String` across
/// the FFI boundary; the underlying value is the `&'static str` produced by
/// `CARGO_PKG_VERSION`.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
