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
    if (el.reduce.method === "palette") quantizeMedianCut(img, el.reduce.numColors);
    else posterize(img, el.reduce.levels);
    const q = img.data;
    for (let i = 0; i < n; i++) {
      if (d[i * 4 + 3] >= __ALPHA_CUTOFF) { mask[i] = 1; r[i] = q[i * 4]; g[i] = q[i * 4 + 1]; b[i] = q[i * 4 + 2]; }
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
  for (let i = 0; i < n; i++) { r[i] = base[0]; g[i] = base[1]; b[i] = base[2]; depthMm[i] = doc.thicknessMm; isBase[i] = 1; }
  for (const el of doc.elements) {
    if (el.type === "image" && !el._img) continue;
    const layer = __renderElement(el, doc, cols, rows);
    const d = (el.depthLayers || 0) * doc.layerHeightMm;
    for (let i = 0; i < n; i++) {
      if (!layer.mask[i]) continue;
      r[i] = layer.r[i]; g[i] = layer.g[i]; b[i] = layer.b[i];
      depthMm[i] = d; cutout[i] = el.cutout ? 1 : 0; isBase[i] = 0;
    }
  }
  return { r, g, b, depthMm, cutout, isBase };
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

// Build a binary signed field (>0 inside) from a membership predicate, then
// intersect (min) with the body/hole field so every part shares one outline.
function __maskField(member, footprint, cols) {
  return (c, r) => Math.min(member(c, r) ? 1 : -1, footprint(c, r));
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
  const facetsByColor = new Map(); // hex -> facets[]
  const push = (hex, facets) => {
    if (!facets.length) return;
    if (!facetsByColor.has(hex)) facetsByColor.set(hex, []);
    const acc = facetsByColor.get(hex); for (const f of facets) acc.push(f);
  };

  // Engraved model: a solid base plate at full thickness; each element is carved
  // INTO the front face by its depth (an air recess), with a thin colored floor
  // at the bottom of the recess and base beneath it. The surrounding base stands
  // proud, so elements read as debossed. Cutout elements are cut all the way
  // through instead (a hole in the shape of the element).
  const floor = Math.min(2 * doc.layerHeightMm, T); // colored-floor thickness (mm)
  const recessOf = (d) => Math.max(0, Math.min(d, T - floor)); // clamp so floor+base fit
  const baseUnder = (d) => T - recessOf(d) - floor;            // base height beneath floor (>=0)

  // 1) Colored recess floors, grouped by (colorHex, depthMm). Skip background and
  //    cutout (cutout = hole, no color).
  const groups = new Map(); // key "hex|depth" -> {hex, depth, set:Uint8Array}
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(c, r);
    if (comp.isBase[i] || comp.cutout[i]) continue;
    const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
    const depth = comp.depthMm[i];
    const key = hex + "|" + depth.toFixed(4);
    let grp = groups.get(key);
    if (!grp) { grp = { hex, depth, set: new Uint8Array(cols * rows) }; groups.set(key, grp); }
    grp.set[i] = 1;
  }
  for (const grp of groups.values()) {
    const z0 = baseUnder(grp.depth);          // floor sits on top of the base block
    const f = __maskField((c, r) => grp.set[idx(c, r)] === 1, footprint, cols);
    push(grp.hex, orientOutward(fieldFacets(f, cols, rows, pitch, floor, smoothTol, z0)));
  }

  // 2) Base plate: full thickness under the background; under each engraved
  //    element a block from the back up to the colored floor (recess = air above).
  //    Cutout pixels get no base (through-hole).
  const behind = new Map(); // heightMm -> {h, m:Uint8Array}
  const bg = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(c, r);
    if (comp.cutout[i]) continue;             // hole: no base
    if (comp.isBase[i]) { bg[i] = 1; continue; }
    const h = baseUnder(comp.depthMm[i]);
    if (h <= 0) continue;                      // floor reaches the back, nothing beneath
    const key = h.toFixed(4);
    let set = behind.get(key); if (!set) { set = { h, m: new Uint8Array(cols * rows) }; behind.set(key, set); }
    set.m[i] = 1;
  }
  // background: full thickness
  {
    const f = __maskField((c, r) => bg[idx(c, r)] === 1, footprint, cols);
    push(baseHex, orientOutward(fieldFacets(f, cols, rows, pitch, T, smoothTol, 0)));
  }
  for (const set of behind.values()) {
    const f = __maskField((c, r) => set.m[idx(c, r)] === 1, footprint, cols);
    push(baseHex, orientOutward(fieldFacets(f, cols, rows, pitch, set.h, smoothTol, 0)));
  }

  // 3) Assemble parts; base first and named "grundplatte".
  const parts = [];
  if (facetsByColor.has(baseHex)) {
    parts.push({ name: "grundplatte", color: hexToRgb(baseHex), facets: facetsByColor.get(baseHex) });
    facetsByColor.delete(baseHex);
  }
  let n = 1;
  for (const [hex, facets] of facetsByColor) parts.push({ name: "farbe-" + (n++), color: hexToRgb(hex), facets });
  return parts.filter(p => p.facets.length);
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
