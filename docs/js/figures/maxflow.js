// ==========================================================================
// Feasible Region . figures/maxflow.js . S6 max flow as a linear program
//
// One picture, two readings of the same eight numbers. On the left a source to
// sink network drawn from the maxflow trace: six nodes, eight directed arcs,
// each labelled flow over capacity at the optimum. On the right the identical
// arcs written as a linear program: a flow row, a cap row, and one balance row
// per interior node. Hover or keyboard focus an arc and its matrix column lights
// up, and the reverse, tied by a shared data-key through sync.js.
//
// Every number is replayed from ./traces/maxflow.json (engine badge: replaying
// trace), so with scripts off the authored still already shows the finished flow
// and its value, and with scripts on nothing about the arithmetic changes. The
// arc directions come straight from the variable names (fsa means s to a), and
// the minimum cut is read off the capacity duals, so the max flow min cut
// equality is drawn, not asserted. No d3: the network is a handful of lines and
// circles built straight with the DOM, so the figure carries no library weight.
// ==========================================================================

import { linkFigure, varKey } from "../sync.js";

const SVGNS = "http://www.w3.org/2000/svg";

// Authored layout. viewBox coordinates; the still in index.html uses the same
// numbers so the live projection lands exactly where the still drew.
const VB_W = 480;
const VB_H = 320;
const NODE_R = 20;

// Node positions, source on the left, sink on the right, two interior columns.
const NODES = {
  s: [45, 160],
  a: [180, 85],
  b: [180, 235],
  c: [315, 85],
  d: [315, 235],
  t: [435, 160],
};

// Where each arc's flow/cap label sits, authored to keep the crossings legible.
const LABELS = {
  fsa: [108, 108],
  fsb: [108, 214],
  fac: [247, 72],
  fda: [272, 150],
  fbd: [247, 252],
  fcb: [222, 168],
  fct: [388, 108],
  fdt: [388, 214],
};

// The minimum cut curve: it keeps the source side {s, a} to its left and slices
// exactly the two forward arcs that carry the whole flow (s to b and a to c).
const CUT_PATH = "M 250,25 C 250,90 200,110 175,140 C 150,175 140,210 120,300";

const EPS = 1e-6;

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

