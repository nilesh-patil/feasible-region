// ==========================================================================
// Feasible Region . engine.js . the WASM solver loader
// The pure loader behind ctx.ensureEngine / ctx.solve.
// Feature-detect WebAssembly, lazy-import the wasm-bindgen glue, init once,
// cache ONE shared promise, resolve null on ANY failure, hard 8000ms timeout.
// console.debug only (never warn/error) so the zero-console-errors rule
// holds when WASM is blocked. No DOM, no d3, no work at import time.
// ==========================================================================

const INIT_TIMEOUT_MS = 8000;

// The complete SolveOptions the core requires. SolveOptions has NO serde
// defaults, so a live solve MUST stringify all three fields or solve_json
// returns InvalidInput. These are the defaults {Dantzig, 10000, false};
// callers override per field.
export const ENGINE_DEFAULTS = { pivot_rule: "dantzig", max_iterations: 10000, record_trace: false };

// Fill missing SolveOptions fields, returning a COMPLETE object to stringify.
export function fillOptions(options) {
  const o = options || {};
  return {
    pivot_rule: o.pivot_rule != null ? o.pivot_rule : ENGINE_DEFAULTS.pivot_rule,
    max_iterations: o.max_iterations != null ? o.max_iterations : ENGINE_DEFAULTS.max_iterations,
    record_trace: o.record_trace === true,
  };
}

let enginePromise = null;

function debug() {
  if (typeof console !== "undefined" && console.debug) {
    console.debug.apply(console, ["[engine]"].concat([].slice.call(arguments)));
  }
}

// Resolve module-or-null; NEVER rejects. Every fallible step is guarded so the
// only outcomes are "usable module" or "null, stay on fallback".
async function importAndInit() {
  if (typeof WebAssembly === "undefined" || WebAssembly === null ||
      typeof WebAssembly.instantiate !== "function") {
    debug("WebAssembly unavailable; staying on fallback");
    return null;
  }
  let mod;
  try {
    mod = await import("../wasm/feasible_core.js");
  } catch (err) {
    debug("glue import failed:", err && err.message);
    return null;
  }
  const init = mod && (mod.default || mod.init);
  if (typeof init !== "function") {
    debug("glue missing default init");
    return null;
  }
  try {
    await init(); // fetches + instantiates feasible_core_bg.wasm
  } catch (err) {
    debug("wasm instantiate failed:", err && err.message);
    return null;
  }
  if (typeof mod.solve_json !== "function") {
    debug("glue missing solve_json");
    return null;
  }
  return mod;
}

// Load (or return the cached load of) the WASM engine module. Memoized: one
// shared promise for the page lifetime. Resolves the module on success or null
// on ANY failure/timeout. Never throws, never rejects.
export function loadEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      debug("load timed out after", INIT_TIMEOUT_MS, "ms");
      resolve(null);
    }, INIT_TIMEOUT_MS);
    importAndInit().then(
      (mod) => { if (!settled) { settled = true; clearTimeout(timer); resolve(mod); } },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        debug("unexpected load error:", err && err.message);
        resolve(null);
      }
    );
  });
  return enginePromise;
}
