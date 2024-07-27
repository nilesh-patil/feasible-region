// Feasible Region . figures/duality.js . S4 shadow prices (duality)
//
// The reframe: instead of "how do we fill the hold", ask "what is one more unit
// of each resource worth", the constraint's dual value, its shadow price. Five
// resource limits (primal) sit beside their five shadow prices (dual) as bars;
// hover or focus a resource on either side and it lights on both via a shared
// con: data-key (sync.js), so a limit and its price read as one thing seen twice.
//
// Every number is replayed from ./traces/topic21.json (engine badge: replaying
// trace). The dual values live at trace.result.duals = [0, 1/7, 3/7, 0, 1]; the
// two binding limits (chargrid hours, hull-frame stock) carry the fractional
// prices, the crystal chamber cap is worth 1, and the two limits with room to
// spare (antimatter budget, stabilizer mass) are worth 0. Priced out against
// their right-hand sides they sum back to 22, the same objective the primal
// walk reached at (9, 9, 4): strong duality, an equality the reader can check.
//
// No d3, no KaTeX: the bars are a handful of buttons built straight with the
// DOM. With scripts off the authored inline-SVG still in index.html states the
// resting prices; hydration swaps it for these focusable bar buttons.
// ==========================================================================

import { linkFigure, conHue, conKey } from "../sync.js";

// Resource labels IN CONSTRAINT ORDER (implementer-owned, exact strings). The
// fraction text is shown verbatim (never a decimal); the spoken form goes into
// each bar's aria-label so keyboard focus reads a name, not a colour.
const RESOURCES = [
  { name: "antimatter budget",   text: "0",   spoken: "zero" },
  { name: "chargrid hours",      text: "1/7", spoken: "one seventh" },
  { name: "hull-frame stock",    text: "3/7", spoken: "three sevenths" },
  { name: "stabilizer mass",     text: "0",   spoken: "zero" },
  { name: "crystal chamber cap", text: "1",   spoken: "one" },
];

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
  }
  if (children) children.forEach((c) => e.appendChild(c));
  return e;
}

const SVGNS = "http://www.w3.org/2000/svg";
function sel(tag, attrs, children) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) {
    for (const k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
  }
  if (children) children.forEach((c) => e.appendChild(c));
  return e;
}

// ==========================================================================
// Upgrade C: the shadow price of one resource, drawn as a visible slope.
//
// The dual bars answer "what is one more unit worth" as heights. This panel
// answers the SAME question a second way for one resource, the hull-frame stock
// (constraint 3, con:3): plot the best achievable profit z*(b) as its limit b
// moves, and the shadow price is the LOCAL SLOPE of that curve. At the committed
// limit b = 27 the slope is exactly 3/7, the same price the con:3 bar and the
// strong-duality readout carry, so the three views agree.
//
// The curve is concave and piecewise linear; where it kinks, the price steps to
// a new value, so a shadow price is only local (it holds over an allowable
// range). Every breakpoint and per-segment slope below was computed against the
// scipy HiGHS oracle and cross-checked against this project's reference simplex
// for the topic21 program with the hull-frame limit b left free:
//
//   max x1+x2+x3  s.t.  -x1+x2<=5, x1+4x2<=45, 2x1+x2<=b, 3x1-4x2<=24, x3<=4
//
// x3 is pinned at 4 for every b (its own cap), so z*(b) = 4 + best(x1+x2). The
// value curve has slopes 1, 2/3, 3/7, 0 over b in [0,5], [5,20], [20, 663/16],
// [663/16, infinity); 663/16 = 41.4375. These are hardcoded static constants,
// never guessed and never solved live. The slider only reads this table.
const VF_KINK = 663 / 16; // 41.4375, oracle-verified upper breakpoint
const VF_REST = 27;       // the committed hull-frame limit (b3 in topic21.json)
const VF_BMIN = 12;
const VF_BMAX = 45;
const VF_BSTEP = 1;

// z*(b): best profit as the hull-frame limit b moves (x3 = 4 folded in).
function vfValue(b) {
  if (b <= 5) return 4 + b;                          // slope 1
  if (b <= 20) return 9 + (2 / 3) * (b - 5);         // slope 2/3
  if (b <= VF_KINK) return 19 + (3 / 7) * (b - 20);  // slope 3/7
  return 28.1875;                                    // slope 0
}

