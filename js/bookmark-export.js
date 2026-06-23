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
