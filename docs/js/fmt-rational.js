// Feasible Region . fmt-rational.js . small-denominator rational display
//
// A NEW, scoped number formatter for S3 (dualview + hood) only. It snaps a float
// to the smallest denominator d <= 64 with |v*d - round(v*d)| < 1e-6, printing
// integers bare and fractions as n/d in lowest terms, so the tableau z row reads
// -1/7 and -3/7 rather than -0.14 and -0.43, and S3's z row visibly becomes S4's
// exact prices. When nothing under 64 fits (a genuine live-solve irrational) it
// falls back to the same two-decimal shape fmt() uses, so live cells stay clean
// numbers. It is deliberately separate from fmt() in lp2d.js: fmt() is shared by
// the S2 standard-form block that rebuilds per click, and a global snap there
// would silently rewrite S2's strings.

const MAX_DEN = 64;
const SNAP_TOL = 1e-6;
const ZERO_TOL = 5e-4;

export function fmtR(n) {
  if (!isFinite(n)) return String(n);
  if (Math.abs(n) < ZERO_TOL) return "0"; // also clears -0
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  for (let d = 1; d <= MAX_DEN; d++) {
    const num = Math.round(v * d);
    if (Math.abs(v * d - num) < SNAP_TOL) {
      return d === 1 ? sign + num : sign + num + "/" + d;
    }
  }
  // Decimal fallback: two decimals, trailing zeros trimmed (fmt()'s shape).
  return String(Math.round(n * 100) / 100);
}
