// ==========================================================================
// Feasible Region . figures/dualview.js . S3 synchronized polytope + tableau
//
// The signature figure. One native <input type=range> scrubber (plus prev,
// next, and play) drives TWO views in lockstep: an isometric projection of the
// three variable cargo polytope on the left, and the live simplex tableau on
// the right. Stepping the walk lights the entering column and the leaving row
// in the tableau AND the matching vertex and traversed edge in the polytope at
// once, tied by a shared data-key. The numbers are replayed
// exactly from ./traces/topic21.json (engine badge: replaying trace), so with
// scripts off the authored still already shows the finished walk and its
// optimum, and with scripts on nothing about the arithmetic changes.
//
// No d3 here: the polytope is a handful of lines and dots built straight with
// the DOM, so this figure carries no library weight of its own.
// ==========================================================================

import { fmt } from "../lp2d.js";
import { linkFigure } from "../sync.js";

const SVGNS = "http://www.w3.org/2000/svg";
const COS30 = Math.cos(Math.PI / 6);

// Fixed polytope panel viewBox and inner padding. The authored no-JS still uses
// the same numbers, so the live projection lands exactly where the still drew.
const PANEL_W = 380;
const PANEL_H = 320;
const PAD = 30;

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

// Variable index -> label. 0..2 are the decision variables x1..x3; 3..7 are the
// five slacks s1..s5, one per resource limit (color language).
function varLabel(i, names) {
  return i < 3 ? names[i] || `x${i + 1}` : `s${i - 2}`;
}
function varColorVar(i) {
  return i < 3 ? "var(--ink)" : `var(--constraint-${i - 2})`;
}

const sameVertex = (a, b) =>
  Math.abs(a[0] - b[0]) < 1e-6 &&
  Math.abs(a[1] - b[1]) < 1e-6 &&
  Math.abs(a[2] - b[2]) < 1e-6;

