// Feasible Region . figures/dualview.js . S3 synchronized polytope + tableau
//
// One native scrubber drives an isometric 3-variable polytope and the simplex
// tableau in lockstep, lighting the entering column, leaving row, and matching
// vertex/edge via a shared data-key. At rest every number replays
// traces/topic21.json. A second range (the hull-frame stock limit) is a WHAT-IF:
// off its recorded value the WASM core re-solves (ctx.solve) and poly3d
// re-enumerates the exact n=3 hull, so "solving live" is literally true;
// with no WebAssembly the slider is disabled with an honest note. The
// projection is fit ONCE from committed geometry and reused, so it never rescales.

import { linkFigure } from "../sync.js";
import { enumerateVertices } from "../poly3d.js";
// Pure classifier import only (plus the triad constant helper): the fixed-fit
// projection stays local to this file, never pulled from iso3d.
import { classifyEdges, triadArms } from "../iso3d.js";
// Scoped rational formatter (NEW): the S3 tableau, manifest, and staircase read
// exact fractions (-1/7, not -0.14) via fmtR, so the z row visibly becomes S4's
// prices. fmtR() stays untouched in lp2d.js so S2's live-rebuilt block is unmoved.
import { fmtR } from "../fmt-rational.js";
import mountHood from "./hood.js";

const SVGNS = "http://www.w3.org/2000/svg";
const COS30 = Math.cos(Math.PI / 6);

// Fixed polytope panel viewBox and inner padding. The no-JS still uses the same
// numbers, so the live projection lands exactly where the still drew.
const PANEL_W = 380;
const PANEL_H = 320;
const PAD = 30;

// What-if slider perturbs binding constraint 2 (2 x1 + x2 <= 27). Home = its
// recorded rhs; off home, live re-solve.
const WHATIF_CON = 2;
const WHATIF_HOME = 27;
const WHATIF_MIN = 18;
const WHATIF_MAX = 36;
const SOLVE_DEBOUNCE_MS = 140;
const DISABLED_TIP =
  "Live re-solve needs the WebAssembly engine; showing the recorded walk";

// Isometric projection of a 3D cargo vertex to 2D. Height (x3) lifts the point.
function project(v) {
  return [(v[0] - v[1]) * COS30, (v[0] + v[1]) * 0.5 - v[2]];
}

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

// Variable index -> label: 0..2 are decision variables x1..x3; 3..7 are slacks
// s1..s5, one per resource limit (color language).
function varLabel(i, names) {
  return i < 3 ? names[i] || `x${i + 1}` : `s${i - 2}`;
}
function varColorVar(i) {
  return i < 3 ? "var(--ink)" : `var(--constraint-${i - 2})`;
}

// One inequality line for the manifest card, built from a constraint so it live
// updates under the what-if slider and never asserts a stale "<= 27". Reads back
// exactly as the S4 limit list does, e.g. "2 x1 + x2 <= 27".
function ineqText(coeffs, rhs, names) {
  let lhs = "";
  coeffs.forEach((c, i) => {
    if (Math.abs(c) < 1e-9) return;
    const mag = Math.abs(c);
    const term =
      (Math.abs(mag - 1) < 1e-9 ? "" : fmtR(mag) + " ") + varLabel(i, names);
    if (lhs === "") lhs = (c < 0 ? "-" : "") + term;
    else lhs += (c < 0 ? " - " : " + ") + term;
  });
  return lhs + " ≤ " + fmtR(rhs);
}

