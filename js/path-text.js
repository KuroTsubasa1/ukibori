"use strict";
// Pfadtext: lay the glyphs of a single line along a freehand path. Pure layout
// math plus one canvas draw helper shared by the 2D workbench and the 3D
// rasterizer (same contract as arc-text.js), so preview and print stay
// identical. Paths are element-local; units must match the advances.

// Chaikin corner cutting: smooths a hand-drawn polyline while keeping the
// endpoints. Returns a new array; degenerate inputs pass through unchanged.
function smoothPath(points, iterations) {
  let pts = (points || []).slice();
  const iters = iterations == null ? 2 : iterations;
  for (let k = 0; k < iters; k++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

// Arc-length walker over a polyline with end extrapolation: at(s) is defined
// for s < 0 (before the start, along the first segment's direction) and
// s > length (past the end) so text longer than the path can overhang.
function __pathWalker(points) {
  const pts = (points || []).filter(function (p, i, a) {
    return i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-9;
  });
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const L = cum[cum.length - 1];
  if (!(L > 0)) return null;
  return {
    length: L,
    at(s) {
      let seg = 0;
      if (s >= L) seg = pts.length - 2;
      else if (s > 0) { while (seg < pts.length - 2 && s > cum[seg + 1]) seg++; }
      const dx = pts[seg + 1].x - pts[seg].x, dy = pts[seg + 1].y - pts[seg].y;
      const len = Math.hypot(dx, dy) || 1;
      const f = (s - cum[seg]) / len; // may be <0 / >1 at the ends → extrapolates
      return {
        x: pts[seg].x + dx * f,
        y: pts[seg].y + dy * f,
        rot: Math.atan2(dy, dx),
      };
    },
  };
}

// advances: per-glyph advance widths; path: [{x,y}] in the same units.
// Text is centered on the path (overhanging both ends when longer). Returns
// [{x, y, rot}] glyph centers, or null when the layout degenerates.
function pathTextPositions(advances, path) {
  const w = __pathWalker(path);
  const total = (advances || []).reduce(function (a, b) { return a + b; }, 0);
  if (!w || !(total > 0)) return null;
  let s = (w.length - total) / 2;
  return advances.map(function (a) {
    const q = w.at(s + a / 2);
    s += a;
    return q;
  });
}

// Draws text along a path (element-local px). Caller ctx state contract is
// the same as drawArcText: font, fillStyle, textAlign=center, baseline=middle.
function drawPathText(ctx, text, pathPx, fontPx) {
  const chars = Array.from(text);
  const advances = chars.map(function (ch) { return ctx.measureText(ch).width; });
  const glyphs = pathTextPositions(advances, pathPx);
  if (!glyphs) { ctx.fillText(text, 0, 0); return; }
  for (let i = 0; i < chars.length; i++) {
    const g = glyphs[i];
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
}

window.smoothPath = smoothPath;
window.pathTextPositions = pathTextPositions;
window.drawPathText = drawPathText;
