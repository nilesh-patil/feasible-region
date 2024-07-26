// Feasible Region . figures/hood.js . S3 "open the hood" pivot zoom
//
// A collapsible panel under the dual view that opens the hood on ONE simplex
// pivot and works the Gaussian elimination by hand, in three frames: the raw
// excerpt, the scaled pivot row, then the cleared column. It is generic and
// data driven: nothing is fabricated. The 3 by 3 excerpt is an honest slice of
// the step's own tableau, rows [pivot, one eliminated, z] and columns [pivot,
// one other, rhs], recomputed live from that tableau so it works identically on
// the recorded walk and on any live what if pivot. Every number goes through
// fmtR() and every label through the caller's varLabel, so the excerpt reads the
// same as the main tableau (s4, s3, z and x1, x2, rhs line up exactly).
//
// dualview.js drives it through a tiny direct call contract: mountHood(scope,
// ctx, meta) once, then hood.sync(step, cur, nSteps, mode) after every tableau
// render. The panel auto opens exactly once, on the first pivot step the reader
// reaches (reveal plus an aria-live line, never a focus grab); the figure lands
// on the optimal step at hydration, so nothing opens on load and layout never
// shifts. If the host div is absent the mount returns a no op stub.

import { fmtR } from "../fmt-rational.js";

