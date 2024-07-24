// Feasible Region . figures/formulation.js . S2 the formulation pipeline
//
// Mounts on #s2 (data-fixture="statquest"), the "words to a tableau" widget.
// Each plain-English limit on the fab-bay mix is a clickable card; check one and
// it carves the feasible region on the left AND grows the standard-form block on
// the right, adding one equation and a named slack. The region and its best
// corner are recomputed by half-plane clipping and exact vertex enumeration from
// ../lp2d.js (2 variables, so the optimum sits at a corner: no solver, no trace
// replay), and the badge reads "drawn from geometry". The authored no-JS still
// states the resting result, so scripts-off the box is never blank. No d3 here.

import { feasibleRegion, objectiveArgmax, lineThroughBox, fmt } from "../lp2d.js";
import { linkFigure, conHue, conKey } from "../sync.js";

const SVGNS = "http://www.w3.org/2000/svg";
const GE = "≥"; // greater-than-or-equal glyph, not a dash

// Plot frame inside the 640x360 (16:9) viewBox, matched byte for byte to the
// authored still so the hydrated figure lands where the fallback drew (no jump).
const VW = 640;
const VH = 360;
const M = { left: 52, right: 18, top: 18, bottom: 42 };
const X_MAX = 6.5; // wide enough that a single limit's corner (6, 0) or (0, 4)
const Y_MAX = 4.5; // is a real axis corner, never an artificial box edge
const X_TICKS = [1, 2, 3, 4, 5, 6];
const Y_TICKS = [1, 2, 3, 4];
const SX = (VW - M.left - M.right) / X_MAX;
const SY = (VH - M.top - M.bottom) / Y_MAX;
const X = (v) => M.left + v * SX;
const Y = (v) => VH - M.bottom - v * SY;

// The objective arrow only shows the optimize-toward direction (statquest 3, 2);
// it does not turn here (that is the S1 job). Base and length in data units.
const OBJ_BASE = { x: 1.2, y: 0.5 };
const OBJ_LEN = 1.4;

const WORDS = ["No", "One", "Two", "Three", "Four", "Five"];

