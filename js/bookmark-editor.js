"use strict";
// Bookmark composer editor: state, canvas rendering, selection/manipulation,
// layer list, properties, project save/load, and .3mf export wiring.

let doc = defaultBookmark();
const state = { selectedId: null, scale: 1, ox: 0, oy: 0 }; // scale = px per mm; ox/oy = canvas origin

const bm = {
  modeRelief: document.getElementById('appModeRelief'),
  modeBookmark: document.getElementById('appModeBookmark'),
  ws: document.getElementById('bmWorkspace'),
  canvas: document.getElementById('bmCanvas'),
  preview: document.getElementById('bmPreview'),
  addImage: document.getElementById('bmAddImage'),
  addText: document.getElementById('bmAddText'),
  file: document.getElementById('bmFile'),
  fontFile: document.getElementById('bmFontFile'),
  loadFile: document.getElementById('bmLoadFile'),
  layers: document.getElementById('bmLayers'),
  props: document.getElementById('bmProps'),
  status: document.getElementById('bmStatus'),
  exportBtn: document.getElementById('bmExport'),
  save: document.getElementById('bmSave'),
  load: document.getElementById('bmLoad'),
};

function bmStatus(msg, isErr) { bm.status.textContent = msg; bm.status.className = isErr ? 'status error' : 'status'; }
function selected() { return doc.elements.find(e => e.id === state.selectedId) || null; }

// ---- Mode switch ----
function setAppMode(bookmark) {
  document.body.classList.toggle('bookmark-mode', bookmark);
  bm.ws.hidden = !bookmark;
  bm.preview.classList.toggle('ready', bookmark);
  bm.modeRelief.classList.toggle('seg-active', !bookmark);
  bm.modeBookmark.classList.toggle('seg-active', bookmark);
  if (bookmark) bmRender();
}
bm.modeRelief.addEventListener('click', () => setAppMode(false));
bm.modeBookmark.addEventListener('click', () => setAppMode(true));

// ---- Canvas fit + render ----
function fitScale() {
  const pad = 24;
  const availW = (bm.preview.clientWidth || 600) - pad;
  const availH = (bm.preview.clientHeight || 700) - pad;
  const s = Math.max(1, Math.min(availW / doc.widthMm, availH / doc.heightMm));
  state.scale = s;
  bm.canvas.width = Math.round(doc.widthMm * s);
  bm.canvas.height = Math.round(doc.heightMm * s);
}

