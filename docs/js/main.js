// Feasible Region . main.js . the page entry point
// Buildless ES module, deferred, so it never blocks first paint. It detects
// figures by data-figure, lazy-hydrates them on an IntersectionObserver (heavy
// figure code and the WASM solver load only as a figure nears view),
// hands each mount its ctx, wires the per-figure engine badge, and runs a
// table-of-contents scroll-spy. Missing modules no-op gracefully, keeping the
// authored still on screen.

import { loadEngine, fillOptions } from "./engine.js";

// A figure name maps to a lazy module loader ONLY when a module exists. Names
// absent from this registry (the milestone shells) are detected and no-op, so
// no missing-module fetch is ever attempted and the console stays clean.
const FIGURE_MODULES = {
  hero: () => import("./figures/hero.js"),
  dualview: () => import("./figures/dualview.js"),
  formulation: () => import("./figures/formulation.js"), // s2, data-figure="formulation"
  duality: () => import("./figures/duality.js"),         // s4, data-figure="duality"
  kleeminty: () => import("./figures/kleeminty.js"),     // s5, data-figure="kleeminty"
  maxflow: () => import("./figures/maxflow.js"),         // s6, data-figure="maxflow"
  shortestpath: () => import("./figures/shortestpath.js"), // s6, data-figure="shortestpath"
  race: () => import("./figures/race.js"),               // s6, data-figure="race"
};

// Live-capable figures warm the WASM engine as they near view. Every other
// figure (formulation, duality, maxflow, shortestpath, race) is trace/geometry
// only and NEVER fetches WASM.
const LIVE_CAPABLE = new Set(["hero", "dualview", "kleeminty"]);

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

// ---- engine badge -------------------------------------------------------
// The badge lives in the figure and states which engine is live. Until a live
// WASM solve reports success, the honest state is trace replay.
const ENGINE_LABEL = {
  live: "solving live (WASM)",
  trace: "replaying trace",
  geometric: "drawn from geometry",
};

function setEngine(figureEl, state) {
  const badge = figureEl
    .closest("figure, section")
    ?.querySelector('.engine-badge[data-role="hero-engine"], .engine-badge');
  if (!badge) return;
  const next = ENGINE_LABEL[state] ? state : "trace";
  badge.setAttribute("data-engine", next);
  badge.textContent = ENGINE_LABEL[next];
}

// ---- live WASM engine surface -------
// Three memoized helpers form the whole ctx engine API; each NEVER throws, so a
// figure can always await them and fall back cleanly on null.
let engineModule = null; // loaded wasm module, or null (never loaded / failed)
let engineReady = null;  // memoized Promise<boolean>

// Trigger (or reuse) the lazy load; resolve true iff the engine is usable. For
// the initial badge and to enable the S3 slider WITHOUT forcing a solve.
function ensureEngine() {
  if (engineReady) return engineReady;
  engineReady = loadEngine().then(
    (mod) => { engineModule = mod; return mod !== null; },
    () => { engineModule = null; return false; }
  );
  return engineReady;
}

// Per-interaction workhorse: solve the current view, or null on ANY failure
// (engine absent, solve_json missing, {"error":...}, malformed, unknown schema).
// Wraps the SYNCHRONOUS solve_json and lowercases Solution.status.
async function solve(problem, options) {
  try {
    const ready = await ensureEngine();
    if (!ready || !engineModule || typeof engineModule.solve_json !== "function") return null;
    const raw = engineModule.solve_json(JSON.stringify(problem), JSON.stringify(fillOptions(options)));
    let sol;
    try { sol = JSON.parse(raw); } catch (e) { return null; }
    if (!sol || typeof sol !== "object" || sol.error) return null;
    if (typeof sol.status !== "string") return null;
    sol.status = sol.status.toLowerCase();
    if (sol.trace && sol.trace.schema !== "feasible-trace/v1") return null;
    return sol;
  } catch (err) {
    if (window.console && console.debug) console.debug("live solve failed:", err && err.message);
    return null;
  }
}

// The shared honesty gate: run ONE verify solve of the CURRENT view
// (problem may be a thunk, re-read after warm-up so a mid-drag change is not a
// false mismatch). Flip the badge to live ONLY if verify(sol) is true and hold
// is unset. Return the engine on success, or null (NO flip) on engine-null /
// solve-fail / verify-false.
async function upgradeToLive(figureEl, args) {
  const opts = args || {};
  const ready = await ensureEngine();
  if (!ready || !engineModule) return null;
  const view = typeof opts.problem === "function" ? opts.problem() : opts.problem;
  const sol = await solve(view, opts.options);
  if (!sol) return null;
  if (typeof opts.verify === "function") {
    let ok = false;
    try { ok = opts.verify(sol) === true; } catch (e) { ok = false; }
    if (!ok) return null;
  }
  if (!opts.hold) setEngine(figureEl, "live");
  return engineModule;
}

