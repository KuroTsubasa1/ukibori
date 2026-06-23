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

function redrawCanvas() {
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
}
function bmRender() { redrawCanvas(); renderLayers(); renderProps(); }

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

function bmSelect(id) { state.selectedId = id; bmRender(); }

// ---- Layer list (top of list = top of z-order; doc.elements is back→front) ----
function renderLayers() {
  bm.layers.innerHTML = '';
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const el = doc.elements[i];
    const li = document.createElement('li');
    if (el.id === state.selectedId) li.classList.add('sel');
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = el.color || '#888';
    const name = document.createElement('span'); name.className = 'name';
    name.textContent = el.type === 'text' ? ('„' + el.text + '"') : 'Bild';
    const up = document.createElement('button'); up.className = 'lbtn'; up.textContent = '▲'; up.title = 'nach oben';
    const dn = document.createElement('button'); dn.className = 'lbtn'; dn.textContent = '▼'; dn.title = 'nach unten';
    const del = document.createElement('button'); del.className = 'lbtn'; del.textContent = '✕'; del.title = 'löschen';
    li.append(sw, name, up, dn, del);
    li.addEventListener('click', e => { if (e.target.classList.contains('lbtn')) return; bmSelect(el.id); });
    up.addEventListener('click', e => { e.stopPropagation(); moveLayer(i, +1); });
    dn.addEventListener('click', e => { e.stopPropagation(); moveLayer(i, -1); });
    del.addEventListener('click', e => { e.stopPropagation(); deleteLayer(i); });
    bm.layers.appendChild(li);
  }
}
function moveLayer(i, dir) {
  const j = i + dir; if (j < 0 || j >= doc.elements.length) return;
  const t = doc.elements[i]; doc.elements[i] = doc.elements[j]; doc.elements[j] = t; bmRender();
}
function deleteLayer(i) {
  const el = doc.elements[i]; doc.elements.splice(i, 1);
  if (state.selectedId === el.id) state.selectedId = null; bmRender();
}

// ---- Properties panel ----
function propRow(label, inputHTML) { return `<div class="field"><div class="field-head"><label>${label}</label></div>${inputHTML}</div>`; }
function renderProps() {
  const el = selected();
  if (!el) { bm.props.innerHTML = '<p class="hint">Kein Element ausgewählt.</p>'; return; }
  let html = '';
  if (el.type === 'text') {
    html += propRow('Text', `<input type="text" id="pText" value="${(el.text || '').replace(/"/g, '&quot;')}">`);
    html += propRow('Schrift', `<select id="pFont">
      ${['system-ui','serif','monospace','Georgia','Impact','Comic Sans MS'].map(f => `<option ${f===el.fontFamily?'selected':''}>${f}</option>`).join('')}
      ${el.fontFamily && !['system-ui','serif','monospace','Georgia','Impact','Comic Sans MS'].includes(el.fontFamily) ? `<option selected>${el.fontFamily}</option>` : ''}
      </select> <button class="btn" id="pFontUpload" type="button">Schrift laden</button>`);
    html += propRow('Fett', `<label class="toggle"><input type="checkbox" id="pBold" ${el.fontWeight==='bold'?'checked':''}> fett</label>`);
  }
  html += propRow('Farbe', `<input type="color" id="pColor" value="${el.color}">`);
  if (el.type === 'image') {
    html += propRow('Farbmodus', `<select id="pMode"><option value="solid" ${el.colorMode==='solid'?'selected':''}>Vollfarbe</option><option value="reduce" ${el.colorMode==='reduce'?'selected':''}>Farben reduzieren</option></select>`);
    if (el.colorMode === 'solid')
      html += propRow('Schwellwert', `<input type="range" id="pThresh" min="0" max="255" value="${el.threshold}"> <label class="toggle"><input type="checkbox" id="pInvert" ${el.invert?'checked':''}> invertieren</label>`);
    else
      html += propRow('Anzahl Farben', `<input type="range" id="pNum" min="2" max="16" value="${el.reduce.numColors}">`);
  }
  html += propRow('Tiefe (Schichten)', `<input type="range" id="pDepth" min="1" max="12" value="${el.depthLayers}"> <span class="badge">${el.depthLayers}</span>`);
  html += propRow('Breite (mm)', `<input type="range" id="pW" min="2" max="${doc.widthMm}" step="0.5" value="${el.wMm.toFixed(1)}">`);
  html += propRow('Höhe (mm)', `<input type="range" id="pH" min="2" max="${doc.heightMm}" step="0.5" value="${el.hMm.toFixed(1)}">`);
  html += propRow('Drehung (°)', `<input type="range" id="pRot" min="-180" max="180" value="${Math.round(el.rotationDeg)}">`);
  html += propRow('', `<label class="toggle"><input type="checkbox" id="pCut" ${el.cutout?'checked':''}> Aussparung (nichts dahinter)</label>`);
  bm.props.innerHTML = html;

  const on = (id, ev, fn) => { const e = document.getElementById(id); if (e) e.addEventListener(ev, fn); };
  on('pText', 'input', e => { el.text = e.target.value; redrawCanvas(); renderLayers(); });
  on('pFont', 'change', e => { el.fontFamily = e.target.value; redrawCanvas(); });
  on('pFontUpload', 'click', () => bm.fontFile.click());
  on('pBold', 'change', e => { el.fontWeight = e.target.checked ? 'bold' : 'normal'; redrawCanvas(); });
  on('pColor', 'input', e => { el.color = e.target.value; redrawCanvas(); renderLayers(); });
  on('pMode', 'change', e => { el.colorMode = e.target.value; bmRender(); });
  on('pThresh', 'input', e => { el.threshold = Number(e.target.value); redrawCanvas(); });
  on('pInvert', 'change', e => { el.invert = e.target.checked; redrawCanvas(); });
  on('pNum', 'input', e => { el.reduce.numColors = Number(e.target.value); redrawCanvas(); });
  on('pDepth', 'input', e => {
    el.depthLayers = Number(e.target.value);
    const badge = e.target.parentElement.querySelector('.badge');
    if (badge) badge.textContent = el.depthLayers;
    redrawCanvas();
  });
  on('pW', 'input', e => { el.wMm = Number(e.target.value); redrawCanvas(); });
  on('pH', 'input', e => { el.hMm = Number(e.target.value); redrawCanvas(); });
  on('pRot', 'input', e => { el.rotationDeg = Number(e.target.value); redrawCanvas(); });
  on('pCut', 'change', e => { el.cutout = e.target.checked; redrawCanvas(); });
}

