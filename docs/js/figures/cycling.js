// Feasible Region . figures/cycling.js . S5 second exhibit: the cycling trap
//
// Chvatal's 1983 degenerate program. Under a naive tie-break the basis loops
// with period 6 and the objective never leaves 0; Bland's rule escapes in eight
// pivots. The authored inline SVG in index.html is the whole no-JS exhibit and
// the PRIMARY visual (a ring of six bases, the closed loop). This module adds a
// step control that walks the 31 recorded naive pivots and lights the current
// basis on that ring, so a reader can watch the recurrence close on itself.
//
// It is mounted by kleeminty.js (a sibling figure in S5), never by main.js, and
// it NEVER touches the exhibit's engine badge: the naive lane is never re-solved
// live, so the badge stays a static "replaying trace". A failed trace load or a
// missing mount point leaves the authored still exactly as written.

const PERIOD = 6;

function el(name, attrs, text) {
  const e = document.createElement(name);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

// Clean integer, else two decimals. The naive objective is exactly 0 at every
// recorded step, so this stays "0".
const num = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(2)));

export default async function mount(cycBox, ctx) {
  let trace;
  try {
    trace = await ctx.loadTrace("degenerate1-naive");
  } catch (e) {
    return; // keep the authored still
  }
  const steps = trace && trace.steps;
  if (!Array.isArray(steps) || steps.length < PERIOD + 1) return;

  const svg = cycBox.querySelector(".cyc-loop-svg");
  const panel = cycBox.closest(".cyc-panel") || cycBox.parentElement;
  if (!svg || !panel) return;

  const nodes = Array.from(svg.querySelectorAll(".cyc-node"));
  if (nodes.length !== PERIOD) return;
  const nodeByBasis = new Map();
  for (const g of nodes) nodeByBasis.set(g.dataset.basis, g);

  const controls = panel.querySelector('[data-role="cyc-controls"]');
  const readout = panel.querySelector('[data-role="cyc-readout"]');
  if (!controls) return;

  const basisKey = (b) => b.slice().sort((x, y) => x - y).join("-");
  const basisLabel = (g) => {
    const t = g && g.querySelector(".cyc-node-basis");
    return t ? t.textContent.trim() : "";
  };
  const N = steps.length - 1; // last recorded pivot index (30)

  // ---- controls: prev / scrubber / next, plus an optional play ----------
  const prev = el("button", { type: "button", class: "btn dv-step-btn" }, "Prev");
  const next = el("button", { type: "button", class: "btn dv-step-btn" }, "Next");
  const scrub = el("input", {
    type: "range",
    class: "scrubber cyc-scrub",
    min: "0",
    max: String(N),
    step: "1",
    value: "0",
    "aria-label": "Pivot of the naive cycle",
  });
  const play = ctx && ctx.prefersReducedMotion
    ? null
    : el("button", { type: "button", class: "btn dv-play", "aria-pressed": "false" }, "Play");

  let cur = 0;
  let timer = null;

  function render(k) {
    cur = Math.max(0, Math.min(N, k));
    const s = steps[cur];
    const key = basisKey(s.basis);
    let hit = null;
    for (const g of nodes) {
      const on = g.dataset.basis === key;
      g.classList.toggle("is-current", on);
      if (on) hit = g;
    }
    scrub.value = String(cur);
    prev.disabled = cur === 0;
    next.disabled = cur === N;

    const lab = basisLabel(hit) || key;
    let msg = `Pivot ${cur} of ${N}: basis ${lab}, objective ${num(s.objective_value)}.`;
    msg += cur >= PERIOD
      ? ` The same basis stood at pivot ${cur - PERIOD}, six pivots back: the loop has closed on itself.`
      : " Follow the basis; six pivots on, it returns to this very node.";
    if (readout) readout.textContent = msg;
    scrub.setAttribute("aria-valuetext", msg);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (play) {
      play.setAttribute("aria-pressed", "false");
      play.textContent = "Play";
    }
  }
  function start() {
    if (!play) return;
    if (cur >= N) render(0);
    play.setAttribute("aria-pressed", "true");
    play.textContent = "Pause";
    timer = setInterval(() => {
      if (cur >= N) {
        stop();
        return;
      }
      render(cur + 1);
    }, 700);
  }

  prev.addEventListener("click", () => { stop(); render(cur - 1); });
  next.addEventListener("click", () => { stop(); render(cur + 1); });
  scrub.addEventListener("input", () => { stop(); render(parseInt(scrub.value, 10) || 0); });
  if (play) play.addEventListener("click", () => (timer ? stop() : start()));

  const row = el("div", { class: "scrubber-row cyc-scrub-row" });
  const kids = [prev, scrub, next];
  if (play) kids.push(play);
  row.append(...kids);
  controls.replaceChildren(row);

  render(0);
}
