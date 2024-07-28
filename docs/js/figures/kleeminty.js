// Feasible Region . figures/kleeminty.js . S5 the worst case, built on purpose
//
// LEFT a log-scale cost chart: the worst-case corner count is 2^n, an EXACT
// BigInt (n from 3 to 200; at 200 it is 1.606938e60, 61 digits) over an n^3
// reference labelled as scale, not a bound. RIGHT the n = 3 Klee-Minty cube:
// Dantzig's greedy rule is lured through all eight corners to the exit at
// (0, 0, 10000). A live WASM re-solve reproduces that walk exactly (flipping the
// badge to live), and a compare control overlays Bland's walk on the same cube as
// a divergence-aware dashed ghost, so both rules are seen at once; with WASM
// blocked the cube keeps the recorded Dantzig walk and the control is disabled.
// The big-n chart is exact arithmetic and never drives the engine badge.

import { classifyEdges, makeProjector, triadArms, walkIndices } from "../iso3d.js";

const SVGNS = "http://www.w3.org/2000/svg";

// ---- chart geometry (matches the authored still exactly) -----------------
const CW = 380;
const CH = 300;
const CM = { l: 46, r: 18, t: 20, b: 40 }; // chart plot margins
const PL = CM.l;
const PR = CW - CM.r; // 362
const PT = CM.t; // 20
const PB = CH - CM.b; // 260
const N_MIN = 3;
const N_MAX = 200;
const Y_MAX = 61; // top of the log10 axis, in digits of the corner count
const LOG2 = Math.log10(2); // 0.3010299957...
// n sampled for the smooth reference curve; the worst case is a straight line.
const REF_NS = [3, 6, 10, 16, 24, 36, 52, 74, 104, 144, 200];

const chartX = (n) => PL + ((n - N_MIN) / (N_MAX - N_MIN)) * (PR - PL);
const chartY = (y) => PB - (y / Y_MAX) * (PB - PT);
const worstY = (n) => n * LOG2; // log10 of 2^n
const refY = (n) => 3 * Math.log10(n); // log10 of n^3

// ---- cube geometry (matches the authored still exactly) ------------------
const PANEL_W = 380;
const PANEL_H = 300;
const PAD = 40;

// ---- little DOM builders (no d3) -----------------------------------------
function svgEl(name, attrs) {
  const e = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function htmlEl(name, attrs, text) {
  const e = document.createElement(name);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

// A clean integer, or two decimals for the rare non-integer. Trace vertices and
// objectives here are exact integers, so this stays clean.
const num = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(2)));
const vtx = (v) => `${num(v[0])}, ${num(v[1])}, ${num(v[2])}`;

// EXACT worst case corner count 2^n as a BigInt, so no float ever rounds it.
const corners = (n) => 2n ** BigInt(n);

// Format a corner count for the <count> slot: small counts in full, large ones
// as a seven figure mantissa with an exponent. corners(200) -> "1.606938e60".
function fmtCount(n) {
  const s = corners(n).toString();
  if (s.length <= 9) return s;
  return `${s[0]}.${s.slice(1, 7)}e${s.length - 1}`;
}

// A "10" with a superscript exponent, for the log axis tick labels. Exponent 0
// is just "1". Uses a tspan baseline shift so no dash or caret appears.
function powerLabel(x, y, exp) {
  const t = svgEl("text", { class: "km-tick-label km-tick-y", x, y });
  if (exp === 0) {
    t.textContent = "1";
    return t;
  }
  t.appendChild(document.createTextNode("10"));
  const sup = svgEl("tspan", { "baseline-shift": "super", "font-size": "0.72em" });
  sup.textContent = String(exp);
  t.appendChild(sup);
  return t;
}

