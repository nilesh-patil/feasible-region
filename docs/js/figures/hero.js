// Feasible Region . figures/hero.js . S1 interactive 2D LP playground
//
// Mounts on #s1 (data-fixture="statquest"), seeding from the trace problem block.
// Drag a constraint or rotate the objective; the feasible polygon re-clips from
// the live half-planes and the optimum is re-read by evaluating the objective at
// each vertex. In two variables that enumeration is EXACT, so the badge reads
// "geometric". A live WASM solve runs alongside and flips the badge to "solving
// live" only when it reproduces the shown corner. d3 (v7) is a UMD window
// global; if it or the trace fails to load we throw and main.js keeps the still.

import {
  feasibleRegion,
  objectiveArgmax,
  lineThroughBox,
  fmt,
} from "../lp2d.js";

const LE = "≤"; // less-than-or-equal, not a dash
const TAU = Math.PI * 2;

// Plot frame inside the 640x400 viewBox, matched to the authored still so the
// hydrated figure lands where the fallback was (no visual jump).
const VW = 640;
const VH = 400;
const M = { left: 56, right: 8, top: 16, bottom: 48 };
const X_MAX = 5.15;
const Y_MAX = 3.6;
const X_TICKS = [1, 2, 3, 4, 5];
const Y_TICKS = [1, 2, 3];

// The objective arrow pivots about a fixed base and only rotates.
const OBJ_BASE = { x: 1.25, y: 0.55 };
const OBJ_LEN = 1.55; // arrow length in data units

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Lazy-load d3 as a global. Resolves window.d3 or rejects so the still stays.
function ensureD3() {
  if (window.d3) return Promise.resolve(window.d3);
  const src = new URL("./vendor/d3.v7.min.js", document.baseURI).href;
  let s = document.querySelector("script[data-d3]");
  if (!s) {
    s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.setAttribute("data-d3", "");
    document.head.appendChild(s);
  }
  return new Promise((resolve, reject) => {
    if (window.d3) return resolve(window.d3);
    s.addEventListener(
      "load",
      () => (window.d3 ? resolve(window.d3) : reject(new Error("d3 missing"))),
      { once: true }
    );
    s.addEventListener("error", () => reject(new Error("d3 load failed")), {
      once: true,
    });
  });
}

// A term string like "x1 + 3 x2" from coefficients and variable names.
function termString(coeffs, names) {
  const parts = [];
  coeffs.forEach((k, i) => {
    if (Math.abs(k) < 1e-9) return;
    const nm = names[i] || `x${i + 1}`;
    const mag = Math.abs(k);
    const coef = Math.abs(mag - 1) < 1e-9 ? "" : `${fmt(mag)} `;
    const sign = k < 0 ? (parts.length ? " - " : "-") : parts.length ? " + " : "";
    parts.push(`${sign}${coef}${nm}`);
  });
  return parts.join("") || "0";
}

// Plain-language compass for the objective direction (for aria + no dashes).
function dirWord(theta) {
  const deg = ((theta * 180) / Math.PI + 360) % 360;
  const words = [
    "to the right",
    "up and to the right",
    "straight up",
    "up and to the left",
    "to the left",
    "down and to the left",
    "straight down",
    "down and to the right",
  ];
  return words[Math.round(deg / 45) % 8];
}

// Normalise the trace's problem into a<=form half-planes. A ">=" row is negated.
function readConstraints(problem) {
  return problem.constraints.map((row, i) => {
    const flip = row.op === "ge" ? -1 : 1;
    const a = flip * row.coeffs[0];
    const b = flip * row.coeffs[1];
    const c = flip * row.rhs;
    // Fully relaxing a limit must still leave a VISIBLE chord: the far corner
    // makes lineThroughBox() return null, dropping the line and stranding keyboard
    // focus. Pull the max rhs just inside that corner so two box edges stay
    // crossed. Axis-aligned lines never hit the corner, so they skip the reduction.
    const corner = a * X_MAX + b * Y_MAX;
    const inset = 0.5 * Math.min(Math.abs(a) * X_MAX, Math.abs(b) * Y_MAX);
    const cMax = Math.max(2, corner - inset);
    return {
      a,
      b,
      c,
      c0: c,
      cMin: 0.4,
      cMax,
      idx: i,
      colorVar: `var(--constraint-${(i % 5) + 1})`,
      termStr: termString(row.coeffs, problem.var_names || []),
    };
  });
}

