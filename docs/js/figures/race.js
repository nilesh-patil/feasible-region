// Feasible Region . figures/race.js . S6 the race (Corner Case vs Strictly Feasible)
//
// One shared cargo polytope, two ways across. Corner Case (the drone) hops the
// BOUNDARY corner to corner, its five vertices replayed from the topic21 trace on
// the same iso polytope the S3 walk drew. Strictly Feasible (the vessel) threads
// the INTERIOR along the recorded central path: the committed centralpath-topic21
// sidecar logs 24 interior points as mu falls from 45 to a few millionths, landing
// on the arrival (9, 9, 4). Both racers are replays; the badge stays "replaying
// trace" and never claims a live solve (there is no live interior solver). One
// scrubber drives both. If the sidecar is ever missing, mount throws and main.js
// keeps the authored still.

import { classifyEdges, findVertexIndex, makeProjector, triadArms } from "../iso3d.js";
import { linkFigure } from "../sync.js";

const SVGNS = "http://www.w3.org/2000/svg";
// Stage viewBox + pad; the still in index.html reuses these so hydration lands where it drew.
const VB_W = 480;
const VB_H = 300;
const PAD = 40;
const OPT = [9, 9, 4]; // the shared arrival; real, from topic21.result.x

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
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
// mu spans 45 down to a few millionths; two significant figures, trimmed.
const muFmt = (m) => (m == null ? "0" : String(Number(m.toPrecision(2))));

// The drone glyph: a small quadcopter, solid-filled, the boundary racer.
function makeDrone() {
  const g = svgEl("g", { class: "race-drone" });
  g.appendChild(svgEl("line", { class: "race-drone-arm", x1: "-7", y1: "-5", x2: "7", y2: "5" }));
  g.appendChild(svgEl("line", { class: "race-drone-arm", x1: "-7", y1: "5", x2: "7", y2: "-5" }));
  [[-7, -5], [7, -5], [-7, 5], [7, 5]].forEach(([x, y]) =>
    g.appendChild(svgEl("circle", { class: "race-drone-rotor", cx: String(x), cy: String(y), r: "2.6" }))
  );
  g.appendChild(svgEl("rect", { class: "race-drone-body", x: "-4.5", y: "-3", width: "9", height: "6", rx: "1.6" }));
  return g;
}
// The vessel glyph: a sleek outline hull, distinct from the solid drone, the interior racer.
function makeVessel() {
  const g = svgEl("g", { class: "race-vessel" });
  g.appendChild(svgEl("path", { class: "race-vessel-hull", d: "M-10,0 Q-2,5.5 9,2.6 Q11.5,0 9,-2.6 Q-2,-5.5 -10,0 Z" }));
  g.appendChild(svgEl("line", { class: "race-vessel-fin", x1: "-1", y1: "-1", x2: "-1", y2: "-8" }));
  g.appendChild(svgEl("path", { class: "race-vessel-sail", d: "M-1,-8 L5,-3 L-1,-2 Z" }));
  return g;
}

