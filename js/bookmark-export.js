"use strict";
// Bookmark export: rasterize the composition, group by (color, depth), extrude
// via geometry.js into a multicolor .3mf. Reuses image-ops.js + geometry.js.

const __ALPHA_CUTOFF = 128;

// Render one element into an offscreen ImageData of size cols×rows. Returns
// { mask:Uint8Array, r,g,b:Uint8ClampedArray } — mask=1 where the element is
// opaque. For reduce-mode images r/g/b vary per pixel; otherwise they are the
// element's flat color where mask=1.
function __renderElement(el, doc, cols, rows) {
  const sx = cols / doc.widthMm, sy = rows / doc.heightMm;
  const cv = document.createElement("canvas"); cv.width = cols; cv.height = rows;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const w = el.wMm * sx, h = el.hMm * sy;
  ctx.save();
  ctx.translate(el.cxMm * sx, el.cyMm * sy);
  ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
  if (el.type === "text") {
    ctx.fillStyle = el.color;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // Fit font size to the box height; the editor sets hMm to the cap height.
    ctx.font = `${el.fontWeight} ${Math.max(1, Math.round(h))}px ${el.fontFamily}`;
    ctx.fillText(el.text, 0, 0);
  } else if (el._img) {
    ctx.drawImage(el._img, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
  const img = ctx.getImageData(0, 0, cols, rows);
  const d = img.data, n = cols * rows;
  const mask = new Uint8Array(n);
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);

  if (el.type === "image" && el.colorMode === "reduce" && el._img) {
    // Extract a canonical palette from the source image (resolution-independent),
    // then map each grid pixel to the nearest palette color. This keeps the
    // preview and every export resolution in agreement. remap recolors/merges
    // colors (extracted hex -> chosen hex).
    const pal = __imagePaletteFromImg(el._img, el.reduce.method, el.reduce.numColors, el.reduce.levels);
    const remap = (el.reduce && el.reduce.remap) || {};
    for (let i = 0; i < n; i++) {
      if (d[i * 4 + 3] < __ALPHA_CUTOFF) continue;
      const near = __nearestColor(pal, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      let cr = near[0], cg = near[1], cb = near[2];
      const m = remap[__hex(cr, cg, cb)];
      if (m) { const c = hexToRgb(m); cr = c[0]; cg = c[1]; cb = c[2]; }
      mask[i] = 1; r[i] = cr; g[i] = cg; b[i] = cb;
    }
    return { mask, r, g, b };
  }

  // Solid: silhouette from alpha; for images also apply luminance threshold.
  const col = hexToRgb(el.color);
  for (let i = 0; i < n; i++) {
    let on = d[i * 4 + 3] >= __ALPHA_CUTOFF;
    if (on && el.type === "image") {
      const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      on = el.invert ? lum >= el.threshold : lum < el.threshold;
    }
    if (on) { mask[i] = 1; r[i] = col[0]; g[i] = col[1]; b[i] = col[2]; }
  }
  return { mask, r, g, b };
}

// Composite all elements (last = on top) into per-pixel front color/depth/flags.
function composeDesign(doc, cols, rows) {
  const n = cols * rows;
  const base = hexToRgb(doc.baseColor);
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
  const depthMm = new Float32Array(n), cutout = new Uint8Array(n), isBase = new Uint8Array(n);
  const owner = new Int32Array(n).fill(-1); // index of the element owning each pixel (-1 = base)
  for (let i = 0; i < n; i++) { r[i] = base[0]; g[i] = base[1]; b[i] = base[2]; depthMm[i] = doc.thicknessMm; isBase[i] = 1; }
  doc.elements.forEach((el, ei) => {
    if (el.type === "image" && !el._img) return;
    const layer = __renderElement(el, doc, cols, rows);
    const d = (el.depthLayers || 0) * doc.layerHeightMm;
    for (let i = 0; i < n; i++) {
      if (!layer.mask[i]) continue;
      r[i] = layer.r[i]; g[i] = layer.g[i]; b[i] = layer.b[i];
      depthMm[i] = d; cutout[i] = el.cutout ? 1 : 0; isBase[i] = 0; owner[i] = ei;
    }
  });
  return { r, g, b, depthMm, cutout, isBase, owner };
}

window.composeDesign = composeDesign;

// Aspect-correct grid: longest side = resolution.
function __gridFor(doc) {
  const res = Math.max(8, Math.round(doc.resolution));
  if (doc.widthMm >= doc.heightMm) {
    const cols = res; return { cols, rows: Math.max(2, Math.round(res * doc.heightMm / doc.widthMm)) };
  }
  const rows = res; return { rows, cols: Math.max(2, Math.round(res * doc.widthMm / doc.heightMm)) };
}

function __hex(r, g, b) {
  const h = x => x.toString(16).padStart(2, "0");
  return ("#" + h(r) + h(g) + h(b)).toUpperCase();
}

// Median cut that splits until EXACTLY k boxes (so "Anzahl Farben" = N gives N
// colors, not just powers of two). Repeatedly splits the box with the widest
// channel range at its median. Returns up to k average colors as [r,g,b].
function __paletteMedianCutK(pts, k) {
  k = Math.max(1, Math.round(k));
  if (!pts.length) return [];
  const mkBox = (arr) => {
    let rmin=255,rmax=0,gmin=255,gmax=0,bmin=255,bmax=0;
    for (const p of arr) {
      if (p[0]<rmin) rmin=p[0]; if (p[0]>rmax) rmax=p[0];
      if (p[1]<gmin) gmin=p[1]; if (p[1]>gmax) gmax=p[1];
      if (p[2]<bmin) bmin=p[2]; if (p[2]>bmax) bmax=p[2];
    }
    return { arr, r: rmax-rmin, g: gmax-gmin, b: bmax-bmin };
  };
  let boxes = [mkBox(pts)];
  while (boxes.length < k) {
    let bi = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i]; if (bx.arr.length < 2) continue;
      const rng = Math.max(bx.r, bx.g, bx.b); if (rng > best) { best = rng; bi = i; }
    }
    if (bi < 0) break;                 // nothing left to split
    const bx = boxes[bi];
    const ch = (bx.r >= bx.g && bx.r >= bx.b) ? 0 : (bx.g >= bx.b ? 1 : 2);
    bx.arr.sort((p, q) => p[ch] - q[ch]);
    const mid = bx.arr.length >> 1;
    boxes.splice(bi, 1, mkBox(bx.arr.slice(0, mid)), mkBox(bx.arr.slice(mid)));
  }
  return boxes.map(bx => {
    let r=0,g=0,b=0; for (const p of bx.arr) { r+=p[0]; g+=p[1]; b+=p[2]; }
    const m = bx.arr.length; return [Math.round(r/m), Math.round(g/m), Math.round(b/m)];
  });
}

