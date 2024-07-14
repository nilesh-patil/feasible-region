// Feasible Region . poly3d.js . exact three variable polytope enumeration
//
// Pure, no DOM, no d3. The S3 what-if figure calls enumerateVertices to rebuild
// the cargo polytope when the reader perturbs a right-hand side. At n=3 the
// corners of { x >= 0 : A x <= b } are exactly the feasible triple-plane
// intersections, so brute force is EXACT. Each constraint is
// a1*x1+a2*x2+a3*x3 <= rhs (le only); x1,x2,x3 >= 0 enters as the three axis
// planes. Re-enumerating at topic21's rhs reproduces its 12 vertices / 18 edges.

const EPS = 1e-9;
const DEDUP = 1e-6;
const TIGHT = 1e-6;
// Axis-plane normals x1 = 0, x2 = 0, x3 = 0.
const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

// Solve the 3x3 system rows[i] = [a, b, c | d] (Gaussian elimination, partial
// pivot). Returns [x1, x2, x3], or null when the triple is parallel (skipped).
function solve3(rows) {
  const m = [rows[0].slice(), rows[1].slice(), rows[2].slice()];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < EPS) return null;
    const t = m[col];
    m[col] = m[piv];
    m[piv] = t;
    const d = m[col][col];
    for (let c = col; c < 4; c++) m[col][c] /= d;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

function cross(u, v) {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

// Snap a near-integer coordinate to the integer, so integer data reports 9, not
// 8.99999999 (output snapping); perturbed non-integer corners untouched.
function snap(x) {
  const r = Math.round(x);
  return Math.abs(x - r) < 1e-7 ? r + 0 : x;
}

// Enumerate the corners and edges of { x >= 0 : A x <= b } at n = 3. `constraints`
// is [{ coeffs: [a, b, c], rhs }] (op assumed le). Returns { vertices, edges,
// bounded }. A corner is a feasible triple-plane intersection; an edge joins two
// corners tight on >= 2 common planes (they share the meeting line).
export function enumerateVertices(constraints, opts) {
  const eps = (opts && opts.eps) || EPS;

  // Bounding planes [a, b, c, d], half-space a . x <= d: constraints then axes.
  const planes = constraints.map((k) => [k.coeffs[0], k.coeffs[1], k.coeffs[2], k.rhs]);
  const axisPlanes = AXES.map((n) => [n[0], n[1], n[2], 0]);
  const all = planes.concat(axisPlanes);
  const P = all.length;

  const feasible = (p) => {
    for (let i = 0; i < constraints.length; i++) {
      const k = constraints[i].coeffs;
      if (k[0] * p[0] + k[1] * p[1] + k[2] * p[2] > constraints[i].rhs + eps) return false;
    }
    return p[0] >= -eps && p[1] >= -eps && p[2] >= -eps;
  };

  // Indices of every plane the point sits on (within TIGHT), used for adjacency.
  const tightOf = (p) => {
    const t = [];
    for (let i = 0; i < P; i++) {
      const pl = all[i];
      if (Math.abs(pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] - pl[3]) < TIGHT) t.push(i);
    }
    return t;
  };

  const vertices = [];
  const tights = [];
  for (let i = 0; i < P; i++) {
    for (let j = i + 1; j < P; j++) {
      for (let k = j + 1; k < P; k++) {
        const raw = solve3([all[i], all[j], all[k]]);
        if (!raw) continue;
        if (!feasible(raw)) continue;
        let dup = false;
        for (let v = 0; v < vertices.length; v++) {
          const q = vertices[v];
          if (
            Math.abs(q[0] - raw[0]) < DEDUP &&
            Math.abs(q[1] - raw[1]) < DEDUP &&
            Math.abs(q[2] - raw[2]) < DEDUP
          ) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
        const p = [snap(raw[0]), snap(raw[1]), snap(raw[2])];
        vertices.push(p);
        tights.push(tightOf(p));
      }
    }
  }

  // Adjacency: corners tight on >= 2 common planes share an edge (reproduces
  // topic21's 18 edges).
  const edges = [];
  for (let a = 0; a < vertices.length; a++) {
    for (let b = a + 1; b < vertices.length; b++) {
      let common = 0;
      const ta = tights[a];
      const tb = tights[b];
      for (let x = 0; x < ta.length; x++) if (tb.indexOf(ta[x]) !== -1) common++;
      if (common >= 2) edges.push([a, b]);
    }
  }

  return { vertices, edges, bounded: isBounded(constraints, eps) };
}

// Bounded iff the recession cone { d >= 0 : A d <= 0 } is just the origin. Its
// extreme rays lie where two homogeneous bounding planes meet, so at n = 3 we
// enumerate plane pairs and test both signs of the cross-product direction: any
// surviving nonzero ray means the region runs off to infinity along it.
function isBounded(constraints, eps) {
  const normals = constraints
    .map((k) => [k.coeffs[0], k.coeffs[1], k.coeffs[2]])
    .concat(AXES.map((a) => a.slice()));
  const okRay = (d) => {
    if (Math.abs(d[0]) < eps && Math.abs(d[1]) < eps && Math.abs(d[2]) < eps) return false;
    if (d[0] < -eps || d[1] < -eps || d[2] < -eps) return false; // d >= 0
    for (let i = 0; i < constraints.length; i++) {
      const k = constraints[i].coeffs;
      if (k[0] * d[0] + k[1] * d[1] + k[2] * d[2] > eps) return false; // A d <= 0
    }
    return true;
  };
  for (let i = 0; i < normals.length; i++) {
    for (let j = i + 1; j < normals.length; j++) {
      const d = cross(normals[i], normals[j]);
      if (okRay(d) || okRay([-d[0], -d[1], -d[2]])) return false;
    }
  }
  return true;
}
