"use strict";

const els = {
  drop: document.getElementById('drop'),
  srcBild: document.getElementById('srcBild'),
  srcText: document.getElementById('srcText'),
  srcQR: document.getElementById('srcQR'),
  textPanel: document.getElementById('textPanel'),
  qrPanel: document.getElementById('qrPanel'),
  textInput: document.getElementById('textInput'),
  textBold: document.getElementById('textBold'),
  textSize: document.getElementById('textSize'),
  textApply: document.getElementById('textApply'),
  qrInput: document.getElementById('qrInput'),
  qrEc: document.getElementById('qrEc'),
  qrApply: document.getElementById('qrApply'),
  file: document.getElementById('file'),
  keepAlpha: document.getElementById('keepAlpha'),
  bgRemove: document.getElementById('bgRemove'),
  thresh: document.getElementById('thresh'),
  threshVal: document.getElementById('threshVal'),
  island: document.getElementById('island'),
  islandVal: document.getElementById('islandVal'),
  otsu: document.getElementById('otsu'),
  invert: document.getElementById('invert'),
  modeBw: document.getElementById('modeBw'),
  modeColor: document.getElementById('modeColor'),
  methPalette: document.getElementById('methPalette'),
  methPosterize: document.getElementById('methPosterize'),
  numColors: document.getElementById('numColors'),
  numColorsVal: document.getElementById('numColorsVal'),
  levels: document.getElementById('levels'),
  levelsVal: document.getElementById('levelsVal'),
  colorIsland: document.getElementById('colorIsland'),
  colorIslandVal: document.getElementById('colorIslandVal'),
  smooth: document.getElementById('smooth'),
  smoothVal: document.getElementById('smoothVal'),
  circleEnable: document.getElementById('circleEnable'),
  circleSize: document.getElementById('circleSize'),
  circleSizeVal: document.getElementById('circleSizeVal'),
  circleThickness: document.getElementById('circleThickness'),
  circleThicknessVal: document.getElementById('circleThicknessVal'),
  circleColor: document.getElementById('circleColor'),
  modelWidth: document.getElementById('modelWidth'),
  modelWidthVal: document.getElementById('modelWidthVal'),
  thickBlack: document.getElementById('thickBlack'),
  thickBlackVal: document.getElementById('thickBlackVal'),
  thickWhite: document.getElementById('thickWhite'),
  thickWhiteVal: document.getElementById('thickWhiteVal'),
  ringThick: document.getElementById('ringThick'),
  ringThickVal: document.getElementById('ringThickVal'),
  frameWidth: document.getElementById('frameWidth'),
  frameWidthVal: document.getElementById('frameWidthVal'),
  baseThick: document.getElementById('baseThick'),
  baseThickVal: document.getElementById('baseThickVal'),
  mountKein: document.getElementById('mountKein'),
  mountLoch: document.getElementById('mountLoch'),
  mountOese: document.getElementById('mountOese'),
  mountType: document.getElementById('mountType'),
  mountDia: document.getElementById('mountDia'),
  mountDiaVal: document.getElementById('mountDiaVal'),
  mountBoss: document.getElementById('mountBoss'),
  mountBossVal: document.getElementById('mountBossVal'),
  bodyColor: document.getElementById('bodyColor'),
  modelRes: document.getElementById('modelRes'),
  modelResVal: document.getElementById('modelResVal'),
  modelSmooth: document.getElementById('modelSmooth'),
  modelSmoothVal: document.getElementById('modelSmoothVal'),
  stampMode: document.getElementById('stampMode'),
  colorRelief: document.getElementById('colorRelief'),
  colorReliefVal: document.getElementById('colorReliefVal'),
  colorHeightUniform: document.getElementById('colorHeightUniform'),
  colorHeightBrightness: document.getElementById('colorHeightBrightness'),
  colorMaxH: document.getElementById('colorMaxH'),
  colorMaxHVal: document.getElementById('colorMaxHVal'),
  colorDarkTall: document.getElementById('colorDarkTall'),
  dims: document.getElementById('dims'),
  openExport: document.getElementById('openExport'),
  exportModal: document.getElementById('exportModal'),
  exportClose: document.getElementById('exportClose'),
  exportName: document.getElementById('exportName'),
  exportPng: document.getElementById('exportPng'),
  exportSvg: document.getElementById('exportSvg'),
  exportMf: document.getElementById('exportMf'),
  exportStl: document.getElementById('exportStl'),
  exportStatus: document.getElementById('exportStatus'),
  output: document.getElementById('output'),
  preview: document.getElementById('preview'),
  controls: document.getElementById('controls'),
  status: document.getElementById('status'),
};

let loadedName = 'ukibori';   // base filename for exports (from the loaded image)
function safeFileName(s) { return (String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\.+$/, '') || 'ukibori'); }

let mode = 'bw';            // 'bw' | 'color'
let colorMethod = 'palette'; // 'palette' | 'posterize'
let colorHeight = 'uniform'; // 'uniform' | 'brightness'
function colorHeightMode() { return colorHeight; }
window.colorHeightMode = colorHeightMode;

const offscreen = document.createElement('canvas');
const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
let originalData = null;    // ImageData at full resolution
let processedData = null;   // cached mode+cleanup result (no circle)
let processedCanvas = null; // processedData drawn to a canvas, for compositing

function setStatus(msg, isError) {
  els.status.textContent = msg;
  els.status.className = isError ? 'status error' : 'status';
}

function enableControls(on) {
  els.controls.classList.toggle('disabled', !on);
  [els.keepAlpha, els.bgRemove, els.thresh, els.island, els.otsu, els.invert, els.numColors, els.levels,
   els.colorIsland, els.smooth, els.circleEnable, els.circleSize,
   els.circleThickness, els.circleColor, els.mountDia, els.mountBoss,
   els.modelWidth, els.thickBlack,
   els.thickWhite, els.ringThick, els.frameWidth, els.baseThick, els.bodyColor,
   els.modelRes, els.modelSmooth, els.openExport, els.colorRelief, els.colorMaxH, els.colorDarkTall, els.stampMode]
    .forEach(e => { e.disabled = !on; });
}

function setThreshold(t) {
  els.thresh.value = t;
  els.threshVal.textContent = t;
}