// ---- Custom font loading ----
function bmLoadFontFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    const fam = 'bmfont-' + file.name.replace(/\W+/g, '');
    const ff = new FontFace(fam, rd.result);
    ff.load().then(loaded => {
      document.fonts.add(loaded);
      const el = selected(); if (el && el.type === 'text') { el.fontFamily = fam; }
      bmRender();
      bmStatus('Schrift geladen: ' + file.name);
    }).catch(() => bmStatus('Schrift konnte nicht geladen werden.', true));
  };
  rd.readAsArrayBuffer(file);
}
bm.fontFile.addEventListener('change', e => { const f = e.target.files[0]; if (f) bmLoadFontFile(f); bm.fontFile.value = ''; });
window.bmLoadFontFile = bmLoadFontFile;

// ---- Pointer manipulation (move / scale / rotate) ----
function elemToLocal(el, px, py, s) {
  const dx = px - el.cxMm * s, dy = py - el.cyMm * s, a = -(el.rotationDeg || 0) * Math.PI / 180;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}
function bmHitTest(px, py) {
  const s = state.scale;
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const el = doc.elements[i], [lx, ly] = elemToLocal(el, px, py, s), w = el.wMm * s, h = el.hMm * s;
    if (Math.hypot(lx, ly + h / 2 + 22) <= 9) return { id: el.id, handle: 'rotate' };
    const corners = { nw:[-w/2,-h/2], ne:[w/2,-h/2], se:[w/2,h/2], sw:[-w/2,h/2] };
    for (const k in corners) if (Math.hypot(lx - corners[k][0], ly - corners[k][1]) <= 9) return { id: el.id, handle: k };
    if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return { id: el.id, handle: 'move' };
  }
  return null;
}
window.bmHitTest = bmHitTest;

let drag = null;
bm.canvas.addEventListener('pointerdown', e => {
  const rect = bm.canvas.getBoundingClientRect(), scaleC = bm.canvas.width / rect.width;
  const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
  const hit = bmHitTest(px, py);
  if (!hit) { state.selectedId = null; bmRender(); return; }
  state.selectedId = hit.id;
  const el = selected();
  drag = { handle: hit.handle, px, py, start: { cx: el.cxMm, cy: el.cyMm, w: el.wMm, h: el.hMm, rot: el.rotationDeg } };
  bm.canvas.setPointerCapture(e.pointerId); bmRender();
});
bm.canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const rect = bm.canvas.getBoundingClientRect(), scaleC = bm.canvas.width / rect.width, s = state.scale;
  const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
  const el = selected(); if (!el) return;
  if (drag.handle === 'move') {
    el.cxMm = drag.start.cx + (px - drag.px) / s; el.cyMm = drag.start.cy + (py - drag.py) / s;
  } else if (drag.handle === 'rotate') {
    const ang = Math.atan2(py - el.cyMm * s, px - el.cxMm * s) * 180 / Math.PI + 90;
    el.rotationDeg = Math.round(ang);
  } else {
    const [lx, ly] = elemToLocal(el, px, py, s);
    el.wMm = Math.max(2, Math.abs(lx) * 2 / s); el.hMm = Math.max(2, Math.abs(ly) * 2 / s);
  }
  redrawCanvas();
});
function endDrag() { drag = null; bmRender(); }
bm.canvas.addEventListener('pointerup', endDrag);
bm.canvas.addEventListener('pointercancel', endDrag);

window.addEventListener('resize', () => { if (!bm.ws.hidden) bmRender(); });

// Verification hooks.
Object.defineProperty(window, 'bmDoc', { get() { return doc; }, set(v) { doc = v; } });
window.bmRender = bmRender;
window.bmSelect = bmSelect;
window.bmAddImageFromDataURL = bmAddImageFromDataURL;
window.bmState = state;
