// Feasible Region . iso3d.js . pure isometric projection helpers
//
// Dependency-free ES module of PURE functions: no DOM, no d3, no rotation, no
// stored hull faces. Any 3D figure (S5's Klee-Minty cube, the race) projects
// through here so it lands with byte-identical math to the S3 tableau walk,
// keeping the site's isometric look consistent. The projection is a fixed
// isometric plane (no turntable). Every export is console unit-checkable.
//
// Depth cues: classifyEdges labels each wireframe edge front or back against
// the fixed view direction. No face data exists anywhere, so face adjacency is
// derived per call from problem.constraints alone: an edge is BACK exactly
// when the ray from its midpoint toward the camera passes through the strict
// interior of the polytope. Consumers rerun it on every what-if perturbation
// and pivot-rule re-solve; nothing is cached, nothing is guessed.

// cos(30 degrees). The x and y axes fan out at +/- 30 degrees from horizontal,
// so a unit step in x1 or x2 moves this far sideways. Frozen to the same value
// dualview.js uses, so a projected vertex here lands where the S3 still drew it.
export const COS30 = Math.cos(Math.PI / 6); // 0.8660254037844387

// Project one 3D point to the raw isometric plane, PRE-fit, Y NOT yet flipped.
// Height (the third coordinate) lifts the point straight up. Byte-identical math
// to dualview.js so any 3D figure matches the S3 polytope's look exactly.
export function projectIso(v) {
  return [(v[0] - v[1]) * COS30, (v[0] + v[1]) / 2 - v[2]];
}

// Fit a cloud of already-projected iso points into a (width, height) box minus
// pad on every side, centred, with the Y axis flipped so a larger py (a higher
// point in space) sits higher on screen. Returns the fit constants plus a map()
// that carries any iso point through the same transform.
export function fitToBox(isoPts, width, height, pad) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of isoPts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const contentW = width - 2 * pad;
  const contentH = height - 2 * pad;
  // A degenerate (flat) span would divide by zero; let the other axis govern.
  const scale = Math.min(
    spanX === 0 ? Infinity : contentW / spanX,
    spanY === 0 ? Infinity : contentH / spanY
  );
  const offX = pad + (contentW - spanX * scale) / 2;
  const offY = pad + (contentH - spanY * scale) / 2;
  const map = (pt) => [
    offX + (pt[0] - minX) * scale,
    offY + (maxY - pt[1]) * scale, // flip: larger py sits higher on screen
  ];
  return { scale, offX, offY, map };
}

// Build a reusable projector for one vertex set. project(v) takes an ORIGINAL
// vertex and runs it through the same pipeline the fit was measured on:
// optional per-axis normalize -> projectIso -> fit.map. With normalize:true each
// axis is remapped independently to [0, 1] before projection, so the Klee-Minty
// cube (axis maxes 1, 100, 10000) renders as a true cube rather than a sliver.
export function makeProjector(opts) {
  const { vertices, width, height, pad = 24, normalize = false } = opts;
  const dims = vertices[0].length;

  let mins = null;
  let spans = null;
  if (normalize) {
    mins = new Array(dims).fill(Infinity);
    const maxs = new Array(dims).fill(-Infinity);
    for (const v of vertices) {
      for (let d = 0; d < dims; d++) {
        if (v[d] < mins[d]) mins[d] = v[d];
        if (v[d] > maxs[d]) maxs[d] = v[d];
      }
    }
    spans = maxs.map((mx, d) => mx - mins[d]);
  }

  const norm = (v) =>
    normalize
      ? v.map((val, d) => (spans[d] === 0 ? 0 : (val - mins[d]) / spans[d]))
      : v;

  const iso = vertices.map((v) => projectIso(norm(v)));
  const fit = fitToBox(iso, width, height, pad);

  return {
    project: (v) => fit.map(projectIso(norm(v))),
    // World-space axis spans when normalize is on, else null. classifyEdges
    // needs them: normalization warps the camera direction back to world space.
    spans: normalize ? spans.slice() : null,
  };
}

// ===========================================================================
// Edge visibility. The projection kernel is the (1, 1, 1) direction in the
// (possibly normalized) projection space, and every figure draws +x3 downward
// on screen, so the viewer sits on the MINUS (1, 1, 1) side. In world space
// that camera direction is minus the per-axis spans (all ones without
// normalization). An edge midpoint whose ray toward the camera crosses the
// strict interior of { x >= 0 : A x <= b } is occluded by the body, so the
// edge is BACK; a grazing ray (edge on a facet the view direction rides along)
// never enters the strict interior, so silhouette edges classify FRONT.
// ===========================================================================

// Bounding half-spaces a . x <= b: the constraints plus x1, x2, x3 >= 0.
function halfspacesOf(constraints) {
  const hs = constraints.map((c) => ({
    a: [c.coeffs[0], c.coeffs[1], c.coeffs[2]],
    b: c.rhs,
  }));
  for (let d = 0; d < 3; d++) {
    const a = [0, 0, 0];
    a[d] = -1;
    hs.push({ a, b: 0 });
  }
  return hs;
}