// Show only the controls that belong to the current mode and color method.
function updateControlVisibility() {
  const bw = mode === 'bw';
  const palette = colorMethod === 'palette';
  document.querySelectorAll('.mode-bw').forEach(e => { e.hidden = !bw; });
  document.querySelectorAll('.mode-color').forEach(e => { e.hidden = bw; });
  document.querySelectorAll('.meth-palette').forEach(e => { e.hidden = bw || !palette; });
  document.querySelectorAll('.meth-posterize').forEach(e => { e.hidden = bw || palette; });
  els.modeBw.classList.toggle('seg-active', bw);
  els.modeColor.classList.toggle('seg-active', !bw);
  els.methPalette.classList.toggle('seg-active', palette);
  els.methPosterize.classList.toggle('seg-active', !palette);
}

const circle = { cx: 0, cy: 0, r: 0 }; // selection in image coordinates
const mount = { x: 0, y: 0 }; // mounting hole/loop center, in image coordinates
function mountActive() { return els.mountType && els.mountType.value !== 'kein'; }
window.mount = mount;
window.mountActive = mountActive;

// A source pixel counts as transparent below this alpha (fixed, binary edge).
const ALPHA_CUTOFF = 128;

// Mode + cleanup, without the circle. Returns a fresh ImageData. With
// keepAlpha off, transparent source pixels are composited over white (so they
// become opaque white); with it on, they are restored to fully transparent
// after processing, so the background stays transparent.
function processImage() {
  const src = originalData.data;
  const copy = new ImageData(
    new Uint8ClampedArray(src),
    originalData.width,
    originalData.height
  );
  const d = copy.data;
  const keepAlpha = els.keepAlpha.checked;
  // Flatten alpha before processing: transparent -> white (unless we keep it),
  // semi/opaque -> fully opaque so the mode operations work on solid colors.
  for (let i = 0; i < d.length; i += 4) {
    if (src[i + 3] < ALPHA_CUTOFF) {
      if (!keepAlpha) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255; }
    } else {
      d[i + 3] = 255;
    }
  }
  if (mode === 'bw') {
    applyThreshold(copy, Number(els.thresh.value), els.invert.checked);
    removeSmallIslands(copy, Number(els.island.value));
  } else {
    if (colorMethod === 'palette') {
      quantizeMedianCut(copy, Number(els.numColors.value));
    } else {
      posterize(copy, Number(els.levels.value));
    }
    removeSmallColorIslands(copy, Number(els.colorIsland.value));
    majorityFilter(copy, Number(els.smooth.value));
  }
  if (keepAlpha) {
    for (let i = 0; i < d.length; i += 4) if (src[i + 3] < ALPHA_CUTOFF) d[i + 3] = 0;
  }
  return copy;
}

// The output frame in image coordinates. When the circle pokes past the image
// edges the frame grows to contain the whole circle (the overflow is filled
// white); otherwise it equals the image. x0/y0 is the frame's top-left in image
// coordinates (may be negative); the image is drawn at (-x0, -y0).
function circleFrame() {
  const w = processedData.width, h = processedData.height;
  if (!els.circleEnable.checked) return { x0: 0, y0: 0, fw: w, fh: h };
  const { cx, cy, r } = circle;
  const x0 = Math.floor(Math.min(0, cx - r));
  const y0 = Math.floor(Math.min(0, cy - r));
  const x1 = Math.ceil(Math.max(w, cx + r));
  const y1 = Math.ceil(Math.max(h, cy + r));
  return { x0, y0, fw: x1 - x0, fh: y1 - y0 };
}

// Draws the interactive editing preview into the (possibly extended) frame: the
// full processed image, white where the frame extends beyond it, the area
// outside the circle dimmed, and the ring shown as a guide. The real
// white-filled crop is only produced on export (see exportData).
function paint() {
  if (!processedData || !processedCanvas) return;
  const f = circleFrame();
  const out = els.output;
  out.width = f.fw;
  out.height = f.fh;
  const ctx = out.getContext('2d');
  if (els.keepAlpha.checked) {
    ctx.clearRect(0, 0, f.fw, f.fh);
  } else {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, f.fw, f.fh);
  }
  if (stampActive()) { ctx.save(); ctx.translate(f.fw, 0); ctx.scale(-1, 1); ctx.drawImage(processedCanvas, f.x0, -f.y0); ctx.restore(); }
  else ctx.drawImage(processedCanvas, -f.x0, -f.y0);
  if (els.circleEnable.checked) {
    const cx = circle.cx - f.x0, cy = circle.cy - f.y0, r = circle.r;
    const t = Number(els.circleThickness.value);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, f.fw, f.fh);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true); // reverse winding -> hole at circle
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill('evenodd');
    ctx.restore();
    if (t > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, r - t / 2), 0, Math.PI * 2);
      ctx.lineWidth = t;
      ctx.strokeStyle = els.circleColor.value;
      ctx.stroke();
    }
  }
  if (mountActive()) {
    const mx = mount.x - f.x0, my = mount.y - f.y0;
    const pitchMm = Number(els.modelWidth.value) / Math.max(1, processedData.width); // approx px→mm for preview ring
    const rPx = (Number(els.mountDia.value) / 2) / pitchMm;
    ctx.save();
    ctx.strokeStyle = '#e0245e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, Math.max(3, rPx), 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx - 6, my); ctx.lineTo(mx + 6, my); ctx.moveTo(mx, my - 6); ctx.lineTo(mx, my + 6); ctx.stroke();
    ctx.restore();
  }
  els.preview.classList.add('ready');
  updateDims();
}

// Full recompute (mode + cleanup), cache it to a canvas, then repaint.
function render() {
  if (!originalData) return;
  processedData = processImage();
  processedCanvas = document.createElement('canvas');
  processedCanvas.width = processedData.width;
  processedCanvas.height = processedData.height;
  processedCanvas.getContext('2d').putImageData(processedData, 0, 0);
  paint();
}

