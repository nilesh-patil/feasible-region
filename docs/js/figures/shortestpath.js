// Feasible Region . figures/shortestpath.js . S6 shortest path as an LP
//
// One graph, two readings of the same five numbers: a four node network
// (s, a, b, t) with the best route s to a to b to t lit along its three binding
// edges, beside the same edges as node potential bounds. Hover or focus an edge
// and its matrix row light together (con: key); focus a node and its potential
// column light together (var: key). Every number is replayed from the shortestpath
// trace (badge: replaying trace), so scripts-off already shows the finished route.
// The route comes from the duals: a node potential IS a dual price (the S4 payoff).

import { linkFigure, conKey, conHue, varKey } from "../sync.js";

const SVGNS = "http://www.w3.org/2000/svg";
// Authored layout; the still in index.html reuses these so the live graph lands where it drew.
const VB_W = 340;
const VB_H = 244;
const NODE_R = 21;
const NODES = { s: [46, 122], a: [156, 52], b: [156, 192], t: [298, 122] };
const POT_AT = { s: [46, 178], a: [156, 24], b: [156, 228], t: [298, 178] };
const EPS = 1e-6;

function svgEl(name, attrs, text) {
  const e = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
function htmlEl(name, attrs, text) {
  const e = document.createElement(name);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
const num = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

// Build the model from the trace with no hand-entered numbers. A potential bound
// reads d_to minus d_from <= length: +1 names the head, -1 the tail, a missing tail
// is the reference node s (potential 0). An edge binds when its dual is positive;
// the binding edges walked from s spell the route.
function deriveModel(trace) {
  const p = trace.problem;
  const names = p.var_names; // da, db, dt
  const nodeOf = (j) => names[j].replace(/^d/, "");
  const duals = trace.result.duals || [];

  const pot = { s: 0 };
  names.forEach((nm, j) => (pot[nodeOf(j)] = trace.result.x[j]));

  const edges = p.constraints.map((c, i) => {
    let to = null;
    let from = "s";
    c.coeffs.forEach((v, j) => {
      if (v > 0.5) to = nodeOf(j);
      else if (v < -0.5) from = nodeOf(j);
    });
    return { i, from, to, w: c.rhs, tight: (duals[i] || 0) > EPS };
  });

  // Follow the binding edges from s to t to recover the ordered route.
  const nextTight = {};
  edges.forEach((e) => {
    if (e.tight && !(e.from in nextTight)) nextTight[e.from] = e;
  });
  const route = [];
  let node = "s";
  let guard = 0;
  while (node !== "t" && guard++ < 8) {
    const e = nextTight[node];
    if (!e) break;
    route.push(e);
    node = e.to;
  }
  const routePhrase = ["s", ...route.map((e) => e.to)].join(" to ");

  // Coefficient of variable j in edge e: +1 on the head, -1 on the tail.
  const coeffOf = (e, j) => (nodeOf(j) === e.to ? 1 : nodeOf(j) === e.from ? -1 : 0);

  return { names, nodeOf, coeffOf, pot, edges, route, routePhrase, best: trace.result.objective_value };
}

// Arc endpoints trimmed to the node rims so the arrowhead sits on the boundary.
function endpoints(from, to) {
  const [x1, y1] = NODES[from];
  const [x2, y2] = NODES[to];
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  return { x1: x1 + ux * NODE_R, y1: y1 + uy * NODE_R, x2: x2 - ux * NODE_R, y2: y2 - uy * NODE_R, mx: (x1 + x2) / 2, my: (y1 + y2) / 2, nx: -uy, ny: ux };
}

const edgePhrase = (e) => `${e.from} to ${e.to}`;

const readoutBase = (m) =>
  `Shortest route <b>${m.routePhrase}</b> has length <b>dt = ${num(m.best)}</b>. ` +
  `Node potentials ds <b>${num(m.pot.s)}</b>, da <b>${num(m.pot.a)}</b>, ` +
  `db <b>${num(m.pot.b)}</b>, dt <b>${num(m.pot.t)}</b>. ` +
  `Binding edges: ${m.route.map(edgePhrase).join(", ")}.`;

const readoutForEdge = (e, m) =>
  `Edge <b>${edgePhrase(e)}</b> has length <b>${num(e.w)}</b>, the bound on d${e.to} minus d${e.from}.` +
  (e.tight ? " It binds, so it lies on the shortest route." : " It has slack, so the route skips it.") +
  ` Shortest length dt = ${num(m.best)}.`;

const readoutForNode = (id, m) =>
  `Node <b>${id}</b> has potential <b>d${id} = ${num(m.pot[id])}</b>, its shortest distance from s. ` +
  `Shortest length dt = ${num(m.best)}.`;

// ---- the graph panel -----------------------------------------------------
function buildGraph(model) {
  const svg = svgEl("svg", {
    class: "fig-svg sp-graph",
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "group",
    "aria-label": "Four node network s, a, b, t. The shortest route s to a to b to t has length 4. Move through the edges to hear each length.",
  });

  const defs = svgEl("defs");
  const marker = svgEl("marker", { id: "sp-arrow", markerWidth: "9", markerHeight: "9", refX: "8", refY: "4", orient: "auto", markerUnits: "userSpaceOnUse" });
  marker.appendChild(svgEl("path", { d: "M0,0 L8,4 L0,8 Z", fill: "context-stroke" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Each edge is a focusable group carrying its constraint key, so the edge and its row light together.
  model.edges.forEach((e) => {
    const g = svgEl("g", {
      class: "sp-edge" + (e.tight ? " is-route" : ""),
      "data-key": conKey(e.i),
      style: `--hue: ${conHue(e.i)};`,
      tabindex: "0",
      role: "img",
      "aria-label": `Edge ${edgePhrase(e)}, length ${num(e.w)}` + (e.tight ? ", on the shortest route" : ""),
    });
    const p = endpoints(e.from, e.to);
    g.appendChild(svgEl("line", { class: "sp-line", x1: p.x1.toFixed(2), y1: p.y1.toFixed(2), x2: p.x2.toFixed(2), y2: p.y2.toFixed(2), "marker-end": "url(#sp-arrow)" }));
    const off = 13;
    g.appendChild(svgEl("text", { class: "sp-wlabel", x: (p.mx + p.nx * off).toFixed(2), y: (p.my + p.ny * off + 4).toFixed(2), "text-anchor": "middle" }, num(e.w)));
    svg.appendChild(g);
  });

  // Each non source node carries its potential key so the node and its column light together.
  ["s", "a", "b", "t"].forEach((id) => {
    const [cx, cy] = NODES[id];
    const terminal = id === "s" || id === "t";
    const vn = id === "s" ? null : "d" + id;
    const g = svgEl("g", { class: "sp-node" + (terminal ? " is-terminal" : "") });
    if (vn) {
      g.setAttribute("data-key", varKey(vn));
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", `Node ${id}, potential d${id} equals ${num(model.pot[id])}`);
    }
    g.appendChild(svgEl("circle", { cx: String(cx), cy: String(cy), r: String(NODE_R) }));
    g.appendChild(svgEl("text", { class: "sp-node-id", x: String(cx), y: String(cy + 6), "text-anchor": "middle" }, id));
    const [px, py] = POT_AT[id];
    g.appendChild(svgEl("text", { class: "sp-pot", x: String(px), y: String(py), "text-anchor": "middle" }, `d${id}=${num(model.pot[id])}`));
    svg.appendChild(g);
  });

  return svg;
}

// ---- the matrix panel ----------------------------------------------------
function buildMatrix(model) {
  const table = htmlEl("table", { class: "sp-matrix" });
  table.appendChild(htmlEl("caption", { class: "sp-matrix-cap" }, "The same five edges, as node potential bounds"));

  const thead = htmlEl("thead");
  const hrow = htmlEl("tr");
  hrow.appendChild(htmlEl("th", { scope: "col", class: "sp-rowhead" }, "edge"));
  model.names.forEach((nm, j) => {
    const id = model.nodeOf(j);
    const th = htmlEl("th", {
      scope: "col", class: "sp-col-head", "data-key": varKey(nm), tabindex: "0", role: "img",
      "aria-label": `Potential column ${nm}, node ${id}, value ${num(model.pot[id])}`,
    });
    th.appendChild(htmlEl("span", { class: "sp-col-name" }, nm));
    hrow.appendChild(th);
  });
  hrow.appendChild(htmlEl("th", { scope: "col", class: "sp-bound-head" }, "≤"));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = htmlEl("tbody");
  model.edges.forEach((e) => {
    const key = conKey(e.i);
    const tr = htmlEl("tr", { class: "sp-row" + (e.tight ? " is-route" : "") });
    const head = htmlEl("th", {
      scope: "row", class: "sp-rowhead sp-edge-head", "data-key": key, style: `--hue: ${conHue(e.i)};`, tabindex: "0", role: "img",
      "aria-label": `Edge ${edgePhrase(e)}, bound ${num(e.w)}` + (e.tight ? ", on the shortest route" : ""),
    });
    head.appendChild(htmlEl("span", { class: "sp-edge-name" }, `${e.from}→${e.to}`));
    if (e.tight) head.appendChild(htmlEl("span", { class: "sp-route-tag" }, "route"));
    tr.appendChild(head);
    model.names.forEach((nm, j) => {
      const v = model.coeffOf(e, j);
      tr.appendChild(htmlEl("td", { "data-key": key, class: v ? "is-nz" : "" }, num(v)));
    });
    tr.appendChild(htmlEl("td", { "data-key": key, class: "sp-bound" }, num(e.w)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

// ---- mount ---------------------------------------------------------------
export default async function mount(box, ctx) {
  const trace = await ctx.loadTrace(ctx.fixture || "shortestpath");
  const model = deriveModel(trace);

  const graphPanel = box.querySelector('[data-role="sp-graph"]');
  const matrixPanel = box.querySelector('[data-role="sp-matrix"]');
  const readout = box.querySelector('[data-role="sp-readout"]');
  const badge = box.querySelector('[data-role="sp-engine"]');

  if (graphPanel) {
    const still = graphPanel.querySelector("svg");
    const graph = buildGraph(model);
    if (still) still.replaceWith(graph);
    else graphPanel.appendChild(graph);
  }
  if (matrixPanel) {
    const scroll = htmlEl("div", { class: "sp-matrix-scroll" });
    scroll.appendChild(buildMatrix(model));
    matrixPanel.textContent = "";
    matrixPanel.appendChild(scroll);
  }

  // ---- readout: base summary, swapped for a focused edge or node detail ----
  const setBase = () => {
    if (readout) readout.innerHTML = readoutBase(model);
  };
  const edgeByKey = {};
  model.edges.forEach((e) => (edgeByKey[conKey(e.i)] = e));
  const nodeByKey = {};
  ["a", "b", "t"].forEach((id) => (nodeByKey[varKey("d" + id)] = id));

  const showFrom = (target) => {
    if (!readout || !(target instanceof Element)) return;
    const keyed = target.closest("[data-key]");
    if (!keyed || !box.contains(keyed)) return setBase();
    const key = keyed.getAttribute("data-key");
    if (edgeByKey[key]) readout.innerHTML = readoutForEdge(edgeByKey[key], model);
    else if (nodeByKey[key]) readout.innerHTML = readoutForNode(nodeByKey[key], model);
    else setBase();
  };

  setBase();

  // Linked brushing scoped to THIS card only (root = box), so it never reaches the
  // maxflow panels that share the enclosing figure. con: ties each edge to its row;
  // var: ties each node to its column. A delegated listener keeps the readout in step.
  linkFigure(box);
  box.addEventListener("pointerover", (e) => showFrom(e.target));
  box.addEventListener("pointerleave", setBase);
  box.addEventListener("focusin", (e) => showFrom(e.target));
  box.addEventListener("focusout", (e) => {
    if (!box.contains(e.relatedTarget)) setBase();
    else showFrom(e.relatedTarget);
  });

  // Self managed badge (this card sits inside the maxflow figure, so a shared
  // setEngine would target the wrong badge). Every number is replayed.
  if (badge) {
    badge.setAttribute("data-engine", "trace");
    badge.textContent = "replaying trace";
  }
}