// ---- trace loading (source-agnostic fallback) --------
// Fetches a golden trace mirrored into docs/traces/. Root-relative to the
// served document so it resolves the same on GitHub Pages and locally.
async function loadTrace(name) {
  const res = await fetch(`./traces/${name}.json`);
  if (!res.ok) throw new Error(`trace ${name} not found (${res.status})`);
  return res.json();
}

// The context every figure module receives. It hides where the data and the
// engine come from, so a figure renders identically from a live solve or a
// fetched trace.
function makeContext(figureEl) {
  return {
    el: figureEl,
    fixture: figureEl.dataset.fixture || null,
    prefersReducedMotion,
    loadTrace,
    setEngine: (state) => setEngine(figureEl, state),
    ensureEngine,
    solve,
    upgradeToLive: (args) => upgradeToLive(figureEl, args),
  };
}

// ---- lazy figure hydration ----------------------------------------------
async function hydrateFigure(figureEl) {
  const name = figureEl.dataset.figure;

  // Warm-start the WASM engine as a live-capable figure nears view:
  // fire-and-forget on THIS IntersectionObserver (no second observer). The
  // wasm binary loads once, only now, and never blocks first paint.
  if (name && LIVE_CAPABLE.has(name)) ensureEngine();

  const loader = name && FIGURE_MODULES[name];

  // A shell with no registered module: mark it hydrated and leave the
  // reserved still exactly as authored. This is the graceful no-op path.
  if (!loader) {
    figureEl.dataset.figureState = "shell";
    return;
  }

  figureEl.dataset.figureState = "loading";
  try {
    const mod = await loader();
    const mount = mod.default || mod.mount || mod.init;
    if (typeof mount === "function") {
      await mount(figureEl, makeContext(figureEl));
      figureEl.dataset.figureState = "live";
    } else {
      // Module loaded but exposes no mount: keep the still, do not throw.
      figureEl.dataset.figureState = "shell";
    }
  } catch (err) {
    // Module missing or failed: the no-JS still remains on screen, no blank
    // figure, no rethrow. Kept quiet so a not-yet-built figure is not an error.
    figureEl.dataset.figureState = "fallback";
    if (window.console && console.debug) {
      console.debug(`figure "${name}" kept its still fallback:`, err && err.message);
    }
  }
}

function observeFigures() {
  const mounts = Array.from(document.querySelectorAll("[data-figure]"));
  if (mounts.length === 0) return;

  // No IntersectionObserver (very old engines): hydrate everything at once.
  if (!("IntersectionObserver" in window)) {
    mounts.forEach(hydrateFigure);
    return;
  }

  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        obs.unobserve(entry.target);
        hydrateFigure(entry.target);
      }
    },
    // Start a little before the figure reaches the viewport so hydration feels
    // instant on arrival, while WASM and figure code still load on demand.
    { rootMargin: "200px 0px", threshold: 0.01 }
  );

  mounts.forEach((el) => io.observe(el));
}

// ---- table-of-contents scroll-spy ---------------------------------------
function tocScrollSpy() {
  const links = new Map();
  document.querySelectorAll('.toc-nav a[href^="#"]').forEach((a) => {
    const id = a.getAttribute("href").slice(1);
    const target = document.getElementById(id);
    if (target) links.set(target, a);
  });
  if (links.size === 0 || !("IntersectionObserver" in window)) return;

  const setActive = (a) => {
    links.forEach((link) => {
      link.classList.remove("is-active");
      link.removeAttribute("aria-current");
    });
    if (a) {
      a.classList.add("is-active");
      a.setAttribute("aria-current", "true");
    }
  };

  const io = new IntersectionObserver(
    (entries) => {
      // Pick the visible section nearest the top of the viewport.
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActive(links.get(visible[0].target));
    },
    { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
  );

  links.forEach((_, section) => io.observe(section));
}

// ---- theme toggle -------------------------------------------------------
// Light is canonical for everyone; this is the explicit opt-in that
// sets data-theme="dark" on <html> and remembers the choice in localStorage.
// The tiny inline <head> script re-applies a saved choice before first paint;
// here we only reflect the current state into the button and flip it on click.
function themeToggle() {
  const btn = document.querySelector('[data-role="theme-toggle"]');
  if (!btn) return;
  const root = document.documentElement;
  const label = btn.querySelector('[data-role="theme-label"]');

  const sync = () => {
    const dark = root.getAttribute("data-theme") === "dark";
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    const next = dark ? "light" : "dark";
    const text = dark ? "Light" : "Dark";
    btn.setAttribute("aria-label", `Switch to ${next} theme`);
    btn.setAttribute("title", `Switch to ${next} theme`);
    if (label) label.textContent = text;
  };

  sync();
  btn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("fr-theme", next);
    } catch (e) {
      /* private mode: the toggle still works for this session */
    }
    sync();
  });
}

// ---- boot ---------------------------------------------------------------
function boot() {
  themeToggle();
  observeFigures();
  tocScrollSpy();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
