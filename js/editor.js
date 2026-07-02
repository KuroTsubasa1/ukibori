"use strict";
// Unified editor controller. Owns the v2 doc; renders the 2D canvas; manages the
// Simple/Advanced view. Ported from bookmark-editor.js draw/hit/drag, adapted to
// the v2 doc shape (body.shape, mount, makeElementV2). Phase 3 Tasks 2+.
(function () {
  // ---- file:// guard for features that require HTTP (WASM/ONNX) ----
  var __isFile = (location.protocol === 'file:');
  if (__isFile) {
    window.addEventListener('DOMContentLoaded', function () {
      var btn = document.getElementById('removeBgBtn');
      var statusEl = document.getElementById('bgStatus');
      if (btn) btn.disabled = true;
      if (statusEl) statusEl.textContent =
        'KI-Freistellung benötigt einen HTTP-Server (nicht per Doppelklick/file:// öffnen). ' +
        'Starte z. B. ⁠`python3 -m http.server`⁠ und öffne http://localhost:8000.';
    });
  }

  const VIEW_KEY = "ukibori.view";
  const doc = window.defaultDoc();
  const cv = document.getElementById("canvas2d");

  // Module-local interaction state (scale = px per mm; ox/oy reserved for future pan).
  // viewX0/viewY0: mm offset of canvas top-left from plate origin (≤0 when tab overhangs top/left).
  const state = { selectedId: null, scale: 1, ox: 0, oy: 0, viewX0: 0, viewY0: 0 };

  // ---- mm↔px helpers — all drawing/hit-test coordinates go through these ----
  // mmX(x): mm doc-space x → canvas px. Inverse: (px / s) + viewX0.
  function mmX(x) { return (x - state.viewX0) * state.scale; }
  function mmY(y) { return (y - state.viewY0) * state.scale; }
  function pxToMmX(px) { return px / state.scale + state.viewX0; }
  function pxToMmY(py) { return py / state.scale + state.viewY0; }

  // Default depth direction for newly created elements.
  let defaultDirection = "raised";

  // ---- View toggle (Task 1, preserved) ----
  function getView() { return document.body.classList.contains("mode-advanced") ? "advanced" : "simple"; }
  function setView(v) {
    const adv = v === "advanced";
    document.body.classList.toggle("mode-advanced", adv);
    document.getElementById("viewSimple").classList.toggle("seg-active", !adv);
    document.getElementById("viewAdvanced").classList.toggle("seg-active", adv);
    document.getElementById("sidebarSimple").hidden = adv;
    document.getElementById("sidebarAdvanced").hidden = !adv;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
  }

  // ---- visibleDoc: filter _hidden elements for 3D preview + export ----
  function visibleDoc() {
    return Object.assign({}, doc, { elements: doc.elements.filter(function (e) { return !e._hidden; }) });
  }

  // ---- 3D rebuild (debounced, 120 ms) ----
  let _rebuild3DTimer = null;
  function scheduleRebuild3D() {
    if (!window.preview3d || !window.preview3d.isActive()) return;
    clearTimeout(_rebuild3DTimer);
    _rebuild3DTimer = setTimeout(function () { window.preview3d.rebuild(); }, 120);
  }

  // ---- Element-field helpers (DRY refactor) ----

  // Returns the currently selected element, or null.
  function selectedEl() {
    return doc.elements.find(function (e) { return e.id === state.selectedId; }) || null;
  }

  // Runs mutate(el) on the selected element, then optionally invalidates _display and re-renders.
  // If mutate returns false, the update is aborted (no state change, no re-render).
  function withSelected(mutate, opts) {
    var el = selectedEl();
    if (!el) return;
    if (mutate(el) === false) return;
    if (opts && opts.invalidate) delete el._display;
    render2D();
    scheduleRebuild3D();
  }

  // Wires a single control: on evt, calls withSelected with apply(el, node).
  function bindElementField(id, evt, apply, opts) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener(evt, function () {
      withSelected(function (el) { return apply(el, node); }, opts);
    });
  }

  // ---- Canvas fit scale ----
  // Fits the full domain (plate ∪ washer bbox) into the preview element.
  // Also updates state.viewX0/viewY0 from docDomain so all conversions stay in sync.
  function fitScale() {
    const pad = 24;
    const preview = document.getElementById("preview");
    const availW = (preview ? preview.clientWidth : 600) - pad;
    const availH = (preview ? preview.clientHeight : 700) - pad;
    // Use expanded domain (docDomain exported by T1; falls back to body box if unavailable).
    var domain = (window.docDomain ? window.docDomain(doc) : { x0: 0, y0: 0, wMm: doc.body.widthMm, hMm: doc.body.heightMm });
    state.viewX0 = domain.x0;
    state.viewY0 = domain.y0;
    const s = Math.max(1, Math.min(availW / domain.wMm, availH / domain.hMm));
    state.scale = s;
    cv.width = Math.round(domain.wMm * s);
    cv.height = Math.round(domain.hMm * s);
  }

  // ---- Plate paths ----
  // Rounded-rect path for body.shape === 'rect'.
  function bodyPath(ctx) {
    const body = doc.body;
    const x0 = mmX(0), y0 = mmY(0);
    const x1 = mmX(body.widthMm), y1 = mmY(body.heightMm);
    const w = x1 - x0, h = y1 - y0;
    const rr = Math.min((body.cornerRadiusMm || 0) * state.scale, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x0 + rr, y0);
    ctx.arcTo(x1, y0, x1, y1, rr);
    ctx.arcTo(x1, y1, x0, y1, rr);
    ctx.arcTo(x0, y1, x0, y0, rr);
    ctx.arcTo(x0, y0, x1, y0, rr);
    ctx.closePath();
  }

  // ---- Image-processing display cache (WYSIWYG: what-you-see == what-prints) ----

  // Cache key: encodes all processing params that affect the display canvas.
  function elementDisplayKey(el) {
    var d = el.depth;
    var r = (d && d.reduce) || {};
    return [
      (d && d.mode) || 'solid',
      el.color || '',
      (d && d.threshold != null ? d.threshold : 128),
      !!(d && d.invert),
      r.method || 'palette', r.numColors || '', r.levels || '',
      JSON.stringify(r.remap || {}),
      JSON.stringify(r.order || [])
    ].join('|');
  }

  // hex helper (uppercase) — local, not a global redeclaration.
  function __hexOfRGB(r, g, b) {
    return ('#' + [r, g, b].map(function (x) { return x.toString(16).padStart(2, '0'); }).join('')).toUpperCase();
  }

  // Build a shim that looks like a v1 element for __orderedNaturalHexes / __imagePaletteFromImg.
  // They read el.colorMode, el._img, el.reduce.* — so we bridge from v2 depth.reduce.
  function __makeV1Shim(el) {
    return {
      type: 'image',
      colorMode: 'reduce',
      _img: el._img,
      reduce: (el.depth && el.depth.reduce) || {},
    };
  }

  // Returns a cached off-screen canvas showing the processed image for the given element:
  //   heightmap  → grayscale (brightness-inverted when el.depth.invert).
  //   colorLayers → each opaque pixel mapped to the nearest palette color + remap applied.
  //   solid       → luminance threshold → silhouette in el.color, rest transparent.
  // Cache lives on el._display / el._displayKey; invalidated by deleting el._display.
  function processImageForDisplay(el) {
    if (el.type !== 'image' || !el._img) return null;
    var key = elementDisplayKey(el);
    if (el._display && el._displayKey === key) return el._display;

    var img = el._img;
    var iw = img.naturalWidth || img.width || 1;
    var ih = img.naturalHeight || img.height || 1;
    var scale = Math.min(1, 256 / Math.max(iw, ih, 1));
    var w = Math.max(1, Math.round(iw * scale));
    var h = Math.max(1, Math.round(ih * scale));
    var n = w * h;

    var src = document.createElement('canvas');
    src.width = w; src.height = h;
    var sx = src.getContext('2d', { willReadFrequently: true });
    sx.drawImage(img, 0, 0, w, h);
    var imgData = sx.getImageData(0, 0, w, h);
    var d = imgData.data;
    var out = sx.createImageData(w, h);
    var o = out.data;

    var depth = el.depth || {};
    var mode = depth.mode || 'solid';

    if (mode === 'heightmap') {
      // Grayscale: brightness of each opaque pixel, optionally inverted.
      for (var i = 0; i < n; i++) {
        if (d[i * 4 + 3] < 128) continue;
        var lum = Math.round(0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2]);
        var v = depth.invert ? (255 - lum) : lum;
        o[i*4] = v; o[i*4+1] = v; o[i*4+2] = v; o[i*4+3] = 255;
      }
    } else if (mode === 'colorLayers') {
      // Reduced palette + remap: mirrors what the engine exports.
      var shim = __makeV1Shim(el);
      var r = depth.reduce || {};
      try {
        var pal = window.__imagePaletteFromImg(img, r.method || 'palette', r.numColors || 8, r.levels || 4);
        var remap = r.remap || {};
        for (var j = 0; j < n; j++) {
          if (d[j * 4 + 3] < 128) continue;
          var near = window.__nearestColor(pal, d[j*4], d[j*4+1], d[j*4+2]);
          var cr = near[0], cg = near[1], cb = near[2];
          var natHex = __hexOfRGB(cr, cg, cb);
          var mapped = remap[natHex];
          if (mapped && window.hexToRgb) {
            var mc = window.hexToRgb(mapped);
            if (mc) { cr = mc[0]; cg = mc[1]; cb = mc[2]; }
          }
          o[j*4] = cr; o[j*4+1] = cg; o[j*4+2] = cb; o[j*4+3] = 255;
        }
      } catch (e) {
        // Fallback: draw raw image (palette helper unavailable).
        for (var k = 0; k < n; k++) {
          o[k*4] = d[k*4]; o[k*4+1] = d[k*4+1]; o[k*4+2] = d[k*4+2]; o[k*4+3] = d[k*4+3];
        }
      }
    } else {
      // solid: luminance threshold → silhouette in el.color.
      var threshold = (depth.threshold != null ? depth.threshold : 128);
      var colRGB = (window.hexToRgb && el.color) ? window.hexToRgb(el.color) : null;
      var colR = colRGB ? colRGB[0] : 255;
      var colG = colRGB ? colRGB[1] : 255;
      var colB = colRGB ? colRGB[2] : 255;
      for (var p = 0; p < n; p++) {
        if (d[p * 4 + 3] < 128) continue;
        var lp = 0.299 * d[p*4] + 0.587 * d[p*4+1] + 0.114 * d[p*4+2];
        var on = depth.invert ? (lp >= threshold) : (lp < threshold);
        if (on) { o[p*4] = colR; o[p*4+1] = colG; o[p*4+2] = colB; o[p*4+3] = 255; }
      }
    }

    var cv2 = document.createElement('canvas');
    cv2.width = w; cv2.height = h;
    cv2.getContext('2d').putImageData(out, 0, 0);
    el._display = cv2;
    el._displayKey = key;
    return cv2;
  }

  // ---- Palette swatch UI (Advanced Umwandlung, colorLayers mode) ----

  function renderPaletteSwatches(el) {
    var cont = document.getElementById('advPaletteSwatch');
    var field = document.getElementById('advPaletteField');
    if (!cont || !field) return;
    var isColorLayers = el && el.type === 'image' && el._img &&
      ((el.depth && el.depth.mode) || 'solid') === 'colorLayers';
    field.hidden = !isColorLayers;
    if (!isColorLayers) { cont.innerHTML = ''; return; }
    // Use the v1 shim to call __orderedNaturalHexes.
    var shim = __makeV1Shim(el);
    var hexes = [];
    try { hexes = window.__orderedNaturalHexes(shim); } catch (e) {}
    if (!hexes || hexes.length === 0) {
      cont.innerHTML = '<span class="hint">Keine Farben gefunden</span>';
      return;
    }
    var remap = (el.depth && el.depth.reduce && el.depth.reduce.remap) || {};
    var html = hexes.map(function (nat) {
      var eff = remap[nat] || nat.toLowerCase();
      return '<span class="pal-entry" draggable="true" data-orig="' + nat + '">'
        + '<span class="grip" aria-hidden="true">⠿</span>'
        + '<input type="color" class="sw-edit" data-orig="' + nat + '" value="' + eff + '" title="' + nat + ' → ' + eff + '">'
        + '</span>';
    }).join('');
    cont.innerHTML = html || '<span class="hint">–</span>';
    wirePaletteSwatches(el);
  }

  function wirePaletteSwatches(el) {
    var cont = document.getElementById('advPaletteSwatch');
    if (!cont) return;
    cont.querySelectorAll('.sw-edit').forEach(function (inp) {
      inp.addEventListener('input', function (e) {
        if (!el.depth.reduce) el.depth.reduce = {};
        if (!el.depth.reduce.remap) el.depth.reduce.remap = {};
        el.depth.reduce.remap[e.target.dataset.orig] = e.target.value;
        e.target.title = e.target.dataset.orig + ' → ' + e.target.value;
        delete el._display; // invalidate cache
        render2D();
        scheduleRebuild3D();
      });
    });
    var dragSrc = null;
    cont.querySelectorAll('.pal-entry').forEach(function (entry) {
      entry.addEventListener('dragstart', function (e) {
        dragSrc = entry.dataset.orig;
        e.dataTransfer.effectAllowed = 'move';
        entry.classList.add('dragging');
      });
      entry.addEventListener('dragend', function () {
        dragSrc = null;
        entry.classList.remove('dragging');
        cont.querySelectorAll('.pal-entry').forEach(function (e2) { e2.classList.remove('drag-over'); });
      });
      entry.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        entry.classList.add('drag-over');
      });
      entry.addEventListener('dragleave', function () {
        entry.classList.remove('drag-over');
      });
      entry.addEventListener('drop', function (e) {
        e.preventDefault();
        entry.classList.remove('drag-over');
        var tgt = entry.dataset.orig;
        if (!dragSrc || dragSrc === tgt) return;
        // Get current ordered hexes via shim, reorder.
        var shim = __makeV1Shim(el);
        var ord = [];
        try { ord = window.__orderedNaturalHexes(shim).slice(); } catch (err) {}
        var from = ord.indexOf(dragSrc), to = ord.indexOf(tgt);
        if (from < 0 || to < 0) return;
        ord.splice(to, 0, ord.splice(from, 1)[0]);
        if (!el.depth.reduce) el.depth.reduce = {};
        el.depth.reduce.order = ord;
        delete el._display;
        renderPaletteSwatches(el);
        render2D();
        scheduleRebuild3D();
      });
    });
  }

  // ---- Draw element ----
  // vx0/vy0: view-origin offset in mm (default: state.viewX0/viewY0).
  // Pass vx0=0,vy0=0 when drawing into a non-canvas context (e.g. SVG raster offscreen).
  function drawElement(ctx, el, s, vx0, vy0) {
    var ox = (vx0 !== undefined ? vx0 : state.viewX0);
    var oy = (vy0 !== undefined ? vy0 : state.viewY0);
    ctx.save();
    ctx.translate((el.cxMm - ox) * s, (el.cyMm - oy) * s);
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    const w = el.wMm * s, h = el.hMm * s;
    if (el.type === "text") {
      ctx.fillStyle = el.color || "#ffffff";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${el.fontWeight || "normal"} ${Math.max(1, Math.round(h))}px ${el.fontFamily || "system-ui"}`;
      ctx.fillText(el.text || "", 0, 0);
    } else if (el.type === "image") {
      if (el._img) {
        // Use processed display canvas (threshold/invert/reduce applied) so 2D == print.
        var disp = processImageForDisplay(el);
        ctx.drawImage(disp || el._img, -w / 2, -h / 2, w, h);
      } else {
        // Placeholder when image hasn't loaded yet.
        ctx.fillStyle = "#888"; ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = "#ccc"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "12px system-ui"; ctx.fillText("Bild", 0, 0);
      }
    }
    ctx.restore();
  }

  // ---- Selection handles ----
  function drawSelection(ctx, el, s) {
    ctx.save();
    ctx.translate(mmX(el.cxMm), mmY(el.cyMm)); // always uses state view origin
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    const w = el.wMm * s, h = el.hMm * s;
    ctx.strokeStyle = "#6b4fb0"; ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = "#6b4fb0";
    for (const [hx, hy] of [[-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]]) {
      ctx.beginPath(); ctx.rect(hx - 5, hy - 5, 10, 10); ctx.fill();
    }
    // Rotation handle: line + circle above the top edge.
    ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 - 22); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -h / 2 - 22, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---- Main render (exported as render2D) ----
  function render2D() {
    if (!cv) return;
    // B3: fitScale is NOT called here; it is called on initial load, window resize,
    // and when body size (sizeW/sizeH) changes. This prevents re-zoom on every control change.
    const s = state.scale;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);

    const body = doc.body;
    const shape = body.shape || "rect";

    if (shape === "rect") {
      // Rounded-rect plate: outline only (B5: no solid fill so elements/relief are visible).
      // Clip elements inside the body outline.
      ctx.save(); bodyPath(ctx); ctx.clip();
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
      ctx.restore();
      // Outline.
      bodyPath(ctx); ctx.strokeStyle = "#3a3a44"; ctx.lineWidth = 1; ctx.stroke();
    } else if (shape === "circle") {
      // Circle plate: outline only (B5: no solid fill so elements/relief are visible).
      const r = Math.min(body.widthMm, body.heightMm) / 2 * s;
      const cx = mmX(body.widthMm / 2), cy = mmY(body.heightMm / 2);
      // Clip to circle.
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "#3a3a44"; ctx.lineWidth = 1; ctx.stroke();
    } else {
      // free shape: draw elements only (no plate frame in 2D).
      // NOTE: true free-shape plate outline only shown in 3D/export (2D simplification).
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
    }

    // Mount marker: visible draggable circle + crosshair.
    const mount = doc.mount;
    if (mount && mount.type !== "none") {
      const mr = (mount.diameterMm / 2) * s;
      const mx = mmX(mount.xMm), my = mmY(mount.yMm);
      ctx.save();
      ctx.strokeStyle = "#e0245e"; ctx.lineWidth = 2;
      ctx.setLineDash([]);
      // For loop type: draw the outer ring as a solid-stroke outline (it IS printed geometry).
      if (mount.type === "loop" && mount.ringThicknessMm > 0) {
        const or = (mount.diameterMm / 2 + mount.ringThicknessMm) * s;
        ctx.beginPath(); ctx.arc(mx, my, or, 0, Math.PI * 2); ctx.stroke();
      }
      // Main (hole) circle.
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.stroke();
      // Crosshair (±8 px through center).
      ctx.beginPath();
      ctx.moveTo(mx - 8, my); ctx.lineTo(mx + 8, my);
      ctx.moveTo(mx, my - 8); ctx.lineTo(mx, my + 8);
      ctx.stroke();
      ctx.restore();
    }

    // Selection handles on top.
    const sel = doc.elements.find(e => e.id === state.selectedId) || null;
    if (sel) drawSelection(ctx, sel, s);
  }

  // ---- Hit test: pointer canvas-px → element/handle ----
  function elemToLocal(el, px, py, s) {
    const dx = px - mmX(el.cxMm), dy = py - mmY(el.cyMm);
    const a = -(el.rotationDeg || 0) * Math.PI / 180;
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  }

  function hitTest(px, py) {
    const s = state.scale;
    // Mount marker hit (checked first — small target on top).
    const mount = doc.mount;
    if (mount && mount.type !== "none") {
      if (Math.hypot(px - mmX(mount.xMm), py - mmY(mount.yMm)) <= 9) {
        return { handle: "mount" };
      }
    }
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const el = doc.elements[i];
      const [lx, ly] = elemToLocal(el, px, py, s);
      const w = el.wMm * s, h = el.hMm * s;
      // Rotation handle (circle above top edge).
      if (Math.hypot(lx, ly + h / 2 + 22) <= 9) return { id: el.id, handle: "rotate" };
      // Corner scale handles.
      const corners = { nw: [-w/2, -h/2], ne: [w/2, -h/2], se: [w/2, h/2], sw: [-w/2, h/2] };
      for (const k in corners) {
        if (Math.hypot(lx - corners[k][0], ly - corners[k][1]) <= 9) return { id: el.id, handle: k };
      }
      // Body.
      if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return { id: el.id, handle: "move" };
    }
    return null;
  }

  // ---- Pointer handlers (move / scale / rotate) ----
  let drag = null;

  cv.addEventListener("pointerdown", function (e) {
    const rect = cv.getBoundingClientRect();
    const scaleC = cv.width / rect.width;
    const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
    const hit = hitTest(px, py);
    if (!hit) { state.selectedId = null; refreshAdvancedForSelection(); renderAdvancedLayers(); render2D(); return; }
    // Mount drag: distinct path, does not select an element.
    if (hit.handle === "mount") {
      drag = {
        handle: "mount", px, py,
        startX: doc.mount.xMm, startY: doc.mount.yMm,
      };
      cv.setPointerCapture(e.pointerId);
      render2D();
      return;
    }
    state.selectedId = hit.id;
    const el = doc.elements.find(el => el.id === hit.id);
    drag = {
      handle: hit.handle,
      // Store drag start in canvas px
      px, py,
      start: { cx: el.cxMm, cy: el.cyMm, w: el.wMm, h: el.hMm, rot: el.rotationDeg || 0 },
    };
    cv.setPointerCapture(e.pointerId);
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    render2D();
  });

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Helper: compute content bbox for free-shape plates (used in attach clamp).
  function contentBbox() {
    var els = doc.elements.filter(function (e) { return !e._hidden; });
    if (!els.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      x0 = Math.min(x0, el.cxMm - el.wMm / 2);
      y0 = Math.min(y0, el.cyMm - el.hMm / 2);
      x1 = Math.max(x1, el.cxMm + el.wMm / 2);
      y1 = Math.max(y1, el.cyMm + el.hMm / 2);
    }
    return { x0, y0, x1, y1 };
  }

  // Returns true if the candidate (nx, ny) satisfies the attach clamp for the loop mount.
  // Must have bodySdfMm(body)(nx,ny) >= -(outerR - 1) — the washer always bites >=1mm into plate.
  function loopAttachOk(nx, ny) {
    var mount = doc.mount;
    var outerR = mount.diameterMm / 2 + mount.ringThicknessMm;
    var limit = -(outerR - 1);
    var body = doc.body;
    var sdf;
    if (body.shape === 'free') {
      // Approximate plate with content bbox.
      var bb = contentBbox();
      if (!bb) {
        // Fallback: use body box
        sdf = function (x, y) {
          var dx = Math.max(0 - x, x - body.widthMm);
          var dy = Math.max(0 - y, y - body.heightMm);
          return -Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) || Math.min(-dx, -dy);
        };
      } else {
        sdf = function (x, y) {
          // Box SDF for the content bbox.
          var cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
          var hw = (bb.x1 - bb.x0) / 2, hh = (bb.y1 - bb.y0) / 2;
          var qx = Math.abs(x - cx) - hw, qy = Math.abs(y - cy) - hh;
          return -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0));
        };
      }
    } else {
      sdf = window.bodySdfMm ? window.bodySdfMm(body) : null;
      if (!sdf) return true; // bodySdfMm unavailable — allow
    }
    return sdf(nx, ny) >= limit;
  }

  cv.addEventListener("pointermove", function (e) {
    if (!drag) return;
    const rect = cv.getBoundingClientRect();
    const scaleC = cv.width / rect.width, s = state.scale;
    const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
    // Mount drag: update mm position.
    if (drag.handle === "mount") {
      var mount = doc.mount;
      var rawX = drag.startX + (px - drag.px) / s;
      var rawY = drag.startY + (py - drag.py) / s;
      if (mount.type === "loop") {
        // Attach clamp: ensure washer bites >=1mm into the plate.
        // Try full move first; if not valid, try axis-by-axis fallback.
        var nx = rawX, ny = rawY;
        if (!loopAttachOk(nx, ny)) {
          // Try X only
          if (loopAttachOk(rawX, mount.yMm)) {
            nx = rawX; ny = mount.yMm;
          // Try Y only
          } else if (loopAttachOk(mount.xMm, rawY)) {
            nx = mount.xMm; ny = rawY;
          } else {
            // Reject entirely — stay at last valid position
            nx = mount.xMm; ny = mount.yMm;
          }
        }
        mount.xMm = nx;
        mount.yMm = ny;
        // Update view origin without rezoom (just update viewX0/viewY0 from domain).
        var domain = (window.docDomain ? window.docDomain(doc) : { x0: 0, y0: 0, wMm: doc.body.widthMm, hMm: doc.body.heightMm });
        state.viewX0 = domain.x0;
        state.viewY0 = domain.y0;
      } else {
        // Hole: classic inside-plate clamp.
        mount.xMm = clamp(rawX, 0, doc.body.widthMm);
        mount.yMm = clamp(rawY, 0, doc.body.heightMm);
      }
      render2D();
      scheduleRebuild3D();
      return;
    }
    const el = doc.elements.find(el => el.id === state.selectedId);
    if (!el) return;
    if (drag.handle === "move") {
      el.cxMm = drag.start.cx + (px - drag.px) / s;
      el.cyMm = drag.start.cy + (py - drag.py) / s;
    } else if (drag.handle === "rotate") {
      const ang = Math.atan2(py - mmY(el.cyMm), px - mmX(el.cxMm)) * 180 / Math.PI + 90;
      el.rotationDeg = Math.round(ang);
    } else {
      // Corner handle: scale width/height symmetrically.
      const [lx, ly] = elemToLocal(el, px, py, s);
      el.wMm = Math.max(2, Math.abs(lx) * 2 / s);
      el.hMm = Math.max(2, Math.abs(ly) * 2 / s);
    }
    render2D();
  });

  function endDrag() {
    if (!drag) return;
    var wasMountDrag = (drag.handle === "mount");
    drag = null;
    if (wasMountDrag) {
      // Re-fit the canvas now that the mount may have moved (expanded/contracted domain).
      fitScale();
    }
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    scheduleRebuild3D();
    render2D();
  }
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);

  // Cursor: show 'move' over mount marker (or while dragging it), else reset.
  cv.addEventListener("mousemove", function (e) {
    if (drag && drag.handle === "mount") { cv.style.cursor = "move"; return; }
    if (drag) return; // leave cursor as-is during other drags
    const rect = cv.getBoundingClientRect();
    const scaleC = cv.width / rect.width;
    const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
    const mount = doc.mount;
    if (mount && mount.type !== "none" &&
        Math.hypot(px - mmX(mount.xMm), py - mmY(mount.yMm)) <= 9) {
      cv.style.cursor = "move";
    } else {
      cv.style.cursor = "";
    }
  });

  // ---- Add image from data URL ----
  function addImageFromDataURL(dataURL) {
    const img = new Image();
    img.onload = function () {
      const body = doc.body;
      const maxMm = Math.min(body.widthMm * 0.8, body.heightMm * 0.4);
      const ar = img.naturalWidth / img.naturalHeight || 1;
      const wMm = ar >= 1 ? maxMm : maxMm * ar;
      const hMm = ar >= 1 ? maxMm / ar : maxMm;
      const el = window.makeElementV2("image", {
        src: dataURL, _img: img,
        cxMm: body.widthMm / 2, cyMm: body.heightMm / 2,
        wMm, hMm,
      });
      el.depth.direction = defaultDirection;
      doc.elements.push(el);
      state.selectedId = el.id;
      refreshAdvancedForSelection();
      renderAdvancedLayers();
      scheduleRebuild3D();
      render2D();
    };
    img.src = dataURL;
  }

  // ---- Drop handler on canvas/preview ----
  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const rd = new FileReader();
    rd.onload = function () { addImageFromDataURL(rd.result); };
    rd.readAsDataURL(file);
  }
  function handleDragOver(e) { e.preventDefault(); }

  cv.addEventListener("dragover", handleDragOver);
  cv.addEventListener("drop", handleDrop);

  // ---- Keyboard accessibility (WCAG 2.1) ----
  function selectByIndex(i) {
    var els = doc.elements;
    if (!els.length) return;
    var idx = ((i % els.length) + els.length) % els.length;   // wrap
    state.selectedId = els[idx].id;
    refreshAdvancedForSelection();
    renderLayers();
    render2D();
  }
  function selectedIndex() {
    return doc.elements.findIndex(function (e) { return e.id === state.selectedId; });
  }

  cv.addEventListener("keydown", function (e) {
    var els = doc.elements;
    var cur = selectedIndex();

    // --- Selection cycling ---
    if (e.key === "Tab") {
      if (!els.length) return;                       // nothing to cycle → let Tab move focus normally
      if (!e.shiftKey) {
        if (cur === -1) { e.preventDefault(); selectByIndex(0); return; }
        if (cur < els.length - 1) { e.preventDefault(); selectByIndex(cur + 1); return; }
        // at last element → release focus (deselect, allow default Tab) to avoid a keyboard trap
        state.selectedId = null; refreshAdvancedForSelection(); renderLayers(); render2D();
        return; // do NOT preventDefault: focus leaves the canvas
      } else {
        if (cur === -1) { e.preventDefault(); selectByIndex(els.length - 1); return; }
        if (cur > 0) { e.preventDefault(); selectByIndex(cur - 1); return; }
        state.selectedId = null; refreshAdvancedForSelection(); renderLayers(); render2D();
        return; // release focus backward
      }
    }

    if (e.key === "Enter") {                          // Enter cycles forward (wrap), stays on canvas
      if (!els.length) return;
      e.preventDefault();
      selectByIndex(cur === -1 ? 0 : cur + 1);
      return;
    }

    if (e.key === "Escape") {                         // deselect + release focus
      if (state.selectedId != null) {
        state.selectedId = null; refreshAdvancedForSelection(); renderLayers(); render2D();
      }
      cv.blur();
      return;
    }

    // --- Arrow nudge of the selected element ---
    var dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -1;
    else if (e.key === "ArrowRight") dx = 1;
    else if (e.key === "ArrowUp") dy = -1;
    else if (e.key === "ArrowDown") dy = 1;
    else return;                                      // not a key we handle

    e.preventDefault();                               // stop page scroll
    if (cur === -1) { selectByIndex(0); return; }     // nothing selected → select first, don't move yet
    var stepMm = e.shiftKey ? 0.25 : 1;               // Shift = fine 0.25 mm, else 1 mm
    withSelected(function (el) {
      el.cxMm = clamp(el.cxMm + dx * stepMm, 0, doc.body.widthMm);
      el.cyMm = clamp(el.cyMm + dy * stepMm, 0, doc.body.heightMm);
    });
    refreshAdvancedForSelection();                    // keep advCx/advCy inputs in sync
  });

  const previewEl = document.getElementById("preview");
  if (previewEl) {
    previewEl.addEventListener("dragover", handleDragOver);
    previewEl.addEventListener("drop", handleDrop);
  }

  // ---- Hidden file input (#addImageInput) ----
  const addImageInput = document.getElementById("addImageInput");
  if (addImageInput) {
    addImageInput.addEventListener("change", function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () { addImageFromDataURL(rd.result); };
      rd.readAsDataURL(f);
      addImageInput.value = "";
    });
  }

  // ---- Single resize listener: 2D re-render; 3D resize is handled by preview3d ----
  window.addEventListener("resize", function () {
    if (!window.preview3d || !window.preview3d.isActive()) {
      fitScale(); // B3: re-fit available space on window resize.
      render2D();
    }
  });

  // ---- 2D/3D toggle ----
  function getPartsFn() { return { parts: window.buildParts(visibleDoc()) }; }

  document.getElementById("view3dBtn").addEventListener("click", function () {
    document.getElementById("canvas2d").hidden = true;
    document.getElementById("preview3dCanvas").hidden = false;
    document.getElementById("view3dBtn").classList.add("seg-active");
    document.getElementById("view2dBtn").classList.remove("seg-active");
    Promise.resolve(window.preview3d.show(document.getElementById("preview3dCanvas"), getPartsFn)).catch(function (err) {
      if (window.__errs) window.__errs.push(String(err && err.message || err));
    });
  });

  document.getElementById("view2dBtn").addEventListener("click", function () {
    window.preview3d.hide();
    document.getElementById("canvas2d").hidden = false;
    document.getElementById("preview3dCanvas").hidden = true;
    document.getElementById("view2dBtn").classList.add("seg-active");
    document.getElementById("view3dBtn").classList.remove("seg-active");
    render2D();
  });

  // ---- Export dialog ----
  function exportFileName() {
    const n = (document.getElementById("exportName").value || "").trim();
    return n || "ukibori";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function setExportStatus(msg) {
    document.getElementById("exportStatus").textContent = msg;
  }

  document.getElementById("exportBtn").addEventListener("click", function () {
    document.getElementById("exportModal").removeAttribute("hidden");
    setExportStatus("");
  });

  document.getElementById("exportClose").addEventListener("click", function () {
    document.getElementById("exportModal").setAttribute("hidden", "");
  });

  document.getElementById("exportMf").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      const parts = window.buildParts(visibleDoc());
      const blob = window.build3MF(parts);
      downloadBlob(blob, exportFileName() + ".3mf");
      setExportStatus("Fertig.");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });

  document.getElementById("exportStl").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      const parts = window.buildParts(visibleDoc());
      const facets = parts.flatMap(function (p) { return p.facets; });
      const u8 = window.facetsToBinarySTL(facets);
      const blob = new Blob([u8], { type: "application/octet-stream" });
      downloadBlob(blob, exportFileName() + ".stl");
      setExportStatus("Fertig.");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });

  document.getElementById("exportPng").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      const name = exportFileName();
      document.getElementById("canvas2d").toBlob(function (b) {
        try {
          if (!b) { setExportStatus("Fehler: PNG konnte nicht erstellt werden."); return; }
          downloadBlob(b, name + ".png");
          setExportStatus("Fertig.");
        } catch (e) {
          setExportStatus("Fehler: " + e.message);
        }
      }, "image/png");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });

  // ---- SVG vector export ----
  // Composes the design on the engine's own grid (same as buildParts), traces one
  // evenodd-filled path per color, and returns an SVG string (or null if empty).
  function buildDesignSVG() {
    var d = visibleDoc();
    var grid = window.gridForBody(d.body, d.resolution);
    var cols = grid.cols, rows = grid.rows, pitch = grid.pitch;
    var s = 1 / pitch; // px per mm so that drawElement places content on the engine grid

    // Footprint field: >0 inside the plate (with mount hole already cut).
    var field = d.body.shape === "free"
      ? window.freeFootprintField(d, cols, rows, pitch)
      : window.shapeFootprintField(cols, rows, d.body, d.mount);
    var baseInside = function (c, r) { return field(c, r) > 0; };

    // Composite raster: paint base color, then elements on top.
    var offcanvas = document.createElement("canvas");
    offcanvas.width = cols; offcanvas.height = rows;
    var offctx = offcanvas.getContext("2d", { willReadFrequently: true });

    // Base plate color.
    offctx.fillStyle = d.body.baseColor;
    offctx.fillRect(0, 0, cols, rows);

    // Elements on top (WYSIWYG — processImageForDisplay applied inside drawElement).
    // Pass explicit vx0=0,vy0=0: SVG grid has no view-origin offset; it starts at grid origin.
    for (var ei = 0; ei < d.elements.length; ei++) {
      drawElement(offctx, d.elements[ei], s, 0, 0);
    }

    // Enforce footprint: blank out pixels outside the plate (overhang + mount hole).
    var imgData = offctx.getImageData(0, 0, cols, rows);
    var px = imgData.data;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (!baseInside(c, r)) {
          var i4 = (r * cols + c) * 4;
          px[i4] = 0; px[i4 + 1] = 0; px[i4 + 2] = 0; px[i4 + 3] = 0;
        }
      }
    }
    offctx.putImageData(imgData, 0, 0);

    // Re-read pixels and build per-color Uint8Array masks.
    var final = offctx.getImageData(0, 0, cols, rows).data;
    var n = cols * rows;
    var masks = new Map();
    for (var pi = 0; pi < n; pi++) {
      if (final[pi * 4 + 3] < 128) continue;
      var hex = "#" + [final[pi * 4], final[pi * 4 + 1], final[pi * 4 + 2]]
        .map(function (v) { return v.toString(16).padStart(2, "0"); })
        .join("").toUpperCase();
      var mk = masks.get(hex);
      if (!mk) { mk = new Uint8Array(n); masks.set(hex, mk); }
      mk[pi] = 1;
    }

    if (!masks.size) return null;

    // Trace each color mask into SVG paths (coords in mm = cell index × pitch).
    var wMm = +(cols * pitch).toFixed(3), hMm = +(rows * pitch).toFixed(3);
    var paths = "";
    masks.forEach(function (mask, hex) {
      var loops = window.traceMaskLoops(mask, cols, rows, {});
      var dAttr = "";
      for (var li = 0; li < loops.length; li++) {
        var lp = loops[li];
        if (lp.length < 3) continue;
        dAttr += "M" + lp.map(function (pt) {
          return (pt[0] * pitch).toFixed(3) + " " + (pt[1] * pitch).toFixed(3);
        }).join(" L") + " Z ";
      }
      if (dAttr) paths += "  <path d=\"" + dAttr.trim() + "\" fill=\"" + hex + "\" fill-rule=\"evenodd\" />\n";
    });

    if (!paths) return null;

    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
      "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + wMm + "mm\" height=\"" + hMm + "mm\" viewBox=\"0 0 " + wMm + " " + hMm + "\">\n" +
      paths + "</svg>\n";
  }

  document.getElementById("exportSvg").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      var svg = buildDesignSVG();
      if (!svg) { setExportStatus("Kein Inhalt für SVG."); return; }
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), exportFileName() + ".svg");
      setExportStatus("Fertig.");
    } catch (e) { setExportStatus("Fehler: " + e.message); }
  });

  // ---- Simple panel wiring (Task 4a) ----

  // -- Helpers --
  function setSegActive(groupId, activeId) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.querySelectorAll(".seg").forEach(function (btn) {
      btn.classList.toggle("seg-active", btn.id === activeId);
    });
  }

  // Depth: Erhaben / Vertieft
  function applyDepth(direction) {
    defaultDirection = direction;
    for (var i = 0; i < doc.elements.length; i++) {
      doc.elements[i].depth.direction = direction;
    }
    setSegActive("depthSeg", direction === "raised" ? "depthRaised" : "depthEngraved");
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("depthRaised").addEventListener("click", function () { applyDepth("raised"); });
  document.getElementById("depthEngraved").addEventListener("click", function () { applyDepth("engraved"); });

  // Shape: Rechteck / Kreis / Frei
  function applyShape(shape) {
    doc.body.shape = shape;
    setSegActive("shapeSeg", shape === "rect" ? "shapeRect" : shape === "circle" ? "shapeCircle" : "shapeFree");
    document.getElementById("borderField").hidden = (shape !== "free");
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("shapeRect").addEventListener("click", function () { applyShape("rect"); });
  document.getElementById("shapeCircle").addEventListener("click", function () { applyShape("circle"); });
  document.getElementById("shapeFree").addEventListener("click", function () { applyShape("free"); });

  // Border (shown only for Free)
  document.getElementById("borderMm").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) {
      doc.body.borderMm = v;
      scheduleRebuild3D();
    }
  });

  // Mount: Keine / Loch / Öse
  function applyMount(type) {
    doc.mount.type = type;
    if (type === "loop") {
      // B1: ensure non-zero ring dimensions.
      if (!(doc.mount.ringThicknessMm > 0)) doc.mount.ringThicknessMm = 2;
      if (!(doc.mount.ringHeightMm > 0)) doc.mount.ringHeightMm = 2;
      // Snap to top edge based on body shape.
      var body = doc.body;
      var W = body.widthMm, H = body.heightMm;
      var shape = body.shape || 'rect';
      if (shape === 'rect') {
        doc.mount.xMm = W / 2;
        doc.mount.yMm = 0;
      } else if (shape === 'circle') {
        var R = Math.min(W, H) / 2;
        doc.mount.xMm = W / 2;
        doc.mount.yMm = H / 2 - R;
      } else {
        // free: content bbox top-center.
        var bb = contentBbox();
        if (bb) {
          doc.mount.xMm = (bb.x0 + bb.x1) / 2;
          doc.mount.yMm = bb.y0;
        } else {
          doc.mount.xMm = W / 2;
          doc.mount.yMm = 0;
        }
      }
    }
    setSegActive("mountSeg", type === "none" ? "mountNone" : type === "hole" ? "mountHole" : "mountLoop");
    // Re-fit canvas: domain may have expanded/contracted.
    fitScale();
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("mountNone").addEventListener("click", function () { applyMount("none"); });
  document.getElementById("mountHole").addEventListener("click", function () { applyMount("hole"); });
  document.getElementById("mountLoop").addEventListener("click", function () { applyMount("loop"); });

  // Size W/H
  document.getElementById("sizeW").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 5) {
      doc.body.widthMm = v;
      fitScale(); // B3: re-fit when plate dimensions change.
      render2D();
      scheduleRebuild3D();
    }
  });
  document.getElementById("sizeH").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 5) {
      doc.body.heightMm = v;
      fitScale(); // B3: re-fit when plate dimensions change.
      render2D();
      scheduleRebuild3D();
    }
  });

  // Add Text
  document.getElementById("addTextBtn").addEventListener("click", function () {
    var el = window.makeElementV2("text", {
      cxMm: doc.body.widthMm / 2,
      cyMm: doc.body.heightMm / 2,
      wMm: Math.min(40, doc.body.widthMm * 0.6),
      hMm: 12,
    });
    el.depth.direction = defaultDirection;
    doc.elements.push(el);
    state.selectedId = el.id;
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    render2D();
    scheduleRebuild3D();
  });

  // Add Image (trigger hidden file input)
  document.getElementById("addImageBtn").addEventListener("click", function () {
    var inp = document.getElementById("addImageInput");
    if (inp) inp.click();
  });

  // Add QR
  document.getElementById("addQrBtn").addEventListener("click", function () {
    var data = prompt("QR-Inhalt:");
    if (!data || !data.trim()) return;
    var imgData;
    try {
      imgData = window.qrToImageData({ text: data, ecLevel: "M" });
    } catch (err) {
      alert("QR-Fehler: " + (err && err.message || err));
      return;
    }
    // Rasterize the ImageData to a canvas → dataURL → Image onload.
    var tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = imgData.width;
    tmpCanvas.height = imgData.height;
    tmpCanvas.getContext("2d").putImageData(imgData, 0, 0);
    var dataURL = tmpCanvas.toDataURL("image/png");
    var img = new Image();
    img.onload = function () {
      var sz = Math.min(doc.body.widthMm * 0.7, doc.body.heightMm * 0.7, 40);
      var el = window.makeElementV2("image", {
        src: dataURL, _img: img,
        cxMm: doc.body.widthMm / 2,
        cyMm: doc.body.heightMm / 2,
        wMm: sz, hMm: sz,
      });
      el.qrData = data;
      el.depth.direction = defaultDirection;
      el.depth.threshold = 256;
      doc.elements.push(el);
      state.selectedId = el.id;
      refreshAdvancedForSelection();
      renderAdvancedLayers();
      render2D();
      scheduleRebuild3D();
    };
    img.src = dataURL;
  });

  // ---- Remove Background (KI) ----
  document.getElementById("removeBgBtn").addEventListener("click", function () {
    var btn = document.getElementById("removeBgBtn");
    var statusEl = document.getElementById("bgStatus");

    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el || el.type !== "image" || !el._img) {
      statusEl.textContent = "Bitte zuerst ein Bild auswählen.";
      return;
    }

    btn.disabled = true;
    statusEl.textContent = "Entferne Hintergrund … (lädt beim ersten Mal ~16 MB)";

    (function () {
      // Draw _img to offscreen canvas at natural size to get ImageData.
      var src = document.createElement("canvas");
      src.width = el._img.naturalWidth || el._img.width || 320;
      src.height = el._img.naturalHeight || el._img.height || 320;
      var ctx2d = src.getContext("2d");
      ctx2d.drawImage(el._img, 0, 0, src.width, src.height);
      var imageData = ctx2d.getImageData(0, 0, src.width, src.height);

      window.removeBackground(imageData).then(function (cut) {
        // Put the cut ImageData onto a canvas and convert to data URL.
        var outCanvas = document.createElement("canvas");
        outCanvas.width = cut.width;
        outCanvas.height = cut.height;
        outCanvas.getContext("2d").putImageData(cut, 0, 0);
        var url = outCanvas.toDataURL("image/png");

        // Decode into a new Image, then swap into the element.
        var img = new Image();
        img.onload = function () {
          el._img = img;
          el.src = url;
          el.depth.threshold = 256;
          render2D();
          scheduleRebuild3D();
          btn.disabled = false;
          statusEl.textContent = "Fertig.";
        };
        img.onerror = function () {
          btn.disabled = false;
          statusEl.textContent = "Hintergrundentfernung fehlgeschlagen.";
        };
        img.src = url;
      }).catch(function (e) {
        btn.disabled = false;
        var msg = (e && e.message) || '';
        if (/backend|fetch|wasm/i.test(msg)) {
          statusEl.textContent =
            'KI-Freistellung benötigt einen HTTP-Server. ' +
            'Starte z. B. `python3 -m http.server` und öffne http://localhost:8000.';
        } else {
          statusEl.textContent = msg || 'Hintergrundentfernung fehlgeschlagen.';
        }
      });
    }());
  });

  // Initialize Simple panel UI from doc on load (also called by resetDocTo).
  function initSimpleUI() {
    // Shape
    applyShape(doc.body.shape || "rect");
    // Mount
    applyMount(doc.mount.type || "none");
    // Size
    document.getElementById("sizeW").value = doc.body.widthMm;
    document.getElementById("sizeH").value = doc.body.heightMm;
    // Border
    document.getElementById("borderMm").value = doc.body.borderMm != null ? doc.body.borderMm : 2;
    // Depth (defaultDirection already 'raised'; reflect it)
    setSegActive("depthSeg", defaultDirection === "raised" ? "depthRaised" : "depthEngraved");
  }
  initSimpleUI();

  // ---- Advanced panel (Task 4b) ----

  // -- Layers list (shared: populates both #advLayers and #simpleLayers) --

  // Build a small thumbnail node for a layer row.
  function buildLayerThumb(el) {
    if (el.type === "image" && !el.qrData) {
      var disp = processImageForDisplay(el);
      if (disp) {
        // Scale the processed display canvas into a 28×28 thumb canvas.
        var thumb = document.createElement("canvas");
        thumb.className = "layer-thumb";
        thumb.width = 28; thumb.height = 28;
        var ctx = thumb.getContext("2d");
        var sw = disp.width, sh = disp.height;
        var scale = Math.min(28 / sw, 28 / sh);
        var dw = Math.round(sw * scale), dh = Math.round(sh * scale);
        var dx = Math.round((28 - dw) / 2), dy = Math.round((28 - dh) / 2);
        ctx.drawImage(disp, 0, 0, sw, sh, dx, dy, dw, dh);
        return thumb;
      }
    }
    // Text / QR / fallback: a coloured chip with the first character(s).
    var chip = document.createElement("span");
    chip.className = "layer-thumb-text";
    if (el.type === "text") {
      chip.style.color = el.color || "#333";
      chip.textContent = el.text ? el.text.charAt(0).toUpperCase() : "T";
    } else if (el.type === "qr" || el.qrData) {
      chip.textContent = "QR";
    } else {
      chip.textContent = "?";
    }
    return chip;
  }

  // Build a single layer <li> for element at index i. Clicking triggers renderLayers().
  function buildLayerRow(i) {
    var el = doc.elements[i];
    var li = document.createElement("li");
    if (el.id === state.selectedId) li.classList.add("adv-sel");
    if (el._hidden) li.classList.add("adv-hidden");

    var thumb = buildLayerThumb(el);
    li.appendChild(thumb);

    var nameSpan = document.createElement("span");
    nameSpan.className = "adv-lname";
    var isQR = el.type === "qr" || (el.type === "image" && el.qrData);
    var typeLabel = el.type === "text" ? "Text" : isQR ? "QR" : "Bild";
    nameSpan.textContent = typeLabel + " " + (i + 1);
    if (el.type === 'text' && el.text) nameSpan.textContent = '„' + el.text + '“';

    var vis = document.createElement("button");
    vis.className = "adv-lbtn";
    vis.textContent = el._hidden ? "🙈" : "👁";
    vis.title = el._hidden ? "Einblenden" : "Ausblenden";

    var up = document.createElement("button");
    up.className = "adv-lbtn";
    up.textContent = "▲";
    up.title = "Nach oben";

    var dn = document.createElement("button");
    dn.className = "adv-lbtn";
    dn.textContent = "▼";
    dn.title = "Nach unten";

    var del = document.createElement("button");
    del.className = "adv-lbtn";
    del.textContent = "🗑";
    del.title = "Löschen";

    li.append(nameSpan, vis, up, dn, del);

    li.addEventListener("click", function (e) {
      if (e.target.classList.contains("adv-lbtn")) return;
      state.selectedId = el.id;
      refreshAdvancedForSelection();
      renderLayers();
      render2D();
    });

    vis.addEventListener("click", function (e) {
      e.stopPropagation();
      el._hidden = !el._hidden;
      renderLayers();
      render2D();
      scheduleRebuild3D();
    });

    up.addEventListener("click", function (e) {
      e.stopPropagation();
      if (i < doc.elements.length - 1) {
        var tmp = doc.elements[i]; doc.elements[i] = doc.elements[i + 1]; doc.elements[i + 1] = tmp;
        renderLayers();
        render2D();
        scheduleRebuild3D();
      }
    });

    dn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (i > 0) {
        var tmp = doc.elements[i]; doc.elements[i] = doc.elements[i - 1]; doc.elements[i - 1] = tmp;
        renderLayers();
        render2D();
        scheduleRebuild3D();
      }
    });

    del.addEventListener("click", function (e) {
      e.stopPropagation();
      doc.elements.splice(i, 1);
      if (state.selectedId === el.id) state.selectedId = null;
      refreshAdvancedForSelection();
      renderLayers();
      render2D();
      scheduleRebuild3D();
    });

    return li;
  }

  // Populate a layers <ul> container (and its paired empty <p>) with the current doc elements.
  function populateLayersList(list, empty) {
    if (!list) return;
    list.innerHTML = "";
    var els = doc.elements;
    if (!els || els.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    // Render back-to-front (last index = topmost layer shown first).
    for (var idx = els.length - 1; idx >= 0; idx--) {
      list.appendChild(buildLayerRow(idx));
    }
  }

  // Shared entry point: refresh both the Advanced and Simple layer lists.
  function renderLayers() {
    populateLayersList(
      document.getElementById("advLayers"),
      document.getElementById("advLayersEmpty")
    );
    populateLayersList(
      document.getElementById("simpleLayers"),
      document.getElementById("simpleLayersEmpty")
    );
  }

  // Backward-compat alias so existing call sites (and window.editor export) still work.
  function renderAdvancedLayers() { renderLayers(); }

  // -- Selection refresh hook --
  function refreshAdvancedForSelection() {
    var adv = document.getElementById("sidebarAdvanced");
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; }) || null;
    var disabled = !el;

    var threshold = document.getElementById("advThreshold");
    var thresholdVal = document.getElementById("advThresholdVal");
    var invert = document.getElementById("advInvert");
    var numColors = document.getElementById("advNumColors");
    if (threshold) { threshold.disabled = disabled; threshold.value = el ? (el.depth.threshold != null ? el.depth.threshold : 128) : 128; }
    if (thresholdVal) thresholdVal.textContent = el ? (el.depth.threshold != null ? el.depth.threshold : 128) : 128;
    if (invert) { invert.disabled = disabled; invert.checked = el ? !!el.depth.invert : false; }
    if (numColors) { numColors.disabled = disabled; numColors.value = el ? (el.depth.reduce && el.depth.reduce.numColors != null ? el.depth.reduce.numColors : 8) : 8; }

    var modeSolid = document.getElementById("modeSolid");
    var modeColorLayers = document.getElementById("modeColorLayers");
    var modeHeightmap = document.getElementById("modeHeightmap");
    if (modeSolid) modeSolid.disabled = disabled;
    if (modeColorLayers) modeColorLayers.disabled = disabled;
    if (modeHeightmap) modeHeightmap.disabled = disabled;
    if (el) {
      var m = el.depth.mode || "solid";
      if (modeSolid) modeSolid.classList.toggle("seg-active", m === "solid");
      if (modeColorLayers) modeColorLayers.classList.toggle("seg-active", m === "colorLayers");
      if (modeHeightmap) modeHeightmap.classList.toggle("seg-active", m === "heightmap");
    } else {
      if (modeSolid) modeSolid.classList.add("seg-active");
      if (modeColorLayers) modeColorLayers.classList.remove("seg-active");
      if (modeHeightmap) modeHeightmap.classList.remove("seg-active");
    }

    var advColor = document.getElementById("advColor");
    var advCx = document.getElementById("advCx");
    var advCy = document.getElementById("advCy");
    var advW = document.getElementById("advW");
    var advH = document.getElementById("advH");
    var advRot = document.getElementById("advRot");
    var advRotVal = document.getElementById("advRotVal");
    var advCutout = document.getElementById("advCutout");
    var advDirRaised = document.getElementById("advDirRaised");
    var advDirEngraved = document.getElementById("advDirEngraved");
    [advColor, advCx, advCy, advW, advH, advRot, advCutout, advDirRaised, advDirEngraved].forEach(function (inp) { if (inp) inp.disabled = disabled; });
    if (el) {
      if (advColor) advColor.value = el.color || "#ffffff";
      if (advCx) advCx.value = (el.cxMm != null ? el.cxMm : 25).toFixed(1);
      if (advCy) advCy.value = (el.cyMm != null ? el.cyMm : 75).toFixed(1);
      if (advW) advW.value = (el.wMm != null ? el.wMm : 30).toFixed(1);
      if (advH) advH.value = (el.hMm != null ? el.hMm : 30).toFixed(1);
      if (advRot) advRot.value = Math.round(el.rotationDeg || 0);
      if (advRotVal) advRotVal.textContent = Math.round(el.rotationDeg || 0) + "°";
      if (advCutout) advCutout.checked = !!el.cutout;
      // Per-element direction
      var dir = (el.depth && el.depth.direction) || "raised";
      if (advDirRaised) advDirRaised.classList.toggle("seg-active", dir === "raised");
      if (advDirEngraved) advDirEngraved.classList.toggle("seg-active", dir === "engraved");
    } else {
      if (advDirRaised) advDirRaised.classList.add("seg-active");
      if (advDirEngraved) advDirEngraved.classList.remove("seg-active");
    }

    // Palette swatches: show only for image elements in colorLayers mode.
    renderPaletteSwatches(el);
  }

  // -- Depth mode buttons --
  function applyDepthMode(mode) {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    el.depth.mode = mode;
    delete el._display; // invalidate processed display cache on mode change
    var modeSolid = document.getElementById("modeSolid");
    var modeColorLayers = document.getElementById("modeColorLayers");
    var modeHeightmap = document.getElementById("modeHeightmap");
    if (modeSolid) modeSolid.classList.toggle("seg-active", mode === "solid");
    if (modeColorLayers) modeColorLayers.classList.toggle("seg-active", mode === "colorLayers");
    if (modeHeightmap) modeHeightmap.classList.toggle("seg-active", mode === "heightmap");
    renderPaletteSwatches(el);
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("modeSolid").addEventListener("click", function () { applyDepthMode("solid"); });
  document.getElementById("modeColorLayers").addEventListener("click", function () { applyDepthMode("colorLayers"); });
  document.getElementById("modeHeightmap").addEventListener("click", function () { applyDepthMode("heightmap"); });

  // -- Umwandlung inputs --
  bindElementField("advThreshold", "input", function (el, node) {
    var v = Number(node.value); el.depth.threshold = v;
    var badge = document.getElementById("advThresholdVal"); if (badge) badge.textContent = v;
  }, { invalidate: true });

  bindElementField("advInvert", "change", function (el, node) {
    el.depth.invert = node.checked;
  }, { invalidate: true });

  bindElementField("advNumColors", "input", function (el, node) {
    var v = Number(node.value); if (isNaN(v) || v < 2) return false;
    el.depth.reduce.numColors = v; renderPaletteSwatches(el);
  }, { invalidate: true });

  // -- Element inputs --
  bindElementField("advColor", "input", function (el, node) {
    el.color = node.value;
  }, { invalidate: true });

  bindElementField("advCx", "input", function (el, node) {
    var v = parseFloat(node.value); if (isNaN(v)) return false; el.cxMm = v;
  });

  bindElementField("advCy", "input", function (el, node) {
    var v = parseFloat(node.value); if (isNaN(v)) return false; el.cyMm = v;
  });

  bindElementField("advW", "input", function (el, node) {
    var v = parseFloat(node.value); if (isNaN(v) || v < 0.5) return false; el.wMm = v;
  });

  bindElementField("advH", "input", function (el, node) {
    var v = parseFloat(node.value); if (isNaN(v) || v < 0.5) return false; el.hMm = v;
  });

  bindElementField("advRot", "input", function (el, node) {
    var v = Number(node.value); el.rotationDeg = v;
    var badge = document.getElementById("advRotVal"); if (badge) badge.textContent = v + "°";
  });

  bindElementField("advCutout", "change", function (el, node) {
    el.cutout = node.checked;
  });

  // -- Per-element direction (Erhaben / Vertieft) --
  bindElementField("advDirRaised", "click", function (el) {
    el.depth.direction = "raised";
    var r = document.getElementById("advDirRaised"), g = document.getElementById("advDirEngraved");
    if (r) r.classList.add("seg-active"); if (g) g.classList.remove("seg-active");
  });

  bindElementField("advDirEngraved", "click", function (el) {
    el.depth.direction = "engraved";
    var r = document.getElementById("advDirRaised"), g = document.getElementById("advDirEngraved");
    if (r) r.classList.remove("seg-active"); if (g) g.classList.add("seg-active");
  });

  // -- 3D / Export doc-level inputs --
  document.getElementById("advThickness").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0.5) { doc.body.thicknessMm = v; scheduleRebuild3D(); }
  });

  document.getElementById("advLayerHeight").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0.01) { doc.body.layerHeightMm = v; scheduleRebuild3D(); }
  });

  document.getElementById("advResolution").addEventListener("input", function () {
    var v = Number(this.value);
    if (!isNaN(v) && v >= 64) { doc.resolution = v; scheduleRebuild3D(); }
  });

  document.getElementById("advColorStep").addEventListener("input", function () {
    var v = Number(this.value);
    if (!isNaN(v) && v >= 1) { doc.colorStepLayers = v; scheduleRebuild3D(); }
  });

  // -- Init Advanced panel doc-level values (also called by resetDocTo) --
  function initAdvancedUI() {
    var t = document.getElementById("advThickness");
    if (t) t.value = doc.body.thicknessMm != null ? doc.body.thicknessMm : 3;
    var lh = document.getElementById("advLayerHeight");
    if (lh) lh.value = doc.body.layerHeightMm != null ? doc.body.layerHeightMm : 0.2;
    var res = document.getElementById("advResolution");
    if (res) res.value = doc.resolution != null ? doc.resolution : 1024;
    var cs = document.getElementById("advColorStep");
    if (cs) cs.value = doc.colorStepLayers != null ? doc.colorStepLayers : 2;
    refreshAdvancedForSelection();
    renderAdvancedLayers();
  }
  initAdvancedUI();

  // ---- resetDocTo: in-place doc replacement (used by Open) ----
  function resetDocTo(newDoc) {
    Object.keys(doc).forEach(function (k) { delete doc[k]; });
    Object.assign(doc, newDoc);
    state.selectedId = null;
    defaultDirection = "raised";
    // Re-decode images: deserializeProject sets _img=null; renderer skips images without _img.
    doc.elements.forEach(function (el) {
      if (el.type === "image" && el.src) {
        var img = new Image();
        img.onload = function () { el._img = img; render2D(); scheduleRebuild3D(); };
        img.src = el.src;
      }
    });
    initSimpleUI();
    initAdvancedUI();
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    render2D();
    scheduleRebuild3D();
  }

  // ---- Speichern (Save) ----
  document.getElementById("saveBtn").addEventListener("click", function () {
    try {
      var json = window.serializeProject(doc);
      var blob = new Blob([json], { type: "application/json" });
      var name = (document.getElementById("exportName") && document.getElementById("exportName").value.trim()) || "ukibori";
      downloadBlob(blob, name + ".json");
    } catch (e) {
      if (window.__errs) window.__errs.push(String(e && e.message || e));
      alert("Fehler beim Speichern: " + (e && e.message || e));
    }
  });

  // ---- Öffnen (Open) ----
  document.getElementById("openBtn").addEventListener("click", function () {
    var inp = document.getElementById("openInput");
    if (inp) inp.click();
  });

  (function () {
    var openInput = document.getElementById("openInput");
    if (!openInput) return;
    openInput.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var loaded = window.migrateProject(window.deserializeProject(rd.result));
          resetDocTo(loaded);
        } catch (err) {
          if (window.__errs) window.__errs.push(String(err && err.message || err));
          alert("Fehler beim Öffnen: " + (err && err.message || err));
        }
      };
      rd.onerror = function () {
        alert("Fehler beim Lesen der Datei.");
      };
      rd.readAsText(f);
      openInput.value = "";
    });
  }());

  // ---- View toggle wiring (Task 1, preserved) ----
  document.getElementById("viewSimple").addEventListener("click", function () { setView("simple"); renderLayers(); });
  document.getElementById("viewAdvanced").addEventListener("click", function () {
    setView("advanced");
    refreshAdvancedForSelection();
    renderAdvancedLayers();
  });
  setView((function () { try { return localStorage.getItem(VIEW_KEY) || "simple"; } catch (e) { return "simple"; } })());

  // Initial render: fit scale first (B3: fitScale not in render2D anymore).
  fitScale();
  render2D();
  renderLayers();

  // Public interface. Expose state so tests can inspect/mutate selection.
  window.editor = { doc, setView, getView, render2D, refreshAdvancedForSelection, renderAdvancedLayers, renderLayers, resetDocTo, buildDesignSVG };
  // Expose for Playwright smoke tests.
  window.__editorState = state;
  window.__editorHitTest = hitTest;
})();
