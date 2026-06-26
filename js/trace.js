"use strict";
// License-clean adapter around the vendored potrace (js/vendor/potrace.js):
// trace a binary mask into smooth, closed polygon loops ready for extrusion.

// Flatten one potrace curve (cubic Béziers for CURVE tags, two segments for
// CORNER tags) into a polyline [[x,y]...] in the bitmap's coordinate space.
function __ptFlattenCurve(curve, steps) {
  const n = curve.n, pts = [];
  let prev = curve.c[(n - 1) * 3 + 2];
  for (let i = 0; i < n; i++) {
    const c0 = curve.c[i * 3 + 0], c1 = curve.c[i * 3 + 1], c2 = curve.c[i * 3 + 2];
    if (curve.tag[i] === "CURVE") {
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, mt = 1 - t;
        const a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
        pts.push([a * prev.x + b * c0.x + cc * c1.x + d * c2.x,
                  a * prev.y + b * c0.y + cc * c1.y + d * c2.y]);
      }
    } else { // CORNER
      pts.push([c1.x, c1.y], [c2.x, c2.y]);
    }
    prev = c2;
  }
  return pts;
}

// Trace a binary mask (Uint8/Int8Array, 1 = foreground) of size w×h into closed
// loops [[x,y]...] in grid coordinates (y-down), with Bézier curves flattened.
// opts: turdsize (drop specks ≤ N px), alphamax/opttolerance (smoothing),
// steps (samples per Bézier).
function traceMaskLoops(data, w, h, opts) {
  opts = opts || {};
  const curves = window.Potrace.traceData(data, w, h, {
    turnpolicy: "minority",
    turdsize: opts.turdsize == null ? 2 : opts.turdsize,
    optcurve: true,
    alphamax: opts.alphamax == null ? 1 : opts.alphamax,
    opttolerance: opts.opttolerance == null ? 0.2 : opts.opttolerance,
  });
  const steps = opts.steps || 8;
  const loops = [];
  for (const c of curves) { const l = __ptFlattenCurve(c, steps); if (l.length >= 3) loops.push(l); }
  return loops;
}

window.traceMaskLoops = traceMaskLoops;

// Rasterize a region (inside(c,r) -> truthy) on a cols×rows grid, trace it with
// potrace into smooth loops, clean them (drop coincident + collinear points so
// the extrude has no zero-area walls/caps), map to mm (y-flipped to match the
// extrude convention), normalize orientation (largest loop = outer/CCW), apply a
// sub-micron jitter to dodge earcut coincidence failures, and extrude from z0 by
// thickness. Shared by the bookmark and relief exporters.
function traceMaskToFacets(inside, cols, rows, pitch, thickness, z0) {
  if (thickness <= 0) return [];
  const data = new Uint8Array(cols * rows);
  let any = false;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (inside(c, r)) { data[r * cols + c] = 1; any = true; }
  }
  if (!any) return [];
  const EPS = 1e-4, AREA_EPS = 1e-4;
  const clean = (l) => {
    let p = [];
    for (const q of l) { const last = p[p.length - 1]; if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > EPS) p.push(q); }
    while (p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) <= EPS) p.pop();
    if (p.length < 3) return p;
    const n = p.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) > AREA_EPS) out.push(b);
    }
    return out.length >= 3 ? out : p;
  };
  let loops = traceMaskLoops(data, cols, rows, {})
    .map(l => l.map(([x, y]) => [x * pitch, (rows - y) * pitch]))
    .map(clean)
    .filter(l => l.length >= 3);
  if (!loops.length) return [];
  let maxA = 0; for (const l of loops) { const a = window.polyArea(l); if (Math.abs(a) > Math.abs(maxA)) maxA = a; }
  if (maxA < 0) loops = loops.map(l => l.slice().reverse());
  loops = loops.map((l, li) => l.map((p, pi) => [
    p[0] + (((li * 131 + pi * 31) % 13) - 6) * 1e-5,
    p[1] + (((li * 71 + pi * 17) % 13) - 6) * 1e-5,
  ]));
  return window.extrudeLoops(loops, thickness, z0);
}
window.traceMaskToFacets = traceMaskToFacets;