// Per-constraint authored labels. The slack name is the spare capacity the limit
// leaves behind; the card is the plain-English brief the reader clicks. Order
// matches the statquest constraint order (feedstock first, press time second).
const SLACK = [
  { name: "s1", tag: "spare feedstock" },
  { name: "s2", tag: "spare press time" },
];
const CARDS = [
  {
    title: "Feedstock budget",
    desc: "field-tile and shear-foam each draw one unit of feedstock; four units are on hand.",
  },
  {
    title: "Press time",
    desc: "field-tile needs one press pass, shear-foam needs three; six passes fit the shift.",
  },
];

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
function showEl(el, on) {
  if (on) el.removeAttribute("display");
  else el.setAttribute("display", "none");
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

export default async function mount(box, ctx) {
  const trace = await ctx.loadTrace(ctx.fixture || "statquest");
  const problem = trace.problem;
  const names = problem.var_names || ["x1", "x2"];
  const objCx = problem.objective[0];
  const objCy = problem.objective[1];
  const objTerm = termString(problem.objective, names); // "3 x1 + 2 x2"

  // Normalise each constraint into an a*x + b*y <= c half-plane (a ">=" row is
  // negated), and carry the authored copy alongside it.
  const cons = problem.constraints.map((row, i) => {
    const flip = row.op === "ge" ? -1 : 1;
    return {
      i,
      a: flip * row.coeffs[0],
      b: flip * row.coeffs[1],
      c: flip * row.rhs,
      rhs: row.rhs,
      term: termString(row.coeffs, names),
      hue: conHue(i),
      key: conKey(i),
      slack: SLACK[i] || { name: `s${i + 1}`, tag: "spare capacity" },
      card: CARDS[i] || { title: `Limit ${i + 1}`, desc: "" },
    };
  });

  const figure = box.closest("figure") || box.parentElement;
  const storylineHost = figure.querySelector('[data-role="fm-storyline"]');
  const stdformHost = figure.querySelector('[data-role="fm-stdform"]');
  const controlsHost = figure.querySelector('[data-role="fm-controls"]');
  const readout = figure.querySelector('[data-role="fm-readout"]');
  const provenance = figure.querySelector('[data-role="fm-provenance"]');

  const active = cons.map(() => true); // authored default: both limits on
  let prevActive = active.slice(); // for one-shot slack pulses on newly-added rows

  // ---- geometry SVG scaffold ------------------------------------------
  const svg = svgEl("svg", {
    class: "fig-svg",
    viewBox: `0 0 ${VW} ${VH}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "Feasible region for the fab-bay mix, loading.",
  });

  const defs = svgEl("defs");
  const mkArrow = (id, fillVar, w) => {
    const marker = svgEl("marker", {
      id,
      viewBox: "0 0 10 10",
      refX: 8,
      refY: 5,
      markerWidth: w,
      markerHeight: w,
      orient: "auto-start-reverse",
    });
    marker.appendChild(svgEl("path", { d: "M0,1 L9,5 L0,9 Z", style: `fill: ${fillVar};` }));
    defs.appendChild(marker);
  };
  mkArrow("s2-arrow-axis", "var(--hairline-strong)", 7);
  mkArrow("s2-arrow-obj", "var(--objective)", 8);
  svg.appendChild(defs);

  const x0 = X(0);
  const y0 = Y(0);

  // gridlines
  const gGrid = svgEl("g", { style: "stroke: var(--hairline); stroke-width: 1;" });
  X_TICKS.forEach((t) =>
    gGrid.appendChild(svgEl("line", { x1: X(t), y1: M.top, x2: X(t), y2: y0 }))
  );
  Y_TICKS.forEach((t) =>
    gGrid.appendChild(svgEl("line", { x1: x0, y1: Y(t), x2: VW - M.right, y2: Y(t) }))
  );
  svg.appendChild(gGrid);

  // shaded feasible region (updated)
  const regionPath = svgEl("polygon", {
    style:
      "fill: var(--region-fill); stroke: var(--trail); stroke-width: 1.5; stroke-linejoin: round;",
  });
  svg.appendChild(regionPath);

  // corner dots (rebuilt each render)
  const gVerts = svgEl("g", { style: "fill: var(--trail);" });
  svg.appendChild(gVerts);

  // constraint lines + labels (shown only when active)
  const gCons = svgEl("g");
  cons.forEach((k) => {
    k.line = svgEl("line", { style: `stroke: ${k.hue}; stroke-width: 2.5;` });
    k.lineLabel = svgEl("text", { style: `font-size: 12px; fill: ${k.hue};` });
    gCons.appendChild(k.line);
    gCons.appendChild(k.lineLabel);
  });
  svg.appendChild(gCons);

  // objective direction arrow (static)
  const ux = objCx / Math.hypot(objCx, objCy);
  const uy = objCy / Math.hypot(objCx, objCy);
  const objTip = { x: OBJ_BASE.x + ux * OBJ_LEN, y: OBJ_BASE.y + uy * OBJ_LEN };
  svg.appendChild(
    svgEl("line", {
      x1: X(OBJ_BASE.x),
      y1: Y(OBJ_BASE.y),
      x2: X(objTip.x),
      y2: Y(objTip.y),
      style: "stroke: var(--objective); stroke-width: 2.5;",
      "marker-end": "url(#s2-arrow-obj)",
    })
  );
  svg.appendChild(
    svgEl("text", {
      x: X(objTip.x) + 6,
      y: Y(objTip.y) - 6,
      style: "font-size: 12px; fill: var(--objective);",
    })
  ).textContent = "objective";

  // axes on top
  const gAxes = svgEl("g", { style: "stroke: var(--hairline-strong); stroke-width: 1.5;" });
  gAxes.appendChild(
    svgEl("line", { x1: x0, y1: y0, x2: VW - M.right + 6, y2: y0, "marker-end": "url(#s2-arrow-axis)" })
  );
  gAxes.appendChild(
    svgEl("line", { x1: x0, y1: y0, x2: x0, y2: M.top - 6, "marker-end": "url(#s2-arrow-axis)" })
  );
  svg.appendChild(gAxes);

  // tick + axis labels
  const gLabels = svgEl("g", { style: "font-size: 13px;" });
  X_TICKS.forEach((t) => {
    const el = svgEl("text", { x: X(t), y: y0 + 18, "text-anchor": "middle" });
    el.textContent = String(t);
    gLabels.appendChild(el);
  });
  Y_TICKS.forEach((t) => {
    const el = svgEl("text", { x: x0 - 8, y: Y(t) + 4, "text-anchor": "end" });
    el.textContent = String(t);
    gLabels.appendChild(el);
  });
  const nameX = svgEl("text", { x: VW - M.right, y: y0 + 18, "text-anchor": "end" });
  nameX.textContent = names[0] || "x1";
  const nameY = svgEl("text", { x: x0 - 14, y: M.top + 4 });
  nameY.textContent = names[1] || "x2";
  gLabels.appendChild(nameX);
  gLabels.appendChild(nameY);
  svg.appendChild(gLabels);

  // optimum: pulse ring behind (killed by reduced motion), solid dot on top
  const ring = svgEl("circle", {
    r: 10,
    fill: "none",
    style: "stroke: var(--objective); stroke-width: 2;",
    opacity: ctx.prefersReducedMotion ? 0.5 : 0.6,
  });
  if (!ctx.prefersReducedMotion) {
    const a1 = svgEl("animate", { attributeName: "r", values: "9;18", dur: "1.7s", repeatCount: "indefinite" });
    const a2 = svgEl("animate", { attributeName: "opacity", values: "0.6;0", dur: "1.7s", repeatCount: "indefinite" });
    ring.appendChild(a1);
    ring.appendChild(a2);
  }
  const optDot = svgEl("circle", {
    r: 6.5,
    style: "fill: var(--objective); stroke: var(--surface); stroke-width: 2;",
  });
  const optLabel = svgEl("text", {
    style: "font-size: 12px; font-weight: 650; fill: var(--objective);",
  });
  svg.appendChild(ring);
  svg.appendChild(optDot);
  svg.appendChild(optLabel);

  // ---- storyline cards (the interactive replacement for the still briefs) ----
  const cards = cons.map((k, i) => {
    const label = htmlEl("label", { class: "fm-card" });
    label.setAttribute("data-key", k.key);
    label.style.setProperty("--fm-hue", k.hue);
    const input = htmlEl("input", { type: "checkbox", class: "fm-check" });
    input.checked = active[i];
    const body = htmlEl("span", { class: "fm-card-body" });
    body.appendChild(htmlEl("span", { class: "fm-card-title" }, k.card.title));
    body.appendChild(htmlEl("span", { class: "fm-card-desc" }, k.card.desc));
    body.appendChild(htmlEl("span", { class: "fm-card-ineq" }, `${k.term} ≤ ${fmt(k.rhs)}`));
    label.appendChild(input);
    label.appendChild(body);
    input.addEventListener("change", () => {
      active[i] = input.checked;
      render();
    });
    k.cardEl = label;
    k.checkbox = input;
    return label;
  });

  // ---- standard-form block (objective, one row per active limit, nonneg) ----
  const stdform = htmlEl("div", { class: "fm-stdform" });
  stdform.setAttribute("data-role", "fm-stdform");
  stdform.appendChild(htmlEl("div", { class: "fm-row fm-obj" }, `maximize z = ${objTerm}`));
  cons.forEach((k) => {
    const row = htmlEl("div", { class: "fm-row fm-con" });
    row.setAttribute("data-key", k.key);
    row.style.setProperty("--fm-hue", k.hue);
    row.appendChild(htmlEl("span", {}, `${k.term} + `));
    row.appendChild(htmlEl("span", { class: "fm-slack" }, k.slack.name));
    row.appendChild(htmlEl("span", {}, ` = ${fmt(k.rhs)}`));
    const tag = htmlEl("span", { class: "fm-slack-tag" }, k.slack.tag);
    row.appendChild(tag);
    k.rowEl = row;
    k.slackTag = tag;
    stdform.appendChild(row);
  });
  const nonnegRow = htmlEl("div", { class: "fm-row fm-nonneg" });
  stdform.appendChild(nonnegRow);

  // ---- controls: Start over --------------------------------------------
  const resetBtn = htmlEl("button", { type: "button", class: "btn" }, "Start over");
  resetBtn.addEventListener("click", () => {
    active.fill(false);
    cons.forEach((k) => (k.checkbox.checked = false));
    render();
  });

  // ---- render: recompute the region, redraw everything, retell the state ----
  function render() {
    const n = active.filter(Boolean).length;
    const clip = cons.filter((_, i) => active[i]).map((k) => ({ a: k.a, b: k.b, c: k.c }));
    const poly = feasibleRegion(clip, X_MAX, Y_MAX);

    regionPath.setAttribute(
      "points",
      poly.map((p) => `${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join(" ")
    );

    gVerts.textContent = "";
    poly.forEach((p) =>
      gVerts.appendChild(svgEl("circle", { cx: X(p[0]).toFixed(2), cy: Y(p[1]).toFixed(2), r: 3.2 }))
    );

    cons.forEach((k, i) => {
      const seg = active[i] ? lineThroughBox(k.a, k.b, k.c, X_MAX, Y_MAX) : null;
      if (!seg) {
        showEl(k.line, false);
        showEl(k.lineLabel, false);
        return;
      }
      const [p0, p1] = seg;
      const ax = X(p0[0]), ay = Y(p0[1]), bx = X(p1[0]), by = Y(p1[1]);
      showEl(k.line, true);
      k.line.setAttribute("x1", ax);
      k.line.setAttribute("y1", ay);
      k.line.setAttribute("x2", bx);
      k.line.setAttribute("y2", by);
      showEl(k.lineLabel, true);
      k.lineLabel.setAttribute("x", (ax + bx) / 2 + 6);
      k.lineLabel.setAttribute("y", (ay + by) / 2 - 6);
      k.lineLabel.textContent = `${k.term} = ${fmt(k.rhs)}`;
    });

    // Optimum: only with at least one limit is the region bounded in the
    // objective direction; with none it is the open quadrant (no best corner).
    let opt = null;
    if (n >= 1) opt = objectiveArgmax(poly, objCx, objCy);
    if (opt) {
      const ox = X(opt.point[0]);
      const oy = Y(opt.point[1]);
      showEl(ring, true);
      showEl(optDot, true);
      showEl(optLabel, true);
      ring.setAttribute("cx", ox);
      ring.setAttribute("cy", oy);
      optDot.setAttribute("cx", ox);
      optDot.setAttribute("cy", oy);
      optLabel.setAttribute("x", Math.min(ox + 10, VW - 6));
      optLabel.setAttribute("y", Math.max(oy - 12, 16));
      optLabel.setAttribute("text-anchor", ox > VW - 96 ? "end" : "start");
      if (ox > VW - 96) optLabel.setAttribute("x", ox - 10);
      optLabel.textContent = `best corner (${fmt(opt.point[0])}, ${fmt(opt.point[1])})`;
    } else {
      showEl(ring, false);
      showEl(optDot, false);
      showEl(optLabel, false);
    }

    // Standard-form rows: show only the active limits, name the surviving vars.
    const vars = [names[0] || "x1", names[1] || "x2"];
    cons.forEach((k, i) => {
      k.rowEl.style.display = active[i] ? "" : "none";
      if (active[i]) vars.push(k.slack.name);
    });
    nonnegRow.textContent = `${vars.join(", ")} ${GE} 0`;

    // One-shot pulse on a slack that just appeared (never on load, never under
    // reduced motion): the moment a <= becomes an = is worth a single blink.
    if (!ctx.prefersReducedMotion) {
      cons.forEach((k, i) => {
        if (active[i] && !prevActive[i]) {
          k.slackTag.classList.remove("fm-pulse");
          void k.slackTag.offsetWidth; // reflow so the animation restarts
          k.slackTag.classList.add("fm-pulse");
        }
      });
    }

    cons.forEach((k, i) => k.cardEl.classList.toggle("is-active", active[i]));
    updateReadout(n, poly, opt);
    prevActive = active.slice();
  }

  function updateReadout(n, poly, opt) {
    let msg;
    let aria;
    if (n === 0) {
      msg = "No limits active yet. The region is the whole quadrant. Click a limit to carve it.";
      aria =
        "Feasible region for the fab-bay mix. No limits are active, so the region is the whole first quadrant and the objective is unbounded.";
    } else if (!opt) {
      msg = "These limits leave no points in common, so there is no feasible region.";
      aria = "Feasible region for the fab-bay mix. The active limits have no points in common.";
    } else {
      const word = WORDS[n] || String(n);
      const plural = n === 1 ? "limit" : "limits";
      const corner = `(${fmt(opt.point[0])}, ${fmt(opt.point[1])})`;
      msg = `${word} ${plural} active. The region has ${poly.length} corners. Best corner ${corner}, objective ${fmt(opt.value)}.`;
      aria = `Feasible region for the fab-bay mix. ${word} ${plural} carve a polygon with ${poly.length} corners; the best corner is ${corner}, objective ${fmt(opt.value)}.`;
    }
    if (readout) readout.textContent = msg;
    svg.setAttribute("aria-label", aria);
  }

  // ---- mount: build the initial state, then swap the stills atomically ---
  render();

  if (storylineHost) {
    storylineHost.textContent = "";
    cards.forEach((c) => storylineHost.appendChild(c));
  }
  if (stdformHost) stdformHost.replaceWith(stdform);
  if (controlsHost) {
    controlsHost.textContent = "";
    controlsHost.appendChild(resetBtn);
  }
  const still = box.querySelector("svg");
  if (still) still.replaceWith(svg);
  else box.appendChild(svg);

  linkFigure(figure);
  ctx.setEngine("geometric"); // exact vertex enumeration, not a solver or trace

  // Keep the provenance honest against the live badge: once hydrated the corner
  // is recomputed here by exact vertex enumeration, not replayed from a trace.
  if (provenance) {
    provenance.textContent =
      "Live, the region and its best corner are recomputed here by testing the " +
      "objective at every corner, exact in two dimensions; at rest they match " +
      "the trace the reference solver recorded for this mix.";
  }
}
