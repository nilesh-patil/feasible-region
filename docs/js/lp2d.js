// ==========================================================================
// Feasible Region . lp2d.js . 2D linear-program geometry, computed client-side
//
// A tiny, dependency-free toolkit the hero figure uses to build a feasible
// polygon by half-plane intersection and to read the optimum straight off the
// corners. In two variables the optimum of a linear objective always sits at a
// vertex, so enumerating corners is exact: no solver, no trace needed.
//
// Convention: every constraint is written a*x + b*y <= c (a half-plane). A
// ">=" constraint is negated into that form by the caller. Nonnegativity is
// handled by starting from the first-quadrant plotting box, so 0 <= x <= xMax
// and 0 <= y <= yMax hold for free.
// ==========================================================================

const EPS = 1e-9;

// Clip a convex polygon (array of [x,y], counter-clockwise) to the half-plane
// a*x + b*y <= c using one pass of Sutherland-Hodgman. Returns the clipped
// polygon, possibly empty.
export function clipHalfPlane(poly, a, b, c) {
  if (poly.length === 0) return poly;
  const out = [];
  const inside = (p) => a * p[0] + b * p[1] <= c + EPS;
  // Point where segment p->q crosses the line a*x + b*y = c.
  const cross = (p, q) => {
    const dp = a * p[0] + b * p[1] - c;
    const dq = a * q[0] + b * q[1] - c;
    const t = dp / (dp - dq);
    return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
  };
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(cross(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(cross(prev, cur));
    }
  }
  return out;
}

// Drop consecutive points that coincide (clipping can emit hair-thin edges).
export function dedupe(poly, eps = 1e-6) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = out.length ? out[out.length - 1] : poly[poly.length - 1];
    if (!out.length || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  // A closing duplicate can survive the wrap-around check above.
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= eps) out.pop();
  }
  return out;
}

// Build the feasible polygon: start from the first-quadrant box [0,xMax] x
// [0,yMax] and clip it by every constraint. Returns ordered vertices (CCW).
export function feasibleRegion(constraints, xMax, yMax) {
  let poly = [
    [0, 0],
    [xMax, 0],
    [xMax, yMax],
    [0, yMax],
  ];
  for (const k of constraints) {
    poly = clipHalfPlane(poly, k.a, k.b, k.c);
    if (poly.length === 0) break;
  }
  return dedupe(poly);
}

// Evaluate cx*x + cy*y at every vertex and return the arg-max corner. Returns
// null for an empty (infeasible) polygon.
export function objectiveArgmax(poly, cx, cy) {
  if (!poly || poly.length === 0) return null;
  let best = poly[0];
  let bestVal = cx * poly[0][0] + cy * poly[0][1];
  for (let i = 1; i < poly.length; i++) {
    const v = cx * poly[i][0] + cy * poly[i][1];
    if (v > bestVal + EPS) {
      bestVal = v;
      best = poly[i];
    }
  }
  return { point: best, value: bestVal };
}

// Clip the INFINITE line a*x + b*y = c to the box [0,xMax] x [0,yMax]. Returns
// the two boundary crossings as [[x,y],[x,y]], or null if the line misses the
// box entirely. Used to draw a constraint line across the plot.
export function lineThroughBox(a, b, c, xMax, yMax) {
  const pts = [];
  const add = (x, y) => {
    if (x >= -EPS && x <= xMax + EPS && y >= -EPS && y <= yMax + EPS) {
      // Reject near-duplicate corner hits.
      if (!pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1e-6)) pts.push([x, y]);
    }
  };
  if (Math.abs(b) > EPS) {
    add(0, c / b);
    add(xMax, (c - a * xMax) / b);
  }
  if (Math.abs(a) > EPS) {
    add(c / a, 0);
    add((c - b * yMax) / a, yMax);
  }
  return pts.length >= 2 ? [pts[0], pts[1]] : null;
}

// Compact number: at most two decimals, trailing zeros trimmed. -0 -> 0.
export function fmt(n) {
  if (Math.abs(n) < 5e-4) n = 0;
  const r = Math.round(n * 100) / 100;
  return String(r);
}