// Final image for export. With the circle enabled it is cropped to the circle's
// bounding box (a square tightly containing the circle, white outside it, ring
// applied). Without the circle it is just the processed image.
function exportData() {
  if (!els.circleEnable.checked) {
    return new ImageData(
      new Uint8ClampedArray(processedData.data),
      processedData.width,
      processedData.height
    );
  }
  const r = circle.r;
  const x0 = Math.round(circle.cx - r), y0 = Math.round(circle.cy - r);
  const fw = Math.round(2 * r), fh = Math.round(2 * r);
  const tmp = document.createElement('canvas');
  tmp.width = fw;
  tmp.height = fh;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  const keepAlpha = els.keepAlpha.checked;
  if (!keepAlpha) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, fw, fh);
  }
  if (stampActive()) { ctx.save(); ctx.translate(fw, 0); ctx.scale(-1, 1); ctx.drawImage(processedCanvas, x0, -y0); ctx.restore(); }
  else ctx.drawImage(processedCanvas, -x0, -y0);
  const data = ctx.getImageData(0, 0, fw, fh);
  applyCircleMask(data, Number(els.circleThickness.value),
    hexToRgb(els.circleColor.value), circle.cx - x0, circle.cy - y0, r, keepAlpha);
  return data;
}

function updateCircleCursor() {
  els.output.style.cursor = mountActive() ? 'crosshair' : (els.circleEnable.checked ? 'grab' : 'default');
}

function stampActive() { return els.stampMode && els.stampMode.checked; }
window.stampActive = stampActive;

// Builds continuous signed fields (>0 inside) for each part on a cols x rows
// grid, sampled from the processed B/W result. These feed marching-squares so
// the exported contours are sub-pixel smooth instead of a binary staircase.
// gray = luminance over white; alpha = coverage (when transparency is kept);
// circle/ring/frame are analytic distance fields. Parts are intersections (min).
function buildFields(maxDim) {
  const enabled = els.circleEnable.checked;
  const keepAlpha = els.keepAlpha.checked;
  let sx, sy, sw, sh;
  if (enabled) { const r = circle.r; sx = circle.cx - r; sy = circle.cy - r; sw = 2 * r; sh = 2 * r; }
  else { sx = 0; sy = 0; sw = processedCanvas.width; sh = processedCanvas.height; }
  let cols, rows;
  if (sw >= sh) { cols = Math.max(2, Math.min(maxDim, Math.round(sw))); rows = Math.max(2, Math.round(cols * sh / sw)); }
  else { rows = Math.max(2, Math.min(maxDim, Math.round(sh))); cols = Math.max(2, Math.round(rows * sw / sh)); }
  const sample = (compositeWhite) => {
    const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    if (compositeWhite) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, cols, rows); }
    cx.drawImage(processedCanvas, sx, sy, sw, sh, 0, 0, cols, rows);
    return cx.getImageData(0, 0, cols, rows).data;
  };
  const gd = sample(true);                       // gray over white
  const gray = new Float64Array(cols * rows);
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * gd[i * 4] + 0.587 * gd[i * 4 + 1] + 0.114 * gd[i * 4 + 2];
  let alpha = null;
  if (keepAlpha) { const ad = sample(false); alpha = new Float64Array(cols * rows); for (let i = 0; i < alpha.length; i++) alpha[i] = ad[i * 4 + 3]; }
  if (stampActive()) {
    const mirrorRow = (arr) => {
      for (let r = 0; r < rows; r++) {
        const base = r * cols;
        for (let c = 0; c < cols >> 1; c++) {
          const t = arr[base + c]; arr[base + c] = arr[base + cols - 1 - c]; arr[base + cols - 1 - c] = t;
        }
      }
    };
    mirrorRow(gray);
    if (alpha) mirrorRow(alpha);
  }
  const BIG = 1e9, ix = (c, r) => r * cols + c;
  const ccx = cols / 2, ccy = rows / 2, cr = Math.min(cols, rows) / 2;
  const ringCells = (enabled && Number(els.circleThickness.value) > 0 && Number(els.ringThick.value) > 0)
    ? Number(els.circleThickness.value) * (cols / sw) : 0;
  const frameCells = (!enabled && Number(els.frameWidth.value) > 0 && Number(els.ringThick.value) > 0)
    ? Number(els.frameWidth.value) * (cols / sw) : 0;
  const innerR = cr - ringCells;
  const G = (c, r) => gray[ix(c, r)];
  const dist = (c, r) => Math.hypot(c + 0.5 - ccx, r + 0.5 - ccy);
  const edge = (c, r) => Math.min(c, r, cols - 1 - c, rows - 1 - r);
  const fAlpha = (c, r) => keepAlpha ? (alpha[ix(c, r)] - 128) : BIG;
  const fCircle = (c, r) => enabled ? (cr - dist(c, r)) : BIG;
  const fInner = (c, r) => enabled ? (innerR - dist(c, r)) : (frameCells > 0 ? (edge(c, r) - frameCells) : BIG);
  const fBase = (c, r) => Math.min(fAlpha(c, r), fCircle(c, r));
  const fBlack = (c, r) => Math.min(128 - G(c, r), fAlpha(c, r), fInner(c, r));
  const fWhite = (c, r) => Math.min(G(c, r) - 128, fAlpha(c, r), fInner(c, r));
  let fRing = null;
  if (ringCells > 0) fRing = (c, r) => Math.min(dist(c, r) - innerR, cr - dist(c, r), fAlpha(c, r));
  else if (frameCells > 0) fRing = (c, r) => Math.min(frameCells - edge(c, r), fAlpha(c, r));
  let fBlack2 = fBlack, fWhite2 = fWhite, fBase2 = fBase, fRing2 = fRing, fBoss = null;
  if (mountActive()) {
    const holeCol = (mount.x - sx) / sw * cols, holeRow = (mount.y - sy) / sh * rows;
    const pitchMm = Number(els.modelWidth.value) / cols;
    const holeRc = (Number(els.mountDia.value) / 2) / pitchMm;
    const distH = (c, r) => Math.hypot(c + 0.5 - holeCol, r + 0.5 - holeRow);
    const dOut = (c, r) => distH(c, r) - holeRc; // >0 outside the hole
    const carve = (f) => f ? (c, r) => Math.min(f(c, r), dOut(c, r)) : null;
    fBase2 = carve(fBase); fBlack2 = carve(fBlack); fWhite2 = carve(fWhite); fRing2 = carve(fRing);
    if (els.mountType.value === 'oese') {
      const bossRc = holeRc + Number(els.mountBoss.value) / pitchMm;
      fBoss = (c, r) => Math.min(dOut(c, r), bossRc - distH(c, r), fAlpha(c, r));
    }
  }
  const result = { cols, rows, pitch: Number(els.modelWidth.value) / cols, fBase: fBase2, fBlack: fBlack2, fWhite: fWhite2, fRing: fRing2, fBoss };
  if (stampActive()) { const tmp = result.fBlack; result.fBlack = result.fWhite; result.fWhite = tmp; }
  return result;
}
window.buildFields = buildFields;

