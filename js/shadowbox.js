// Schaukasten engine: shared tunnel-opening field, plate color ramp, preview
// loops, and the printed stand. Pure module — no DOM, no editor state.
(function () {
  "use strict";

  const RING_MIN_MM = 2; // every opening keeps at least this ring to the plate edge

  function __sbClampLayers(n) {
    return Math.max(3, Math.min(10, Math.round(n || 6)));
  }

  // mulberry32 (same generator family as scatter.js makeRng) — deterministic wobble.
  function __rng(seed) {
    let a = (seed | 0) + 0x6d2b79f5;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function __hexRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  // Front->back per-plate colors: linear lerp between colorFront and colorBack.
  function shadowboxPlateColors(sb) {
    const n = __sbClampLayers(sb.layers);
    const a = __hexRgb(sb.colorFront || "#DDEEFA"), b = __hexRgb(sb.colorBack || "#1B5E9E");
    const out = [];
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const c = [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
      out.push("#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase());
    }
    return out;
  }

  // Seeded wobble profile along the plate perimeter. Two sinusoids whose repeat
  // counts snap to integers (Zierkante convention) so the profile closes
  // seamlessly at t=0/t=L. Returns (t)->mm, amplitude-bounded by ampMm.
  function __wobble(L, periodMm, waviness, seed, ampMm) {
    if (!(waviness > 0) || !(ampMm > 0)) return () => 0;
    const n1 = Math.max(3, Math.round(L / Math.max(4, periodMm || 40)));
    const n2 = n1 * 2 + 1;
    const rnd = __rng(seed || 1);
    const p1 = rnd() * 2 * Math.PI, p2 = rnd() * 2 * Math.PI;
    const a = ampMm * Math.max(0, Math.min(1, waviness));
    return (t) => a * (0.62 * Math.sin((2 * Math.PI * n1 * t) / L + p1)
                     + 0.38 * Math.sin((2 * Math.PI * n2 * t) / L + p2));
  }

  // Even-odd scanline polygon fill onto a raster grid (pure math, no canvas).
  // points: [{xMm,yMm}] closed implicitly; sx/sy = cells per mm.
  function __sbPolygonMask(points, cols, rows, sx, sy) {
    const mask = new Uint8Array(cols * rows);
    const n = points.length;
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) / sy;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const a = points[i], b = points[(i + 1) % n];
        if ((a.yMm <= y) !== (b.yMm <= y)) {
          xs.push(a.xMm + ((y - a.yMm) / (b.yMm - a.yMm)) * (b.xMm - a.xMm));
        }
      }
      xs.sort((p, q) => p - q);
      for (let j = 0; j + 1 < xs.length; j += 2) {
        const c0 = Math.max(0, Math.ceil(xs[j] * sx - 0.5));
        const c1 = Math.min(cols - 1, Math.floor(xs[j + 1] * sx - 0.5));
        for (let c = c0; c <= c1; c++) mask[r * cols + c] = 1;
      }
    }
    return mask;
  }

  function __polyAreaMm(points) {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      a += p.xMm * q.yMm - q.xMm * p.yMm;
    }
    return Math.abs(a) / 2;
  }

  // Signed opening field in mm, >0 inside the FRONT (largest) opening. Plate k's
  // opening is {f > k*insetPerLayerMm}; nested by construction. Clamped by
  // min(f, plateSdf - RING_MIN_MM) so no opening ever thins the surrounding
  // ring below RING_MIN_MM. Cell mapping matches shapeFootprintField's default
  // rectangular mapping (x=(c+0.5)/(cols/W)) — shadowbox never expands the domain.
  // Returns null when the body has no analytic perimeter (free/image shapes).
  function shadowboxOpeningField(doc, grid) {
    const body = doc.body;
    if (body.shape !== "rect" && body.shape !== "circle") return null;
    const sb = doc.shadowbox;
    const bare = Object.assign({}, body, { edge: null }); // undecorated plate SDF
    const rawSdf = window.bodySdfMm(bare);
    const per = window.platePerimeterMm(bare);
    if (!per) return null;
    const o = sb.opening || {};
    const marginMm = Math.max(0.5, o.marginMm != null ? o.marginMm : 12);
    const amp = Math.min(marginMm * 0.7, 8);
    const wob = __wobble(per.length, o.periodMm, o.waviness != null ? o.waviness : 0.5, o.seed, amp);
    const sx0 = grid.cols / body.widthMm, sy0 = grid.rows / body.heightMm;

    const pts = o.source === "drawn" ? o.points : null;
    if (pts && pts.length >= 3 && __polyAreaMm(pts) >= 25) {
      const { cols, rows } = grid;
      const mask = __sbPolygonMask(pts, cols, rows, sx0, sy0);
      const inv = new Uint8Array(mask.length);
      for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
      const dIn = window.__chamferDT(inv, cols, rows);   // distance to outside == inward depth
      const dOut = window.__chamferDT(mask, cols, rows); // distance to inside == outward gap
      const pitchX = 1 / sx0, pitchY = 1 / sy0, pmm = (pitchX + pitchY) / 2;
      return (c, r) => {
        const i = r * cols + c;
        const fRaw = (mask[i] ? dIn[i] : -dOut[i]) * pmm;
        const x = (c + 0.5) / sx0, y = (r + 0.5) / sy0;
        return Math.min(fRaw, rawSdf(x, y) - RING_MIN_MM);
      };
    }

    return (c, r) => {
      const x = (c + 0.5) / sx0, y = (r + 0.5) / sy0;
      const d = rawSdf(x, y);
      const fRaw = d - marginMm + wob(per.nearest(x, y));
      return Math.min(fRaw, d - RING_MIN_MM); // ring guard for every layer at once
    };
  }

  // Plate k's opening outlines in doc mm (y-down) for the 2D workbench —
  // coarse display grid (longest side 160 cells), marching-squares sub-pixel.
  function shadowboxOpeningLoops(doc, k) {
    const body = doc.body;
    const RES = 160;
    const W = body.widthMm, H = body.heightMm;
    const long = Math.max(W, H);
    const cols = Math.max(8, Math.round((W / long) * RES));
    const rows = Math.max(8, Math.round((H / long) * RES));
    const grid = { cols, rows, pitch: long / RES, x0: 0, y0: 0 };
    const f = shadowboxOpeningField(doc, grid);
    if (!f) return [];
    const inset = k * Math.max(0.5, doc.shadowbox.insetPerLayerMm || 4);
    const g = (c, r) => f(c, r) - inset;
    const sx = cols / W, sy = rows / H;
    return window.marchingSquaresLoops(g, cols, rows)
      .filter((lp) => lp.length >= 3)
      .map((lp) => lp.map(([c, r]) => ({ xMm: (c + 0.5) / sx, yMm: (r + 0.5) / sy })));
  }

  window.__sbClampLayers = __sbClampLayers;
  window.shadowboxPlateColors = shadowboxPlateColors;
  window.shadowboxOpeningField = shadowboxOpeningField;
  window.shadowboxOpeningLoops = shadowboxOpeningLoops;
  window.__sbPolygonMask = __sbPolygonMask;
})();