export default async function mount(box, ctx) {
  const trace = await ctx.loadTrace(ctx.fixture || "kleeminty3");
  const committedSteps = trace.steps; // the recorded Dantzig walk, the fallback
  // steps / lastStep are reassigned when a live pivot-rule re-solve lands.
  let steps = committedSteps;
  const geom = trace.geometry;
  let lastStep = steps.length - 1;

  const scope = box.closest("figure, section") || document;
  const cubeBox = scope.querySelector('[data-role="km-cube-box"]');
  const chartCtl = scope.querySelector('[data-role="km-chart-controls"]');
  const cubeCtl = scope.querySelector('[data-role="km-cube-controls"]');
  const chartOut = scope.querySelector('[data-role="km-chart-readout"]');
  const cubeOut = scope.querySelector('[data-role="km-cube-readout"]');

  // ======================================================================
  // LEFT PANEL: the log scale cost chart
  // ======================================================================
  const chart = svgEl("svg", {
    class: "fig-svg km-chart-svg",
    viewBox: `0 0 ${CW} ${CH}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
  });

  // horizontal gridlines + y tick labels at 0, 20, 40, 60 digits
  const gGrid = svgEl("g", { class: "km-grid-lines" });
  [0, 20, 40, 60].forEach((yv) => {
    const py = chartY(yv);
    gGrid.appendChild(svgEl("line", { class: "km-gridline", x1: PL, y1: py, x2: PR, y2: py }));
    const lbl = powerLabel(PL - 6, py + 3.5, yv);
    gGrid.appendChild(lbl);
  });
  chart.appendChild(gGrid);

  // axes
  const gAxis = svgEl("g", { class: "km-axis" });
  gAxis.appendChild(svgEl("line", { class: "km-axis-line", x1: PL, y1: PT, x2: PL, y2: PB }));
  gAxis.appendChild(svgEl("line", { class: "km-axis-line", x1: PL, y1: PB, x2: PR, y2: PB }));
  chart.appendChild(gAxis);

  // x tick labels at n = 3, 50, 100, 150, 200
  const gxT = svgEl("g", { class: "km-ticks-x" });
  [N_MIN, 50, 100, 150, N_MAX].forEach((nv) => {
    const px = chartX(nv);
    gxT.appendChild(svgEl("line", { class: "km-tick-mark", x1: px, y1: PB, x2: px, y2: PB + 4 }));
    const t = svgEl("text", { class: "km-tick-label km-tick-x", x: px, y: PB + 16 });
    t.textContent = String(nv);
    gxT.appendChild(t);
  });
  chart.appendChild(gxT);

  // axis titles
  const xTitle = svgEl("text", { class: "km-axis-title", x: (PL + PR) / 2, y: CH - 4 });
  xTitle.textContent = "dimension n";
  chart.appendChild(xTitle);
  const yTitle = svgEl("text", {
    class: "km-axis-title",
    x: 12,
    y: (PT + PB) / 2,
    transform: `rotate(-90 12 ${(PT + PB) / 2})`,
  });
  yTitle.textContent = "corners visited (log scale)";
  chart.appendChild(yTitle);

  // reference n^3 curve (polynomial, for scale, not a bound)
  const refPts = REF_NS.map((n) => `${chartX(n).toFixed(2)},${chartY(refY(n)).toFixed(2)}`).join(" ");
  chart.appendChild(svgEl("polyline", { class: "km-ref", points: refPts }));

  // worst case 2^n curve (a straight climb on the log axis)
  const worstPts =
    `${chartX(N_MIN).toFixed(2)},${chartY(worstY(N_MIN)).toFixed(2)} ` +
    `${chartX(N_MAX).toFixed(2)},${chartY(worstY(N_MAX)).toFixed(2)}`;
  chart.appendChild(svgEl("polyline", { class: "km-worst", points: worstPts }));

  // curve labels
  const worstLabel = svgEl("text", { class: "km-curve-label km-worst-label", x: chartX(150), y: chartY(worstY(150)) - 8 });
  worstLabel.textContent = "worst case, 2ⁿ corners";
  chart.appendChild(worstLabel);
  const refLabel = svgEl("text", { class: "km-curve-label km-ref-label", x: chartX(60), y: chartY(refY(60)) - 6 });
  refLabel.textContent = "polynomial, for scale, not a bound";
  chart.appendChild(refLabel);

  // marker: a guide line dropping to the axis plus a dot riding the worst curve
  const guide = svgEl("line", { class: "km-guide" });
  const marker = svgEl("circle", { class: "km-marker", r: 5 });
  chart.appendChild(guide);
  chart.appendChild(marker);

  // ---- chart controls: native range slider + a big count readout --------
  const slider = htmlEl("input", {
    type: "range",
    class: "scrubber km-slider",
    min: String(N_MIN),
    max: String(N_MAX),
    step: "1",
    value: String(N_MIN),
    "aria-label": "Dimension n",
  });
  const big = htmlEl("span", { class: "km-big", "aria-hidden": "true" });

  function renderChart() {
    const n = parseInt(slider.value, 10) || N_MIN;
    const mx = chartX(n);
    const my = chartY(worstY(n));
    marker.setAttribute("cx", mx.toFixed(2));
    marker.setAttribute("cy", my.toFixed(2));
    guide.setAttribute("x1", mx.toFixed(2));
    guide.setAttribute("y1", my.toFixed(2));
    guide.setAttribute("x2", mx.toFixed(2));
    guide.setAttribute("y2", PB);
    const c = fmtCount(n);
    big.innerHTML = `n = <b>${n}</b> &rarr; <b>${c}</b> corners`;
    slider.setAttribute("aria-valuetext", `n = ${n}, worst case ${c} corners`);
    if (chartOut) {
      const head = `At n = <b>${n}</b>, worst-case Dantzig visits <b>${c}</b> corners`;
      // At the top of the slider the head already names n = 200 and the value, so
      // the extrapolation tail would only repeat it; keep just the digit count.
      chartOut.innerHTML =
        n === N_MAX
          ? `${head}, a number with 61 digits.`
          : `${head}; at n = 200 that is <b>1.606938e60</b>, a number with 61 digits.`;
    }
  }
  slider.addEventListener("input", renderChart);

  // ======================================================================
  // RIGHT PANEL: the n = 3 cube walk
  // ======================================================================
  const proj = makeProjector({
    vertices: geom.vertices,
    width: PANEL_W,
    height: PANEL_H,
    pad: PAD,
    normalize: true, // axis maxes 1, 100, 10000 render as a true cube
  });
  const screen = geom.vertices.map((v) => proj.project(v));
  // Geometry-vertex index the walk lands on, in step order. Reassigned by a live
  // pivot-rule re-solve; [7,3,1,5,4,0,2,6] (all 8 corners) for the recorded Dantzig walk.
  let walk = walkIndices(geom, steps);

  const cube = svgEl("svg", {
    class: "fig-svg km-cube-svg",
    viewBox: `0 0 ${PANEL_W} ${PANEL_H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
  });

  // wireframe edges (no stored faces, matches the S3 look)
  const edgeEls = geom.edges.map(([i, j]) => {
    const e = svgEl("line", { class: "km-edge", x1: screen[i][0], y1: screen[i][1], x2: screen[j][0], y2: screen[j][1] });
    cube.appendChild(e);
    return e;
  });

  // Depth cues, recomputed from the problem constraints and the live
  // projection: at mount and again after every pivot-rule re-solve. The hull
  // never changes here, but the classes are recomputed, never cached.
  function classifyWire() {
    const depth = classifyEdges(trace.problem.constraints, geom.vertices, geom.edges, {
      project: proj.project,
      spans: proj.spans,
    });
    edgeEls.forEach((el, k) => el.classList.toggle("is-back", depth[k] === "back"));
  }
  classifyWire();

  // Axis triad in the free lower-left corner plus the labeled origin. The
  // hidden corner projects about 22 viewBox units up and right of the origin,
  // so the label hangs low and right, clear of that corner's back edges.
  const gTriad = svgEl("g", { class: "iso-triad", "aria-hidden": "true" });
  for (const arm of triadArms(40, 240, 15)) {
    gTriad.appendChild(
      svgEl("line", { class: "iso-triad-arm", x1: arm.x1, y1: arm.y1, x2: arm.x2, y2: arm.y2 })
    );
    const t = svgEl("text", { class: "iso-triad-label", x: arm.lx, y: arm.ly, "text-anchor": arm.anchor });
    t.textContent = arm.label;
    gTriad.appendChild(t);
  }
  cube.appendChild(gTriad);
  const kmOrigin = proj.project([0, 0, 0]);
  const originLabel = svgEl("text", {
    class: "iso-origin",
    x: kmOrigin[0] + 8,
    y: kmOrigin[1] + 12,
    "text-anchor": "start",
    "aria-hidden": "true",
  });
  originLabel.textContent = "0";
  cube.appendChild(originLabel);

  // vertices (created before the trail so trail segments insert just beneath them)
  const vertEls = geom.vertices.map((v, idx) => {
    const c = svgEl("circle", { class: "km-vertex", cx: screen[idx][0], cy: screen[idx][1], r: 3.5 });
    cube.appendChild(c);
    return c;
  });

  // one trail segment per hop, revealed up to the current step. Rebuilt whenever
  // the walk changes (a live pivot-rule re-solve gives Bland a different path).
  let trailEls = [];
  function buildTrail(w) {
    trailEls.forEach((s) => s.remove());
    trailEls = [];
    for (let k = 0; k < w.length - 1; k++) {
      const a = screen[w[k]];
      const b = screen[w[k + 1]];
      const seg = svgEl("line", { class: "km-trail", x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      cube.insertBefore(seg, vertEls[0]);
      trailEls.push(seg);
    }
  }
  buildTrail(walk);

  const ring = svgEl("circle", { class: "km-current-ring", r: 10 });
  const current = svgEl("circle", { class: "km-current", r: 6 });
  const curLabel = svgEl("text", { class: "km-current-label" });
  cube.appendChild(ring);
  cube.appendChild(current);
  cube.appendChild(curLabel);

  // ---- cube controls: scrubber + prev / next / play ---------------------
  const prevBtn = htmlEl("button", { type: "button", class: "btn dv-step-btn" }, "Prev");
  const nextBtn = htmlEl("button", { type: "button", class: "btn dv-step-btn" }, "Next");
  const scrub = htmlEl("input", {
    type: "range",
    class: "scrubber km-scrub",
    min: "0",
    max: String(lastStep),
    step: "1",
    value: String(lastStep),
    "aria-label": "Corner of the cube walk",
  });
  const stepTag = htmlEl("span", { class: "dv-step-tag", "aria-hidden": "true" });
  // Autoplay is motion, so the play button exists only when motion is welcome.
  const playBtn = ctx.prefersReducedMotion
    ? null
    : htmlEl("button", { type: "button", class: "btn dv-play", "aria-pressed": "false" }, "Play");

  let cur = lastStep; // resting default: the finished walk, optimum ringed
  let timer = null;

  function renderCube() {
    trailEls.forEach((seg, k) => seg.classList.toggle("is-on", k < cur));
    const visited = walk.slice(0, cur + 1);
    vertEls.forEach((c, idx) => c.classList.toggle("is-visited", visited.includes(idx)));

    const p = screen[walk[cur]];
    ring.setAttribute("cx", p[0]);
    ring.setAttribute("cy", p[1]);
    current.setAttribute("cx", p[0]);
    current.setAttribute("cy", p[1]);
    const v = steps[cur].vertex;
    curLabel.setAttribute("x", Math.min(p[0] + 10, PANEL_W - 4));
    curLabel.setAttribute("y", Math.max(p[1] - 10, 14));
    curLabel.setAttribute("text-anchor", p[0] > PANEL_W - 78 ? "end" : "start");
    if (p[0] > PANEL_W - 78) curLabel.setAttribute("x", p[0] - 10);
    curLabel.textContent = `(${vtx(v)})`;

    scrub.value = String(cur);
    stepTag.textContent = `corner ${cur} of ${lastStep}`;
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === lastStep;

    const val = num(steps[cur].objective_value);
    let msg;
    if (cur === lastStep) {
      msg = `All ${lastStep + 1} corners visited; optimum (${vtx(v)}), objective ${val}.`;
    } else {
      const j = cur + 1;
      msg = `Corner ${cur} of ${lastStep} at (${vtx(v)}); objective ${val}; ${j} corner${j === 1 ? "" : "s"} visited.`;
    }
    if (cubeOut) cubeOut.textContent = msg;
    cube.setAttribute("aria-label", msg);
    scrub.setAttribute("aria-valuetext", msg);
  }

  function setStep(i) {
    cur = Math.max(0, Math.min(lastStep, i));
    renderCube();
  }

  function stopPlay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (playBtn) {
      playBtn.setAttribute("aria-pressed", "false");
      playBtn.textContent = "Play";
    }
  }
  function startPlay() {
    if (!playBtn) return;
    if (cur === lastStep) setStep(0); // replay from the first corner
    playBtn.setAttribute("aria-pressed", "true");
    playBtn.textContent = "Pause";
    timer = setInterval(() => {
      if (cur >= lastStep) {
        stopPlay();
        return;
      }
      setStep(cur + 1);
    }, 900);
  }

  prevBtn.addEventListener("click", () => {
    stopPlay();
    setStep(cur - 1);
  });
  nextBtn.addEventListener("click", () => {
    stopPlay();
    setStep(cur + 1);
  });
  scrub.addEventListener("input", () => {
    stopPlay();
    setStep(parseInt(scrub.value, 10) || 0);
  });
  if (playBtn) playBtn.addEventListener("click", () => (timer ? stopPlay() : startPlay()));

  // ======================================================================
  // Provenance + engine badge honesty
  // ======================================================================
  // The resting cube shows the recorded Dantzig walk (replaying trace). When the
  // WASM engine warms, a live Dantzig re-solve reproduces this exact walk, so the
  // badge honestly flips to live without redrawing the trail. Bland is never the
  // primary walk here; it rides in only as a ghost overlay (see below).
  const provEl = scope.querySelector('[data-role="km-provenance"]');
  const PROV_TRACE =
    "Both panels replay the kleeminty3 trace, corner for corner as our reference " +
    "solver logged it; an independent solver reached the same optimum.";
  const PROV_LIVE =
    "The cube on the right is re-solving live in your browser, the same simplex core " +
    "compiled to WebAssembly; the recorded Dantzig walk is reproduced exactly, and the " +
    "compare control overlays Bland's walk on the same cube. The cost chart on the left " +
    "stays exact arithmetic.";
  const setProv = (live) => { if (provEl) provEl.textContent = live ? PROV_LIVE : PROV_TRACE; };

  let engineOK = false;

  // Reassign the walk to a new step list, rebuild the trail, re-render. Kept as a
  // guarded path; the live Dantzig re-solve normally matches the recorded walk and
  // never triggers a rebuild (so the resting trail elements stay stable).
  function applyWalk(newSteps) {
    if (!Array.isArray(newSteps) || newSteps.length === 0) return false;
    const w = walkIndices(geom, newSteps);
    if (w.some((i) => i < 0)) return false;
    steps = newSteps;
    walk = w;
    lastStep = steps.length - 1;
    buildTrail(walk);
    classifyWire();
    scrub.max = String(lastStep);
    cur = lastStep;
    renderCube();
    return true;
  }

  // ---- compare control: Bland's walk as a divergence-aware ghost --------------
  // The upgrade over a plain rule swap is SIMULTANEITY: Dantzig's walk stays the
  // solid primary while Bland's walk is drawn as a dashed ghost on the SAME cube.
  // Bland shares most edges with Dantzig here, so each ghost segment is nudged a
  // few pixels along its normal; shared edges then read as two parallel strokes
  // instead of fusing, and the divergent edge stands clear. A text equivalent
  // names both rules so the comparison is never stroke-style-only. Bland needs a
  // live solve (the engine exposes dantzig and bland), so with WASM blocked the
  // control is disabled and the cube keeps the lone recorded Dantzig walk.
  const cmpWrap = htmlEl("div", { class: "km-rules" });
  const cmpRow = htmlEl("div", { class: "km-rule-row", role: "group", "aria-label": "Second walk" });
  cmpRow.appendChild(htmlEl("span", { class: "km-rules-label" }, "Second walk"));
  const cmpBtn = htmlEl("button", { type: "button", class: "btn km-rule-btn", "aria-pressed": "false" }, "Compare Bland");
  cmpBtn.disabled = true;
  cmpBtn.title = "Live re-solve needs the WebAssembly engine; showing the recorded Dantzig walk";
  cmpRow.append(cmpBtn);
  const cmpMsg = htmlEl("p", { class: "km-rule-msg", "aria-live": "polite" });
  cmpWrap.append(cmpRow, cmpMsg);

  const GHOST_OFF = 4; // px along each segment normal, so shared edges never fuse
  let ghostEls = [];
  let blandStepsCache = null;
  let comparing = false;

  function clearGhost() {
    ghostEls.forEach((el) => el.remove());
    ghostEls = [];
  }
  function buildGhost(w) {
    clearGhost();
    for (let k = 0; k < w.length - 1; k++) {
      const a = screen[w[k]];
      const b = screen[w[k + 1]];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * GHOST_OFF;
      const ny = (dx / len) * GHOST_OFF;
      const seg = svgEl("line", {
        class: "km-ghost",
        x1: (a[0] + nx).toFixed(2),
        y1: (a[1] + ny).toFixed(2),
        x2: (b[0] + nx).toFixed(2),
        y2: (b[1] + ny).toFixed(2),
      });
      cube.insertBefore(seg, ring); // above the wireframe, below the current dot
      ghostEls.push(seg);
    }
  }

  async function solveBland() {
    if (blandStepsCache) return blandStepsCache;
    if (!engineOK) return null;
    const sol = await ctx.solve(trace.problem, { pivot_rule: "bland", max_iterations: 10000, record_trace: true });
    if (sol && sol.trace && Array.isArray(sol.trace.steps)) {
      const w = walkIndices(geom, sol.trace.steps);
      if (!w.some((i) => i < 0)) {
        blandStepsCache = sol.trace.steps;
        return blandStepsCache;
      }
    }
    return null;
  }

  function cmpRest() {
    cmpMsg.textContent = engineOK
      ? "Dantzig's greedy rule tours all 8 corners before the exit. Compare Bland to see a second walk on the same cube."
      : "Dantzig's greedy rule tours all 8 corners before the exit (recorded).";
  }
  function cmpBoth(bn) {
    cmpMsg.textContent =
      `Both walks shown. Dantzig's greedy rule (solid) tours all ${walk.length} corners; ` +
      `Bland's lowest-index rule (dashed) reaches the exit in ${bn} corner${bn === 1 ? "" : "s"} ` +
      "on the very same cube.";
  }

  async function toggleCompare() {
    if (!comparing) {
      const bs = await solveBland();
      if (!bs) {
        cmpMsg.textContent = "Live re-solve unavailable; showing Dantzig's recorded walk only.";
        return;
      }
      buildGhost(walkIndices(geom, bs));
      comparing = true;
      cmpBtn.setAttribute("aria-pressed", "true");
      cmpBtn.textContent = "Hide Bland";
      cmpBoth(bs.length);
    } else {
      clearGhost();
      comparing = false;
      cmpBtn.setAttribute("aria-pressed", "false");
      cmpBtn.textContent = "Compare Bland";
      cmpRest();
    }
  }
  cmpBtn.addEventListener("click", toggleCompare);

  // ======================================================================
  // First paint, then swap the stills for the live views in one pass
  // ======================================================================
  renderChart();
  renderCube();

  const stillChart = box.querySelector("svg");
  if (stillChart) stillChart.replaceWith(chart);
  else box.appendChild(chart);

  if (cubeBox) {
    const stillCube = cubeBox.querySelector("svg");
    if (stillCube) stillCube.replaceWith(cube);
    else cubeBox.appendChild(cube);
  }

  if (chartCtl) chartCtl.replaceChildren(slider, big);
  if (cubeCtl) {
    const kids = [prevBtn, scrub, nextBtn];
    if (playBtn) kids.push(playBtn);
    kids.push(stepTag);
    cubeCtl.replaceChildren(...kids);
    cubeCtl.parentNode.insertBefore(cmpWrap, cubeCtl); // compare control sits above the scrubber
  }

  // Resting state: the recorded Dantzig walk (replaying trace). Warm the WASM
  // engine; if it loads, enable the compare control and verify the Dantzig walk
  // with a live solve so the badge honestly flips to live (the walk is identical,
  // so the trail is never redrawn), then pre-warm Bland for an instant first click.
  ctx.setEngine("trace");
  setProv(false);
  cmpRest();
  ctx.ensureEngine().then(
    (ok) => {
      engineOK = ok === true;
      if (!engineOK) return;
      cmpBtn.disabled = false;
      cmpBtn.removeAttribute("title");
      cmpRest();
      ctx
        .solve(trace.problem, { pivot_rule: "dantzig", max_iterations: 10000, record_trace: true })
        .then((sol) => {
          if (!sol || !sol.trace || !Array.isArray(sol.trace.steps)) return;
          const w = walkIndices(geom, sol.trace.steps);
          if (w.some((i) => i < 0)) return;
          const same = w.length === walk.length && w.every((x, i) => x === walk[i]);
          if (!same) applyWalk(sol.trace.steps); // live disagreed: honor the live walk
          ctx.setEngine("live");
          setProv(true);
        })
        .catch(() => {});
      solveBland(); // pre-warm; result cached for the first compare click
    },
    () => { engineOK = false; }
  );

  // Progressive enhancement of the sibling cycling exhibit. Fire and forget
  // so a slow or failed import never blocks this figure or its live state, and the
  // cycling exhibit keeps its authored still. cycling.js never touches its badge.
  try {
    const section = box.closest("section");
    const cycBox = section && section.querySelector('[data-role="cyc-loop-box"]');
    if (cycBox && !cycBox.dataset.cycMounted) {
      cycBox.dataset.cycMounted = "1";
      import("./cycling.js")
        .then((m) => {
          const fn = m.default || m.mount;
          if (typeof fn === "function") return fn(cycBox, ctx);
        })
        .catch(() => {});
    }
  } catch (e) {
    /* keep the authored still */
  }
}