const TOL = 1e-6;
let uid = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export default function mountHood(scope, ctx, meta) {
  const host = scope && scope.querySelector('[data-role="dualview-hood"]');
  if (!host) return { sync() {} }; // no host, no work

  const label = (meta && meta.label) || ((i) => "v" + (i + 1));
  const nRows = meta.nRows;
  const nCols = meta.nCols;
  const nVars = nCols - 1;
  const zRow = nRows - 1;
  const rhsCol = nCols - 1;
  const panelId = "dv-hood-panel-" + ++uid;

  // ---- shell, built once ------------------------------------------------
  const root = el("div", "hood");

  const bar = el("div", "hood-bar");
  const toggle = el("button", "btn hood-toggle", "Open the hood");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  const chip = el("span", "hood-chip", "pivot step 0");
  chip.setAttribute("aria-hidden", "true");
  chip.setAttribute("data-key", "pivot:0");
  bar.append(toggle, chip);

  // Live region kept OUTSIDE the collapsible panel so the auto open and the
  // frame steps always announce, and only when we write to it (no scrub chatter).
  const status = el("div", "hood-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  const panel = el("div", "hood-panel");
  panel.id = panelId;
  panel.hidden = true;

  const lead = el("p", "hood-lead");

  const frames = el("div", "hood-frames");
  const frameBar = el("div", "hood-frame-bar");
  const prevBtn = el("button", "btn hood-step", "Back");
  prevBtn.type = "button";
  const nextBtn = el("button", "btn hood-step", "Next");
  nextBtn.type = "button";
  const frameTag = el("span", "hood-frame-tag");
  frameTag.setAttribute("aria-hidden", "true");
  frameBar.append(prevBtn, frameTag, nextBtn);

  const gridScroll = el("div", "hood-grid-scroll");
  const table = el("table", "hood-grid");
  table.setAttribute("role", "img");
  const thead = el("thead");
  const tbody = el("tbody");
  table.append(thead, tbody);
  gridScroll.appendChild(table);

  const signNote = el("p", "hood-signnote");
  frames.append(frameBar, gridScroll, signNote);

  const note = el("p", "hood-note");
  const cite = el("p", "hood-cite", "CLRS section 28.1");

  panel.append(lead, frames, note, cite);
  root.append(bar, status, panel);
  host.textContent = "";
  host.appendChild(root);

  // ---- state ------------------------------------------------------------
  let frame = 0;
  let open = false;
  let autoOpened = false;
  let lastCur = null;
  let model = null;

  function setOpen(v) {
    open = v;
    toggle.setAttribute("aria-expanded", v ? "true" : "false");
    toggle.textContent = v ? "Close the hood" : "Open the hood";
    panel.hidden = !v;
  }
  toggle.addEventListener("click", () => setOpen(!open));

  // ---- recompute one pivot from the step's own tableau ------------------
  // Returns null when there is no pivot here (optimal corner), so sync renders
  // the terminal body instead of a fabricated excerpt.
  function computeModel(step) {
    if (!step || step.entering == null) return null;
    const T = step.tableau;
    const basis = step.basis;
    const pivotCol = step.entering;
    const pivotRow = basis.indexOf(step.leaving);
    if (pivotRow < 0) return null;
    const piv = T[pivotRow][pivotCol];
    if (!isFinite(piv) || Math.abs(piv) < TOL) return null;

    // The scaled pivot row (the row divided by its pivot), full width.
    const scaled = T[pivotRow].map((v) => v / piv);

    // Post pivot z row, to read off which variable enters next.
    const zFactor = T[zRow][pivotCol];
    const postZ = T[zRow].map((v, c) => v - zFactor * scaled[c]);
    let nextCol = -1;
    let nextRC = TOL;
    for (let c = 0; c < nVars; c++) {
      if (c === pivotCol) continue;
      if (postZ[c] > nextRC) {
        nextRC = postZ[c];
        nextCol = c;
      }
    }
    const hasNext = nextCol >= 0;

    // One other column: the next entering variable when there is one, else the
    // largest scaled coefficient, so the excerpt always shows a real transform.
    let oneOther = nextCol;
    if (oneOther < 0) {
      let bestMag = TOL;
      for (let c = 0; c < nVars; c++) {
        if (c === pivotCol) continue;
        const m = Math.abs(scaled[c]);
        if (m > bestMag) {
          bestMag = m;
          oneOther = c;
        }
      }
      if (oneOther < 0) oneOther = (pivotCol + 1) % nVars;
    }

    // One eliminated row: the constraint row with the largest pivot column
    // coefficient, so its elimination is clearly visible.
    let oneElim = -1;
    let elimMag = TOL;
    for (let r = 0; r < nRows; r++) {
      if (r === pivotRow || r === zRow) continue;
      const m = Math.abs(T[r][pivotCol]);
      if (m > elimMag) {
        elimMag = m;
        oneElim = r;
      }
    }
    if (oneElim < 0) {
      for (let r = 0; r < nRows; r++) {
        if (r !== pivotRow && r !== zRow) {
          oneElim = r;
          break;
        }
      }
    }

    const cols = [pivotCol, oneOther, rhsCol];
    const rows = [pivotRow, oneElim, zRow];

    // Three value frames over the 3 by 3 excerpt.
    const cleared = (r) => cols.map((c) => T[r][c] - T[r][pivotCol] * scaled[c]);
    const before = rows.map((r) => cols.map((c) => T[r][c]));
    const scaledFrame = rows.map((r) =>
      r === pivotRow ? cols.map((c) => scaled[c]) : cols.map((c) => T[r][c])
    );
    const clearedFrame = rows.map((r) =>
      r === pivotRow ? cols.map((c) => scaled[c]) : cleared(r)
    );

    const afterZRhs = clearedFrame[2][2];
    return {
      rows,
      cols,
      V: [before, scaledFrame, clearedFrame],
      opFactor: rows.map((r) => T[r][pivotCol]),
      rowLabels: [label(basis[pivotRow]), label(basis[oneElim]), "z"],
      colLabels: [label(pivotCol), label(oneOther), "rhs"],
      eLabel: label(pivotCol),
      lLabel: label(step.leaving),
      oLabel: label(oneOther),
      piv,
      rhsPiv: T[pivotRow][rhsCol],
      ratio: T[pivotRow][rhsCol] / piv,
      beforeObj: step.objective_value,
      afterObj: -afterZRhs,
      afterZRhs,
      hasNext,
      nextRC,
    };
  }

  // ---- per frame text ---------------------------------------------------
  function opText(ri) {
    const m = model;
    if (frame === 1 && ri === 0) return "divide by " + fmtR(m.piv);
    if (frame === 2 && ri !== 0) {
      const f = m.opFactor[ri];
      return (f >= 0 ? "minus " : "plus ") + fmtR(Math.abs(f)) + " × pivot row";
    }
    return "";
  }

  function noteFor() {
    const m = model;
    if (frame === 0) {
      return (
        m.eLabel + " enters and " + m.lLabel + " leaves. The ratio test picks " +
        "this row: " + fmtR(m.rhsPiv) + " divided by " + fmtR(m.piv) + " is " +
        fmtR(m.ratio) + ", the smallest ratio, so " + m.eLabel + " rises to " +
        fmtR(m.ratio) + "."
      );
    }
    if (frame === 1) {
      return (
        "Divide the leaving row by the pivot " + fmtR(m.piv) + ", so the pivot " +
        "cell becomes 1. The other rows have not moved yet."
      );
    }
    const head =
      "Subtract multiples of the scaled row until the " + m.eLabel +
      " column is a clean unit column. ";
    const bridge = m.hasNext
      ? "In the z row, " + m.oLabel + " now shows a reduced cost of +" +
        fmtR(m.nextRC) + ", so " + m.oLabel + " enters next. "
      : "Every reduced cost in the z row is now zero or negative, so this " +
        "reaches the optimal corner. ";
    return (
      head + bridge + "The objective climbs from " + fmtR(m.beforeObj) +
      " to " + fmtR(m.afterObj) + "."
    );
  }

  // ---- render the grid for the current frame ----------------------------
  function renderFrames() {
    const m = model;
    if (!m) return;

    lead.textContent =
      m.eLabel + " enters and " + m.lLabel + " leaves. Goal: turn the " +
      m.eLabel + " column into a unit column, 1 in the pivot row and 0 " +
      "everywhere else.";
    frameTag.textContent = "frame " + (frame + 1) + " of 3";
    prevBtn.disabled = frame === 0;
    nextBtn.disabled = frame === 2;

    // head: corner, three column labels, op column
    thead.textContent = "";
    const htr = el("tr");
    htr.appendChild(el("th"));
    m.colLabels.forEach((c) => {
      const th = el("th", null, c);
      th.setAttribute("scope", "col");
      htr.appendChild(th);
    });
    htr.appendChild(el("th", "hood-op-head"));
    thead.appendChild(htr);

    // body: three rows, ghosts where the value changed this frame
    tbody.textContent = "";
    const cur = m.V[frame];
    const prev = frame > 0 ? m.V[frame - 1] : null;
    for (let ri = 0; ri < 3; ri++) {
      const tr = el("tr");
      if (ri === 0) tr.className = "hood-row-piv";
      if (ri === 2) tr.classList.add("hood-obj");
      const rh = el("th", "hood-rowhead", m.rowLabels[ri]);
      rh.setAttribute("scope", "row");
      tr.appendChild(rh);
      for (let ci = 0; ci < 3; ci++) {
        const td = el("td", "hood-cell");
        if (ci === 0) td.classList.add("hood-col-piv");
        if (ri === 0 && ci === 0) td.classList.add("hood-pivot");
        const now = fmtR(cur[ri][ci]);
        if (prev && fmtR(prev[ri][ci]) !== now) {
          const ghost = el("span", "hood-ghost");
          ghost.appendChild(el("span", "hood-was", "was"));
          ghost.appendChild(document.createTextNode(" "));
          ghost.appendChild(el("s", null, fmtR(prev[ri][ci])));
          td.appendChild(ghost);
        }
        td.appendChild(el("span", "hood-now", now));
        tr.appendChild(td);
      }
      tr.appendChild(el("td", "hood-op", opText(ri)));
      tbody.appendChild(tr);
    }

    const alt = m.colLabels.map((c, i) => c + " " + fmtR(cur[0][i])).join(", ");
    table.setAttribute(
      "aria-label",
      "Pivot excerpt, frame " + (frame + 1) + " of 3. Pivot row " +
        m.rowLabels[0] + ": " + alt + "."
    );

    note.textContent = noteFor();
    signNote.textContent =
      frame === 2
        ? "The z row stores the objective negated, so the " + fmtR(m.afterZRhs) +
          " in its rhs corner means the objective is " + fmtR(m.afterObj) + "."
        : "";
  }

  function stepFrame(d) {
    const next = Math.max(0, Math.min(2, frame + d));
    if (next === frame) return;
    frame = next;
    renderFrames();
    status.textContent = "Frame " + (frame + 1) + " of 3. " + noteFor();
  }
  prevBtn.addEventListener("click", () => stepFrame(-1));
  nextBtn.addEventListener("click", () => stepFrame(1));

  // ---- the sync contract dualview.js calls after every render -----------
  function sync(step, cur) {
    model = computeModel(step);
    chip.setAttribute("data-key", "pivot:" + cur);
    chip.textContent = model ? "pivot step " + cur : "optimal corner";
    if (cur !== lastCur) {
      frame = 0;
      lastCur = cur;
    }
    if (model) {
      lead.hidden = false;
      frames.hidden = false;
      renderFrames();
      if (!autoOpened) {
        autoOpened = true;
        setOpen(true); // reveal only, no focus grab
        status.textContent =
          "Opened the hood. A worked look at pivot step " + cur + ": " +
          model.eLabel + " enters, " + model.lLabel + " leaves.";
      }
    } else {
      lead.hidden = true;
      frames.hidden = true;
      signNote.textContent = "";
      note.textContent =
        "No pivot here. Every reduced cost in the z row is zero or negative, " +
        "so no column improves the objective. This corner is optimal.";
    }
  }

  return { sync };
}