// Half-open segments [lo, hi): the local slope, its written and spoken price,
// and the band the price holds over (the 3/7 band [20, 41.4375) is constraint
// 3's allowable range). "band" is the plain-prose clause the readout appends.
const VF_SEGS = [
  { lo: -Infinity, hi: 5,        m: 1,     text: "1",   spoken: "one",
    band: "while the limit stays below 5" },
  { lo: 5,         hi: 20,       m: 2 / 3, text: "2/3", spoken: "two thirds",
    band: "and holds while the limit stays between 5 and 20" },
  { lo: 20,        hi: VF_KINK,  m: 3 / 7, text: "3/7", spoken: "three sevenths",
    band: "and holds while the limit stays between 20 and 41.4" },
  { lo: VF_KINK,   hi: Infinity, m: 0,     text: "0",   spoken: "zero",
    band: "so past 41.4 one more unit buys nothing" },
];
function vfSeg(b) {
  for (const s of VF_SEGS) if (b >= s.lo && b < s.hi) return s;
  return VF_SEGS[VF_SEGS.length - 1];
}
// Trim a profit value to a short label: integers stay whole, else two decimals.
function vfNum(z) {
  const r = Math.round(z * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

// Build the interactive value-function panel INSIDE the shared S4 figure. Owns
// only the host authored at data-role="valuefn"; returns a no-op if it is
// missing (the authored still stays untouched). No live solve: the curve is
// the static oracle table above, so this stays a trace/geometry figure.
function mountValueFunction(figureRoot) {
  const host = figureRoot.querySelector('[data-role="valuefn"]');
  if (!host) return;
  const boxEl = host.querySelector(".vf-box");
  const controls = host.querySelector('[data-role="vf-controls"]');
  if (!boxEl || !controls) return;

  // Plot geometry inside the 360 x 220 viewBox. b runs left to right, z bottom
  // to top; the reserved box keeps these fixed so hydration shifts nothing.
  const PX0 = 44, PX1 = 346, PYT = 20, PYB = 188;
  const ZLO = 13, ZHI = 29;
  const xpx = (b) => PX0 + ((b - VF_BMIN) / (VF_BMAX - VF_BMIN)) * (PX1 - PX0);
  const ypx = (z) => PYB - ((z - ZLO) / (ZHI - ZLO)) * (PYB - PYT);
  const f1 = (v) => v.toFixed(1);

  const svg = sel("svg", {
    class: "fig-svg vf-chart",
    viewBox: "0 0 360 220",
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label":
      "Best profit against the hull-frame stock limit. The curve climbs and " +
      "flattens; at the committed limit 27 its slope is three sevenths, the " +
      "shadow price. The slope drops to zero once the limit passes about 41.4, " +
      "where more stock is worth nothing.",
  });

  // ---- static frame: axes, ticks, titles -------------------------------- #
  svg.appendChild(sel("line", { class: "vf-axis", x1: PX0, y1: PYB, x2: PX1, y2: PYB }));
  svg.appendChild(sel("line", { class: "vf-axis", x1: PX0, y1: PYT, x2: PX0, y2: PYB }));

  [15, 20, 25].forEach((z) => {
    const y = ypx(z);
    svg.appendChild(sel("line", { class: "vf-grid", x1: PX0, y1: f1(y), x2: PX1, y2: f1(y) }));
    svg.appendChild(sel("text", {
      class: "vf-tick", x: PX0 - 6, y: f1(y + 3), "text-anchor": "end", text: String(z),
    }));
  });
  [[12, "12", false], [20, "20", false], [VF_REST, "27", true], [VF_KINK, "41.4", false], [45, "45", false]]
    .forEach(([b, label, rest]) => {
      svg.appendChild(sel("text", {
        class: rest ? "vf-tick vf-tick-rest" : "vf-tick",
        x: f1(xpx(b)), y: PYB + 13, "text-anchor": "middle", text: label,
      }));
    });
  svg.appendChild(sel("text", {
    class: "vf-axis-title", x: f1((PX0 + PX1) / 2), y: 214, "text-anchor": "middle",
    text: "hull-frame stock limit",
  }));
  svg.appendChild(sel("text", {
    class: "vf-axis-title", x: 13, y: f1((PYT + PYB) / 2),
    "text-anchor": "middle", transform: `rotate(-90 13 ${f1((PYT + PYB) / 2)})`,
    text: "best profit",
  }));

  // ---- the value curve + kink markers ----------------------------------- #
  const curvePts = [[VF_BMIN, vfValue(VF_BMIN)], [20, 19], [VF_KINK, 28.1875], [VF_BMAX, 28.1875]]
    .map(([b, z]) => `${f1(xpx(b))},${f1(ypx(z))}`)
    .join(" ");
  svg.appendChild(sel("polyline", { class: "vf-curve", points: curvePts }));
  [[20, 19], [VF_KINK, 28.1875]].forEach(([b, z]) =>
    svg.appendChild(sel("circle", { class: "vf-kink", cx: f1(xpx(b)), cy: f1(ypx(z)), r: 2.6 }))
  );

  // ---- clip so the extrapolated tangent never leaves the plot ----------- #
  const clip = sel("clipPath", { id: "vf-plot-clip" }, [
    sel("rect", { x: PX0, y: PYT, width: PX1 - PX0, height: PYB - PYT }),
  ]);
  svg.appendChild(sel("defs", {}, [clip]));

  // ---- dynamic marks: tangent, active segment, guide, dot --------------- #
  const tangent = sel("line", { class: "vf-tangent", "clip-path": "url(#vf-plot-clip)" });
  const segLine = sel("line", { class: "vf-seg" });
  const guide = sel("line", { class: "vf-guide" });
  const dot = sel("circle", { class: "vf-dot", r: 5, "data-key": conKey(2) });
  svg.append(tangent, segLine, guide, dot);

  // ---- controls: one native range + a readout --------------------------- #
  const slider = el("input", {
    type: "range",
    class: "scrubber vf-slider",
    min: String(VF_BMIN),
    max: String(VF_BMAX),
    step: String(VF_BSTEP),
    value: String(VF_REST),
    "data-key": conKey(2),
    "aria-label": "Hull-frame stock limit",
  });
  const cap = el("span", { class: "vf-cap", "aria-hidden": "true", text: "limit b" });
  const row = el("div", { class: "vf-slider-row" }, [cap, slider]);
  const readout = el("p", { class: "vf-readout", "data-role": "vf-live-readout", "aria-hidden": "true" });

  function render() {
    const b = parseInt(slider.value, 10);
    const z = vfValue(b);
    const seg = vfSeg(b);
    const dx = xpx(b), dy = ypx(z);

    dot.setAttribute("cx", f1(dx));
    dot.setAttribute("cy", f1(dy));
    guide.setAttribute("x1", f1(dx));
    guide.setAttribute("x2", f1(dx));
    guide.setAttribute("y1", f1(dy));
    guide.setAttribute("y2", PYB);

    const lo = Math.max(seg.lo, VF_BMIN), hi = Math.min(seg.hi, VF_BMAX);
    segLine.setAttribute("x1", f1(xpx(lo)));
    segLine.setAttribute("y1", f1(ypx(vfValue(lo))));
    segLine.setAttribute("x2", f1(xpx(hi)));
    segLine.setAttribute("y2", f1(ypx(vfValue(hi))));

    const z1 = z + seg.m * (VF_BMIN - b), z2 = z + seg.m * (VF_BMAX - b);
    tangent.setAttribute("x1", f1(xpx(VF_BMIN)));
    tangent.setAttribute("y1", f1(ypx(z1)));
    tangent.setAttribute("x2", f1(xpx(VF_BMAX)));
    tangent.setAttribute("y2", f1(ypx(z2)));

    readout.innerHTML =
      `At <b>b = ${b}</b> the best profit is <b>${vfNum(z)}</b>. One more unit of ` +
      `hull-frame stock is worth <b>${seg.text}</b> here, the slope of the curve, ${seg.band}.`;
    slider.setAttribute("aria-valuenow", String(b));
    slider.setAttribute(
      "aria-valuetext",
      `hull-frame stock limit ${b}, best profit ${vfNum(z)}, shadow price ${seg.spoken} per unit`
    );
  }
  slider.addEventListener("input", render);
  render();

  // Atomic swap: build fully, then replace the authored still and the reserved
  // JS-off statement in place so the box height never changes (CLS ~ 0).
  const still = boxEl.querySelector("svg");
  if (still) still.replaceWith(svg);
  else boxEl.appendChild(svg);
  controls.textContent = "";
  controls.append(row, readout);
}

// The stacked contribution bar (strong-duality certificate, drawn). Each binding
// limit contributes dual_i * rhs_i to the objective; the three products stack to
// the twin best-profit bar and sum to 22. The authored still in index.html holds
// the resting widths; on hydration this recomputes each segment width straight
// from the trace duals and the constraint rhs, so the number is derived, never
// hardcoded. Slack limits contribute 0 and keep their keyed zero clause so
// the shared brush still lights them. --w carries the width on a fixed scale
// (px per unit of profit); the CSS turns it into a flex-grow proportion.
const STACK_SCALE = 14; // 22 profit units -> a 308 wide twin bar
function mountStack(figureRoot, trace) {
  const host = figureRoot.querySelector('[data-role="duality-stack"]');
  if (!host) return;
  const duals = trace.result.duals;
  const rhs = trace.problem.constraints.map((c) => c.rhs);
  const products = duals.map((d, i) => d * rhs[i]); // 0, 45/7, 81/7, 0, 4
  products.forEach((p, i) => {
    const w = String(Math.round(p * STACK_SCALE));
    host
      .querySelectorAll(`[data-key="${conKey(i)}"]`)
      .forEach((seg) => seg.style.setProperty("--w", w));
  });
  const total = products.reduce((a, b) => a + b, 0); // 22
  const totalEl = host.querySelector('[data-role="duality-stack-total"]');
  if (totalEl) totalEl.style.setProperty("--w", String(Math.round(total * STACK_SCALE)));
}

export default async function mount(box, ctx) {
  const trace = await ctx.loadTrace(ctx.fixture || "topic21");
  const duals = trace.result.duals;
  // Bars are scaled against the largest price so the tallest (crystal chamber,
  // worth 1) fills the track and the zero-value bars sit empty but still light.
  const maxDual = Math.max(...duals, 1e-9);

  const bars = el("div", {
    class: "s4-bars",
    role: "group",
    "aria-label": "What one more unit of each resource is worth at the optimum.",
  });

  RESOURCES.forEach((r, i) => {
    const frac = duals[i] / maxDual;
    const btn = el("button", {
      type: "button",
      class: "s4-bar",
      "data-key": conKey(i),
      style: `--h: ${conHue(i)}; --frac: ${frac};`,
      "aria-label": `${r.name}, one more unit worth ${r.spoken}`,
    });
    btn.append(
      el("span", { class: "s4-bar-name", text: r.name }),
      el("span", { class: "s4-bar-val", text: r.text }),
      el("span", { class: "s4-bar-track" }, [el("span", { class: "s4-bar-fill" })])
    );
    bars.appendChild(btn);
  });

  // Atomic swap: build the live bars fully, then replace the authored still in
  // one operation so the box is never blank and nothing throws mid-mutation.
  const still = box.querySelector("svg");
  if (still) still.replaceWith(bars);
  else box.appendChild(bars);

  // One delegated brush covers both panels: the dual bars here and the authored
  // primal limit rows in the same <figure>. Hovering or focusing con:2 anywhere
  // lights con:2 everywhere. Idempotent, so a re-mount is a no-op.
  const figureRoot = box.closest("figure") || box;

  // The primal limit rows are static <li>, so pointer hover already lights them
  // but the keyboard cannot reach them. Put them in the tab order; sync.js's
  // focusin delegation then lights each row with its paired price on focus, the
  // same as hover (rubric A1 / A3).
  figureRoot.querySelectorAll(".s4-cx").forEach((li) => {
    if (!li.hasAttribute("tabindex")) li.setAttribute("tabindex", "0");
  });

  // Second view of the con:3 shadow price: the value function as a slope. Lives
  // in its own authored host inside this figure, so linkFigure below covers its
  // dot and slider (both keyed con:3) with the same brush as the bars.
  mountValueFunction(figureRoot);

  // Strong-duality certificate: recompute the stacked contribution bar widths
  // from the trace duals times the constraint rhs (never hardcoded), then let
  // the shared brush below light each segment with its paired limit.
  mountStack(figureRoot, trace);

  linkFigure(figureRoot);

  ctx.setEngine("trace"); // every dual is replayed from topic21.json
}