// Objective staircase: a step function of objective value per pivot
// for the dead space under the tableau. One keyed mark per step carries its own
// value in data-value, so the strip is a checkable supplementary read of numbers
// already in the readout. The committed-walk output is authored verbatim into
// index.html as the no-JS state; JS rebuilds it so a live re-solve shows its own
// climb. Geometry is a plain string builder, so authored and hydrated match.
const STAIR = { W: 252, H: 112, L: 16, R: 16, T: 22, B: 24 };
const stairNum = (x) => String(Math.round(x * 100) / 100);
function stairSVG(objectives, curIdx) {
  const n = objectives.length;
  const plotL = STAIR.L;
  const plotR = STAIR.W - STAIR.R;
  const plotT = STAIR.T;
  const plotB = STAIR.H - STAIR.B;
  const vmax = Math.max(...objectives, 1);
  const colW = (plotR - plotL) / n;
  const yOf = (v) => plotB - (v / vmax) * (plotB - plotT);
  let out =
    `<svg class="dv-stair-svg" viewBox="0 0 ${STAIR.W} ${STAIR.H}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" ` +
    `aria-label="Objective value after each pivot: ${objectives
      .map(fmtR)
      .join(", ")}. A step climb to the best corner.">`;
  out +=
    `<line class="dv-stair-axis" x1="${stairNum(plotL)}" y1="${stairNum(plotB)}" ` +
    `x2="${stairNum(plotR)}" y2="${stairNum(plotB)}"></line>`;
  for (let k = 0; k < n; k++) {
    const x0 = plotL + k * colW;
    const x1 = plotL + (k + 1) * colW;
    const xc = plotL + (k + 0.5) * colW;
    const y = yOf(objectives[k]);
    const yprev = k === 0 ? plotB : yOf(objectives[k - 1]);
    const cls = "dv-stair-step" + (k === curIdx ? " is-current" : "");
    // A whitespace text node between marks keeps textContent's numbers separated
    // ("0 8 15 ...") for a no-JS text read; it is non-rendering inside the SVG.
    out += (k > 0 ? " " : "") + `<g class="${cls}" data-key="pivot:${k}" data-value="${fmtR(
      objectives[k]
    )}">`;
    if (k > 0)
      out +=
        `<line class="dv-stair-riser" x1="${stairNum(x0)}" y1="${stairNum(
          yprev
        )}" x2="${stairNum(x0)}" y2="${stairNum(y)}"></line>`;
    out +=
      `<line class="dv-stair-tread" x1="${stairNum(x0)}" y1="${stairNum(y)}" ` +
      `x2="${stairNum(x1)}" y2="${stairNum(y)}"></line>`;
    out += `<circle class="dv-stair-dot" cx="${stairNum(xc)}" cy="${stairNum(
      y
    )}" r="3"></circle>`;
    out +=
      `<text class="dv-stair-val" x="${stairNum(xc)}" y="${stairNum(y - 7)}" ` +
      `text-anchor="middle">${fmtR(objectives[k])}</text>`;
    out += `</g>`;
  }
  out += `</svg>`;
  return out;
}

