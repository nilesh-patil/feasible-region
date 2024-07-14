// Feasible Region . figures/kleeminty.js . S5 the worst case, built on purpose
//
// LEFT a log-scale cost chart: the worst-case corner count is 2^n, an EXACT
// BigInt (n from 3 to 200; at 200 it is 1.606938e60, 61 digits) over an n^3
// reference labelled as scale, not a bound. RIGHT the n = 3 Klee-Minty cube:
// Dantzig's greedy rule is lured through all eight corners to the exit at
// (0, 0, 10000). A pivot-rule selector re-solves the cube live via the WASM
// core, so Bland's lowest-index rule can be raced against Dantzig on the same
// polytope; with WASM blocked the cube replays the recorded Dantzig walk. The
// big-n chart is exact arithmetic and never drives the engine badge.

import { makeProjector, walkIndices } from "../iso3d.js";

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
  const betOut = scope.querySelector('[data-role="km-bet"]');

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

  // wireframe edges (no faces, matches the S3 look)
  geom.edges.forEach(([i, j]) => {
    cube.appendChild(
      svgEl("line", { class: "km-edge", x1: screen[i][0], y1: screen[i][1], x2: screen[j][0], y2: screen[j][1] })
    );
  });

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
  // Place your bets (revealed by default, so it is honest with scripts off)
  // ======================================================================
  const betWrap = htmlEl("div", { class: "km-bet-live" });
  betWrap.appendChild(
    htmlEl("p", { class: "km-bet-q" }, "Place your bet: how many of the cube's 8 corners does the greedy rule touch before it exits?")
  );
  const betRow = htmlEl("div", { class: "km-bet-row" });
  const betMsg = htmlEl("p", { class: "km-bet-msg", "aria-live": "polite" });
  betMsg.textContent = "The greedy rule is rigged to touch all 8 corners, every one, before it exits at (0, 0, 10000).";
  [2, 4, 6, 8].forEach((g) => {
    const b = htmlEl("button", { type: "button", class: "btn km-bet-btn" }, String(g));
    b.addEventListener("click", () => {
      betRow.querySelectorAll(".km-bet-btn").forEach((n) => n.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      betMsg.textContent =
        g === 8
          ? "You bet 8. Correct: the greedy rule touches all 8 corners, every one, before it exits."
          : `You bet ${g}. It actually touches all 8, every corner, before it exits at (0, 0, 10000).`;
    });
    betRow.appendChild(b);
  });
  betWrap.appendChild(betRow);
  betWrap.appendChild(betMsg);

  // ---- pivot-rule selector: re-solve the cube live (Dantzig vs Bland) --------
  // Same LP, same corners; only the WALK differs by rule. Dantzig is the recorded
  // fallback; a live WASM re-solve swaps in the selected rule's path and flips the
  // badge to live. WASM blocked -> Bland disabled, the cube keeps the Dantzig trace.
  const provEl = scope.querySelector('[data-role="km-provenance"]');
  const PROV_TRACE =
    "Both panels replay the kleeminty3 trace, corner for corner as our reference " +
    "solver logged it; an independent solver reached the same optimum.";
  const PROV_LIVE =
    "The cube on the right is re-solving live in your browser, the same simplex core " +
    "compiled to WebAssembly; the pivot-rule buttons race Dantzig against Bland on the " +
    "same cube. The cost chart on the left stays exact arithmetic.";
  const setProv = (live) => { if (provEl) provEl.textContent = live ? PROV_LIVE : PROV_TRACE; };

  const ruleWrap = htmlEl("div", { class: "km-rules" });
  const ruleRow = htmlEl("div", { class: "km-rule-row", role: "group", "aria-label": "Pivot rule" });
  ruleRow.appendChild(htmlEl("span", { class: "km-rules-label" }, "Pivot rule"));
  const dzBtn = htmlEl("button", { type: "button", class: "btn km-rule-btn", "aria-pressed": "true" }, "Dantzig");
  const blBtn = htmlEl("button", { type: "button", class: "btn km-rule-btn", "aria-pressed": "false" }, "Bland");
  blBtn.disabled = true;
  blBtn.title = "Live re-solve needs the WebAssembly engine; showing the recorded walk";
  ruleRow.append(dzBtn, blBtn);
  const ruleMsgEl = htmlEl("p", { class: "km-rule-msg", "aria-live": "polite" });
  ruleWrap.append(ruleRow, ruleMsgEl);

  let engineOK = false;
  let ruleToken = 0;

  // Reassign the walk to a new step list (a live re-solve), rebuild the trail, and
  // re-render at the finished corner. Returns false (keeping the current walk) if
  // any step vertex fails to line up with a geometry corner.
  function applyWalk(newSteps) {
    if (!Array.isArray(newSteps) || newSteps.length === 0) return false;
    const w = walkIndices(geom, newSteps);
    if (w.some((i) => i < 0)) return false;
    steps = newSteps;
    walk = w;
    lastStep = steps.length - 1;
    buildTrail(walk);
    scrub.max = String(lastStep);
    cur = lastStep;
    renderCube();
    return true;
  }

  function ruleMsg(rule, n, live) {
    const src = live ? "solved live" : "recorded";
    if (rule === "bland") {
      ruleMsgEl.textContent =
        n < 8
          ? `Bland's lowest-index rule reaches the exit in ${n} corner${n === 1 ? "" : "s"} (${src}), a shorter path across the same cube.`
          : `Bland's lowest-index rule also tours all ${n} corners here (${src}); this cube fools both rules.`;
    } else {
      ruleMsgEl.textContent = `Dantzig's greedy rule tours all ${n} corners before the exit (${src}).`;
    }
  }

  async function pickRule(rule) {
    const tok = ++ruleToken;
    stopPlay();
    dzBtn.setAttribute("aria-pressed", rule === "dantzig" ? "true" : "false");
    blBtn.setAttribute("aria-pressed", rule === "bland" ? "true" : "false");
    if (engineOK) {
      const sol = await ctx.solve(trace.problem, { pivot_rule: rule, max_iterations: 10000, record_trace: true });
      if (tok !== ruleToken) return; // a newer click superseded this solve
      if (sol && sol.trace && applyWalk(sol.trace.steps)) {
        ctx.setEngine("live");
        setProv(true);
        ruleMsg(rule, steps.length, true);
        return;
      }
    }
    if (tok !== ruleToken) return;
    // No engine, or the live solve failed: fall back to the recorded Dantzig walk.
    applyWalk(committedSteps);
    ctx.setEngine("trace");
    setProv(false);
    ruleMsg("dantzig", committedSteps.length, false);
    dzBtn.setAttribute("aria-pressed", "true");
    blBtn.setAttribute("aria-pressed", "false");
  }
  dzBtn.addEventListener("click", () => pickRule("dantzig"));
  blBtn.addEventListener("click", () => pickRule("bland"));

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
    cubeCtl.parentNode.insertBefore(ruleWrap, cubeCtl); // selector sits above the scrubber
  }
  if (betOut) betOut.replaceChildren(betWrap);

  // Resting state: the recorded Dantzig walk (replaying trace). Warm the WASM
  // engine; if it loads, enable Bland and re-solve Dantzig live so the badge and
  // provenance flip to the honest live state (a live solve reproduced this walk).
  ctx.setEngine("trace");
  setProv(false);
  ruleMsg("dantzig", committedSteps.length, false);
  ctx.ensureEngine().then(
    (ok) => {
      engineOK = ok === true;
      if (!engineOK) return;
      blBtn.disabled = false;
      blBtn.removeAttribute("title");
      pickRule("dantzig");
    },
    () => { engineOK = false; }
  );
}
