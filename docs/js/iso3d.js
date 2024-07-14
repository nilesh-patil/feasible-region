// Feasible Region . iso3d.js . pure isometric projection helpers
//
// Dependency-free ES module of PURE functions: no DOM, no d3, no rotation, no
// hull faces. Any 3D figure (S5's Klee-Minty cube, the race) projects through
// here so it lands with byte-identical math to the S3 tableau walk, keeping the
// site's isometric look consistent. The projection is a fixed isometric plane
// (no turntable). Every export is console unit-checkable.

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
  };
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