export default async function mount(box, ctx) {
  const trace = await ctx.loadTrace(ctx.fixture || "topic21");
  const problem = trace.problem;
  const steps = trace.steps;
  const geom = trace.geometry;
  const names = problem.var_names || ["x1", "x2", "x3"];
  const nSteps = steps.length;
  const nCols = steps[0].tableau[0].length; // decision + slacks + rhs
  const nVars = nCols - 1;

  const scope = box.closest("figure, section") || document;
  const tableauPanel = scope.querySelector('[data-role="dualview-tableau"]');
  const controls = scope.querySelector('[data-role="dualview-controls"]');
  const readout = scope.querySelector('[data-role="dualview-readout"]');

  // ---- projection fit (identical math to the authored still) -----------
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
  const screen = proj.map((p) => [
    offX + (p[0] - minX) * scale,
    offY + (maxY - p[1]) * scale, // flip: larger height sits higher on screen
  ]);

  // Which geometry vertex does each walk step land on.
  const walk = steps.map((s) => geom.vertices.findIndex((v) => sameVertex(v, s.vertex)));

  // ---- build the live polytope SVG -------------------------------------
  const svg = svgEl("svg", {
    class: "fig-svg dv-polytope",
    viewBox: `0 0 ${PANEL_W} ${PANEL_H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "Isometric view of the cargo polytope with the corner walk drawn on it.",
  });

  geom.edges.forEach(([i, j]) => {
    svg.appendChild(
      svgEl("line", {
        class: "dv-edge",
        x1: screen[i][0], y1: screen[i][1], x2: screen[j][0], y2: screen[j][1],
      })
    );
  });

  // One trail segment per hop; shown up to the current step.
  const trailEls = [];
  for (let k = 0; k < walk.length - 1; k++) {
    const a = screen[walk[k]];
    const b = screen[walk[k + 1]];
    const line = svgEl("line", { class: "dv-trail", x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    trailEls.push(line);
    svg.appendChild(line);
  }

  const vertEls = geom.vertices.map((v, idx) => {
    const c = svgEl("circle", { class: "dv-vertex", cx: screen[idx][0], cy: screen[idx][1], r: 3.5 });
    c.setAttribute("data-vertex", String(idx));
    svg.appendChild(c);
    return c;
  });

  const ring = svgEl("circle", { class: "dv-current-ring", r: 10 });
  const current = svgEl("circle", { class: "dv-current", r: 6 });
  svg.appendChild(ring);
  svg.appendChild(current);
  const currentLabel = svgEl("text", { class: "dv-current-label" });
  svg.appendChild(currentLabel);

  // ---- build the live tableau table ------------------------------------
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
  const nRows = steps[0].tableau.length;
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

  // ---- controls: native range scrubber + prev / next / play ------------
  const prevBtn = htmlEl("button", { type: "button", class: "btn dv-step-btn" }, "Prev");
  const nextBtn = htmlEl("button", { type: "button", class: "btn dv-step-btn" }, "Next");
  // Autoplay is a motion affordance: under prefers-reduced-motion there is no
  // play button at all (nothing pulses), only the scrubber and prev / next. Every
  // reference below is guarded with `playBtn &&` so the null case is inert.
  const playBtn = ctx.prefersReducedMotion
    ? null
    : htmlEl("button", { type: "button", class: "btn dv-play", "aria-pressed": "false" }, "Play");
  const range = htmlEl("input", {
    type: "range", class: "scrubber", min: "0", max: String(nSteps - 1), step: "1",
    "aria-label": "Simplex iteration",
  });
  const stepTag = htmlEl("span", { class: "dv-step-tag", "aria-hidden": "true" });

  // ---- render one step into both views ---------------------------------
  let cur = nSteps - 1; // authored default: the finished walk, optimum ringed
  let timer = null;

  function renderTableau(step) {
    for (let r = 0; r < nRows; r++) {
      const isObjRow = r === nRows - 1;
      bodyRows[r].rowHead.textContent = isObjRow ? "z" : varLabel(step.basis[r], names);
      bodyRows[r].rowHead.style.color = isObjRow ? "var(--faint)" : varColorVar(step.basis[r]);
      for (let c = 0; c < nCols; c++) {
        bodyRows[r].cells[c].textContent = fmt(step.tableau[r][c]);
      }
      bodyRows[r].tr.classList.toggle("dv-obj-row", isObjRow);
    }
    // Clear then re-apply the pivot highlight.
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
    // polytope trail + current vertex
    trailEls.forEach((line, k) => line.classList.toggle("is-on", k < cur));
    vertEls.forEach((c, idx) => {
      c.classList.toggle("is-visited", walk.slice(0, cur + 1).includes(idx));
    });
    const p = screen[walk[cur]];
    ring.setAttribute("cx", p[0]);
    ring.setAttribute("cy", p[1]);
    current.setAttribute("cx", p[0]);
    current.setAttribute("cy", p[1]);
    const v = step.vertex;
    currentLabel.setAttribute("x", Math.min(p[0] + 10, PANEL_W - 4));
    currentLabel.setAttribute("y", Math.max(p[1] - 10, 14));
    currentLabel.setAttribute("text-anchor", p[0] > PANEL_W - 70 ? "end" : "start");
    if (p[0] > PANEL_W - 70) currentLabel.setAttribute("x", p[0] - 10);
    currentLabel.textContent = `(${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])})`;

    renderTableau(step);

    // Shared data-key ties one pivot step into a single group so hovering or
    // focusing any member lights the rest across both panels (contract section 3):
    // the current vertex, the trail edge that led into it, the entering column
    // header, and the leaving row head. On the optimal step there is no entering
    // column, so the vertex pairs with the z-row head instead. The key is cleared
    // from every candidate first, so only this step's group is ever lit.
    const key = `pivot:${cur}`;
    current.setAttribute("data-key", key);
    trailEls.forEach((line) => line.removeAttribute("data-key"));
    if (cur > 0) trailEls[cur - 1].setAttribute("data-key", key);
    headCells.forEach((th) => th.removeAttribute("data-key"));
    bodyRows.forEach(({ rowHead }) => rowHead.removeAttribute("data-key"));
    const leaveRow = step.leaving == null ? -1 : step.basis.indexOf(step.leaving);
    if (step.entering != null && step.entering >= 0 && step.entering < nVars) {
      headCells[step.entering].setAttribute("data-key", key);
      if (leaveRow >= 0) bodyRows[leaveRow].rowHead.setAttribute("data-key", key);
    } else {
      bodyRows[nRows - 1].rowHead.setAttribute("data-key", key); // z-row head
    }

    // controls
    range.value = String(cur);
    // Announce the step with its real vertex, not a bare number, and keep
    // aria-valuenow matched to it (A3).
    range.setAttribute("aria-valuenow", String(cur));
    range.setAttribute(
      "aria-valuetext",
      `Step ${cur} of ${nSteps - 1}, vertex (${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])})`
    );
    stepTag.textContent = `step ${cur} of ${nSteps - 1}`;
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === nSteps - 1;

    // aria-live summary of basis, vertex, objective (A3)
    if (readout) {
      const basisNames = step.basis.map((b) => varLabel(b, names)).join(", ");
      const move =
        step.entering == null
          ? "No column improves the objective, so this corner is optimal."
          : `Pivot: ${varLabel(step.entering, names)} enters, ${varLabel(step.leaving, names)} leaves.`;
      readout.innerHTML =
        `Step <b>${cur}</b> of ${nSteps - 1}. Basis holds <b>${basisNames}</b>. ` +
        `Vertex <b>(${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])})</b>. ` +
        `Objective <b>${fmt(step.objective_value)}</b>. ${move}`;
    }
    svg.setAttribute(
      "aria-label",
      `Corner walk step ${cur} of ${nSteps - 1}. The lit vertex is at x1 ${fmt(v[0])}, ` +
        `x2 ${fmt(v[1])}, x3 ${fmt(v[2])}, where the objective is ${fmt(step.objective_value)}.`
    );
  }

  function setStep(i) {
    cur = Math.max(0, Math.min(nSteps - 1, i));
    render();
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
    if (!playBtn) return; // no autoplay under reduced motion
    if (cur === nSteps - 1) setStep(0); // replay from the start
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
  playBtn &&
    playBtn.addEventListener("click", () => (timer ? stopPlay() : startPlay()));
  range.addEventListener("input", () => {
    stopPlay();
    setStep(parseInt(range.value, 10) || 0);
  });

  // Hover on a tableau column emphasizes it, a light preview of the linked
  // brushing without stepping the walk.
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
  if (tableauPanel) {
    const wrap = htmlEl("div", { class: "tableau-scroll" });
    wrap.appendChild(table);
    tableauPanel.textContent = "";
    tableauPanel.appendChild(wrap);
  }
  const still = box.querySelector("svg");
  if (still) still.replaceWith(svg);
  else box.appendChild(svg);

  render();

  // Wire linked brushing across the whole figure: one delegated pointer + focus
  // listener set so hovering or focusing any keyed element (a vertex, a trail
  // edge, an entering column, a leaving row) lights every element sharing its
  // pivot key across both panels. Idempotent, so a re-hydrate never double-wires.
  linkFigure(box.closest("figure"));

  ctx.setEngine("trace"); // every number here is replayed from topic21.json
}