// True exactly when the ray point + t * dcam (t > 0) meets the STRICT
// interior. Convexity makes the inside t-set an interval, so intersect the
// per-constraint strict intervals directly. A ray that rides a bounding plane
// never goes strictly inside it, which is the silhouette-front rule.
function rayHitsInterior(point, dcam, halfspaces) {
  let lo = 1e-9;
  let hi = Infinity;
  const dmax = Math.max(Math.abs(dcam[0]), Math.abs(dcam[1]), Math.abs(dcam[2]));
  for (const { a, b } of halfspaces) {
    const av = a[0] * point[0] + a[1] * point[1] + a[2] * point[2];
    const ad = a[0] * dcam[0] + a[1] * dcam[1] + a[2] * dcam[2];
    const asum = Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]);
    const margin = 1e-9 * (Math.max(1, Math.abs(b)) + asum);
    if (Math.abs(ad) <= 1e-12 * Math.max(1, asum * dmax)) {
      if (!(av < b - margin)) return false; // rides this plane, never inside
      continue;
    }
    const tStar = (b - margin - av) / ad;
    if (ad > 0) hi = Math.min(hi, tStar);
    else lo = Math.max(lo, tStar);
    if (lo >= hi) return false;
  }
  return lo < hi;
}

// Parameter of point p along the projected segment e (0 at e.a, 1 at e.b).
function segParam(e, p) {
  const dx = e.b[0] - e.a[0];
  const dy = e.b[1] - e.a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 === 0) return 0;
  return ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / L2;
}

// Do two projected segments overlap along one screen line? Used to promote a
// back edge that would z-fight a collinear front edge (a dashed stroke drawn
// under a solid one shimmers), so the pair reads as one solid silhouette.
function collinearOverlap(e, f) {
  const tol = 0.05;
  const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
  for (const p of [f.a, f.b]) {
    const cross =
      (e.b[0] - e.a[0]) * (p[1] - e.a[1]) - (e.b[1] - e.a[1]) * (p[0] - e.a[0]);
    if (Math.abs(cross) > tol * len) return false;
  }
  const t1 = segParam(e, f.a);
  const t2 = segParam(e, f.b);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  return hi > 0.02 && lo < 0.98 && !(hi < 0.02 || lo > 0.98);
}

// Classify every geometry edge front or back for the fixed isometric view.
// `constraints` are the LIVE problem constraints (committed or perturbed),
// `vertices` and `edges` the matching hull, and opts carries:
//   project  the figure's own vertex-to-screen map (the actual projection)
//   spans    per-axis world spans when the projector normalizes, else omit
// Returns an array aligned with `edges` of "front" | "back" strings.
export function classifyEdges(constraints, vertices, edges, opts) {
  const project = opts.project;
  const s = (opts && opts.spans) || [1, 1, 1];
  const dcam = [-s[0], -s[1], -s[2]];
  const hs = halfspacesOf(constraints);
  const out = edges.map(([i, j]) => {
    const vi = vertices[i];
    const vj = vertices[j];
    const mid = [(vi[0] + vj[0]) / 2, (vi[1] + vj[1]) / 2, (vi[2] + vj[2]) / 2];
    return {
      cls: rayHitsInterior(mid, dcam, hs) ? "back" : "front",
      a: project(vi),
      b: project(vj),
    };
  });
  for (const e of out) {
    if (e.cls !== "back") continue;
    for (const f of out) {
      if (f.cls === "front" && collinearOverlap(e, f)) {
        e.cls = "front";
        break;
      }
    }
  }
  return out.map((e) => e.cls);
}

// The small x1 / x2 / x3 axis triad every 3D stage carries. The fixed
// isometric plane makes the screen directions constants: +x1 runs right and
// up, +x2 left and up, +x3 straight down (the fit flips Y). Returns, per axis,
// the arm segment from the anchor plus a label position and text anchor; the
// caller draws them, so this stays DOM-free.
export function triadArms(ax, ay, len) {
  const dx = COS30 * len;
  const dy = 0.5 * len;
  return [
    { label: "x1", x1: ax, y1: ay, x2: ax + dx, y2: ay - dy, lx: ax + dx + 4, ly: ay - dy + 3.5, anchor: "start" },
    { label: "x2", x1: ax, y1: ay, x2: ax - dx, y2: ay - dy, lx: ax - dx - 4, ly: ay - dy + 3.5, anchor: "end" },
    { label: "x3", x1: ax, y1: ay, x2: ax, y2: ay + len, lx: ax, ly: ay + len + 11, anchor: "middle" },
  ];
}

// Index of the vertex that matches target within eps on every coordinate, else
// -1. Used to line a walk of exact vertices up against a geometry vertex list.
export function findVertexIndex(vertices, target, eps = 1e-6) {
  for (let k = 0; k < vertices.length; k++) {
    const v = vertices[k];
    if (v.length !== target.length) continue;
    let ok = true;
    for (let d = 0; d < v.length; d++) {
      if (Math.abs(v[d] - target[d]) > eps) {
        ok = false;
        break;
      }
    }
    if (ok) return k;
  }
  return -1;
}

// The geometry-vertex index each walk step lands on, in step order.
export function walkIndices(geometry, steps) {
  return steps.map((s) => findVertexIndex(geometry.vertices, s.vertex));
}

// Consecutive index pairs of the walk. Each pair is a hop the walk traverses and
// (for a real corner walk) is present in geometry.edges; callers verify that.
export function walkEdges(geometry, steps) {
  const idx = walkIndices(geometry, steps);
  const pairs = [];
  for (let k = 0; k < idx.length - 1; k++) {
    pairs.push([idx[k], idx[k + 1]]);
  }
  return pairs;
}