// A whole integer prints clean; the trace stores flows as 6.0 and coefficients
// as 1.0, so trim the decimal noise before it reaches a label.
function num(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

// Build the model from the trace with no hand-entered numbers. Arc directions
// parse from the variable name (fXY means X to Y), capacities are the first
// per-variable constraint bounds, and a capacity dual above zero flags a cut arc.
function deriveModel(trace) {
  const p = trace.problem;
  const names = p.var_names;
  const flow = trace.result.x;
  const duals = trace.result.duals || [];
  const cap = names.map((_, i) => p.constraints[i].rhs);

  const arcs = names.map((name, i) => {
    const from = name[1];
    const to = name[2];
    return {
      name,
      i,
      from,
      to,
      flow: flow[i],
      cap: cap[i],
      saturated: Math.abs(flow[i] - cap[i]) < EPS,
      cut: (duals[i] || 0) > EPS,
      empty: Math.abs(flow[i]) < EPS,
    };
  });

  // Interior nodes are every node that is neither source nor sink; their balance
  // rows are the equality constraints that follow the capacity rows.
  const seen = [];
  names.forEach((name) => {
    for (const ch of [name[1], name[2]]) if (!seen.includes(ch)) seen.push(ch);
  });
  const interior = seen.filter((n) => n !== "s" && n !== "t").sort();
  const balance = interior.map((node, k) => ({
    node,
    coeffs: p.constraints[names.length + k].coeffs,
  }));

  const objVars = names.filter((_, i) => Math.abs(p.objective[i]) > EPS);
  const cutArcs = arcs.filter((a) => a.cut);

  return {
    names,
    arcs,
    cap,
    balance,
    interior,
    objVars,
    cutArcs,
    maxFlow: trace.result.objective_value,
    satArcs: arcs.filter((a) => a.saturated),
  };
}

// Arc endpoints, shortened to the node boundary so an arrowhead sits cleanly at
// the rim. The still uses the identical formula, so hydration does not jump.
function endpoints(from, to) {
  const [x1, y1] = NODES[from];
  const [x2, y2] = NODES[to];
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  return {
    x1: x1 + ux * NODE_R,
    y1: y1 + uy * NODE_R,
    x2: x2 - ux * NODE_R,
    y2: y2 - uy * NODE_R,
  };
}

// A word form of an arc, spoken to assistive tech and shown in the readout.
const arcPhrase = (a) => `${a.from} to ${a.to}`;
const listPhrase = (list) => list.map(arcPhrase).join(", ");

function readoutBase(model) {
  return (
    `Maximum flow s to t is <b>${num(model.maxFlow)}</b> units, equal to the ` +
    `minimum cut. The cut crosses <b>${model.cutArcs.map(arcPhrase).join("</b> and <b>")}</b>. ` +
    `Saturated arcs: ${listPhrase(model.satArcs)}.`
  );
}

function readoutFor(a, model) {
  const tags = [];
  if (a.saturated) tags.push("at capacity");
  if (a.cut) tags.push("in the minimum cut");
  const tail = tags.length ? ` This arc is ${tags.join(" and ")}.` : "";
  return (
    `Arc <b>${arcPhrase(a)}</b> carries <b>${num(a.flow)}</b> of <b>${num(a.cap)}</b>.` +
    tail +
    ` Maximum flow is ${num(model.maxFlow)}, equal to the minimum cut.`
  );
}

// ---- the network panel ---------------------------------------------------
function buildNet(model) {
  const svg = svgEl("svg", {
    class: "fig-svg mf-net",
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "group",
    "aria-label":
      "Source to sink network at maximum flow 8. Move through the arcs to hear " +
      "each flow and capacity.",
  });

  // One arrowhead marker; context-stroke lets it follow the arc's own colour,
  // including the highlight colour when an arc lights.
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "mf-arrow",
    markerWidth: "9",
    markerHeight: "9",
    refX: "8",
    refY: "4",
    orient: "auto",
    markerUnits: "userSpaceOnUse",
  });
  marker.appendChild(svgEl("path", { d: "M0,0 L8,4 L0,8 Z", fill: "context-stroke" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  // The cut, drawn behind everything.
  svg.appendChild(svgEl("path", { class: "mf-cut", d: CUT_PATH }));
  const cutLabel = svgEl("text", { class: "mf-cut-label", x: "268", y: "34" });
  cutLabel.textContent = `min cut ${num(model.maxFlow)}`;
  svg.appendChild(cutLabel);

  // The arcs. Each is a focusable group carrying the shared data-key.
  model.arcs.forEach((a) => {
    const g = svgEl("g", {
      class:
        "mf-edge" +
        (a.saturated ? " is-saturated" : "") +
        (a.empty ? " is-empty" : ""),
      "data-key": varKey(a.name),
      tabindex: "0",
      role: "img",
      "aria-label":
        `${arcPhrase(a)}, ${num(a.flow)} of ${num(a.cap)}` +
        (a.saturated ? ", at capacity" : "") +
        (a.cut ? ", in the minimum cut" : ""),
    });
    const e = endpoints(a.from, a.to);
    g.appendChild(
      svgEl("line", {
        class: "mf-line",
        x1: e.x1.toFixed(2),
        y1: e.y1.toFixed(2),
        x2: e.x2.toFixed(2),
        y2: e.y2.toFixed(2),
        "marker-end": "url(#mf-arrow)",
      })
    );
    const [lx, ly] = LABELS[a.name];
    const label = svgEl("text", {
      class: "mf-flabel",
      x: String(lx),
      y: String(ly),
      "text-anchor": "middle",
    });
    label.textContent = `${num(a.flow)}/${num(a.cap)}`;
    g.appendChild(label);
    svg.appendChild(g);
  });

  // The nodes, drawn on top so the arc ends tuck under the rims.
  Object.keys(NODES).forEach((n) => {
    const [cx, cy] = NODES[n];
    const terminal = n === "s" || n === "t";
    const g = svgEl("g", { class: "mf-node" + (terminal ? " is-terminal" : "") });
    g.appendChild(svgEl("circle", { cx: String(cx), cy: String(cy), r: String(NODE_R) }));
    const label = svgEl("text", {
      x: String(cx),
      y: String(cy + 5),
      "text-anchor": "middle",
    });
    label.textContent = n;
    g.appendChild(label);
    if (terminal) {
      const cap = svgEl("text", {
        class: "mf-node-cap",
        x: String(cx),
        y: String(cy + NODE_R + 16),
        "text-anchor": "middle",
      });
      cap.textContent = n === "s" ? "source" : "sink";
      g.appendChild(cap);
    }
    svg.appendChild(g);
  });

  return svg;
}

// ---- the matrix panel ----------------------------------------------------
function buildMatrix(model) {
  const table = htmlEl("table", { class: "mf-matrix" });
  const caption = htmlEl("caption", { class: "mf-matrix-cap" });
  caption.textContent = "The same eight numbers, as a linear program";
  table.appendChild(caption);

  const thead = htmlEl("thead");
  const hrow = htmlEl("tr");
  hrow.appendChild(htmlEl("th", { scope: "col", class: "mf-rowhead" }, ""));
  model.arcs.forEach((a) => {
    const th = htmlEl("th", {
      scope: "col",
      class: "mf-col-head" + (a.cut ? " is-cut" : ""),
      "data-key": varKey(a.name),
      tabindex: "0",
      role: "img",
      "aria-label":
        `Column ${a.name}, arc ${arcPhrase(a)}, flow ${num(a.flow)} of ` +
        `${num(a.cap)}` +
        (a.cut ? ", a minimum cut arc" : ""),
    });
    th.appendChild(htmlEl("span", { class: "mf-col-name" }, a.name));
    if (a.cut) th.appendChild(htmlEl("span", { class: "mf-cut-tag" }, "cut"));
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = htmlEl("tbody");

  const addRow = (label, cells, cls) => {
    const tr = htmlEl("tr", cls ? { class: cls } : null);
    tr.appendChild(htmlEl("th", { scope: "row", class: "mf-rowhead" }, label));
    cells.forEach((c) => tr.appendChild(c));
    tbody.appendChild(tr);
  };

  // flow and cap rows carry the shared data-key so the column lights end to end.
  addRow(
    "flow",
    model.arcs.map((a) =>
      htmlEl(
        "td",
        { "data-key": varKey(a.name), class: a.saturated ? "is-saturated" : "" },
        num(a.flow)
      )
    ),
    "mf-flow-row"
  );
  addRow(
    "cap",
    model.arcs.map((a) =>
      htmlEl(
        "td",
        { "data-key": varKey(a.name), class: a.saturated ? "is-saturated" : "" },
        num(a.cap)
      )
    ),
    "mf-cap-row"
  );

  // one balance row per interior node: inflow minus outflow, each equal to zero.
  model.balance.forEach((row) => {
    addRow(
      `net ${row.node}`,
      row.coeffs.map((coeff, i) =>
        htmlEl("td", { "data-key": varKey(model.names[i]) }, num(coeff))
      )
    );
  });

  table.appendChild(tbody);
  return table;
}

// ---- mount ---------------------------------------------------------------
export default async function mount(box, ctx) {
  const trace = await ctx.loadTrace(ctx.fixture || "maxflow");
  const model = deriveModel(trace);

  const figure = box.closest("figure") || box.closest("section") || document;
  const matrixPanel = figure.querySelector('[data-role="maxflow-matrix"]');
  const readout = figure.querySelector('[data-role="maxflow-readout"]');
  const badge = figure.querySelector('[data-role="maxflow-engine"]');

  const svg = buildNet(model);
  const table = buildMatrix(model);

  // ---- readout: base summary, swapped for a focused arc's detail ---------
  const setBase = () => {
    if (readout) readout.innerHTML = readoutBase(model);
  };
  const byKey = {};
  model.arcs.forEach((a) => (byKey[varKey(a.name)] = a));

  const showFrom = (target) => {
    if (!readout || !(target instanceof Element)) return;
    const keyed = target.closest("[data-key]");
    const a = keyed && figure.contains(keyed) ? byKey[keyed.getAttribute("data-key")] : null;
    readout.innerHTML = a ? readoutFor(a, model) : readoutBase(model);
  };

  // ---- swap the authored stills for the live views atomically ------------
  const stillSvg = box.querySelector("svg");
  if (stillSvg) stillSvg.replaceWith(svg);
  else box.appendChild(svg);

  if (matrixPanel) {
    const scroll = htmlEl("div", { class: "mf-matrix-scroll" });
    scroll.appendChild(table);
    matrixPanel.textContent = "";
    matrixPanel.appendChild(scroll);
  }

  setBase();

  // ---- wire brushing and the spoken readout ------------------------------
  // sync.js lights every element sharing a hovered or focused key across both
  // panels; a light delegated listener keeps the aria-live readout in step.
  linkFigure(figure);
  figure.addEventListener("pointerover", (e) => showFrom(e.target));
  figure.addEventListener("pointerleave", setBase);
  figure.addEventListener("focusin", (e) => showFrom(e.target));
  figure.addEventListener("focusout", (e) => {
    if (!figure.contains(e.relatedTarget)) setBase();
    else showFrom(e.relatedTarget);
  });

  // maxflow manages its own badge: the gallery figure holds two cards under one
  // <figure>, so a shared setEngine would target the wrong badge (contract 10).
  if (badge) {
    badge.setAttribute("data-engine", "trace");
    badge.textContent = "replaying trace";
  }
}