export default async function mount(box, ctx) {
  const trace = await ctx.loadTrace(ctx.fixture || "topic21");
  const problem = trace.problem;
  const committedSteps = trace.steps;
  const committedResult = trace.result || {};
  const geom = trace.geometry;
  const names = problem.var_names || ["x1", "x2", "x3"];
  const nCols = committedSteps[0].tableau[0].length; // decision + slacks + rhs
  const nVars = nCols - 1;
  const nRows = committedSteps[0].tableau.length; // constraint rows + objective

  const scope = box.closest("figure, section") || document;
  const tableauPanel = scope.querySelector('[data-role="dualview-tableau"]');
  const controls = scope.querySelector('[data-role="dualview-controls"]');
  const whatifHost = scope.querySelector('[data-role="dualview-whatif"]');
  const readout = scope.querySelector('[data-role="dualview-readout"]');
  const provenance = scope.querySelector('[data-role="dualview-provenance"]');
  // The step-by-step figcaption narrates the RECORDED walk; hide it off-default so
  // it never co-locates a stale present-tense claim next to a perturbed walk.
  const walkCaption = scope.querySelector('[data-role="dualview-walkcaption"]');
  // Authored fig-sub IS the trace-mode provenance; capture it so the trace
  // variant round-trips exactly and only the live variant is new here.
  const traceProvText = provenance ? provenance.textContent : "";

  // Manifest card: five named limits with live inequalities. The
  // ineq spans are rewritten from the model's own constraints every apply, so
  // the card can never assert rhs 27 while the panels solve a perturbed 30.
  const manifestIneqEls = Array.from(
    scope.querySelectorAll('[data-role="dualview-manifest"] .dv-manifest-ineq')
  );
  function updateManifest(constraints) {
    manifestIneqEls.forEach((el, i) => {
      const c = constraints[i];
      if (c) el.textContent = ineqText(c.coeffs, c.rhs, names);
    });
  }

  // Objective staircase host: rebuilt per model so it always reads
  // the current walk's climb; stairSteps holds the per-step marks for emphasis.
  const stairHost = scope.querySelector('[data-role="dualview-staircase"]');
  let stairSteps = [];

  // ---- fixed isometric projection (once, from committed geometry) -------
  const proj = geom.vertices.map(project);
  const xs = proj.map((p) => p[0]);
  const ys = proj.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const contentW = PANEL_W - 2 * PAD;
  const contentH = PANEL_H - 2 * PAD;
  const scale = Math.min(contentW / (maxX - minX), contentH / (maxY - minY));
  const offX = PAD + (contentW - (maxX - minX) * scale) / 2;
  const offY = PAD + (contentH - (maxY - minY) * scale) / 2;
  // Project ANY cargo point (committed or perturbed) with the one fixed frame.
  function screenOf(v) {
    const p = project(v);
    return [offX + (p[0] - minX) * scale, offY + (maxY - p[1]) * scale];
  }

  // ---- live polytope SVG shell (groups refilled per model) -------------
  const svg = svgEl("svg", {
    class: "fig-svg dv-polytope",
    viewBox: `0 0 ${PANEL_W} ${PANEL_H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label":
      "Isometric view of the cargo polytope with the corner walk drawn on it.",
  });
  const gEdges = svgEl("g", { class: "dv-edges" });
  const gTrails = svgEl("g", { class: "dv-trails" });
  const gVerts = svgEl("g", { class: "dv-verts" });
  // Axis triad in the free lower-left corner plus a labeled origin, both from
  // the same fixed projection the polytope uses, so they never drift from it.
  const gTriad = svgEl("g", { class: "iso-triad", "aria-hidden": "true" });
  for (const arm of triadArms(40, 278, 15)) {
    gTriad.appendChild(
      svgEl("line", { class: "iso-triad-arm", x1: arm.x1, y1: arm.y1, x2: arm.x2, y2: arm.y2 })
    );
    const t = svgEl("text", { class: "iso-triad-label", x: arm.lx, y: arm.ly, "text-anchor": arm.anchor });
    t.textContent = arm.label;
    gTriad.appendChild(t);
  }
  const originScreen = screenOf([0, 0, 0]);
  const originLabel = svgEl("text", {
    class: "iso-origin",
    x: originScreen[0] - 8,
    y: originScreen[1] + 12,
    "text-anchor": "end",
    "aria-hidden": "true",
  });
  originLabel.textContent = "0";
  svg.append(gEdges, gTriad, originLabel, gTrails, gVerts);
  const ring = svgEl("circle", { class: "dv-current-ring", r: 10 });
  const current = svgEl("circle", { class: "dv-current", r: 6 });
  const currentLabel = svgEl("text", { class: "dv-current-label" });
  svg.append(ring, current, currentLabel);

  // ---- live tableau table (structure once, cells refilled per step) ----
  const table = htmlEl("table", { class: "tableau", role: "img" });
  const thead = htmlEl("thead");
  const headRow = htmlEl("tr");
  headRow.appendChild(htmlEl("th", { scope: "col", class: "dv-basis-head" }, "basis"));
  const headCells = [];
  for (let c = 0; c < nVars; c++) {
    const th = htmlEl("th", { scope: "col" }, varLabel(c, names));
    th.style.color = varColorVar(c);
    th.setAttribute("data-var", String(c));
    headRow.appendChild(th);
    headCells.push(th);
  }
  headRow.appendChild(htmlEl("th", { scope: "col" }, "rhs"));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = htmlEl("tbody");
  const bodyRows = [];
  for (let r = 0; r < nRows; r++) {
    const tr = htmlEl("tr");
    const rowHead = htmlEl("th", { scope: "row", class: "dv-row-head" });
    tr.appendChild(rowHead);
    const cells = [];
    for (let c = 0; c < nCols; c++) {
      const td = htmlEl("td");
      td.setAttribute("data-var", String(c));
      tr.appendChild(td);
      cells.push(td);
    }
    tbody.appendChild(tr);
    bodyRows.push({ tr, rowHead, cells });
  }
  table.appendChild(tbody);

  // ---- controls: step scrubber + prev / next / play --------------------
  const prevBtn = htmlEl("button", { type: "button", class: "btn dv-step-btn" }, "Prev");
  const nextBtn = htmlEl("button", { type: "button", class: "btn dv-step-btn" }, "Next");
  // Autoplay is a motion affordance: under prefers-reduced-motion there is no
  // play button at all, only the scrubber and prev / next.
  const playBtn = ctx.prefersReducedMotion
    ? null
    : htmlEl("button", { type: "button", class: "btn dv-play", "aria-pressed": "false" }, "Play");
  const range = htmlEl("input", {
    type: "range", class: "scrubber", min: "0", max: "0", step: "1",
    "aria-label": "Simplex iteration",
  });
  const stepTag = htmlEl("span", { class: "dv-step-tag", "aria-hidden": "true" });

  // ---- what-if: second native range perturbs the binding constraint ----
  // Starts disabled: enabled only once ctx.ensureEngine confirms WebAssembly.
  const whatifCap = htmlEl("span", { class: "whatif-cap" }, "Hull-frame stock limit");
  const whatif = htmlEl("input", {
    type: "range", class: "scrubber whatif-range",
    min: String(WHATIF_MIN), max: String(WHATIF_MAX), step: "1", value: String(WHATIF_HOME),
    "aria-label": "Hull-frame stock limit, the right-hand side of binding constraint 2 x1 plus x2",
    disabled: "", title: DISABLED_TIP,
  });
  const whatifTag = htmlEl("span", { class: "dv-step-tag whatif-tag", "aria-hidden": "true" });
  const resetBtn = htmlEl("button", { type: "button", class: "btn dv-step-btn whatif-reset", disabled: "" }, "Reset");

  // ---- mutable model state (reassigned by applyModel) ------------------
  let mode = "committed";
  let steps = committedSteps;
  let nSteps = steps.length;
  let cur = nSteps - 1;
  let vertEls = [];
  let trailEls = [];
  let walkIdx = [];
  let solveTimer = null;
  let solveSeq = 0;

  const clampInt = (raw) => {
    let R = Math.round(Number(raw));
    if (!isFinite(R)) R = WHATIF_HOME;
    return Math.max(WHATIF_MIN, Math.min(WHATIF_MAX, R));
  };

  // Rebuild both panels from one model { steps, vertices, edges, constraints }
  // via the one fixed projection. Committed and perturbed views share this
  // path, so what is drawn is always exactly what was replayed or solved, and
  // edge depth is re-classified from the model's own constraints every time.
  function applyModel(model) {
    steps = model.steps;
    nSteps = steps.length;
    const verts = model.vertices;

    gEdges.textContent = "";
    const depth = classifyEdges(model.constraints, verts, model.edges, { project: screenOf });
    model.edges.forEach(([i, j], k) => {
      const a = screenOf(verts[i]);
      const b = screenOf(verts[j]);
      gEdges.appendChild(
        svgEl("line", {
          class: depth[k] === "back" ? "dv-edge is-back" : "dv-edge",
          x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        })
      );
    });

    gVerts.textContent = "";
    vertEls = verts.map((v, idx) => {
      const s = screenOf(v);
      const c = svgEl("circle", { class: "dv-vertex", cx: s[0], cy: s[1], r: 3.5 });
      c.setAttribute("data-vertex", String(idx));
      gVerts.appendChild(c);
      return c;
    });

    // One trail segment per hop, from the projected step vertices, so the trail
    // is correct even if a walk vertex is off the enumerated hull.
    gTrails.textContent = "";
    trailEls = [];
    for (let k = 0; k < nSteps - 1; k++) {
      const a = screenOf(steps[k].vertex);
      const b = screenOf(steps[k + 1].vertex);
      const line = svgEl("line", { class: "dv-trail", x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      trailEls.push(line);
      gTrails.appendChild(line);
    }

    // Which enumerated corner each step lands on, for is-visited lighting.
    // Cosmetic robustness: match each step vertex to its NEAREST
    // hull corner rather than an exact 1e-6 findIndex, so float noise on a live
    // solve can never silently leave a real corner unlit. The walk is never
    // rejected (trails draw from step vertices directly); an unmatched vertex
    // (> ~0.03 away, which does not occur on a valid solve) simply lights nothing.
    walkIdx = steps.map((s) => {
      let best = -1;
      let bestD = Infinity;
      verts.forEach((v, i) => {
        const d =
          (v[0] - s.vertex[0]) ** 2 +
          (v[1] - s.vertex[1]) ** 2 +
          (v[2] - s.vertex[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return bestD <= 1e-3 ? best : -1;
    });

    // Manifest inequalities and the objective staircase both follow the model,
    // so neither ever shows a number the panels have left behind.
    updateManifest(model.constraints);

    cur = nSteps - 1; // land on the finished walk, optimum ringed
    if (stairHost) {
      stairHost.innerHTML = stairSVG(
        steps.map((s) => s.objective_value),
        cur
      );
      stairSteps = Array.from(stairHost.querySelectorAll(".dv-stair-step"));
    }
    range.max = String(nSteps - 1);
    render();
  }

  function renderTableau(step) {
    for (let r = 0; r < nRows; r++) {
      const isObjRow = r === nRows - 1;
      bodyRows[r].rowHead.textContent = isObjRow ? "z" : varLabel(step.basis[r], names);
      bodyRows[r].rowHead.style.color = isObjRow ? "var(--faint)" : varColorVar(step.basis[r]);
      for (let c = 0; c < nCols; c++) {
        bodyRows[r].cells[c].textContent = fmtR(step.tableau[r][c]);
      }
      bodyRows[r].tr.classList.toggle("dv-obj-row", isObjRow);
    }
    headCells.forEach((th) => th.classList.remove("is-entering"));
    bodyRows.forEach(({ tr, cells }) => {
      tr.classList.remove("is-leaving");
      cells.forEach((td) => td.classList.remove("is-entering"));
    });
    const enter = step.entering;
    const leaveRow = step.leaving == null ? -1 : step.basis.indexOf(step.leaving);
    if (enter != null && enter >= 0 && enter < nVars) {
      headCells[enter].classList.add("is-entering");
      bodyRows.forEach(({ cells }) => cells[enter].classList.add("is-entering"));
    }
    if (leaveRow >= 0) bodyRows[leaveRow].tr.classList.add("is-leaving");
  }

  function render() {
    const step = steps[cur];
    trailEls.forEach((line, k) => line.classList.toggle("is-on", k < cur));
    const visited = walkIdx.slice(0, cur + 1);
    vertEls.forEach((c, idx) => c.classList.toggle("is-visited", visited.includes(idx)));
    // Staircase current-step emphasis follows the scrubber (never disagrees with
    // the readout, which names the same objective for this step).
    stairSteps.forEach((g, k) => g.classList.toggle("is-current", k === cur));

    const p = screenOf(step.vertex);
    ring.setAttribute("cx", p[0]);
    ring.setAttribute("cy", p[1]);
    current.setAttribute("cx", p[0]);
    current.setAttribute("cy", p[1]);
    const v = step.vertex;
    currentLabel.setAttribute("x", Math.min(p[0] + 10, PANEL_W - 4));
    currentLabel.setAttribute("y", Math.max(p[1] - 10, 14));
    currentLabel.setAttribute("text-anchor", p[0] > PANEL_W - 70 ? "end" : "start");
    if (p[0] > PANEL_W - 70) currentLabel.setAttribute("x", p[0] - 10);
    currentLabel.textContent = `(${fmtR(v[0])}, ${fmtR(v[1])}, ${fmtR(v[2])})`;

    renderTableau(step);
    hood.sync(step, cur, nSteps, mode);

    // Shared data-key ties one pivot step into a group so hovering or focusing
    // any member lights the rest across both panels.
    const key = `pivot:${cur}`;
    current.setAttribute("data-key", key);
    trailEls.forEach((line) => line.removeAttribute("data-key"));
    if (cur > 0 && trailEls[cur - 1]) trailEls[cur - 1].setAttribute("data-key", key);
    headCells.forEach((th) => th.removeAttribute("data-key"));
    bodyRows.forEach(({ rowHead }) => rowHead.removeAttribute("data-key"));
    const leaveRow = step.leaving == null ? -1 : step.basis.indexOf(step.leaving);
    if (step.entering != null && step.entering >= 0 && step.entering < nVars) {
      headCells[step.entering].setAttribute("data-key", key);
      if (leaveRow >= 0) bodyRows[leaveRow].rowHead.setAttribute("data-key", key);
    } else {
      bodyRows[nRows - 1].rowHead.setAttribute("data-key", key); // z-row head
    }

    range.value = String(cur);
    range.setAttribute("aria-valuenow", String(cur));
    range.setAttribute(
      "aria-valuetext",
      `Step ${cur} of ${nSteps - 1}, vertex (${fmtR(v[0])}, ${fmtR(v[1])}, ${fmtR(v[2])})`
    );
    stepTag.textContent = `step ${cur} of ${nSteps - 1}`;
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === nSteps - 1;

    if (readout) {
      const basisNames = step.basis.map((b) => varLabel(b, names)).join(", ");
      const move =
        step.entering == null
          ? "No column improves the objective, so this corner is optimal."
          : `Pivot: ${varLabel(step.entering, names)} enters, ${varLabel(step.leaving, names)} leaves.`;
      readout.innerHTML =
        `Step <b>${cur}</b> of ${nSteps - 1}. Basis holds <b>${basisNames}</b>. ` +
        `Vertex <b>(${fmtR(v[0])}, ${fmtR(v[1])}, ${fmtR(v[2])})</b>. ` +
        `Objective <b>${fmtR(step.objective_value)}</b>. ${move}`;
    }
    svg.setAttribute(
      "aria-label",
      `Corner walk step ${cur} of ${nSteps - 1}. The lit vertex is at x1 ${fmtR(v[0])}, ` +
        `x2 ${fmtR(v[1])}, x3 ${fmtR(v[2])}, where the objective is ${fmtR(step.objective_value)}.`
    );
  }

  function setStep(i) {
    cur = Math.max(0, Math.min(nSteps - 1, i));
    render();
  }

  // ---- what-if provenance + aria + engine badge ------------------------
  function traceProvenance() {
    if (provenance) provenance.textContent = traceProvText;
  }
  function liveProvenance(R) {
    if (!provenance) return;
    provenance.textContent =
      `You set the hull-frame stock limit to ${R}, so both panels have left the recorded ` +
      `walk: the same simplex core, compiled to WebAssembly, just re-solved this changed ` +
      `problem in your browser, and the polytope was re-enumerated corner by corner from ` +
      `that solve. Reset to return to the recorded ${WHATIF_HOME} unit walk.`;
  }
  // aria-valuetext template (Decision 7): "limit = R, optimum (x, y, z), value V".
  function setWhatif(R, x, val) {
    whatif.value = String(R);
    whatif.setAttribute("aria-valuenow", String(R));
    whatifTag.textContent = "= " + R;
    const opt =
      x && x.length >= 3
        ? `optimum (${fmtR(x[0])}, ${fmtR(x[1])}, ${fmtR(x[2])}), value ${fmtR(val)}`
        : "recorded walk";
    whatif.setAttribute("aria-valuetext", `limit = ${R}, ${opt}`);
    resetBtn.disabled = R === WHATIF_HOME || whatif.disabled;
  }

  function goCommitted() {
    mode = "committed";
    applyModel({
      steps: committedSteps,
      vertices: geom.vertices,
      edges: geom.edges,
      constraints: problem.constraints,
    });
    setWhatif(
      WHATIF_HOME,
      committedResult.x || [9, 9, 4],
      committedResult.objective_value != null ? committedResult.objective_value : 22
    );
    traceProvenance();
    if (walkCaption) walkCaption.hidden = false;
    ctx.setEngine("trace");
  }

  function perturbedLP(R) {
    return {
      direction: problem.direction,
      objective: problem.objective.slice(),
      constraints: problem.constraints.map((c, i) => ({
        coeffs: c.coeffs.slice(),
        op: c.op,
        rhs: i === WHATIF_CON ? R : c.rhs,
      })),
      var_names: names.slice(),
    };
  }

  function scheduleSolve() {
    if (solveTimer) clearTimeout(solveTimer);
    solveTimer = setTimeout(runSolve, SOLVE_DEBOUNCE_MS);
  }

  // Off-default: enumerate the perturbed hull (sync, exact) and re-solve the walk
  // live (ctx.solve). Draw both from that one solve and flip the badge to live;
  // any failure degrades honestly to the recorded walk.
  async function runSolve() {
    solveTimer = null;
    const seq = ++solveSeq;
    const R = clampInt(whatif.value);
    if (R === WHATIF_HOME) {
      goCommitted();
      return;
    }
    const lp = perturbedLP(R);
    const hull = enumerateVertices(lp.constraints);
    const sol = await ctx.solve(lp, {
      pivot_rule: "dantzig",
      max_iterations: 10000,
      record_trace: true,
    });
    if (seq !== solveSeq) return; // a newer drag superseded this solve
    const solved = sol && sol.trace && sol.trace.steps;
    if (!sol || sol.status !== "optimal" || !solved || !solved.length) {
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[dualview] live re-solve unavailable; showing recorded walk");
      }
      whatif.value = String(WHATIF_HOME);
      goCommitted();
      return;
    }
    mode = "live";
    applyModel({
      steps: solved,
      vertices: hull.vertices,
      edges: hull.edges,
      constraints: lp.constraints,
    });
    setWhatif(R, sol.x, sol.objective_value);
    liveProvenance(R);
    if (walkCaption) walkCaption.hidden = true;
    ctx.setEngine("live");
  }

  // ---- controls behaviour ----------------------------------------------
  let timer = null;
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
    if (cur === nSteps - 1) setStep(0);
    playBtn.setAttribute("aria-pressed", "true");
    playBtn.textContent = "Pause";
    timer = setInterval(() => {
      if (cur >= nSteps - 1) {
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
  playBtn && playBtn.addEventListener("click", () => (timer ? stopPlay() : startPlay()));
  range.addEventListener("input", () => {
    stopPlay();
    setStep(parseInt(range.value, 10) || 0);
  });

  whatif.addEventListener("input", () => {
    if (whatif.disabled) return; // no live re-solve without the engine
    stopPlay();
    const R = clampInt(whatif.value);
    whatifTag.textContent = "= " + R;
    whatif.setAttribute("aria-valuenow", String(R));
    // valuetext overrides valuenow for SRs; refresh it now so a mid-drag readout
    // reports the NEW limit as solving, never the previous optimum (setWhatif
    // fills the full "optimum ..." template once the debounced solve lands).
    whatif.setAttribute("aria-valuetext", "limit = " + R + ", solving");
    resetBtn.disabled = R === WHATIF_HOME;
    scheduleSolve();
  });
  resetBtn.addEventListener("click", () => {
    if (whatif.disabled) return;
    solveSeq++; // cancel any in-flight solve
    if (solveTimer) {
      clearTimeout(solveTimer);
      solveTimer = null;
    }
    whatif.value = String(WHATIF_HOME);
    goCommitted();
  });

  // Hover on a tableau column previews the linked brushing without stepping.
  headCells.forEach((th, c) => {
    th.addEventListener("mouseenter", () => {
      bodyRows.forEach(({ cells }) => cells[c].classList.add("is-hover"));
      th.classList.add("is-hover");
    });
    th.addEventListener("mouseleave", () => {
      bodyRows.forEach(({ cells }) => cells[c].classList.remove("is-hover"));
      th.classList.remove("is-hover");
    });
  });

  // ---- mount: swap the authored stills for the live views --------------
  if (controls) {
    controls.textContent = "";
    controls.append(prevBtn, range, nextBtn, ...(playBtn ? [playBtn] : []), stepTag);
  }
  if (whatifHost) {
    whatifHost.textContent = "";
    whatifHost.append(whatifCap, whatif, whatifTag, resetBtn);
  }
  if (tableauPanel) {
    const wrap = htmlEl("div", { class: "tableau-scroll" });
    wrap.appendChild(table);
    tableauPanel.textContent = "";
    tableauPanel.appendChild(wrap);
  }
  const still = box.querySelector("svg");
  if (still) still.replaceWith(svg);
  else box.appendChild(svg);

  const hood = mountHood(scope, ctx, { names, nRows, nCols, label: (i) => varLabel(i, names) });

  goCommitted(); // authored default: the finished recorded walk, optimum ringed

  // Wire linked brushing once; the delegated listeners cover the groups that
  // applyModel refills, so a perturbation never needs to re-wire.
  linkFigure(box.closest("figure"));

  // Enable the what-if slider only when the engine is usable; otherwise keep it
  // disabled with the honest note, recorded replay untouched.
  ctx.ensureEngine().then(
    (ready) => {
      if (ready) {
        whatif.disabled = false;
        whatif.removeAttribute("title");
        resetBtn.disabled = clampInt(whatif.value) === WHATIF_HOME;
        if (whatifHost) whatifHost.classList.remove("is-disabled");
      } else {
        whatif.disabled = true;
        resetBtn.disabled = true;
        whatif.title = DISABLED_TIP;
        if (whatifHost) whatifHost.classList.add("is-disabled");
      }
    },
    () => {
      whatif.disabled = true;
      resetBtn.disabled = true;
      whatif.title = DISABLED_TIP;
      if (whatifHost) whatifHost.classList.add("is-disabled");
    }
  );
}
