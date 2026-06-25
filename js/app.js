"use strict";

const els = {
  drop: document.getElementById('drop'),
  file: document.getElementById('file'),
  keepAlpha: document.getElementById('keepAlpha'),
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
  bodyColor: document.getElementById('bodyColor'),
  modelRes: document.getElementById('modelRes'),
  modelResVal: document.getElementById('modelResVal'),
  modelSmooth: document.getElementById('modelSmooth'),
  modelSmoothVal: document.getElementById('modelSmoothVal'),
  modelExport: document.getElementById('modelExport'),
  stlExport: document.getElementById('stlExport'),
  dims: document.getElementById('dims'),
  download: document.getElementById('download'),
  output: document.getElementById('output'),
  preview: document.getElementById('preview'),
  controls: document.getElementById('controls'),
  status: document.getElementById('status'),
};

let mode = 'bw';            // 'bw' | 'color'
let colorMethod = 'palette'; // 'palette' | 'posterize'

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
  [els.keepAlpha, els.thresh, els.island, els.otsu, els.invert, els.numColors, els.levels,
   els.colorIsland, els.smooth, els.circleEnable, els.circleSize,
   els.circleThickness, els.circleColor, els.modelWidth, els.thickBlack,
   els.thickWhite, els.ringThick, els.frameWidth, els.baseThick, els.bodyColor,
   els.modelRes, els.modelSmooth, els.modelExport, els.stlExport, els.download]
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
  ctx.drawImage(processedCanvas, -f.x0, -f.y0);
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
  ctx.drawImage(processedCanvas, -x0, -y0);
  const data = ctx.getImageData(0, 0, fw, fh);
  applyCircleMask(data, Number(els.circleThickness.value),
    hexToRgb(els.circleColor.value), circle.cx - x0, circle.cy - y0, r, keepAlpha);
  return data;
}

function updateCircleCursor() {
  els.output.style.cursor = els.circleEnable.checked ? 'grab' : 'default';
}

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
  return { cols, rows, pitch: Number(els.modelWidth.value) / cols, fBase, fBlack, fWhite, fRing };
}
window.buildFields = buildFields;

// Builds the colored parts for the current B/W result. Shared by .3mf, STL,
// and the 3D preview so preview == print. Returns empty parts when there is
// nothing to build (no image, or not in B/W mode).
function buildParts() {
  if (!processedData || mode !== 'bw') return { parts: [], stats: { tris: 0 } };
  const maxDim = Number(els.modelRes.value);
  const { cols, rows, pitch, fBase, fBlack, fWhite, fRing } = buildFields(maxDim);
  const tol = Number(els.modelSmooth.value) * pitch; // slider is in cells
  const baseT = Number(els.baseThick.value);
  const bodyColor = hexToRgb(els.bodyColor.value);
  const facets = (f, thick, z0) => orientOutward(fieldFacets(f, cols, rows, pitch, thick, tol, z0));
  const parts = [];
  const baseF = facets(fBase, baseT, 0);
  if (baseF.length) parts.push({ name: 'grundplatte', color: bodyColor, facets: baseF });
  const blackF = facets(fBlack, Number(els.thickBlack.value), baseT);
  if (blackF.length) parts.push({ name: 'schwarz', color: [0, 0, 0], facets: blackF });
  const whiteF = facets(fWhite, Number(els.thickWhite.value), baseT);
  if (whiteF.length) parts.push({ name: 'weiss', color: [255, 255, 255], facets: whiteF });
  if (fRing) {
    const randColor = els.circleEnable.checked ? hexToRgb(els.circleColor.value) : bodyColor;
    const ringF = facets(fRing, Number(els.ringThick.value), baseT);
    if (ringF.length) parts.push({ name: 'rand', color: randColor, facets: ringF });
  }
  const tris = parts.reduce((s, p) => s + p.facets.length, 0);
  return { parts, stats: { tris } };
}
window.buildParts = buildParts;