// Canonical palette for a reduce-mode image: extract colors from the source image
// at a capped natural resolution (resolution-INDEPENDENT) so the editor preview
// and every export resolution share one palette. Cached per image+params.
// Returns an array of [r,g,b].
const __palCache = new WeakMap();
function __imagePaletteFromImg(imgEl, method, numColors, levels) {
  const pkey = method + "|" + numColors + "|" + levels;
  let cache = __palCache.get(imgEl);
  if (cache && cache.has(pkey)) return cache.get(pkey);
  const iw = imgEl.naturalWidth || imgEl.width, ih = imgEl.naturalHeight || imgEl.height;
  const scale = Math.min(1, 256 / Math.max(iw, ih, 1));
  const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale)), n = w * h;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(imgEl, 0, 0, w, h);
  const img = cx.getImageData(0, 0, w, h), d = img.data;
  const idxs = []; for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= __ALPHA_CUTOFF) idxs.push(i);
  let pal;
  if (method === "palette") {
    const pts = []; for (let k = 0; k < idxs.length; k++) { const p = idxs[k] * 4; pts.push([d[p], d[p+1], d[p+2]]); }
    pal = __paletteMedianCutK(pts, numColors);
  } else {
    const strip = new ImageData(Math.max(1, idxs.length), 1);
    for (let k = 0; k < idxs.length; k++) { const p = idxs[k] * 4; strip.data[k*4]=d[p]; strip.data[k*4+1]=d[p+1]; strip.data[k*4+2]=d[p+2]; strip.data[k*4+3]=255; }
    posterize(strip, levels);
    const seen = new Set(); pal = [];
    for (let k = 0; k < idxs.length; k++) {
      const r = strip.data[k*4], g = strip.data[k*4+1], b = strip.data[k*4+2], hex = __hex(r, g, b);
      if (!seen.has(hex)) { seen.add(hex); pal.push([r, g, b]); }
    }
  }
  if (!cache) { cache = new Map(); __palCache.set(imgEl, cache); }
  cache.set(pkey, pal);
  return pal;
}
// Nearest palette color (squared RGB distance).
function __nearestColor(pal, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const dr = pal[i][0]-r, dg = pal[i][1]-g, db = pal[i][2]-b, dd = dr*dr + dg*dg + db*db;
    if (dd < bd) { bd = dd; best = i; }
  }
  return pal[best] || [r, g, b];
}
window.__imagePaletteFromImg = __imagePaletteFromImg;
window.__nearestColor = __nearestColor;

