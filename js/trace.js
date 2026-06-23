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
