// Feasible Region . sync.js . linked-brushing plumbing shared by every figure
//
// Dependency-free ES module: no DOM creation, no d3. One way to say "these two
// things are the same" across a figure's panels. An element carries
// data-key="<kind>:<id>"; hovering or keyboard-focusing any keyed element lights
// every element under the same figure root sharing that exact key, by toggling
// .is-lit (styled once in css /* fig:sync */). Hover and focus behave identically
// (A11y). A figure imports this directly, as hero imports lp2d.
//
// data-key grammar (contract section 3):
//   con:<1..5>     one constraint everywhere it appears (slack column, shadow
//                  price bar, chip, legend swatch); always paired with conHue.
//   var:<name>     one variable's column / edge (x1, x2, x3, or a flow arc fsa).
//   pivot:<step>   a simplex step's entering column + leaving row + vertex + trail.
//   vertex:<a-b-c> an optional named corner.
// Keep ids in [a-z0-9:_-] so the quoted attribute selector needs no CSS.escape.
// ==========================================================================

// 0-based constraint index -> 1-based colour slot, wrapping after five so a
// sixth constraint reuses slot 1. This is the single source of the mapping every
// figure uses, so constraint k wears constraint-k's hue site-wide.
export const conNum = (i) => (i % 5) + 1;

// The CSS custom property that paints constraint i. Colour only ever comes from
// these tokens, so both themes recolour for free.
export const conHue = (i) => `var(--constraint-${conNum(i)})`;

// The shared data-key for constraint i, matched across a figure's panels.
export const conKey = (i) => `con:${conNum(i)}`;

// The shared data-key for a named variable or flow arc.
export const varKey = (name) => `var:${name}`;

// Resolve the data-key of the element under a pointer/focus target: the nearest
// ancestor (or self) that carries one, provided it is inside root. Null if none.
function keyOf(target, root) {
  if (!(target instanceof Element)) return null;
  const el = target.closest("[data-key]");
  return el && root.contains(el) ? el.getAttribute("data-key") : null;
}

// Imperative brush with no pointer: light every element under root that shares
// this key. Safe to call with a falsy key (does nothing).
export function light(root, key) {
  if (!root || !key) return;
  root
    .querySelectorAll(`[data-key="${key}"]`)
    .forEach((n) => n.classList.add("is-lit"));
}

// Remove every .is-lit under root. The inverse of light(); the reset each
// hover/focus change runs before lighting the new key.
export function clearLit(root) {
  if (!root) return;
  root.querySelectorAll(".is-lit").forEach((n) => n.classList.remove("is-lit"));
}

// Wire one figure root for linked brushing. A single delegated listener set
// (pointer + keyboard focus) covers every keyed element inside, present or added
// later, so a figure calls this once after it swaps its live DOM in. Idempotent:
// a second call on the same root is a no-op (dataset.synced guard). Returns a
// teardown function that removes the listeners and clears any highlight.
export function linkFigure(root) {
  if (!root || root.dataset.synced === "1") return () => {};
  root.dataset.synced = "1";

  const lightFrom = (target) => {
    const key = keyOf(target, root);
    clearLit(root);
    if (key) light(root, key);
  };

  const onOver = (e) => lightFrom(e.target);
  const onLeave = () => clearLit(root);
  const onFocusIn = (e) => lightFrom(e.target);
  // On blur, light whatever focus is moving to (if it is keyed and inside),
  // otherwise clear. This hands off keyed -> keyed with no dark flash.
  const onFocusOut = (e) => lightFrom(e.relatedTarget);

  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerleave", onLeave);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);

  return function teardown() {
    root.removeEventListener("pointerover", onOver);
    root.removeEventListener("pointerleave", onLeave);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    delete root.dataset.synced;
    clearLit(root);
  };
}