// A reduce-image element's natural (pre-remap) palette in the user's preferred
// order: el.reduce.order first (for colors still present), then any new colors
// appended. Returns uppercase hex strings. Used for both the swatch UI order and
// the export height stack so they agree.
function __orderedNaturalHexes(el) {
  if (!(el.type === "image" && el.colorMode === "reduce" && el._img)) return [];
  const pal = __imagePaletteFromImg(el._img, el.reduce.method, el.reduce.numColors, el.reduce.levels)
    .map(c => __hex(c[0], c[1], c[2]));
  const ord = (el.reduce && el.reduce.order) || [];
  const out = [];
  for (const h of ord) { const H = String(h).toUpperCase(); if (pal.indexOf(H) !== -1 && out.indexOf(H) === -1) out.push(H); }
  for (const h of pal) if (out.indexOf(h) === -1) out.push(h);
  return out;
}
window.__orderedNaturalHexes = __orderedNaturalHexes;

// Build a binary signed field (>0 inside) from a membership predicate, then
// intersect (min) with the body/hole field so every part shares one outline.
function __maskField(member, footprint, cols) {
  return (c, r) => Math.min(member(c, r) ? 1 : -1, footprint(c, r));
}

// Build a binary mask (member AND inside the body/hole footprint), trace it with
// potrace into smooth loops, map to mm (y-flipped to match the extrude
// convention), normalize orientation (largest loop = outer/CCW), and extrude
// from z0 by thickness. Replaces marching-squares for crisp, resolution-light
// vector edges.
function __tracedFacets(member, footprint, cols, rows, pitch, thickness, z0) {
  // Region = member AND inside the body/hole footprint. Shared tracer does the
  // rest (clean loops, orient, jitter, extrude).
  return window.traceMaskToFacets((c, r) => member(c, r) && footprint(c, r) > 0,
    cols, rows, pitch, thickness, z0);
}