function bodyPath(ctx, s) {
  const w = doc.widthMm * s, h = doc.heightMm * s, rr = Math.min(doc.cornerRadiusMm * s, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(rr, 0); ctx.arcTo(w, 0, w, h, rr); ctx.arcTo(w, h, 0, h, rr);
  ctx.arcTo(0, h, 0, 0, rr); ctx.arcTo(0, 0, w, 0, rr); ctx.closePath();
}

function drawElement(ctx, el, s) {
  ctx.save();
  ctx.translate(el.cxMm * s, el.cyMm * s);
  ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
  const w = el.wMm * s, h = el.hMm * s;
  if (el.type === 'text') {
    ctx.fillStyle = el.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${el.fontWeight} ${Math.max(1, Math.round(h))}px ${el.fontFamily}`;
    ctx.fillText(el.text, 0, 0);
  } else if (el._img) {
    ctx.drawImage(el._img, -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = '#444'; ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

function drawSelection(ctx, el, s) {
  ctx.save();
  ctx.translate(el.cxMm * s, el.cyMm * s);
  ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
  const w = el.wMm * s, h = el.hMm * s;
  ctx.strokeStyle = '#6b4fb0'; ctx.lineWidth = 1.5; ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#6b4fb0';
  for (const [hx, hy] of [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]) {
    ctx.beginPath(); ctx.rect(hx - 5, hy - 5, 10, 10); ctx.fill();
  }
  // rotate handle
  ctx.beginPath(); ctx.moveTo(0, -h/2); ctx.lineTo(0, -h/2 - 22); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -h/2 - 22, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function bmRender() {
  if (bm.ws.hidden) return;
  fitScale();
  const s = state.scale, ctx = bm.canvas.getContext('2d');
  ctx.clearRect(0, 0, bm.canvas.width, bm.canvas.height);
  // body
  bodyPath(ctx, s); ctx.fillStyle = doc.baseColor; ctx.fill();
  // hole (punch out)
  ctx.save(); bodyPath(ctx, s); ctx.clip();
  const hr = (doc.hole.diameterMm / 2) * s, hx = (doc.widthMm / 2) * s, hy = (doc.hole.marginTopMm + doc.hole.diameterMm / 2) * s;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // elements (back→front), clipped to body
  ctx.save(); bodyPath(ctx, s); ctx.clip();
  for (const el of doc.elements) drawElement(ctx, el, s);
  ctx.restore();
  // outline + selection
  bodyPath(ctx, s); ctx.strokeStyle = '#3a3a44'; ctx.lineWidth = 1; ctx.stroke();
  const sel = selected(); if (sel) drawSelection(ctx, sel, s);
  renderLayers(); renderProps();
}

// ---- Settings wiring ----
function bindRange(id, key, fmt) {
  const inp = document.getElementById(id), badge = document.getElementById(id + 'Val');
  inp.addEventListener('input', () => {
    const v = Number(inp.value);
    setDocValue(key, v);
    if (badge) badge.textContent = fmt ? fmt(v) : String(v);
    bmRender();
  });
}
function setDocValue(key, v) {
  if (key === 'hole.diameterMm') doc.hole.diameterMm = v;
  else if (key === 'hole.marginTopMm') doc.hole.marginTopMm = v;
  else doc[key] = v;
}
bindRange('bmWidth', 'widthMm');
bindRange('bmHeight', 'heightMm');
bindRange('bmCorner', 'cornerRadiusMm', v => String(v));
bindRange('bmThickness', 'thicknessMm', v => v.toFixed(1));
bindRange('bmLayerHeight', 'layerHeightMm', v => v.toFixed(2));
bindRange('bmHoleD', 'hole.diameterMm', v => String(v));
bindRange('bmHoleMargin', 'hole.marginTopMm', v => String(v));
bindRange('bmResolution', 'resolution');
document.getElementById('bmBaseColor').addEventListener('input', e => { doc.baseColor = e.target.value; bmRender(); });

// ---- Add elements ----
function bmAddImageFromDataURL(dataURL) {
  const el = makeImageElement({ src: dataURL });
  const img = new Image();
  img.onload = () => {
    const maxMm = Math.min(doc.widthMm * 0.8, doc.heightMm * 0.4);
    const ar = img.naturalWidth / img.naturalHeight || 1;
    el.wMm = ar >= 1 ? maxMm : maxMm * ar;
    el.hMm = ar >= 1 ? maxMm / ar : maxMm;
    el._img = img;
    bmRender();
  };
  img.src = dataURL;
  doc.elements.push(el);
  state.selectedId = el.id;
  bmRender();
}
bm.addImage.addEventListener('click', () => bm.file.click());
bm.file.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => bmAddImageFromDataURL(rd.result);
  rd.readAsDataURL(f);
  bm.file.value = '';
});
bm.addText.addEventListener('click', () => {
  const el = makeTextElement({ text: 'Text', wMm: doc.widthMm * 0.7, hMm: 10, cxMm: doc.widthMm / 2, cyMm: doc.heightMm / 2 });
  doc.elements.push(el); state.selectedId = el.id; bmRender();
});

// Stubs filled in Task 7.
function renderLayers() {}
function renderProps() {}
function bmSelect(id) { state.selectedId = id; bmRender(); }

window.addEventListener('resize', () => { if (!bm.ws.hidden) bmRender(); });

// Verification hooks.
Object.defineProperty(window, 'bmDoc', { get() { return doc; }, set(v) { doc = v; } });
window.bmRender = bmRender;
window.bmSelect = bmSelect;
window.bmAddImageFromDataURL = bmAddImageFromDataURL;
window.bmState = state;