// Final physical dimensions in mm: width from the slider, height from the
// model grid aspect, total thickness = base + tallest relief layer.
function computeDimensions() {
  if (!processedData) return null;
  const { cols, rows } = buildFields(Number(els.modelRes.value));
  const w = Number(els.modelWidth.value);
  const h = w * (rows / cols);
  const t = Number(els.baseThick.value) + Math.max(
    Number(els.thickBlack.value), Number(els.thickWhite.value),
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
  a.download = 'modell.3mf';
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`3D-Modell (.3mf) exportiert: ${parts.length} Teile, ${stats.tris} Dreiecke.`, false);
}
window.exportModel = exportModel;

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    setStatus('Bitte eine Bilddatei auswählen.', true);
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    try {
      offscreen.width = img.naturalWidth;
      offscreen.height = img.naturalHeight;
      offCtx.drawImage(img, 0, 0);
      originalData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
    } catch (e) {
      setStatus('Bild ist zu groß zum Verarbeiten.', true);
      return;
    }
    enableControls(true);
    restoreLastState();
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
    updateCircleCursor();
    setStatus(`Geladen: ${img.naturalWidth}×${img.naturalHeight}px`, false);
    render();
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
els.output.addEventListener('pointerdown', e => {
  if (!els.circleEnable.checked || !processedData) return;
  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  els.output.setPointerCapture(e.pointerId);
  els.output.style.cursor = 'grabbing';
  e.preventDefault();
});
els.output.addEventListener('pointermove', e => {
  if (!dragging) return;
  const rect = els.output.getBoundingClientRect();
  const scale = els.output.width / rect.width; // frame px per client px (1:1 with image units)
  // Clamp the center to the image so the circle always overlaps it; the frame
  // extends to fit whatever part of the circle pokes past the edges.
  circle.cx = Math.max(0, Math.min(processedData.width, circle.cx + (e.clientX - lastX) * scale));
  circle.cy = Math.max(0, Math.min(processedData.height, circle.cy + (e.clientY - lastY) * scale));
  lastX = e.clientX; lastY = e.clientY;
  paint();
});
function endDrag() {
  if (!dragging) return;
  dragging = false;
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
  render();
}
function setColorMethod(m) {
  colorMethod = m;
  updateControlVisibility();
  render();
}
els.modeBw.addEventListener('click', () => setMode('bw'));
els.modeColor.addEventListener('click', () => setMode('color'));
els.methPalette.addEventListener('click', () => setColorMethod('palette'));
els.methPosterize.addEventListener('click', () => setColorMethod('posterize'));

els.modelWidth.addEventListener('input', () => { els.modelWidthVal.textContent = els.modelWidth.value; updateDims(); });
els.thickBlack.addEventListener('input', () => { els.thickBlackVal.textContent = Number(els.thickBlack.value).toFixed(1); updateDims(); });
els.thickWhite.addEventListener('input', () => { els.thickWhiteVal.textContent = Number(els.thickWhite.value).toFixed(1); updateDims(); });
els.ringThick.addEventListener('input', () => { els.ringThickVal.textContent = Number(els.ringThick.value).toFixed(1); updateDims(); });
els.frameWidth.addEventListener('input', () => { els.frameWidthVal.textContent = els.frameWidth.value; updateDims(); });
els.baseThick.addEventListener('input', () => { els.baseThickVal.textContent = Number(els.baseThick.value).toFixed(1); updateDims(); });
els.modelRes.addEventListener('input', () => { els.modelResVal.textContent = els.modelRes.value; updateDims(); });
els.modelSmooth.addEventListener('input', () => { els.modelSmoothVal.textContent = Number(els.modelSmooth.value).toFixed(1); });
els.modelExport.addEventListener('click', exportModel);

function exportSTL() {
  const { parts, stats } = buildParts();
  if (!parts.length) {
    setStatus('Kein 3D-Modell: keine passenden Flächen gefunden.', true);
    return;
  }
  const all = [];
  for (const p of parts) for (const f of p.facets) all.push(f);
  const blob = new Blob([facetsToBinarySTL(all)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.download = 'modell.stl';
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`3D-Modell (.stl) exportiert: ${stats.tris} Dreiecke.`, false);
}
window.exportSTL = exportSTL;
els.stlExport.addEventListener('click', exportSTL);

els.download.addEventListener('click', () => {
  if (!processedData) return;
  const data = exportData();
  const tmp = document.createElement('canvas');
  tmp.width = data.width;
  tmp.height = data.height;
  tmp.getContext('2d').putImageData(data, 0, 0);
  const a = document.createElement('a');
  a.download = mode === 'bw' ? 'schwarz-weiss.png' : 'farben-reduziert.png';
  a.href = tmp.toDataURL('image/png');
  a.click();
});

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