// Color-mode analogue of buildFields: one anti-aliased coverage field per
// distinct palette color in processedData, intersected with the same
// alpha/circle/frame fields. Reuses the mask→downsample→coverage−128 trick so
// per-color contours are sub-pixel smooth (not a per-pixel staircase).
function buildColorFields(maxDim) {
  const enabled = els.circleEnable.checked;
  const keepAlpha = els.keepAlpha.checked;
  let sx, sy, sw, sh;
  if (enabled) { const r = circle.r; sx = circle.cx - r; sy = circle.cy - r; sw = 2 * r; sh = 2 * r; }
  else { sx = 0; sy = 0; sw = processedCanvas.width; sh = processedCanvas.height; }
  let cols, rows;
  if (sw >= sh) { cols = Math.max(2, Math.min(maxDim, Math.round(sw))); rows = Math.max(2, Math.round(cols * sh / sw)); }
  else { rows = Math.max(2, Math.min(maxDim, Math.round(sh))); cols = Math.max(2, Math.round(rows * sw / sh)); }

  // Distinct opaque colors, most-frequent first, capped at 32.
  const pd = processedData.data;
  const counts = new Map();
  for (let i = 0; i < pd.length; i += 4) {
    if (keepAlpha && pd[i + 3] < 128) continue;
    const key = (pd[i] << 16) | (pd[i + 1] << 8) | pd[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32)
    .map(([key]) => [(key >> 16) & 255, (key >> 8) & 255, key & 255]);

  // Per-color coverage: full-res white-where-matching mask, downsampled to grid.
  const fullW = processedData.width, fullH = processedData.height;
  const coverageOf = (color) => {
    const mask = new Uint8ClampedArray(pd.length);
    for (let i = 0; i < pd.length; i += 4) {
      const on = pd[i] === color[0] && pd[i + 1] === color[1] && pd[i + 2] === color[2]
        && (!keepAlpha || pd[i + 3] >= 128);
      mask[i] = mask[i + 1] = mask[i + 2] = on ? 255 : 0; mask[i + 3] = 255;
    }
    const full = document.createElement('canvas'); full.width = fullW; full.height = fullH;
    full.getContext('2d').putImageData(new ImageData(mask, fullW, fullH), 0, 0);
    const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(full, sx, sy, sw, sh, 0, 0, cols, rows);
    const d = cx.getImageData(0, 0, cols, rows).data;
    const cov = new Float64Array(cols * rows);
    for (let i = 0; i < cov.length; i++) cov[i] = d[i * 4];
    return cov;
  };

  // Alpha field (coverage) when keeping transparency.
  let alpha = null;
  if (keepAlpha) {
    const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(processedCanvas, sx, sy, sw, sh, 0, 0, cols, rows);
    const ad = cx.getImageData(0, 0, cols, rows).data;
    alpha = new Float64Array(cols * rows);
    for (let i = 0; i < alpha.length; i++) alpha[i] = ad[i * 4 + 3];
  }

  const ix = (c, r) => r * cols + c;
  const mirrorRow = (arr) => {
    for (let r = 0; r < rows; r++) { const b = r * cols; for (let c = 0; c < cols >> 1; c++) { const t = arr[b + c]; arr[b + c] = arr[b + cols - 1 - c]; arr[b + cols - 1 - c] = t; } }
  };
  if (stampActive() && alpha) mirrorRow(alpha);
  const coverage = colors.map(c => { const cov = coverageOf(c); if (stampActive()) mirrorRow(cov); return cov; });

  const BIG = 1e9;
  const ccx = cols / 2, ccy = rows / 2, cr = Math.min(cols, rows) / 2;
  const ringCells = (enabled && Number(els.circleThickness.value) > 0 && Number(els.ringThick.value) > 0)
    ? Number(els.circleThickness.value) * (cols / sw) : 0;
  const frameCells = (!enabled && Number(els.frameWidth.value) > 0 && Number(els.ringThick.value) > 0)
    ? Number(els.frameWidth.value) * (cols / sw) : 0;
  const innerR = cr - ringCells;
  const dist = (c, r) => Math.hypot(c + 0.5 - ccx, r + 0.5 - ccy);
  const edge = (c, r) => Math.min(c, r, cols - 1 - c, rows - 1 - r);
  const fAlpha = (c, r) => keepAlpha ? (alpha[ix(c, r)] - 128) : BIG;
  const fCircle = (c, r) => enabled ? (cr - dist(c, r)) : BIG;
  const fInner = (c, r) => enabled ? (innerR - dist(c, r)) : (frameCells > 0 ? (edge(c, r) - frameCells) : BIG);
  const fBase = (c, r) => Math.min(fAlpha(c, r), fCircle(c, r));
  let fRing = null;
  if (ringCells > 0) fRing = (c, r) => Math.min(dist(c, r) - innerR, cr - dist(c, r), fAlpha(c, r));
  else if (frameCells > 0) fRing = (c, r) => Math.min(frameCells - edge(c, r), fAlpha(c, r));

  const colorFields = colors.map((c, k) => ({
    color: c,
    field: (cc, rr) => Math.min(coverage[k][ix(cc, rr)] - 128, fAlpha(cc, rr), fInner(cc, rr)),
  }));
  let fBase2 = fBase, fRing2 = fRing, colorFields2 = colorFields, fBoss = null;
  if (mountActive()) {
    const holeCol = (mount.x - sx) / sw * cols, holeRow = (mount.y - sy) / sh * rows;
    const pitchMm = Number(els.modelWidth.value) / cols;
    const holeRc = (Number(els.mountDia.value) / 2) / pitchMm;
    const distH = (c, r) => Math.hypot(c + 0.5 - holeCol, r + 0.5 - holeRow);
    const dOut = (c, r) => distH(c, r) - holeRc;
    const carve = (f) => f ? (c, r) => Math.min(f(c, r), dOut(c, r)) : null;
    fBase2 = carve(fBase); fRing2 = carve(fRing);
    colorFields2 = colorFields.map(cf => ({ color: cf.color, field: carve(cf.field) }));
    if (els.mountType.value === 'oese') {
      const bossRc = holeRc + Number(els.mountBoss.value) / pitchMm;
      fBoss = (c, r) => Math.min(dOut(c, r), bossRc - distH(c, r), fAlpha(c, r));
    }
  }
  return { cols, rows, pitch: Number(els.modelWidth.value) / cols, colorFields: colorFields2, fBase: fBase2, fRing: fRing2, fBoss };
}
window.buildColorFields = buildColorFields;

// Builds the colored parts for the current B/W result. Shared by .3mf, STL,
// and the 3D preview so preview == print. Returns empty parts when there is
// nothing to build (no image). In color mode, delegates to buildColorParts().
function buildParts() {
  if (!processedData) return { parts: [], stats: { tris: 0 } };
  if (mode !== 'bw') return buildColorParts();
  const maxDim = Number(els.modelRes.value);
  const { cols, rows, pitch, fBase, fBlack, fWhite, fRing, fBoss } = buildFields(maxDim);
  const baseT = Number(els.baseThick.value);
  const bodyColor = hexToRgb(els.bodyColor.value);
  // Trace each region with potrace (smooth vector edges), matching the bookmark
  // exporter, instead of marching squares. A region is where its field is >0.
  const facets = (f, thick, z0) => orientOutward(window.traceMaskToFacets((c, r) => f(c, r) > 0, cols, rows, pitch, thick, z0));
  const parts = [];
  // Base plate: the full footprint, from z=0 up. Relief + rand sit on top (z0=baseT).
  const baseF = facets(fBase, baseT, 0);
  if (baseF.length) parts.push({ name: 'grundplatte', color: bodyColor, facets: baseF });
  const blackF = facets(fBlack, Number(els.thickBlack.value), baseT);
  if (blackF.length) parts.push({ name: 'schwarz', color: [0, 0, 0], facets: blackF });
  const whiteF = facets(fWhite, Number(els.thickWhite.value), baseT);
  if (whiteF.length) parts.push({ name: 'weiss', color: [255, 255, 255], facets: whiteF });
  // Rand color: the circle ring keeps its own colour, the rectangle frame uses the shared body colour.
  if (fRing) {
    const randColor = els.circleEnable.checked ? hexToRgb(els.circleColor.value) : bodyColor;
    const ringF = facets(fRing, Number(els.ringThick.value), baseT);
    if (ringF.length) parts.push({ name: 'rand', color: randColor, facets: ringF });
  }
  if (fBoss) {
    const bossH = Math.max(Number(els.thickBlack.value), Number(els.thickWhite.value)) || baseT;
    const bossF = facets(fBoss, bossH, baseT);
    if (bossF.length) parts.push({ name: 'oese', color: bodyColor, facets: bossF });
  }
  const tris = parts.reduce((s, p) => s + p.facets.length, 0);
  return { parts, stats: { tris } };
}
window.buildParts = buildParts;

// Color-mode parts: one object per palette color at a uniform relief height,
// on a shared base, plus the ring/frame. Consumed by .3mf and STL like the B/W
// parts. (Brightness→height is added in a later task.)
function buildColorParts() {
  const maxDim = Number(els.modelRes.value);
  const { cols, rows, pitch, colorFields, fBase, fRing, fBoss } = buildColorFields(maxDim);
  const tol = Number(els.modelSmooth.value) * pitch;
  const baseT = Number(els.baseThick.value);
  const bodyColor = hexToRgb(els.bodyColor.value);
  const facets = (f, thick, z0) => orientOutward(fieldFacets(f, cols, rows, pitch, thick, tol, z0));
  const parts = [];
  const baseF = facets(fBase, baseT, 0);
  if (baseF.length) parts.push({ name: 'grundplatte', color: bodyColor, facets: baseF });
  const brightness = colorHeightMode() === 'brightness';
  const reliefH = Number(els.colorRelief.value);
  const maxH = Number(els.colorMaxH.value);
  const darkTall = els.colorDarkTall.checked;
  colorFields.forEach((cf, k) => {
    let thick = reliefH;
    if (brightness) {
      const lum = 0.299 * cf.color[0] + 0.587 * cf.color[1] + 0.114 * cf.color[2];
      thick = maxH * (darkTall ? (1 - lum / 255) : (lum / 255));
    }
    if (thick <= 0) return;
    const ff = facets(cf.field, thick, baseT);
    if (ff.length) parts.push({ name: 'farbe' + k, color: cf.color, facets: ff });
  });
  if (fRing) {
    const randColor = els.circleEnable.checked ? hexToRgb(els.circleColor.value) : bodyColor;
    const ringF = facets(fRing, Number(els.ringThick.value), baseT);
    if (ringF.length) parts.push({ name: 'rand', color: randColor, facets: ringF });
  }
  if (fBoss) {
    const bossH = (colorHeightMode() === 'brightness' ? Number(els.colorMaxH.value) : Number(els.colorRelief.value)) || baseT;
    const bossF = facets(fBoss, bossH, baseT);
    if (bossF.length) parts.push({ name: 'oese', color: bodyColor, facets: bossF });
  }
  const tris = parts.reduce((s, p) => s + p.facets.length, 0);
  return { parts, stats: { tris } };
}
window.buildColorParts = buildColorParts;

// Final physical dimensions in mm: width from the slider, height from the
// model grid aspect, total thickness = base + tallest relief layer.
function computeDimensions() {
  if (!processedData) return null;
  const { cols, rows } = mode === 'bw' ? buildFields(Number(els.modelRes.value)) : buildColorFields(Number(els.modelRes.value));
  const w = Number(els.modelWidth.value);
  const h = w * (rows / cols);
  // NOTE: t is re-derived here independently of buildParts(); keep in sync if per-part thickness becomes asymmetric.
  const reliefMax = mode === 'bw'
    ? Math.max(Number(els.thickBlack.value), Number(els.thickWhite.value))
    : (colorHeightMode() === 'brightness' ? Number(els.colorMaxH.value) : Number(els.colorRelief.value));
  const t = Number(els.baseThick.value) + Math.max(
    reliefMax,
    (els.circleEnable.checked || Number(els.frameWidth.value) > 0) ? Number(els.ringThick.value) : 0
  );
  return { w, h, t };
}
window.computeDimensions = computeDimensions;

function updateDims() {
  const d = computeDimensions();
  els.dims.textContent = d ? `${d.w.toFixed(0)} × ${d.h.toFixed(0)} × ${d.t.toFixed(1)} mm` : '—';
}
window.updateDims = updateDims;

// Builds the model from buildParts() and downloads it as a .3mf.
function exportModel() {
  const { parts, stats } = buildParts();
  if (!parts.length) {
    setStatus('Kein 3D-Modell: keine passenden Flächen gefunden.', true);
    return;
  }
  const blob = build3MF(parts);
  const a = document.createElement('a');
  a.download = currentExportName() + '.3mf';
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
  setStatus(`3D-Modell (.3mf) exportiert: ${parts.length} Teile, ${stats.tris} Dreiecke.`, false);
}
window.exportModel = exportModel;

// Adopts an ImageData as the working source (from a file, text, or QR) and
// runs the shared post-load setup. `label` is the status message to show.
function adoptImageData(imageData, label) {
  originalData = imageData;
  enableControls(true);
  document.body.classList.add('has-image');
  setThreshold(computeOtsuThreshold(originalData)); // start at the auto value
  // Default circle: largest centered circle that fits the image.
  const w = originalData.width, h = originalData.height;
  circle.cx = w / 2;
  circle.cy = h / 2;
  circle.r = Math.min(w, h) / 2;
  els.circleSize.min = 10;
  els.circleSize.max = Math.round(Math.hypot(w, h) / 2);
  els.circleSize.value = Math.round(circle.r);
  els.circleSizeVal.textContent = Math.round(circle.r);
  mount.x = originalData.width / 2;
  mount.y = originalData.height * 0.15;
  updateCircleCursor();
  setStatus(label, false);
  restoreLastState();
  render();
}
window.adoptImageData = adoptImageData;

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    setStatus('Bitte eine Bilddatei auswählen.', true);
    return;
  }
  loadedName = safeFileName((file.name || '').replace(/\.[^.]+$/, '')) || 'ukibori';
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    let data;
    try {
      offscreen.width = img.naturalWidth;
      offscreen.height = img.naturalHeight;
      offCtx.drawImage(img, 0, 0);
      data = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
    } catch (e) {
      setStatus('Bild ist zu groß zum Verarbeiten.', true);
      return;
    }
    adoptImageData(data, `Geladen: ${img.naturalWidth}×${img.naturalHeight}px`);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus('Bild konnte nicht geladen werden.', true);
  };
  img.src = url;
}
window.loadFile = loadFile; // exposed for verification