export default async function mount(box, ctx) {
  // topic21 gives the polytope + recorded boundary walk; the central-path sidecar
  // gives the recorded interior trajectory and its mu schedule.
  const topic = await ctx.loadTrace("topic21");
  const central = await ctx.loadTrace("centralpath-topic21");

  const geom = topic.geometry;
  const steps = topic.steps;
  const nSteps = steps.length; // 5 corners, 0..4
  const lastCorner = nSteps - 1;

  // Shared, fixed iso projection, fit once to the polytope (headroom via PAD).
  const project = makeProjector({ vertices: geom.vertices, width: VB_W, height: VB_H, pad: PAD }).project;
  const screen = geom.vertices.map(project);
  // Boundary racer: each recorded step lands on one polytope vertex.
  const walk = steps.map((s) => findVertexIndex(geom.vertices, s.vertex));

  // Interior racer: the recorded central path, projected point by point, plus the
  // mu schedule. Both are read straight from the committed sidecar.
  const mus = central.mu_values || [];
  const cpts = central.points || [];
  const realPath = cpts.map(project);
  const endScreen = project(OPT);
  const interiorAt = (t) => {
    const f = t * (realPath.length - 1);
    const i = Math.min(realPath.length - 1, Math.floor(f));
    const j = Math.min(realPath.length - 1, i + 1);
    const u = f - i;
    return [realPath[i][0] + (realPath[j][0] - realPath[i][0]) * u, realPath[i][1] + (realPath[j][1] - realPath[i][1]) * u];
  };
  const muAt = (k) => (mus.length ? mus[Math.round((k / lastCorner) * (mus.length - 1))] : null);

  // ---- stage svg ----------------------------------------------------------
  const svg = svgEl("svg", {
    class: "fig-svg race-stage-svg",
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "Two racers on one cargo polytope: a recorded boundary walk and the recorded interior central path.",
  });
  // polytope wireframe, shared by both racers; every edge is classified front
  // or back from the problem constraints and this stage's own projection
  const depth = classifyEdges(topic.problem.constraints, geom.vertices, geom.edges, { project });
  geom.edges.forEach(([i, j], k) =>
    svg.appendChild(
      svgEl("line", {
        class: depth[k] === "back" ? "race-edge is-back" : "race-edge",
        x1: screen[i][0], y1: screen[i][1], x2: screen[j][0], y2: screen[j][1],
      })
    )
  );
  // axis triad in the free lower-left corner plus the labeled origin
  const gTriad = svgEl("g", { class: "iso-triad", "aria-hidden": "true" });
  for (const arm of triadArms(44, 240, 15)) {
    gTriad.appendChild(svgEl("line", { class: "iso-triad-arm", x1: arm.x1, y1: arm.y1, x2: arm.x2, y2: arm.y2 }));
    gTriad.appendChild(
      svgEl("text", { class: "iso-triad-label", x: arm.lx, y: arm.ly, "text-anchor": arm.anchor }, arm.label)
    );
  }
  svg.appendChild(gTriad);
  const raceOrigin = project([0, 0, 0]);
  svg.appendChild(
    svgEl("text", {
      class: "iso-origin",
      x: raceOrigin[0] - 8,
      y: raceOrigin[1] + 12,
      "text-anchor": "end",
      "aria-hidden": "true",
    }, "0")
  );
  // interior racer: the recorded central path as a literal polyline
  svg.appendChild(
    svgEl("path", {
      class: "race-interior is-real",
      d: "M " + realPath.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L "),
    })
  );
  // boundary trail segments, revealed up to the current corner; keyed to their
  // destination corner so a corner and its incoming hop light together.
  const trailEls = [];
  for (let k = 0; k < walk.length - 1; k++) {
    const a = screen[walk[k]];
    const b = screen[walk[k + 1]];
    const seg = svgEl("line", { class: "race-trail", x1: a[0], y1: a[1], x2: b[0], y2: b[1], "data-key": `pivot:${k + 1}` });
    trailEls.push(seg);
    svg.appendChild(seg);
  }
  // corner dots: each recorded vertex, focusable, keyed to its step (pivot:<k>)
  const cornerEls = walk.map((vi, k) => {
    const p = screen[vi];
    const v = steps[k].vertex;
    const dot = svgEl("circle", {
      class: "race-corner", cx: p[0], cy: p[1], r: "4", "data-key": `pivot:${k}`, tabindex: "0", role: "img",
      "aria-label": `Corner ${k} of ${lastCorner}, at ${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}`,
    });
    svg.appendChild(dot);
    return dot;
  });
  // start marker on the first recorded interior point
  svg.appendChild(svgEl("circle", { class: "race-start", cx: realPath[0][0].toFixed(1), cy: realPath[0][1].toFixed(1), r: "3.4" }));
  // arrival marker + label: the shared finish (9, 9, 4); label sits clear above
  // the marker so a parked racer never lands on it.
  svg.appendChild(svgEl("circle", { class: "race-arrival", cx: endScreen[0], cy: endScreen[1], r: "5" }));
  svg.appendChild(
    svgEl("text", { class: "race-arrival-label", x: endScreen[0].toFixed(1), y: (endScreen[1] - 20).toFixed(1), "text-anchor": "middle" }, "arrival (9, 9, 4)")
  );
  // the two racers' glyphs, moved each step
  const drone = makeDrone();
  const vessel = makeVessel();
  svg.appendChild(drone);
  svg.appendChild(vessel);

  // ---- controls -----------------------------------------------------------
  const prevBtn = htmlEl("button", { type: "button", class: "btn race-step-btn" }, "Prev");
  const nextBtn = htmlEl("button", { type: "button", class: "btn race-step-btn" }, "Next");
  // No play button under reduced motion, so autoplay cannot exist there.
  const playBtn = ctx.prefersReducedMotion
    ? null
    : htmlEl("button", { type: "button", class: "btn race-play", "aria-pressed": "false" }, "Play");
  const range = htmlEl("input", {
    type: "range", class: "scrubber", min: "0", max: String(lastCorner), step: "1",
    "aria-label": "Race position, corner by corner",
  });
  const stepTag = htmlEl("span", { class: "race-step-tag", "aria-hidden": "true" });
  const readout = box.querySelector('[data-role="race-readout"]');

  // Default is a mid-race corner, not the finish: at rest the racers sit apart
  // (drone out on the boundary, vessel in the middle) and nothing piles up on the
  // arrival. The scrubber still runs the whole walk 0..last.
  let cur = Math.min(2, lastCorner);
  let timer = null;

  function render() {
    const step = steps[cur];
    const v = step.vertex;
    const t = lastCorner === 0 ? 0 : cur / lastCorner;

    trailEls.forEach((seg, k) => seg.classList.toggle("is-on", k < cur));
    cornerEls.forEach((c, k) => c.classList.toggle("is-visited", k <= cur));
    const dp = screen[walk[cur]];
    drone.setAttribute("transform", `translate(${dp[0].toFixed(1)}, ${dp[1].toFixed(1)})`);
    drone.setAttribute("data-key", `pivot:${cur}`);

    // at the finish both racers land on the arrival; park the vessel a touch aside
    // so it stays visible beside the solid drone.
    const vp = interiorAt(t);
    if (cur === lastCorner) {
      vp[0] += 14;
      vp[1] += 1;
    }
    vessel.setAttribute("transform", `translate(${vp[0].toFixed(1)}, ${vp[1].toFixed(1)})`);

    const mu = muAt(cur);
    range.value = String(cur);
    range.setAttribute("aria-valuenow", String(cur));
    range.setAttribute(
      "aria-valuetext",
      `Corner ${cur} of ${lastCorner}, boundary at ${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}, interior mu ${muFmt(mu)}`
    );
    stepTag.textContent = `corner ${cur} of ${lastCorner}`;
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === lastCorner;

    // aria-live readout (implementer-owned template, values substituted live)
    if (readout) {
      readout.innerHTML =
        `<b>Corner Case</b> at corner <b>${cur}</b> of ${lastCorner} ` +
        `(${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}); <b>Strictly Feasible</b> in the interior, ` +
        `mu = <b>${muFmt(mu)}</b>, heading to (9, 9, 4).`;
    }
    svg.setAttribute(
      "aria-label",
      `Race corner ${cur} of ${lastCorner}. Corner Case on the boundary at ${fmt(v[0])}, ${fmt(v[1])}, ` +
        `${fmt(v[2])}; Strictly Feasible on the recorded interior path, mu ${muFmt(mu)}, heading to 9, 9, 4.`
    );
  }

  function setStep(i) {
    cur = Math.max(0, Math.min(lastCorner, i));
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
    if (!playBtn) return;
    if (cur === lastCorner) setStep(0);
    playBtn.setAttribute("aria-pressed", "true");
    playBtn.textContent = "Pause";
    timer = setInterval(() => {
      if (cur >= lastCorner) {
        stopPlay();
        return;
      }
      setStep(cur + 1);
    }, 950);
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

  // ---- mount: swap the authored still, fill the controls ------------------
  const stage = box.querySelector('[data-role="race-stage"]');
  if (stage) {
    const still = stage.querySelector("svg");
    if (still) still.replaceWith(svg);
    else stage.appendChild(svg);
  }
  const controls = box.querySelector('[data-role="race-controls"]');
  if (controls) {
    controls.textContent = "";
    controls.append(prevBtn, range, nextBtn, ...(playBtn ? [playBtn] : []), stepTag);
  }

  render();
  linkFigure(box); // corner <-> incoming trail cross-highlight (pivot:<k>)

  const badge = box.querySelector('[data-role="race-engine"]');
  if (badge) {
    badge.setAttribute("data-engine", "trace");
    badge.textContent = "replaying trace";
  }
}