export default async function mount(el, ctx) {
  const d3 = await ensureD3();
  const trace = await ctx.loadTrace(ctx.fixture || "statquest");
  const problem = trace.problem;

  const constraints = readConstraints(problem);
  const objMag = Math.hypot(problem.objective[0], problem.objective[1]) || 1;
  const state = {
    theta: Math.atan2(problem.objective[1], problem.objective[0]),
    theta0: Math.atan2(problem.objective[1], problem.objective[0]),
    objMag,
  };

  // ---- scales ----------------------------------------------------------
  const xScale = d3.scaleLinear().domain([0, X_MAX]).range([M.left, VW - M.right]);
  const yScale = d3.scaleLinear().domain([0, Y_MAX]).range([VH - M.bottom, M.top]);
  const X = (v) => xScale(v);
  const Y = (v) => yScale(v);
  const x0px = X(0);
  const y0px = Y(0);

  // ---- svg scaffold ----------------------------------------------------
  const svg = d3
    .create("svg:svg")
    .attr("class", "fig-svg")
    .attr("viewBox", `0 0 ${VW} ${VH}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr("aria-label", "Feasible region playground, loading.");
  const svgNode = svg.node();

  const defs = svg.append("defs");
  const mkArrow = (id, fillVar) =>
    defs
      .append("marker")
      .attr("id", id)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 8)
      .attr("refY", 5)
      .attr("markerWidth", id === "hero-arrow-obj" ? 8 : 7)
      .attr("markerHeight", id === "hero-arrow-obj" ? 8 : 7)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M0,1 L9,5 L0,9 Z")
      .attr("style", `fill: ${fillVar};`);
  mkArrow("hero-arrow-axis", "var(--hairline-strong)");
  mkArrow("hero-arrow-obj", "var(--objective)");

  // gridlines
  const gGrid = svg.append("g").attr("style", "stroke: var(--hairline); stroke-width: 1;");
  X_TICKS.forEach((t) =>
    gGrid.append("line").attr("x1", X(t)).attr("y1", M.top).attr("x2", X(t)).attr("y2", y0px)
  );
  Y_TICKS.forEach((t) =>
    gGrid.append("line").attr("x1", x0px).attr("y1", Y(t)).attr("x2", VW - M.right).attr("y2", Y(t))
  );

  // shaded feasible region (updated)
  const regionPath = svg
    .append("polygon")
    .attr("style", "fill: var(--wash); stroke: var(--trail); stroke-width: 1.5; stroke-linejoin: round;");

  // corner dots (updated)
  const gVertices = svg.append("g").attr("style", "fill: var(--trail);");

  // constraint visible + halo + hit lines, plus labels
  const gConstraints = svg.append("g");
  constraints.forEach((k) => {
    k.haloLine = gConstraints
      .append("line")
      .attr("style", `stroke: ${k.colorVar}; stroke-width: 13; stroke-linecap: round; opacity: 0;`);
    k.visLine = gConstraints
      .append("line")
      .attr("style", `stroke: ${k.colorVar}; stroke-width: 2.5;`);
    k.label = gConstraints
      .append("text")
      .attr("style", `font-family: var(--font-sans); font-size: 12px; fill: ${k.colorVar};`);
    k.hitLine = gConstraints
      .append("line")
      .attr("style", "stroke: transparent; stroke-width: 20; cursor: grab; touch-action: none;")
      .attr("tabindex", 0)
      .attr("role", "slider")
      .attr("aria-label", `Constraint ${k.termStr} at most, right hand side`)
      .attr("aria-orientation", "vertical")
      .attr("aria-valuemin", fmt(k.cMin))
      .attr("aria-valuemax", fmt(k.cMax))
      .attr("aria-valuenow", fmt(k.c))
      .datum(k);
  });

  // objective arrow: halo + visible + hit + label
  const objHalo = svg
    .append("line")
    .attr("style", "stroke: var(--objective); stroke-width: 13; stroke-linecap: round; opacity: 0;");
  const objLine = svg
    .append("line")
    .attr("style", "stroke: var(--objective); stroke-width: 2.5;")
    .attr("marker-end", "url(#hero-arrow-obj)");
  const objLabel = svg
    .append("text")
    .attr("style", "font-family: var(--font-sans); font-size: 12px; fill: var(--objective);")
    .text("objective");
  const objHit = svg
    .append("line")
    .attr("style", "stroke: transparent; stroke-width: 20; cursor: grab; touch-action: none;")
    .attr("tabindex", 0)
    .attr("role", "slider")
    .attr("aria-label", "Objective direction")
    .attr("aria-orientation", "horizontal")
    .attr("aria-valuemin", 0)
    .attr("aria-valuemax", 360);

  // Objective heading in degrees (0..360), matching dirWord's compass, for the
  // slider's aria-valuenow. Kept in one place so the drag, keyboard, and readout
  // all report the same number.
  const objDegrees = () => Math.round(((state.theta * 180) / Math.PI + 360) % 360);

  // axes on top
  const gAxes = svg.append("g").attr("style", "stroke: var(--hairline-strong); stroke-width: 1.5;");
  gAxes
    .append("line")
    .attr("x1", x0px)
    .attr("y1", y0px)
    .attr("x2", VW - M.right + 6)
    .attr("y2", y0px)
    .attr("marker-end", "url(#hero-arrow-axis)");
  gAxes
    .append("line")
    .attr("x1", x0px)
    .attr("y1", y0px)
    .attr("x2", x0px)
    .attr("y2", M.top - 6)
    .attr("marker-end", "url(#hero-arrow-axis)");

  // tick labels + axis names
  const gLabels = svg.append("g").attr("style", "font-family: var(--font-sans); font-size: 13px; fill: var(--faint);");
  X_TICKS.forEach((t) =>
    gLabels.append("text").attr("x", X(t)).attr("y", y0px + 16).attr("text-anchor", "middle").text(t)
  );
  Y_TICKS.forEach((t) =>
    gLabels.append("text").attr("x", x0px - 8).attr("y", Y(t) + 4).attr("text-anchor", "end").text(t)
  );
  gLabels.append("text").attr("x", VW - M.right).attr("y", y0px + 20).attr("text-anchor", "end").text(problem.var_names?.[0] || "x1");
  gLabels.append("text").attr("x", x0px - 16).attr("y", M.top + 6).text(problem.var_names?.[1] || "x2");

  // optimum: pulse ring behind, solid dot on top
  const gOpt = svg.append("g");
  const ring = gOpt
    .append("circle")
    .attr("r", 11)
    .attr("fill", "none")
    .attr("style", "stroke: var(--objective); stroke-width: 2;")
    .attr("opacity", ctx.prefersReducedMotion ? 0.5 : 0.6);
  if (!ctx.prefersReducedMotion) {
    ring.append("animate").attr("attributeName", "r").attr("values", "9;19").attr("dur", "1.7s").attr("repeatCount", "indefinite");
    ring.append("animate").attr("attributeName", "opacity").attr("values", "0.6;0").attr("dur", "1.7s").attr("repeatCount", "indefinite");
  }
  const optDot = gOpt
    .append("circle")
    .attr("r", 7)
    .attr("style", "fill: var(--objective); stroke: var(--surface); stroke-width: 2;");

  // Persistent drag affordance: end-dots plus a hollow center knob on each
  // constraint line, and a knob at the objective tip. These are always visible,
  // so the reader sees the lines and arrow are grabbable within 500ms of arrival
  // without needing to hover and reveal the cursor:grab. pointer-events:none lets
  // pointers fall through to the wide transparent hit lines beneath them.
  const gGrips = svg.append("g").attr("style", "pointer-events: none;");
  constraints.forEach((k) => {
    k.gripA = gGrips.append("circle").attr("r", 3).attr("style", `fill: ${k.colorVar};`);
    k.gripB = gGrips.append("circle").attr("r", 3).attr("style", `fill: ${k.colorVar};`);
    k.gripMid = gGrips
      .append("circle")
      .attr("r", 4.5)
      .attr("style", `fill: var(--surface); stroke: ${k.colorVar}; stroke-width: 2;`);
  });
  const objGrip = gGrips
    .append("circle")
    .attr("r", 4.5)
    .attr("style", "fill: var(--surface); stroke: var(--objective); stroke-width: 2;");

  // ---- readout + badge -------------------------------------------------
  const scope = el.closest("figure, section") || document;
  const readout = scope.querySelector('[data-role="hero-readout"]');
  const provenance = scope.querySelector('[data-role="hero-provenance"]');
  const badge = scope.querySelector('.engine-badge[data-role="hero-engine"], .engine-badge');
  if (badge) {
    badge.title =
      "The badge names the engine behind this corner: exact vertex enumeration when drawn from geometry, or the same simplex core compiled to WebAssembly when solving live.";
  }

  const xname = problem.var_names?.[0] || "x1";
  const yname = problem.var_names?.[1] || "x2";

  // Two honest provenance sentences, swapped in lockstep with the badge:
  // the WASM variant when a live solve produced the shown number, the geometry
  // variant otherwise. STORY owns the words; the implementer selects by state.
  const PROV_GEOM =
    "The badge is a promise, not decoration: live, this corner is found by " +
    "testing the objective at every vertex, exact in two dimensions, and it " +
    "matches what an independent solver verified for this problem.";
  const PROV_LIVE =
    "The badge is a promise, not decoration: this corner was just re-solved by " +
    "the same simplex core compiled to WebAssembly, and it lands exactly where " +
    "the exact two dimensional vertex test says it must.";
  function setProvenance(isLive) {
    if (provenance) provenance.textContent = isLive ? PROV_LIVE : PROV_GEOM;
  }

  // Write the readout + aria-label from a point/value pair, whatever its source
  // (the geometric argmax, or a live solve when the badge is live). The corner
  // count is a geometric property, so it always comes from the polygon.
  function writeReadout(point, value, n) {
    const px = fmt(point[0]);
    const py = fmt(point[1]);
    const val = fmt(value);
    svg.attr(
      "aria-label",
      `Feasible region with ${n} corners. The objective points ${dirWord(state.theta)}. Its best corner is ${xname} = ${px}, ${yname} = ${py}, where the objective value is ${val}.`
    );
    if (readout) {
      readout.innerHTML =
        `x* = <b>(${px}, ${py})</b>. Objective value <b>${val}</b>. Feasible region has <b>${n}</b> corners.`;
    }
  }

  function updateReadout(poly, opt) {
    if (!opt) {
      const msg = "The limits leave no points in common, so there is no feasible region.";
      svg.attr("aria-label", msg);
      if (readout) readout.textContent = msg;
      return;
    }
    writeReadout(opt.point, opt.value, poly.length);
  }

  // ---- draw (recompute polygon + optimum, reposition everything) -------
  function draw() {
    const cx = state.objMag * Math.cos(state.theta);
    const cy = state.objMag * Math.sin(state.theta);
    const poly = feasibleRegion(constraints, X_MAX, Y_MAX);
    const opt = objectiveArgmax(poly, cx, cy);

    regionPath.attr("points", poly.map((p) => `${X(p[0])},${Y(p[1])}`).join(" "));

    const dots = gVertices.selectAll("circle").data(poly);
    dots.enter().append("circle").attr("r", 3.5).merge(dots).attr("cx", (p) => X(p[0])).attr("cy", (p) => Y(p[1]));
    dots.exit().remove();

    constraints.forEach((k) => {
      const seg = lineThroughBox(k.a, k.b, k.c, X_MAX, Y_MAX);
      const show = (el2, on) => el2.attr("display", on ? null : "none");
      // The slider value must always track the true right-hand side, even in the
      // rare frame where the drawn line has left the box: a focused handle that
      // reports a stale number is worse than one with no visible line.
      k.hitLine.attr("aria-valuenow", fmt(k.c));
      if (!seg) {
        // Line off-canvas (fully relaxed). Hide the drawn line, halo, grips, and
        // label, but KEEP the hit line displayed so keyboard focus is never lost
        // and an arrow or Home brings the line straight back into view.
        [k.visLine, k.haloLine, k.label, k.gripA, k.gripB, k.gripMid].forEach((e) =>
          show(e, false)
        );
        return;
      }
      const [p0, p1] = seg;
      const ax = X(p0[0]),
        ay = Y(p0[1]),
        bx = X(p1[0]),
        by = Y(p1[1]);
      [k.visLine, k.haloLine, k.hitLine].forEach((e) =>
        show(e, true).attr("x1", ax).attr("y1", ay).attr("x2", bx).attr("y2", by)
      );
      show(k.gripA, true).attr("cx", ax).attr("cy", ay);
      show(k.gripB, true).attr("cx", bx).attr("cy", by);
      show(k.gripMid, true).attr("cx", (ax + bx) / 2).attr("cy", (ay + by) / 2);
      const hi = ay < by ? [ax, ay] : [bx, by];
      show(k.label, true)
        .attr("x", clamp(hi[0] + 6, 4, VW - 60))
        .attr("y", clamp(hi[1] + (hi[1] < 28 ? 16 : -6), 14, VH - 6))
        .text(`${k.termStr} ${LE} ${fmt(k.c)}`);
    });

    const ux = Math.cos(state.theta),
      uy = Math.sin(state.theta);
    const tip = { x: OBJ_BASE.x + ux * OBJ_LEN, y: OBJ_BASE.y + uy * OBJ_LEN };
    [objLine, objHalo, objHit].forEach((e) =>
      e.attr("x1", X(OBJ_BASE.x)).attr("y1", Y(OBJ_BASE.y)).attr("x2", X(tip.x)).attr("y2", Y(tip.y))
    );
    objLabel.attr("x", X(tip.x) + 6).attr("y", Y(tip.y) - 6);
    // Knob at the arrow's pivot base (not the tip, which already carries the
    // arrowhead), marking the objective as a grabbable, turnable handle.
    objGrip.attr("cx", X(OBJ_BASE.x)).attr("cy", Y(OBJ_BASE.y));
    objHit
      .attr("aria-valuenow", objDegrees())
      .attr("aria-valuetext", `pointing ${dirWord(state.theta)}, ${objDegrees()} degrees`);

    if (opt) {
      const ox = X(opt.point[0]),
        oy = Y(opt.point[1]);
      optDot.attr("display", null).attr("cx", ox).attr("cy", oy);
      ring.attr("display", null).attr("cx", ox).attr("cy", oy);
    } else {
      optDot.attr("display", "none");
      ring.attr("display", "none");
    }

    updateReadout(poly, opt);
  }

  // Coalesce drag/keyboard updates to one redraw per animation frame.
  let rafId = null;
  function scheduleDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      draw();
    });
  }

  // ---- live WASM solve (S1) ------
  // The region and its corner are always drawn from exact 2D geometry (instant).
  // Separately, debounced, the live WASM core re-solves the CURRENT view:
  // when it returns "optimal" AND agrees with the shown corner, the badge flips
  // to "solving live (WASM)" and the readout comes from that solve. On any
  // disagreement or when WASM is blocked (ctx.solve null), we keep the geometric
  // answer and the honest "drawn from geometry" badge, exactly as today.
  const SOLVE_OPTS = { pivot_rule: "dantzig", max_iterations: 10000, record_trace: false };
  const SOLVE_DEBOUNCE_MS = 24;
  let live = false;       // is the badge currently "solving live (WASM)"?
  let liveWarned = false; // one-shot guard for the disagreement console.warn
  let engineUp = false;   // did ensureEngine report a usable WASM engine?
  let solveToken = 0;     // drops any solve superseded by a newer interaction
  let solveTimer = null;

  ctx.ensureEngine().then(
    (ok) => { engineUp = ok === true; },
    () => { engineUp = false; }
  );

  // Reconcile one solve result against the geometry snapshot it was solved for.
  function applyLive(sol, snap) {
    const g = snap.g;
    const matched =
      sol &&
      sol.status === "optimal" &&
      g &&
      Array.isArray(sol.x) &&
      sol.x.length >= 2 &&
      Math.abs(sol.x[0] - g.point[0]) < 1e-6 &&
      Math.abs(sol.x[1] - g.point[1]) < 1e-6;
    if (matched) {
      // The shown number now came from solve_json this frame.
      writeReadout(sol.x, sol.objective_value, snap.n);
      if (!live) {
        live = true;
        ctx.setEngine("live");
        setProvenance(true);
      }
      return;
    }
    if (live) {
      live = false;
      ctx.setEngine("geometric");
      setProvenance(false);
    }
    // Warn once, only when the engine RAN and truly disagreed (the box-artifact
    // case). A null solve with no engine is the honest WASM-blocked fallback, so
    // it stays silent (zero console errors).
    const enginePresent = sol != null || engineUp;
    if (enginePresent && g && !liveWarned) {
      liveWarned = true;
      if (window.console && console.warn) {
        console.warn(
          "hero: the live solve and the box-clipped geometry disagree here; showing the geometric corner."
        );
      }
    }
  }

  function runSolve() {
    const token = ++solveToken;
    // Snapshot the geometry for the EXACT state we hand the solver, so a drag
    // between dispatch and resolution is not a false mismatch; the token drops
    // any solve a newer interaction has superseded.
    const cx = state.objMag * Math.cos(state.theta);
    const cy = state.objMag * Math.sin(state.theta);
    const poly = feasibleRegion(constraints, X_MAX, Y_MAX);
    const g = objectiveArgmax(poly, cx, cy);
    const lp = {
      direction: "maximize",
      objective: [cx, cy],
      constraints: constraints.map((k) => ({ coeffs: [k.a, k.b], op: "le", rhs: k.c })),
      var_names: problem.var_names || null,
    };
    ctx.solve(lp, SOLVE_OPTS).then((sol) => {
      if (token !== solveToken) return;
      applyLive(sol, { g, n: poly.length });
    });
  }

  function scheduleSolve() {
    if (solveTimer) clearTimeout(solveTimer);
    solveTimer = setTimeout(() => {
      solveTimer = null;
      runSolve();
    }, SOLVE_DEBOUNCE_MS);
  }

  // Every interaction redraws the geometry immediately (rAF) and asks for a live
  // re-solve on its own debounce (the two schedulers are independent).
  function bump() {
    scheduleDraw();
    scheduleSolve();
  }

  // ---- pointer coordinates in data space -------------------------------
  const dataAt = (event) => {
    const [px, py] = d3.pointer(event, svgNode);
    return { x: xScale.invert(px), y: yScale.invert(py) };
  };

  // ---- drag: constraints translate rhs, objective rotates --------------
  const dragConstraint = d3
    .drag()
    .container(svgNode)
    .on("start", function () {
      this.style.cursor = "grabbing";
    })
    .on("drag", function (event, k) {
      const p = dataAt(event);
      k.c = clamp(k.a * p.x + k.b * p.y, k.cMin, k.cMax);
      bump();
    })
    .on("end", function () {
      this.style.cursor = "grab";
    });

  const dragObjective = d3
    .drag()
    .container(svgNode)
    .on("start", function () {
      this.style.cursor = "grabbing";
    })
    .on("drag", function (event) {
      const p = dataAt(event);
      const dx = p.x - OBJ_BASE.x;
      const dy = p.y - OBJ_BASE.y;
      if (Math.hypot(dx, dy) < 1e-6) return;
      state.theta = Math.atan2(dy, dx);
      bump();
    })
    .on("end", function () {
      this.style.cursor = "grab";
    });

  constraints.forEach((k) => d3.select(k.hitLine.node()).call(dragConstraint));
  d3.select(objHit.node()).call(dragObjective);

  // ---- keyboard --------------------------------------------------------
  const focusHalo = (line, on) => line.attr("opacity", on ? 0.28 : 0);
  constraints.forEach((k) => {
    const node = k.hitLine.node();
    node.addEventListener("focus", () => focusHalo(k.haloLine, true));
    node.addEventListener("blur", () => focusHalo(k.haloLine, false));
    node.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 1 : 0.25;
      let handled = true;
      switch (event.key) {
        case "ArrowUp":
        case "ArrowRight":
          k.c = clamp(k.c + step, k.cMin, k.cMax);
          break;
        case "ArrowDown":
        case "ArrowLeft":
          k.c = clamp(k.c - step, k.cMin, k.cMax);
          break;
        case "Home":
          k.c = k.cMin;
          break;
        case "End":
          k.c = k.cMax;
          break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        bump();
      }
    });
  });

  const objNode = objHit.node();
  objNode.addEventListener("focus", () => focusHalo(objHalo, true));
  objNode.addEventListener("blur", () => focusHalo(objHalo, false));
  objNode.addEventListener("keydown", (event) => {
    const d = ((event.shiftKey ? 15 : 5) * Math.PI) / 180;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        state.theta = (state.theta + d) % TAU;
        break;
      case "ArrowRight":
      case "ArrowDown":
        state.theta = (state.theta - d + TAU) % TAU;
        break;
      case "Home":
        state.theta = state.theta0;
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      bump();
    }
  });

  // ---- go live ---------------------------------------------------------
  draw(); // authored default: untouched statquest LP, optimum already ringed

  // Swap the no-JS still for the live figure in one atomic operation, so the
  // box is never blank even for a frame.
  const still = el.querySelector("svg");
  if (still) still.replaceWith(svgNode);
  else el.appendChild(svgNode);

  // At rest, before any live solve reports in, the honest state is the exact
  // geometric read: vertex enumeration, not a solver or a trace replay.
  ctx.setEngine("geometric");
  setProvenance(false);

  // Kick one live solve of the resting view. If the WASM engine is available it
  // reproduces this corner and the badge flips to "solving live (WASM)"
  // if WASM is blocked ctx.solve resolves null
  // and the figure stays exactly as it renders today: geometric badge, no noise.
  scheduleSolve();
}