// Additional exposures so browser_evaluate assertions can reach otherwise
// script-scoped state.
window.els = els;
window.offscreen = offscreen;
window.offCtx = offCtx;
window.render = render;
window.paint = paint;
window.exportData = exportData;
window.circle = circle;
window.earcut = earcut;
window.triangulateComponent = triangulateComponent;
window.dpSimplify = dpSimplify;
window.polyArea = polyArea;
window.signedVolume = signedVolume;
window.orientOutward = orientOutward;
window.build3MF = build3MF;
window.facetsToIndexedMesh = facetsToIndexedMesh;
window.zipStore = zipStore;
window.crc32 = crc32;
Object.defineProperty(window, 'originalData', {
  get() { return originalData; },
  set(v) { originalData = v; },
});

// --- input source tabs ------------------------------------------------------
function setSource(which) {
  els.drop.hidden = which !== 'bild';
  els.textPanel.hidden = which !== 'text';
  els.qrPanel.hidden = which !== 'qr';
  els.srcBild.classList.toggle('seg-active', which === 'bild');
  els.srcText.classList.toggle('seg-active', which === 'text');
  els.srcQR.classList.toggle('seg-active', which === 'qr');
}
window.setSource = setSource;
els.srcBild.addEventListener('click', () => setSource('bild'));
els.srcText.addEventListener('click', () => setSource('text'));
els.srcQR.addEventListener('click', () => setSource('qr'));

