"use strict";
// Zierkante für Formen: the plate's edge styles (wave/teeth/perforation) on
// rect/circle SHAPE ELEMENTS. Pure polygon builder in element-local mm
// (origin = element center) plus one canvas draw helper shared by the 2D
// workbench and the 3D rasterizer, so preview and print stay identical.
// Circle elements are ellipses when wMm != hMm — sampled parametrically.

// Uniform perimeter sampler: returns { length, at(s)->{x,y,nx,ny} } in local
// centered mm, or null for unsupported/degenerate shapes.
function __shapePerimeter(el) {
  const W = el.wMm, H = el.hMm;
  if (!(W > 0) || !(H > 0)) return null;
  if (el.shape === "circle") {
    const a = W / 2, b = H / 2, N = 512;
    const pts = [], cum = [0];
    for (let i = 0; i <= N; i++) {
      const th = -Math.PI / 2 + (i / N) * 2 * Math.PI; // start at top
      const x = a * Math.cos(th), y = b * Math.sin(th);
      // outward ellipse normal: gradient of (x/a)^2+(y/b)^2
      const nx = b * Math.cos(th), ny = a * Math.sin(th);
      const nl = Math.hypot(nx, ny) || 1;
      pts.push({ x, y, nx: nx / nl, ny: ny / nl });
      if (i > 0) cum.push(cum[i - 1] + Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y));
    }
    const L = cum[N];
    if (!(L > 0)) return null;
    return {
      length: L,
      at(s) {
        s = ((s % L) + L) % L;
        let lo = 0, hi = N;
        while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
        const f = (s - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
        const p0 = pts[lo], p1 = pts[lo + 1];
        const nx = p0.nx + (p1.nx - p0.nx) * f, ny = p0.ny + (p1.ny - p0.ny) * f;
        const nl = Math.hypot(nx, ny) || 1;
        return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, nx: nx / nl, ny: ny / nl };
      },
    };
  }
  // rect: reuse the plate perimeter (sharp corners — element rects have no radius)
  if (el.shape !== "rect" && el.shape != null) return null;
  const per = window.platePerimeterMm({ shape: "rect", widthMm: W, heightMm: H, cornerRadiusMm: 0 });
  if (!per) return null;
  return {
    length: per.length,
    at(s) {
      const q = per.point(s);
      return { x: q.x - W / 2, y: q.y - H / 2, nx: q.nx, ny: q.ny };
    },
  };
}

// Decorated outline polygon(s) for a shape element, or null when the edge is
// off/invalid/too small to decorate. { outline:[{x,y}…] (local mm),
// holes:[{x,y,r}]|null } — holes only for the perforation style.
function buildShapeEdgePolys(el) {
  const e = el && el.edge;
  if (!e || !e.style || e.style === "none") return null;
  if (!(e.sizeMm > 0) || !(e.periodMm > 0)) return null;
  if (el.type !== "shape") return null;
  if (!(Math.min(el.wMm, el.hMm) > e.sizeMm * 2.5)) return null; // keep a core
  const per = __shapePerimeter(el);
  if (!per) return null;
  const L = per.length;
  const n = Math.max(3, Math.round(L / e.periodMm)), p = L / n;
  if (e.style === "perforation") {
    const step = Math.min(1, L / 96);
    const outline = [];
    for (let s = 0; s < L; s += step) { const q = per.at(s); outline.push({ x: q.x, y: q.y }); }
    const holes = [];
    const r = e.sizeMm / 2;
    for (let k = 0; k < n; k++) { const c = per.at(k * p); holes.push({ x: c.x, y: c.y, r }); }
    return { outline, holes };
  }
  const depth = e.style === "teeth"
    ? function (t) { const f = t / p - Math.floor(t / p); return e.sizeMm * (1 - Math.abs(2 * f - 1)); }
    : function (t) { return e.sizeMm * 0.5 * (1 + Math.cos(2 * Math.PI * t / p)); };
  const step2 = Math.min(p / 8, 1);
  const outline = [];
  for (let s = 0; s < L; s += step2) {
    const q = per.at(s);
    const d = depth(s);
    outline.push({ x: q.x - q.nx * d, y: q.y - q.ny * d });
  }
  return { outline, holes: null };
}

// Draw a decorated shape element into ctx (already transformed to the element
// center; wPx/hPx = element size in canvas px; fillStyle set by the caller).
// Returns false when the edge doesn't apply — caller falls back to the plain
// rect/ellipse fill.
function drawShapeEdge(ctx, el, wPx, hPx) {
  const polys = buildShapeEdgePolys(el);
  if (!polys) return false;
  const kx = wPx / el.wMm, ky = hPx / el.hMm;
  const trace = function () {
    ctx.beginPath();
    for (let i = 0; i < polys.outline.length; i++) {
      const q = polys.outline[i];
      if (i) ctx.lineTo(q.x * kx, q.y * ky); else ctx.moveTo(q.x * kx, q.y * ky);
    }
    ctx.closePath();
  };
  if (!polys.holes) { trace(); ctx.fill(); return true; }
  // Perforation: fill the outline while clipped to "everything except the
  // holes" — a plain evenodd fill would also paint the outer half of each
  // hole circle (outside the outline, winding count 1).
  ctx.save();
  const kr = (Math.abs(kx) + Math.abs(ky)) / 2;
  const rx = Math.abs(wPx) / 2 + polys.holes[0].r * kr + 2;
  const ry = Math.abs(hPx) / 2 + polys.holes[0].r * kr + 2;
  ctx.beginPath();
  ctx.rect(-rx, -ry, 2 * rx, 2 * ry);
  for (const h of polys.holes) {
    const X = h.x * kx, Y = h.y * ky, R = h.r * kr;
    ctx.moveTo(X + R, Y);
    ctx.arc(X, Y, R, 0, Math.PI * 2);
  }
  ctx.clip("evenodd");
  trace();
  ctx.fill();
  ctx.restore();
  return true;
}

window.buildShapeEdgePolys = buildShapeEdgePolys;
window.drawShapeEdge = drawShapeEdge;