function buildBookmarkParts(doc) {
  const { cols, rows } = __gridFor(doc);
  const comp = composeDesign(doc, cols, rows);
  const footprint = roundedRectHoleField(cols, rows, doc);
  const pitch = doc.widthMm / cols;
  const smoothTol = (doc.smooth || 0) * pitch;
  const T = doc.thicknessMm;
  const baseHex = doc.baseColor.toUpperCase();
  const idx = (c, r) => r * cols + c;
  const colorParts = [], baseParts = []; // each extruded solid is its own object

  // Engraved model: a solid base plate at full thickness; each element is carved
  // INTO the front face by a recess, with a thin colored floor at the bottom of
  // the recess and base beneath it. The surrounding base stands proud, so
  // elements read as debossed. Cutout elements are cut all the way through (a
  // hole in the element's shape). Each COLOR sits at its own height: a color's
  // recess depth = (its rank in the layer order) x the color step, so reordering
  // the Ebenen list restacks the colors. Front-most color = shallowest.
  const floor = Math.min(2 * doc.layerHeightMm, T); // colored-floor thickness (mm)
  // Always keep a solid base under every colored floor so engravings never reach
  // the bottom/base layer (clamp recess to leave >= minBase beneath the floor).
  const minBase = Math.min(Math.max(0.8, T * 0.34, 2 * doc.layerHeightMm), Math.max(0, T - floor));
  const maxRecess = Math.max(0, T - floor - minBase);
  const recessOf = (d) => Math.max(0, Math.min(d, maxRecess));
  const baseUnder = (d) => T - recessOf(d) - floor;            // base height beneath floor (>= minBase)

  // Per-color recess depth from rank in the global color order. Colors are
  // ordered element-by-element front -> back; within a reduce-image element the
  // order follows the user's palette order (el.reduce.order, set by dragging
  // swatches). depth = rank x step.
  const step = Math.max(1, doc.colorStepLayers || 2) * doc.layerHeightMm;
  const ownerEff = new Map(); // ownerIdx -> Set(effective hex actually present)
  for (let i = 0; i < cols * rows; i++) {
    if (comp.isBase[i] || comp.cutout[i] || comp.owner[i] < 0) continue;
    const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
    let s = ownerEff.get(comp.owner[i]); if (!s) ownerEff.set(comp.owner[i], s = new Set());
    s.add(hex);
  }
  const orderedColors = [];
  const pushC = (h) => { if (orderedColors.indexOf(h) === -1) orderedColors.push(h); };
  for (let ei = doc.elements.length - 1; ei >= 0; ei--) {   // front -> back
    const present = ownerEff.get(ei); if (!present) continue;
    const el = doc.elements[ei];
    const seq = [];
    if (el.type === "text" || (el.type === "image" && el.colorMode === "solid")) {
      const c = hexToRgb(el.color); seq.push(__hex(c[0], c[1], c[2]));
    } else if (el.type === "image" && el.colorMode === "reduce") {
      const remap = (el.reduce && el.reduce.remap) || {};
      for (const nat of __orderedNaturalHexes(el)) { const c = hexToRgb(remap[nat] || nat); seq.push(__hex(c[0], c[1], c[2])); }
    }
    for (const h of seq) if (present.has(h)) pushC(h);
    for (const h of present) pushC(h);   // any present-but-unsequenced color
  }
  const depthByHex = new Map();
  orderedColors.forEach((hex, rank) => depthByHex.set(hex, (rank + 1) * step));
  const depthFor = (hex) => depthByHex.get(hex) || step;

  // 1) Colored recess floors, one group per color (its depth set by rank). Skip
  //    background and cutout (cutout = hole, no color).
  const groups = new Map(); // hex -> {hex, set:Uint8Array}
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(c, r);
    if (comp.isBase[i] || comp.cutout[i]) continue;
    const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
    let grp = groups.get(hex);
    if (!grp) { grp = { hex, set: new Uint8Array(cols * rows) }; groups.set(hex, grp); }
    grp.set[i] = 1;
  }
  let __cn = 0;
  for (const grp of groups.values()) {
    const z0 = baseUnder(depthFor(grp.hex));  // floor sits on top of the base block
    const facets = orientOutward(__tracedFacets((c, r) => grp.set[idx(c, r)] === 1, footprint, cols, rows, pitch, floor, z0));
    if (facets.length) colorParts.push({ name: "farbe-" + (++__cn), color: hexToRgb(grp.hex), facets });
  }

  // 2) Base. One CONTINUOUS bottom slab covers the whole footprint (minus cutout
  //    holes) from z=0 to minBase — this is the only base solid that reaches the
  //    bottom, so separately-traced regions can never leave a gap that cuts
  //    THROUGH the base along an element outline. The background and the blocks
  //    under each color are risers that sit on top of that slab.
  const baseAdd = (member, thickness, z0) => {
    const facets = orientOutward(__tracedFacets(member, footprint, cols, rows, pitch, thickness, z0));
    if (facets.length) baseParts.push({ name: "grundplatte", color: hexToRgb(baseHex), facets });
  };
  // continuous bottom slab (everything except cutout through-holes)
  baseAdd((c, r) => comp.cutout[idx(c, r)] !== 1, minBase, 0);
  // background riser: stands full height above the slab
  baseAdd((c, r) => comp.isBase[idx(c, r)] === 1, T - minBase, minBase);
  // under-color risers up to each colored floor, grouped by height (above slab)
  const behind = new Map(); // heightMm -> Uint8Array
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(c, r);
    if (comp.cutout[i] || comp.isBase[i]) continue;
    const h = baseUnder(depthFor(__hex(comp.r[i], comp.g[i], comp.b[i])));
    if (h - minBase <= 1e-6) continue;        // bottom slab already reaches the floor
    const key = h.toFixed(4);
    let set = behind.get(key); if (!set) behind.set(key, set = { h, m: new Uint8Array(cols * rows) });
    set.m[i] = 1;
  }
  for (const set of behind.values()) baseAdd((c, r) => set.m[idx(c, r)] === 1, set.h - minBase, minBase);

  // Each extruded solid is its own object: slicers handle multiple touching
  // bodies fine, whereas merging them into one mesh makes it non-manifold
  // ("no mesh"). Base bodies first.
  return [...baseParts, ...colorParts];
}

function exportBookmark3MF(doc) {
  const parts = buildBookmarkParts(doc);
  const blob = build3MF(parts);
  const a = document.createElement("a");
  a.download = "lesezeichen.3mf";
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
  return { parts, blob };
}

window.buildBookmarkParts = buildBookmarkParts;
window.exportBookmark3MF = exportBookmark3MF;