els.textApply.addEventListener('click', () => {
  try {
    const data = renderText({
      text: els.textInput.value,
      fontSize: Number(els.textSize.value),
      bold: els.textBold.checked,
    });
    adoptImageData(data, `Text übernommen: ${data.width}×${data.height}px`);
  } catch (e) {
    setStatus(e.message || 'Text konnte nicht erzeugt werden.', true);
  }
});

els.qrApply.addEventListener('click', () => {
  try {
    const data = qrToImageData({ text: els.qrInput.value, ecLevel: els.qrEc.value });
    adoptImageData(data, `QR-Code übernommen: ${data.width}×${data.height}px`);
  } catch (e) {
    setStatus(e.message || 'QR-Code konnte nicht erzeugt werden.', true);
  }
});

els.drop.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
['dragenter', 'dragover'].forEach(ev =>
  els.drop.addEventListener(ev, e => { e.preventDefault(); els.drop.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev =>
  els.drop.addEventListener(ev, e => { e.preventDefault(); els.drop.classList.remove('dragover'); }));
els.drop.addEventListener('drop', e => {
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

els.thresh.addEventListener('input', () => {
  els.threshVal.textContent = els.thresh.value;
  render();
});
els.island.addEventListener('input', () => {
  els.islandVal.textContent = els.island.value;
  render();
});
els.invert.addEventListener('change', render);
els.keepAlpha.addEventListener('change', () => {
  document.body.classList.toggle('alpha', els.keepAlpha.checked);
  render();
});
els.otsu.addEventListener('click', () => {
  if (!originalData) return;
  setThreshold(computeOtsuThreshold(originalData));
  render();
});

els.bgRemove.addEventListener('click', async () => {
  if (!originalData) return;
  els.bgRemove.disabled = true;
  setStatus('KI-Freistellung läuft… (Modell wird ggf. geladen)', false);
  try {
    const cut = await removeBackground(originalData);
    originalData = cut;
    els.keepAlpha.checked = true;
    document.body.classList.add('alpha');
    setStatus(`Hintergrund entfernt: ${cut.width}×${cut.height}px`, false);
    render();
  } catch (e) {
    setStatus(e.message || 'KI-Freistellung nicht verfügbar.', true);
  } finally {
    els.bgRemove.disabled = false;
  }
});

els.numColors.addEventListener('input', () => {
  els.numColorsVal.textContent = els.numColors.value;
  render();
});
els.levels.addEventListener('input', () => {
  els.levelsVal.textContent = els.levels.value;
  render();
});
els.colorIsland.addEventListener('input', () => {
  els.colorIslandVal.textContent = els.colorIsland.value;
  render();
});
els.smooth.addEventListener('input', () => {
  els.smoothVal.textContent = els.smooth.value;
  render();
});
els.circleEnable.addEventListener('change', () => { updateCircleCursor(); paint(); });
els.circleSize.addEventListener('input', () => {
  circle.r = Number(els.circleSize.value);
  els.circleSizeVal.textContent = els.circleSize.value;
  paint();
});
els.circleThickness.addEventListener('input', () => {
  els.circleThicknessVal.textContent = els.circleThickness.value;
  paint();
});
els.circleColor.addEventListener('input', paint);

// Drag on the preview to move the circle; wheel to zoom its radius.
let dragging = false, lastX = 0, lastY = 0;
let dragTarget = null; // 'circle' | 'mount'

function pointerToImage(e) {
  const rect = els.output.getBoundingClientRect();
  const scale = rect.width > 0 ? els.output.width / rect.width : 1; // frame px per client px (== image units)
  const f = circleFrame();
  return { x: (e.clientX - rect.left) * scale + f.x0, y: (e.clientY - rect.top) * scale + f.y0 };
}

els.output.addEventListener('pointerdown', e => {
  if (!processedData) return;
  if (mountActive()) {
    dragTarget = 'mount';
    const p = pointerToImage(e);
    mount.x = Math.max(0, Math.min(processedData.width, p.x));
    mount.y = Math.max(0, Math.min(processedData.height, p.y));
    els.output.setPointerCapture(e.pointerId);
    e.preventDefault();
    paint();
    return;
  }
  if (!els.circleEnable.checked) return;
  dragTarget = 'circle';
  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  els.output.setPointerCapture(e.pointerId);
  els.output.style.cursor = 'grabbing';
  e.preventDefault();
});
els.output.addEventListener('pointermove', e => {
  if (dragTarget === 'mount') {
    const p = pointerToImage(e);
    mount.x = Math.max(0, Math.min(processedData.width, p.x));
    mount.y = Math.max(0, Math.min(processedData.height, p.y));
    paint();
    return;
  }
  if (!dragging) return;
  const rect = els.output.getBoundingClientRect();
  const scale = els.output.width / rect.width;
  circle.cx = Math.max(0, Math.min(processedData.width, circle.cx + (e.clientX - lastX) * scale));
  circle.cy = Math.max(0, Math.min(processedData.height, circle.cy + (e.clientY - lastY) * scale));
  lastX = e.clientX; lastY = e.clientY;
  paint();
});
function endDrag() {
  if (!dragging && dragTarget !== 'mount') return;
  dragging = false;
  dragTarget = null;
  updateCircleCursor();
}
els.output.addEventListener('pointerup', endDrag);
els.output.addEventListener('pointercancel', endDrag);
els.output.addEventListener('wheel', e => {
  if (!els.circleEnable.checked || !processedData) return;
  e.preventDefault();
  const min = Number(els.circleSize.min), max = Number(els.circleSize.max);
  const next = Math.max(min, Math.min(max, circle.r * (e.deltaY < 0 ? 1.06 : 0.94)));
  circle.r = next;
  els.circleSize.value = Math.round(next);
  els.circleSizeVal.textContent = Math.round(next);
  paint();
}, { passive: false });

function setMode(m) {
  mode = m;
  updateControlVisibility();
  if (typeof setColorHeight === 'function') setColorHeight(colorHeight);
  render();
}
window.setMode = setMode;
function setColorMethod(m) {
  colorMethod = m;
  updateControlVisibility();
  render();
}
function setColorHeight(m) {
  colorHeight = m;
  els.colorHeightUniform.classList.toggle('seg-active', m === 'uniform');
  els.colorHeightBrightness.classList.toggle('seg-active', m === 'brightness');
  document.querySelectorAll('.color-brightness').forEach(e => { e.hidden = m !== 'brightness'; });
  // the uniform relief slider is only relevant in uniform mode
  els.colorRelief.closest('.field').hidden = (m === 'brightness') || mode !== 'color';
  updateDims();
}
window.setColorHeight = setColorHeight;
els.colorHeightUniform.addEventListener('click', () => setColorHeight('uniform'));
els.colorHeightBrightness.addEventListener('click', () => setColorHeight('brightness'));
els.colorMaxH.addEventListener('input', () => { els.colorMaxHVal.textContent = Number(els.colorMaxH.value).toFixed(1); updateDims(); });
els.colorDarkTall.addEventListener('change', () => updateDims());

function setMountType(t) {
  els.mountType.value = t;
  els.mountKein.classList.toggle('seg-active', t === 'kein');
  els.mountLoch.classList.toggle('seg-active', t === 'loch');
  els.mountOese.classList.toggle('seg-active', t === 'oese');
  document.querySelectorAll('.mount-on').forEach(e => { e.hidden = t === 'kein'; });
  document.querySelectorAll('.mount-oese').forEach(e => { e.hidden = t !== 'oese'; });
  updateCircleCursor();
  paint();
}
window.setMountType = setMountType;
els.mountKein.addEventListener('click', () => setMountType('kein'));
els.mountLoch.addEventListener('click', () => setMountType('loch'));
els.mountOese.addEventListener('click', () => setMountType('oese'));
els.mountDia.addEventListener('input', () => { els.mountDiaVal.textContent = Number(els.mountDia.value).toFixed(1); paint(); });
els.mountBoss.addEventListener('input', () => { els.mountBossVal.textContent = Number(els.mountBoss.value).toFixed(1); paint(); });

els.stampMode.addEventListener('change', render);
els.modeBw.addEventListener('click', () => setMode('bw'));
els.modeColor.addEventListener('click', () => setMode('color'));
els.methPalette.addEventListener('click', () => setColorMethod('palette'));
els.methPosterize.addEventListener('click', () => setColorMethod('posterize'));

els.modelWidth.addEventListener('input', () => { els.modelWidthVal.textContent = els.modelWidth.value; updateDims(); });
els.colorRelief.addEventListener('input', () => { els.colorReliefVal.textContent = Number(els.colorRelief.value).toFixed(1); updateDims(); });
els.thickBlack.addEventListener('input', () => { els.thickBlackVal.textContent = Number(els.thickBlack.value).toFixed(1); updateDims(); });
els.thickWhite.addEventListener('input', () => { els.thickWhiteVal.textContent = Number(els.thickWhite.value).toFixed(1); updateDims(); });
els.ringThick.addEventListener('input', () => { els.ringThickVal.textContent = Number(els.ringThick.value).toFixed(1); updateDims(); });
els.frameWidth.addEventListener('input', () => { els.frameWidthVal.textContent = els.frameWidth.value; updateDims(); });
els.baseThick.addEventListener('input', () => { els.baseThickVal.textContent = Number(els.baseThick.value).toFixed(1); updateDims(); });
els.modelRes.addEventListener('input', () => { els.modelResVal.textContent = els.modelRes.value; updateDims(); });
els.modelSmooth.addEventListener('input', () => { els.modelSmoothVal.textContent = Number(els.modelSmooth.value).toFixed(1); });
// ---- Export dialog ----
function currentExportName() { return safeFileName((els.exportName && els.exportName.value) || loadedName); }
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}
function openExportDialog() {
  if (!processedData) return;
  els.exportName.value = loadedName;
  els.exportMf.disabled = false;        // .3mf works in B/W AND color now
  els.exportStatus.textContent = '';
  els.exportModal.hidden = false;
}
function closeExportDialog() { els.exportModal.hidden = true; }
els.openExport.addEventListener('click', openExportDialog);
els.exportClose.addEventListener('click', closeExportDialog);
els.exportModal.addEventListener('click', e => { if (e.target === els.exportModal) closeExportDialog(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !els.exportModal.hidden) closeExportDialog(); });

// STL export — routed through the dialog (geometry only, both modes).
function exportSTL() {
  const { parts, stats } = buildParts();
  if (!parts.length) { els.exportStatus.textContent = 'Kein 3D-Modell: keine passenden Flächen gefunden.'; return; }
  const all = [];
  for (const p of parts) for (const f of p.facets) all.push(f);
  downloadBlob(new Blob([facetsToBinarySTL(all)], { type: 'model/stl' }), currentExportName() + '.stl');
  els.exportStatus.textContent = `STL exportiert: ${stats.tris} Dreiecke.`;
}
window.exportSTL = exportSTL;
els.exportStl.addEventListener('click', exportSTL);

els.exportPng.addEventListener('click', () => {
  if (!processedData) return;
  const data = exportData();
  const tmp = document.createElement('canvas'); tmp.width = data.width; tmp.height = data.height;
  tmp.getContext('2d').putImageData(data, 0, 0);
  tmp.toBlob(b => { downloadBlob(b, currentExportName() + '.png'); els.exportStatus.textContent = 'PNG exportiert.'; }, 'image/png');
});
els.exportSvg.addEventListener('click', () => {
  if (!processedData) return;
  const svg = buildReliefSVG();
  if (!svg) { els.exportStatus.textContent = 'Kein Inhalt für SVG.'; return; }
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), currentExportName() + '.svg');
  els.exportStatus.textContent = 'SVG exportiert.';
});
els.exportMf.addEventListener('click', () => exportModel());

// Vector SVG of the processed result: one filled path per color (potrace-traced),
// holes handled via fill-rule evenodd; sized in mm from the 3D width.
function buildReliefSVG() {
  const data = exportData();
  const w0 = data.width, h0 = data.height;
  const maxDim = Math.max(64, Math.min(1024, Number(els.modelRes.value) || 512));
  let cols, rows;
  if (w0 >= h0) { cols = Math.min(maxDim, w0); rows = Math.max(1, Math.round(cols * h0 / w0)); }
  else { rows = Math.min(maxDim, h0); cols = Math.max(1, Math.round(rows * w0 / h0)); }
  const full = document.createElement('canvas'); full.width = w0; full.height = h0;
  full.getContext('2d').putImageData(data, 0, 0);
  const g = document.createElement('canvas'); g.width = cols; g.height = rows;
  const gx = g.getContext('2d', { willReadFrequently: true });
  gx.imageSmoothingEnabled = false;
  gx.drawImage(full, 0, 0, cols, rows);
  const px = gx.getImageData(0, 0, cols, rows).data, n = cols * rows;
  const masks = new Map(); // hex -> Uint8Array
  for (let i = 0; i < n; i++) {
    if (px[i * 4 + 3] < 128) continue;
    const hex = '#' + [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    let mk = masks.get(hex); if (!mk) masks.set(hex, mk = new Uint8Array(n));
    mk[i] = 1;
  }
  if (!masks.size) return null;
  const pitch = (Number(els.modelWidth.value) || 80) / cols;
  const wMm = +(cols * pitch).toFixed(3), hMm = +(rows * pitch).toFixed(3);
  let paths = '';
  for (const [hex, mk] of masks) {
    const loops = window.traceMaskLoops(mk, cols, rows, {});
    let d = '';
    for (const lp of loops) {
      if (lp.length < 3) continue;
      d += 'M' + lp.map(([x, y]) => (x * pitch).toFixed(3) + ' ' + (y * pitch).toFixed(3)).join(' L') + ' Z ';
    }
    if (d) paths += `  <path d="${d.trim()}" fill="${hex}" fill-rule="evenodd" />\n`;
  }
  if (!paths) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}">\n${paths}</svg>\n`;
}
window.buildReliefSVG = buildReliefSVG;

// --- presets / persistence -------------------------------------------------
function refreshPresetSelect() {
  const sel = document.getElementById('presetSelect');
  if (!sel) return;
  sel.textContent = ''; // clear existing options safely
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Vorlage…';
  sel.appendChild(placeholder);
  for (const name of Object.keys(listPresets())) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
}
function initPresets() {
  seedBuiltinPresets();
  refreshPresetSelect();
  const sel = document.getElementById('presetSelect');
  sel.addEventListener('change', () => { if (sel.value && loadPreset(sel.value)) render(); });
  document.getElementById('presetSave').addEventListener('click', () => {
    const name = prompt('Vorlagenname:');
    const trimmed = name && name.trim();
    if (trimmed) { savePreset(trimmed); refreshPresetSelect(); }
  });
  document.getElementById('presetDelete').addEventListener('click', () => {
    if (sel.value) { deletePreset(sel.value); refreshPresetSelect(); }
  });
  // Persist on any control change (debounced).
  let t = null;
  document.addEventListener('input', () => { clearTimeout(t); t = setTimeout(saveLastState, 300); });
  document.addEventListener('change', () => { clearTimeout(t); t = setTimeout(saveLastState, 300); });
}
window.initPresets = initPresets;

updateControlVisibility();
setColorHeight('uniform');
