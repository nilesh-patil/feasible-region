// ==========================================================================
// Feasible Region . figures/duality.js . S4 shadow prices (duality)
//
// The reframe: instead of "how do we fill the hold", ask "what is one more
// unit of each resource worth". That worth is the constraint's dual value, its
// shadow price. This figure shows the five resource limits (the primal side)
// next to the five shadow prices (the dual side) as labelled bars. Hover or
// keyboard-focus a resource on either side and it lights on both, tied by a
// shared con: data-key through sync.js, so the reader sees a limit and its
// price are the same thing seen twice.
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

  linkFigure(figureRoot);

  ctx.setEngine("trace"); // every dual is replayed from topic21.json
}
