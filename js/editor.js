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

  const SNAP_KEY = "ukibori.snap";
  const doc = window.defaultDoc();
  const cv = document.getElementById("canvas2d");

  // Module-local interaction state (scale = px per mm; ox/oy reserved for future pan).
  // viewX0/viewY0: mm offset of canvas top-left from plate origin (≤0 when tab overhangs top/left).
  // marginPx: pixel bleed border around the plate so off-plate handles stay on-canvas.
  // snap: editor-only snapping prefs (NOT stored in doc; persisted in localStorage SNAP_KEY).
  // snapGuides: transient guide lines recorded during a move drag; cleared on drag end.
  var _snapDefault = { plate: true, elements: true, gridMm: 0 };
  var _snapLoaded = (function () { try { var v = JSON.parse(localStorage.getItem(SNAP_KEY)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }());
  const state = {
    selectedId: null, selectionIds: [], scale: 1, ox: 0, oy: 0, viewX0: 0, viewY0: 0, marginPx: 48,
    zoom: 1, // 2D workbench zoom factor: 1 = fit, up to 16 (view state, never saved)
    snap: {
      plate:    _snapLoaded.plate    !== undefined ? !!_snapLoaded.plate    : _snapDefault.plate,
      elements: _snapLoaded.elements !== undefined ? !!_snapLoaded.elements : _snapDefault.elements,
      gridMm:   _snapLoaded.gridMm   !== undefined ? +_snapLoaded.gridMm   : _snapDefault.gridMm,
    },
    snapGuides: [],
  };
  function persistSnap() { try { localStorage.setItem(SNAP_KEY, JSON.stringify(state.snap)); } catch (e) {} }

  // Streuen (scatter) sub-mode state: null unless the panel is open.
  var scatter = null; // { sourceId, region:{x0,y0,x1,y1}|null, seed, previewIds:[] }

  var MARGIN_PX = 48;

  // ---- mm↔px helpers — all drawing/hit-test coordinates go through these ----
  // mmX(x): mm doc-space x → canvas px (includes marginPx bleed border).
  // Inverse: (px - state.marginPx) / s + viewX0.
  function mmX(x) { return state.marginPx + (x - state.viewX0) * state.scale; }
  function mmY(y) { return state.marginPx + (y - state.viewY0) * state.scale; }

  // Default depth direction for newly created elements.
  let defaultDirection = "raised";

  // ---- View toggle (Task 1, preserved) ----

  // ---- visibleDoc: filter _hidden elements for 3D preview + export ----
  function visibleDoc() {
    return Object.assign({}, doc, { elements: doc.elements.filter(function (e) { return !e._hidden; }) });
  }

  // ---- 3D rebuild (debounced, 120 ms) ----
  let _rebuild3DTimer = null;
  function scheduleRebuild3D() {
    noteDocChanged();
    if (!window.preview3d || !window.preview3d.isActive()) return;
    clearTimeout(_rebuild3DTimer);
    _rebuild3DTimer = setTimeout(function () { window.preview3d.rebuild(); }, 120);
  }

  // ---- Undo/Redo (Cmd/Ctrl+Z, +Shift = Wiederholen) ------------------------
  // Snapshot stack over the doc (serializeProject strips runtime fields). No
  // per-handler wiring: render2D/scheduleRebuild3D — the universal post-mutation
  // calls — poke noteDocChanged, which debounces and pushes only when the
  // serialized doc actually differs (selection-only renders and drag frames
  // collapse into one entry). Restore rides the Open path (resetDocTo), which
  // re-decodes images and re-inits the panels.
  var _undo = { stack: [], redo: [], cap: 30, timer: null, muted: false };
  function noteDocChanged() {
    if (_undo.muted) return;
    clearTimeout(_undo.timer);
    _undo.timer = setTimeout(function () {
      var snap;
      try { snap = window.serializeProject(doc); } catch (e) { return; }
      if (snap !== _undo.stack[_undo.stack.length - 1]) {
        _undo.stack.push(snap);
        if (_undo.stack.length > _undo.cap) _undo.stack.shift();
        _undo.redo = [];
        // The doc really changed → any Dünne-Stellen overlay is stale now.
        if (state.thinOverlay) {
          state.thinOverlay = null;
          var ts = document.getElementById("thinCheckStatus");
          if (ts) ts.textContent = "";
          render2D();
        }
      }
    }, 500);
  }
  function _undoRestore(json) {
    _undo.muted = true;
    try {
      resetDocTo(window.migrateProject(window.deserializeProject(json)));
    } finally {
      // Outlive the debounce + async image decodes; a stray late compare is
      // harmless anyway (restored doc serializes identical to the stack top).
      setTimeout(function () { _undo.muted = false; }, 700);
    }
  }
  function undoAction() {
    clearTimeout(_undo.timer);
    var cur;
    try { cur = window.serializeProject(doc); } catch (e) { return; }
    if (cur !== _undo.stack[_undo.stack.length - 1]) _undo.stack.push(cur); // pending edit → redo can return here
    if (_undo.stack.length < 2) return;
    _undo.redo.push(_undo.stack.pop());
    _undoRestore(_undo.stack[_undo.stack.length - 1]);
  }
  function redoAction() {
    if (!_undo.redo.length) return;
    var snap = _undo.redo.pop();
    _undo.stack.push(snap);
    _undoRestore(snap);
  }
  window.addEventListener("keydown", function (e) {
    if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== "z") return;
    var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return; // native text undo
    e.preventDefault();
    if (e.shiftKey) redoAction(); else undoAction();
  });

  // ---- Element-field helpers (DRY refactor) ----

  // Resolve a colorLayers element's stacking style (mirror of the engine's colorStyleOf):
  // new depth.colorLayerStyle wins; legacy depth.flush is the fallback (flush=true → bands).
  function colorStyleOf(el) {
    var d = (el && el.depth) || {};
    return d.colorLayerStyle || (d.flush ? "bands" : "stepped");
  }

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

  // Multiselect: selectionIds is the full set; selectedId stays the PRIMARY (inspector target).
  function setSelection(ids) {
    state.selectionIds = (ids || []).slice();
    state.selectedId = state.selectionIds.length ? state.selectionIds[state.selectionIds.length - 1] : null;
  }
  function clearSelection() { setSelection([]); }
  function isSelected(id) { return state.selectionIds.indexOf(id) !== -1; }
  function toggleInSelection(id) {
    const i = state.selectionIds.indexOf(id);
    if (i === -1) state.selectionIds.push(id); else state.selectionIds.splice(i, 1);
    state.selectedId = state.selectionIds.length ? state.selectionIds[state.selectionIds.length - 1] : null;
  }
  function selectedEls() {
    return state.selectionIds.map(function (id) { return doc.elements.find(function (e) { return e.id === id; }); }).filter(Boolean);
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
    const pad = 12; // slim stage padding — the isolated 2D view should fill like 3D
    const preview = document.getElementById("preview");
    // In split mode the 2D canvas occupies half the preview width. The canvas is now
    // aspect-preserving (flex:0 1 auto), so cv.clientWidth follows the buffer — using it
    // here would be circular. Always derive the split width from the preview (minus the
    // 8px inter-pane gap).
    var inSplit = preview && preview.classList.contains("split");
    var rawW = preview ? (inSplit ? Math.floor((preview.clientWidth - 8) / 2) : preview.clientWidth) : 600;
    const availW = rawW - pad;
    const availH = (preview ? preview.clientHeight : 700) - pad;
    // Use expanded domain (docDomain exported by T1; falls back to body box if unavailable).
    // Editor viewport uses the expanded domain (plate ∪ element bboxes + handle pad) so
    // transform handles never clip. The engine/export keep using docDomain unchanged.
    var domain = (window.viewportDomain ? window.viewportDomain(doc)
      : (window.docDomain ? window.docDomain(doc) : { x0: 0, y0: 0, wMm: doc.body.widthMm, hMm: doc.body.heightMm }));
    // Subtract 2× margin from each dimension so the plate fits within the usable area.
    var uw = availW - 2 * MARGIN_PX;
    var uh = availH - 2 * MARGIN_PX;
    // Fit BOTH dimensions (drop the max(1,…) floor so tall plates can shrink; keep 0.2 floor).
    // Floor the divisors so a degenerate/zero-size domain (e.g. a 0-size Bild element) can't
    // produce Infinity → NaN canvas dimensions.
    const dw = Math.max(1e-3, domain.wMm), dh = Math.max(1e-3, domain.hMm);
    const s = Math.max(0.2, Math.min(uw / dw, uh / dh));
    if (!(state.zoom > 1.0001)) {
      // Fit view — byte-identical to the pre-zoom behavior.
      state.zoom = 1;
      state.viewX0 = domain.x0;
      state.viewY0 = domain.y0;
      state.marginPx = MARGIN_PX;
      state.scale = s;
      cv.width = Math.round(domain.wMm * s + 2 * MARGIN_PX);
      cv.height = Math.round(domain.hMm * s + 2 * MARGIN_PX);
      updateZoomChip();
      return;
    }
    // Zoomed: the canvas caps at the pane, the view keeps its center across
    // re-fits (resize, plate change, endDrag) and clamps onto the domain.
    const oldScale = state.scale || s;
    const cxMm = state.viewX0 + (cv.width - 2 * state.marginPx) / (2 * oldScale);
    const cyMm = state.viewY0 + (cv.height - 2 * state.marginPx) / (2 * oldScale);
    state.marginPx = MARGIN_PX;
    state.scale = s * state.zoom;
    cv.width = Math.round(Math.min(availW, domain.wMm * state.scale + 2 * MARGIN_PX));
    cv.height = Math.round(Math.min(availH, domain.hMm * state.scale + 2 * MARGIN_PX));
    const visW = (cv.width - 2 * MARGIN_PX) / state.scale;
    const visH = (cv.height - 2 * MARGIN_PX) / state.scale;
    const o = window.clampViewOrigin(
      { x0: cxMm - visW / 2, y0: cyMm - visH / 2 }, domain, visW, visH);
    state.viewX0 = o.x0;
    state.viewY0 = o.y0;
    updateZoomChip();
  }

  // ---- 2D zoom & pan ----
  function viewDomain() {
    return (window.viewportDomain ? window.viewportDomain(doc)
      : (window.docDomain ? window.docDomain(doc) : { x0: 0, y0: 0, wMm: doc.body.widthMm, hMm: doc.body.heightMm }));
  }

  function updateZoomChip() {
    var chip = document.getElementById("zoom2dChip");
    if (!chip) return;
    chip.hidden = !(state.zoom > 1.0001);
    if (!chip.hidden) chip.textContent = Math.round(state.zoom * 100) + " %";
  }

  // Set the workbench zoom; ax/ay (canvas-buffer px) anchor the point under
  // the cursor, otherwise the view center is kept (fitScale does that).
  function setZoom2d(z, ax, ay) {
    z = Math.max(1, Math.min(16, z));
    if (Math.abs(z - state.zoom) < 1e-6) return;
    const oldScale = state.scale;
    const oldOrigin = { x0: state.viewX0, y0: state.viewY0 };
    state.zoom = z;
    fitScale();
    if (ax != null && state.zoom > 1.0001) {
      const o = window.zoomAnchoredOrigin(oldOrigin, ax, ay, oldScale, state.scale, MARGIN_PX);
      const visW = (cv.width - 2 * MARGIN_PX) / state.scale;
      const visH = (cv.height - 2 * MARGIN_PX) / state.scale;
      const c = window.clampViewOrigin(o, viewDomain(), visW, visH);
      state.viewX0 = c.x0;
      state.viewY0 = c.y0;
    }
    render2D();
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

  // Zierkante active? (rect/circle plates with a decorated outline; the
  // perimeter must be constructible — degenerate saved plates fall back to
  // the plain outline instead of crashing render2D)
  function edgeActive() {
    var e = doc.body.edge;
    return !!(e && e.style && e.style !== "none" && e.sizeMm > 0 && e.periodMm > 0 &&
      (doc.body.shape === "rect" || doc.body.shape === "circle") &&
      window.platePerimeterMm && window.platePerimeterMm(doc.body));
  }

  // Decorated (wave/teeth) plate outline as the current ctx path. Samples the
  // analytic perimeter and offsets it inward by the same profile the SDF uses
  // (geometry.js plateEdgeDecorator), so 2D and print agree. Perforation is
  // handled by clipDecoratedPlate/strokeDecoratedPlate instead.
  function decoratedPlatePath(ctx) {
    var e = doc.body.edge;
    var per = window.platePerimeterMm(doc.body);
    var L = per.length;
    var n = Math.max(3, Math.round(L / e.periodMm));
    var p = L / n;
    var depth = e.style === "teeth"
      ? function (t) { var f = t / p - Math.floor(t / p); return e.sizeMm * (1 - Math.abs(2 * f - 1)); }
      : function (t) { return e.sizeMm * 0.5 * (1 + Math.cos(2 * Math.PI * t / p)); };
    var step = Math.min(p / 8, 1);
    ctx.beginPath();
    for (var t = 0, j = 0; t < L; t += step, j++) {
      var q = per.point(t);
      var d = depth(t);
      var px = mmX(q.x - q.nx * d), py = mmY(q.y - q.ny * d);
      if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // Nominal (undecorated) plate outline, sampled from the same perimeter.
  function plateNominalPath(ctx, per) {
    var L = per.length, step = Math.min(1, L / 64);
    ctx.beginPath();
    for (var t = 0, i = 0; t < L; t += step, i++) {
      var q = per.point(t);
      if (i === 0) ctx.moveTo(mmX(q.x), mmY(q.y)); else ctx.lineTo(mmX(q.x), mmY(q.y));
    }
    ctx.closePath();
  }

  // Perforation hole circles, appended to the current path (begin starts one).
  function plateHolesPath(ctx, per, e, begin) {
    var L = per.length, n = Math.max(3, Math.round(L / e.periodMm)), p = L / n;
    var r = (e.sizeMm / 2) * state.scale;
    if (begin) ctx.beginPath();
    for (var k = 0; k < n; k++) {
      var c = per.point(k * p);
      ctx.moveTo(mmX(c.x) + r, mmY(c.y));
      ctx.arc(mmX(c.x), mmY(c.y), r, 0, Math.PI * 2);
    }
  }

  // Establish the decorated-plate clip (inside the caller's save/restore).
  // Perforation must be "outline MINUS holes" — a single evenodd path would
  // also include the OUTER half of each hole circle, painting content outside
  // the plate. Intersecting a nonzero outline clip with a canvas-minus-holes
  // evenodd clip kills those half-discs.
  function clipDecoratedPlate(ctx) {
    var e = doc.body.edge;
    if (e.style === "perforation") {
      var per = window.platePerimeterMm(doc.body);
      plateNominalPath(ctx, per); ctx.clip();
      ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height);
      plateHolesPath(ctx, per, e, false);
      ctx.clip("evenodd");
      return;
    }
    decoratedPlatePath(ctx); ctx.clip();
  }

  // Stroke the decorated outline with the current stroke style. Perforation:
  // outline segments outside the hole mouths + the inner half of each circle.
  function strokeDecoratedPlate(ctx) {
    var e = doc.body.edge;
    if (e.style !== "perforation") { decoratedPlatePath(ctx); ctx.stroke(); return; }
    var per = window.platePerimeterMm(doc.body);
    ctx.save(); // outline, suppressed where a hole mouth opens
    ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height);
    plateHolesPath(ctx, per, e, false);
    ctx.clip("evenodd");
    plateNominalPath(ctx, per); ctx.stroke();
    ctx.restore();
    ctx.save(); // the bite arcs: circles clipped to the plate interior
    plateNominalPath(ctx, per); ctx.clip();
    plateHolesPath(ctx, per, e, true); ctx.stroke();
    ctx.restore();
  }

  // Zierlinie 2D preview: stroke the contour-following line(s). The engine
  // band mask is authoritative; on decorated edges this offsets the decorated
  // outline along the nominal normals (a close preview approximation).
  function strokeZierlinie(ctx, s) {
    var l = doc.body.line;
    var nLines = Math.max(1, Math.min(3, Math.round(l.count || 1)));
    var gap = l.widthMm * 1.5;
    ctx.save();
    ctx.strokeStyle = l.mode === "raised" ? (l.color || "#000000") : "#3a3a44";
    ctx.lineWidth = Math.max(1, l.widthMm * s);
    if (l.mode === "engraved") ctx.globalAlpha = 0.55; // a groove reads lighter than ink
    var per = edgeActive() ? window.platePerimeterMm(doc.body) : null;
    var depthFn = function () { return 0; };
    if (per) {
      var e = doc.body.edge;
      if (e.style === "wave" || e.style === "teeth") {
        var deco = window.plateEdgeDecorator(e, per.length);
        if (deco) depthFn = function (t) { return -deco(0, t); };
      }
    }
    for (var k = 0; k < nLines; k++) {
      var insetK = l.insetMm + k * (l.widthMm + gap) + l.widthMm / 2;
      if (per) {
        var L = per.length, step = Math.min(1, L / 128);
        ctx.beginPath();
        for (var t = 0, j = 0; t < L; t += step, j++) {
          var q = per.point(t);
          var off = insetK + depthFn(t);
          var X = mmX(q.x - q.nx * off), Y = mmY(q.y - q.ny * off);
          if (j) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        }
        ctx.closePath();
        ctx.stroke();
      } else if (doc.body.shape === "circle") {
        var r0 = Math.min(doc.body.widthMm, doc.body.heightMm) / 2 - insetK;
        if (r0 * s > 1) {
          ctx.beginPath();
          ctx.arc(mmX(doc.body.widthMm / 2), mmY(doc.body.heightMm / 2), r0 * s, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (insetBodyPath(ctx, insetK)) {
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Rounded-rect path inset by insetMm on all sides (Rand-Rahmen 2D preview).
  // Returns false when the inset collapses the rect. Preview-approximation:
  // the inset corner radius is max(0, cornerRadius - inset); geometry is authoritative.
  function insetBodyPath(ctx, insetMm) {
    const body = doc.body;
    const x0 = mmX(insetMm), y0 = mmY(insetMm);
    const x1 = mmX(body.widthMm - insetMm), y1 = mmY(body.heightMm - insetMm);
    if (x1 <= x0 || y1 <= y0) return false;
    const w = x1 - x0, h = y1 - y0;
    const rr = Math.min(Math.max(0, (body.cornerRadiusMm || 0) - insetMm) * state.scale, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x0 + rr, y0);
    ctx.arcTo(x1, y0, x1, y1, rr);
    ctx.arcTo(x1, y1, x0, y1, rr);
    ctx.arcTo(x0, y1, x0, y0, rr);
    ctx.arcTo(x0, y0, x1, y0, rr);
    ctx.closePath();
    return true;
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
      JSON.stringify(r.order || []),
      JSON.stringify(r.merges || {}),
      (d && d.minIsland != null ? d.minIsland : 0),
      // AMS bands elements render from the shared palette → cache must track it.
      ((d && d.colorLayerStyle) === 'bands' ? JSON.stringify(doc.amsPalette || []) : '')
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

  // ---- Fonts: curated offline system families + custom uploads (doc.fonts: {name: dataURL}) ----
  // el.fontFamily holds a CSS family string (system) or a custom FontFace name. Both the 2D
  // preview (drawElement) and the 3D geometry (build-parts rasterizes text) read it via canvas
  // ctx.font, so a chosen font must be registered in document.fonts before those run.
  var SYSTEM_FONTS = [
    { css: 'system-ui', label: 'System' },
    { css: 'sans-serif', label: 'Sans-Serif' },
    { css: 'serif', label: 'Serif' },
    { css: 'monospace', label: 'Monospace' },
    { css: 'Arial, sans-serif', label: 'Arial' },
    { css: '"Helvetica Neue", Helvetica, sans-serif', label: 'Helvetica' },
    { css: 'Verdana, sans-serif', label: 'Verdana' },
    { css: 'Tahoma, sans-serif', label: 'Tahoma' },
    { css: 'Georgia, serif', label: 'Georgia' },
    { css: '"Times New Roman", Times, serif', label: 'Times New Roman' },
    { css: '"Courier New", monospace', label: 'Courier New' },
    { css: 'Impact, sans-serif', label: 'Impact' }
  ];
  var _fontPromises = {}; // name -> Promise<boolean> (dedupe registration)
  function registerFont(name, dataURL) {
    if (!name || !dataURL || typeof FontFace === 'undefined') return Promise.resolve(false);
    if (_fontPromises[name]) return _fontPromises[name];
    var p = Promise.resolve().then(function () {
      var ff = new FontFace(name, 'url(' + dataURL + ')');
      return ff.load().then(function (loaded) { document.fonts.add(loaded); return true; });
    }).catch(function (e) { if (window.__errs) window.__errs.push('font ' + name + ': ' + (e && e.message || e)); return false; });
    _fontPromises[name] = p;
    return p;
  }
  function registerDocFonts(d) {
    var fonts = (d && d.fonts) || {};
    return Promise.all(Object.keys(fonts).map(function (name) { return registerFont(name, fonts[name]); }));
  }
  // Fill a <select> with system families + custom (uploaded) fonts; keep `current` selectable.
  function populateFontSelect(sel, current) {
    if (!sel) return;
    var opts = SYSTEM_FONTS.map(function (f) { return { v: f.css, t: f.label }; });
    Object.keys((doc && doc.fonts) || {}).forEach(function (name) { opts.push({ v: name, t: name + ' (eigene)' }); });
    if (current && !opts.some(function (o) { return o.v === current; })) opts.unshift({ v: current, t: current });
    sel.innerHTML = opts.map(function (o) {
      var v = String(o.v).replace(/"/g, '&quot;');
      return '<option value="' + v + '"' + (o.v === current ? ' selected' : '') + '>' + o.t + '</option>';
    }).join('');
  }
  function handleFontUpload(file) {
    if (!file) return;
    var base = (file.name || 'Schrift').replace(/\.[^.]+$/, '').replace(/[^\w \-]/g, '').trim() || 'Schrift';
    var rd = new FileReader();
    rd.onload = function () {
      if (!doc.fonts) doc.fonts = {};
      doc.fonts[base] = rd.result;
      registerFont(base, rd.result).then(function () {
        var el = selectedEl();
        if (el && el.type === 'text') el.fontFamily = base;
        refreshAdvancedForSelection();
        render2D(); scheduleRebuild3D();
      });
    };
    rd.readAsDataURL(file);
  }

  // Returns a cached off-screen canvas showing the processed image for the given element:
  //   heightmap  → grayscale (brightness-inverted when el.depth.invert).
  //   colorLayers → each opaque pixel mapped to the nearest palette color + remap applied.
  //   solid       → luminance threshold → silhouette in el.color, rest transparent.
  // Cache lives on el._display / el._displayKey; invalidated by deleting el._display.
  function processImageForDisplay(el, capOverride) {
    if (el.type !== 'image' || !el._img) return null;
    var key = elementDisplayKey(el);
    // capOverride (PNG export) renders at a higher resolution and MUST bypass the shared
    // display cache — its bigger canvas would otherwise corrupt the on-screen preview.
    if (!capOverride && el._display && el._displayKey === key) return el._display;

    var img = el._img;
    var iw = img.naturalWidth || img.width || 1;
    var ih = img.naturalHeight || img.height || 1;
    // Preview resolution cap (was 256 → visibly blocky). 1024 keeps the on-screen image crisp;
    // it's downscaled by CSS to the canvas and the display cache is param-keyed + debounced.
    // Export passes a higher capOverride so the processed image is (near-)native resolution.
    var scale = Math.min(1, (capOverride || 1024) / Math.max(iw, ih, 1));
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
      // Mirrors __renderElementV2: an AMS 'bands' element snaps to the shared doc.amsPalette;
      // otherwise the per-element reduced palette + merges + remap. Keeps 2D == 3D/export.
      var r = depth.reduce || {};
      var useGlobalAms = colorStyleOf(el) === 'bands' && Array.isArray(doc.amsPalette) && doc.amsPalette.length > 0;
      try {
        if (useGlobalAms) {
          for (var jg = 0; jg < n; jg++) {
            if (d[jg * 4 + 3] < 128) continue;
            var ac = window.hexToRgb(window.nearestAmsColor(doc.amsPalette, d[jg*4], d[jg*4+1], d[jg*4+2]));
            o[jg*4] = ac[0]; o[jg*4+1] = ac[1]; o[jg*4+2] = ac[2]; o[jg*4+3] = 255;
          }
        } else {
        var pal = window.__imagePaletteFromImg(img, r.method || 'palette', r.numColors || 8, r.levels || 4);
        var remap = r.remap || {};
        var mergeRoots = (window.resolveMergeRoots ? window.resolveMergeRoots(r.merges) : {});
        for (var j = 0; j < n; j++) {
          if (d[j * 4 + 3] < 128) continue;
          var near = window.__nearestColor(pal, d[j*4], d[j*4+1], d[j*4+2]);
          var cr = near[0], cg = near[1], cb = near[2];
          var natHex = __hexOfRGB(cr, cg, cb);
          var rootHex = mergeRoots[natHex] || natHex;
          var mapped = remap[rootHex] || (rootHex !== natHex ? rootHex : null);
          if (mapped && window.hexToRgb) {
            var mc = window.hexToRgb(mapped);
            if (mc) { cr = mc[0]; cg = mc[1]; cb = mc[2]; }
          }
          o[j*4] = cr; o[j*4+1] = cg; o[j*4+2] = cb; o[j*4+3] = 255;
        }
        }
        // Island removal (Inseln entfernen) — colorLayers path.
        // Fill transparent pixels with white, run removeSmallColorIslands, re-apply alpha.
        var islandPx = (depth.minIsland || 0);
        if (islandPx > 0 && window.removeSmallColorIslands) {
          // Build a flat-color RGBA: mask-on pixels = palette-mapped color, mask-off = white.
          var islandData = new Uint8ClampedArray(n * 4);
          var alphaMask = new Uint8Array(n); // track which pixels were opaque
          for (var ia = 0; ia < n; ia++) {
            if (o[ia * 4 + 3] >= 128) {
              alphaMask[ia] = 1;
              islandData[ia*4] = o[ia*4]; islandData[ia*4+1] = o[ia*4+1]; islandData[ia*4+2] = o[ia*4+2]; islandData[ia*4+3] = 255;
            } else {
              islandData[ia*4] = 255; islandData[ia*4+1] = 255; islandData[ia*4+2] = 255; islandData[ia*4+3] = 255;
            }
          }
          window.removeSmallColorIslands({ width: w, height: h, data: islandData }, islandPx);
          // Copy back the merged colors; restore alpha from original opaque mask.
          for (var ib = 0; ib < n; ib++) {
            if (alphaMask[ib]) {
              o[ib*4] = islandData[ib*4]; o[ib*4+1] = islandData[ib*4+1]; o[ib*4+2] = islandData[ib*4+2]; o[ib*4+3] = 255;
            }
          }
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
      // Island removal (Inseln entfernen) — solid path.
      // After threshold, run removeSmallIslands on a binary (0/255) representation.
      var solidIslandPx = (depth.minIsland || 0);
      if (solidIslandPx > 0 && window.removeSmallIslands) {
        var binData = new Uint8ClampedArray(n * 4);
        for (var bi = 0; bi < n; bi++) {
          var v = (o[bi*4+3] >= 128) ? 0 : 255; // mask-on pixels are BLACK; others are white
          binData[bi*4] = v; binData[bi*4+1] = v; binData[bi*4+2] = v; binData[bi*4+3] = 255;
        }
        window.removeSmallIslands({ width: w, height: h, data: binData }, solidIslandPx);
        // Rebuild output from cleaned binary
        for (var bj = 0; bj < n; bj++) {
          if (binData[bj*4] === 0) { // pixel survived as "on" (black = foreground)
            o[bj*4] = colR; o[bj*4+1] = colG; o[bj*4+2] = colB; o[bj*4+3] = 255;
          } else {
            o[bj*4] = 0; o[bj*4+1] = 0; o[bj*4+2] = 0; o[bj*4+3] = 0;
          }
        }
      }
    }

    var cv2 = document.createElement('canvas');
    cv2.width = w; cv2.height = h;
    cv2.getContext('2d').putImageData(out, 0, 0);
    if (!capOverride) { el._display = cv2; el._displayKey = key; } // don't cache the export render
    return cv2;
  }

  // ---- AMS shared filament palette (doc-level) ----

  // The element's current effective colors (natural → merge-root → remap), used to seed the
  // shared palette the first time an element is switched to AMS.
  function elementEffectiveHexes(el) {
    var nats = [];
    try { nats = window.__orderedNaturalHexes(__makeV1Shim(el)); } catch (e) {}
    var reduce = (el.depth && el.depth.reduce) || {};
    var remap = reduce.remap || {};
    var roots = (window.resolveMergeRoots ? window.resolveMergeRoots(reduce.merges) : {});
    var out = [], seen = {};
    nats.forEach(function (nat) {
      var root = roots[nat] || nat;
      var eff = String(remap[root] || root).toUpperCase();
      if (!seen[eff]) { seen[eff] = 1; out.push(eff); }
    });
    return out;
  }

  // Render the shared AMS palette as an ordered layer list: slot # · color chip · remove, + add.
  function renderAmsPalette(cont) {
    var pal = doc.amsPalette || [];
    var html = pal.map(function (hex, i) {
      return '<span class="pal-entry ams-entry" draggable="true" data-hex="' + hex + '" title="Layer ' + (i + 1) + '">'
        + '<span class="pal-slot" aria-hidden="true">' + (i + 1) + '</span>'
        + '<span class="grip" aria-hidden="true">⠿</span>'
        + '<input type="color" class="sw-edit ams-color" data-hex="' + hex + '" value="' + hex.toLowerCase() + '" title="Layer ' + (i + 1) + ': ' + hex + '">'
        + '<button type="button" class="ams-del" data-hex="' + hex + '" title="Layer entfernen" aria-label="Layer entfernen"' + (pal.length <= 1 ? ' disabled' : '') + '>✕</button>'
        + '</span>';
    }).join('');
    html += '<button type="button" id="amsAdd" class="btn ams-add" title="Farb-Layer hinzufügen">+ Farbe</button>';
    // Keep the surrounding plate one solid base color (don't split it into layer bands).
    html += '<label class="ams-solid-toggle" title="Grundplatte einfarbig lassen — nur das vertiefte Motiv mehrfarbig">'
      + '<input type="checkbox" id="amsSolidBase"' + (doc.amsSolidBase ? ' checked' : '') + '> Grundplatte einfarbig</label>';
    cont.innerHTML = html;
    wireAmsPalette();
  }

  function wireAmsPalette() {
    var cont = document.getElementById('amsPaletteHost');
    if (!cont) return;
    var refresh = function () { renderAmsPalette(cont); render2D(); scheduleRebuild3D(); };
    // Recolor a layer in place (preserve order). Do NOT rebuild the swatch DOM — that would
    // detach the live <input type=color> mid-drag; just repaint the preview + 3D.
    cont.querySelectorAll('.ams-color').forEach(function (inp) {
      inp.addEventListener('input', function (e) {
        var v = String(e.target.value).toUpperCase();
        var arr = (doc.amsPalette || []).slice();
        var idx = arr.indexOf(e.target.dataset.hex);
        if (idx < 0) return;
        var dup = arr.indexOf(v);
        if (dup !== -1 && dup !== idx) { e.target.value = String(e.target.dataset.hex).toLowerCase(); return; } // would merge two layers → ignore
        arr[idx] = v; window.setAmsPalette(doc, arr);
        e.target.dataset.hex = v; // keep the input anchored for repeated edits
        render2D(); scheduleRebuild3D();
      });
    });
    // Remove a layer — but never empty the palette (that would hide the editor + "+ Farbe").
    cont.querySelectorAll('.ams-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if ((doc.amsPalette || []).length <= 1) return;
        window.removeAmsColor(doc, e.target.dataset.hex); refresh();
      });
    });
    // Add a layer (first default color not already present).
    var add = document.getElementById('amsAdd');
    if (add) add.addEventListener('click', function () {
      var cands = ['#808080', '#BBBBBB', '#555555', '#CC4444', '#4488CC', '#44AA66', '#DDCC44', '#000000', '#FFFFFF'];
      var pick = cands.filter(function (c) { return (doc.amsPalette || []).indexOf(c) === -1; })[0] || '#808080';
      window.addAmsColor(doc, pick); refresh();
    });
    // Grundplatte einfarbig toggle.
    var solid = document.getElementById('amsSolidBase');
    if (solid) solid.addEventListener('change', function (e) { doc.amsSolidBase = e.target.checked; render2D(); scheduleRebuild3D(); });
    // Drag to reorder = set which layer prints on which Z-band.
    var dragSrc = null;
    cont.querySelectorAll('.ams-entry').forEach(function (entry) {
      entry.addEventListener('dragstart', function () { dragSrc = entry.dataset.hex; entry.classList.add('dragging'); });
      entry.addEventListener('dragend', function () { dragSrc = null; entry.classList.remove('dragging'); cont.querySelectorAll('.ams-entry').forEach(function (x) { x.classList.remove('drag-over'); }); });
      entry.addEventListener('dragover', function (e) { e.preventDefault(); entry.classList.add('drag-over'); });
      entry.addEventListener('dragleave', function () { entry.classList.remove('drag-over'); });
      entry.addEventListener('drop', function (e) {
        e.preventDefault(); entry.classList.remove('drag-over');
        var tgt = entry.dataset.hex; if (!dragSrc || dragSrc === tgt) return;
        var arr = (doc.amsPalette || []).slice();
        var from = arr.indexOf(dragSrc), to = arr.indexOf(tgt);
        if (from < 0 || to < 0) return;
        arr.splice(to, 0, arr.splice(from, 1)[0]);
        window.setAmsPalette(doc, arr); refresh();
      });
    });
  }

  // ---- Palette swatch UI (Advanced Umwandlung, colorLayers mode) ----

  function renderPaletteSwatches(el) {
    var cont = document.getElementById('advPaletteSwatch');
    var field = document.getElementById('advPaletteField');
    if (!cont || !field) return;
    var isColorLayers = el && el.type === 'image' && el._img &&
      ((el.depth && el.depth.mode) || 'solid') === 'colorLayers';
    field.hidden = !isColorLayers;
    // Farb-Stapelung selector shares the palette's visibility group (colorLayers only).
    var colorStyleField = document.getElementById('colorStyleField');
    if (colorStyleField) colorStyleField.hidden = !isColorLayers;
    if (!isColorLayers) { cont.innerHTML = ''; return; }
    // AMS shared palette active for a bands element → the doc-level filament-layer
    // editor lives in the Ebenen group (renderAmsPaletteField); hide the per-element
    // swatches, they would only duplicate it.
    var styleNow = (el.depth && el.depth.colorLayerStyle) || ((el.depth && el.depth.flush) ? 'bands' : 'stepped');
    if (styleNow === 'bands' && Array.isArray(doc.amsPalette) && doc.amsPalette.length) {
      field.hidden = true;
      cont.innerHTML = '';
      return;
    }
    // Use the v1 shim to call __orderedNaturalHexes.
    var shim = __makeV1Shim(el);
    var hexes = [];
    try { hexes = window.__orderedNaturalHexes(shim); } catch (e) {}
    if (!hexes || hexes.length === 0) {
      cont.innerHTML = '<span class="hint">Keine Farben gefunden</span>';
      return;
    }
    var reduce = (el.depth && el.depth.reduce) || {};
    // Self-heal: drop merges that reference colors no longer in the palette (e.g. after the
    // color count changed) so a merge can't leave a color hidden and unrecoverable.
    if (window.pruneReduceMerges) window.pruneReduceMerges(reduce, hexes);
    var remap = reduce.remap || {};
    // Color merge: naturals folded into a root are hidden; the root shows a fold count.
    var mergeRoots = (window.resolveMergeRoots ? window.resolveMergeRoots(reduce.merges) : {});
    var rootOf = function (nat) { return mergeRoots[nat] || nat; };
    var childCount = {};
    hexes.forEach(function (nat) { var rt = rootOf(nat); childCount[rt] = (childCount[rt] || 0) + 1; });
    var visible = hexes.filter(function (nat) { return rootOf(nat) === nat; });
    // Slot / print-layer number per color so the palette reads as an ordered slot list:
    // bands (AMS) = luminance rank (darkest = slot 1); stepped/flush = palette order.
    var style = (el.depth && el.depth.colorLayerStyle) || ((el.depth && el.depth.flush) ? 'bands' : 'stepped');
    var effOf = function (nat) { return (remap[nat] || nat).toUpperCase(); };
    var lumOf = function (hex) { var c = window.hexToRgb(hex) || [0, 0, 0]; return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
    var slotOrder = (style === 'bands')
      ? visible.slice().sort(function (a, b) { return lumOf(effOf(a)) - lumOf(effOf(b)); })
      : visible.slice();
    var slotOf = {}; slotOrder.forEach(function (nat, i) { slotOf[nat] = i + 1; });
    var html = visible.map(function (nat) {
      var eff = remap[nat] || nat.toLowerCase();
      var count = childCount[nat] || 1;
      var slot = slotOf[nat];
      // Merge menu: fold THIS color into another slot (listed in slot order), or split apart.
      var opts = '<option value="">⤵ zusammenführen…</option>';
      slotOrder.forEach(function (other) {
        if (other === nat) return;
        opts += '<option value="' + other + '">→ Slot ' + slotOf[other] + ' · ' + (remap[other] || other.toLowerCase()) + '</option>';
      });
      if (count > 1) opts += '<option value="__unmerge">↩ auftrennen (' + count + ')</option>';
      return '<span class="pal-entry" draggable="true" data-orig="' + nat + '" title="Slot ' + slot + '">'
        + '<span class="pal-slot" aria-hidden="true">' + slot + '</span>'
        + '<span class="grip" aria-hidden="true">⠿</span>'
        + '<input type="color" class="sw-edit" data-orig="' + nat + '" value="' + eff + '" title="' + nat + ' → ' + eff + '">'
        + (count > 1 ? '<span class="pal-count" title="' + count + ' Farben zusammengeführt">' + count + '</span>' : '')
        + '<select class="sw-merge" data-orig="' + nat + '" title="Mit anderem Slot zusammenführen">' + opts + '</select>'
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
    // Merge menu: fold this color into another (or split it back apart). Merged colors print
    // at one height (same color) — handy for flattening noisy images. Reuses reduce.merges.
    cont.querySelectorAll('.sw-merge').forEach(function (sel) {
      sel.addEventListener('change', function (e) {
        var from = e.target.dataset.orig, val = e.target.value;
        if (!el.depth.reduce) el.depth.reduce = {};
        var reduce = el.depth.reduce;
        if (val === '__unmerge') {
          // Release every color currently folded into `from`.
          var roots = (window.resolveMergeRoots ? window.resolveMergeRoots(reduce.merges) : {});
          Object.keys(roots).forEach(function (nat) { if (roots[nat] === from) window.unmergeReduceColor(reduce, nat); });
        } else if (val) {
          window.mergeReduceColors(reduce, from, val);
        } else {
          return; // placeholder selected, nothing to do
        }
        delete el._display; // invalidate cache
        renderPaletteSwatches(el);
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
  // originPxX/originPxY: pixel offset added before the mm→px transform. Canvas paths use
  // state.marginPx (default) so elements are inset from the canvas edge by the bleed border.
  // SVG export passes 0,0 so the output is byte-identical to before (no margin baked in).
  function drawElement(ctx, el, s, vx0, vy0, originPxX, originPxY, capOverride) {
    var ox = (vx0 !== undefined ? vx0 : state.viewX0);
    var oy = (vy0 !== undefined ? vy0 : state.viewY0);
    var ax = (originPxX !== undefined ? originPxX : state.marginPx);
    var ay = (originPxY !== undefined ? originPxY : state.marginPx);
    ctx.save();
    ctx.translate(ax + (el.cxMm - ox) * s, ay + (el.cyMm - oy) * s);
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    if (el.flipH || el.flipV) ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1); // Spiegeln: element-local mirror
    const w = el.wMm * s, h = el.hMm * s;
    if (el.type === "text") {
      ctx.fillStyle = el.color || "#ffffff";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${el.fontWeight || "normal"} ${Math.max(1, Math.round(h))}px ${el.fontFamily || "system-ui"}`;
      if (el.textPath && el.textPath.length > 1 && window.drawPathText) {
        window.drawPathText(ctx, el.text || "",
          el.textPath.map(function (p) { return { x: p.x * s, y: p.y * s }; }),
          Math.max(1, Math.round(h)));
      } else if (el.arcDeg) window.drawArcText(ctx, el.text || "", el.arcDeg, Math.max(1, Math.round(h)));
      else ctx.fillText(el.text || "", 0, 0);
    } else if (el.type === "shape") {
      ctx.fillStyle = el.color || "#000000";
      if (!(window.drawShapeEdge && window.drawShapeEdge(ctx, el, w, h))) {
        ctx.beginPath();
        if (el.shape === "circle") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(-w / 2, -h / 2, w, h);
        ctx.fill();
      }
    } else if (el.type === "image") {
      if (el._img) {
        // Use processed display canvas (threshold/invert/reduce applied) so 2D == print.
        var disp = processImageForDisplay(el, capOverride);
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

  // Axis-aligned box + handles for a multi-selection (mm bbox -> canvas px).
  function drawSelectionBox(ctx, bb, s) {
    if (!bb) return;
    const x0 = mmX(bb.x0), y0 = mmY(bb.y0), x1 = mmX(bb.x1), y1 = mmY(bb.y1);
    ctx.save();
    ctx.strokeStyle = "#6b4fb0"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = "#6b4fb0";
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(function (c) {
      ctx.beginPath(); ctx.rect(c[0] - 5, c[1] - 5, 10, 10); ctx.fill();
    });
    const mx = (x0 + x1) / 2;
    ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y0 - 22); ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, y0 - 22, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---- Main render (exported as render2D) ----
  function render2D() {
    noteDocChanged();
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
      // Clip elements inside the body outline (decorated when a Zierkante is active).
      const deco = edgeActive();
      ctx.save();
      if (deco) clipDecoratedPlate(ctx);
      else { bodyPath(ctx); ctx.clip(); }
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
      ctx.restore();
      // Outline.
      ctx.strokeStyle = "#3a3a44"; ctx.lineWidth = 1;
      if (deco) strokeDecoratedPlate(ctx);
      else { bodyPath(ctx); ctx.stroke(); }
      // Rand-Rahmen preview: stroke inset by widthMm/2 with lineWidth widthMm*s
      // (drawn over the content — "ring wins"; exact band comes from the engine).
      // With a Zierkante the ring is clipped to the decorated outline so its
      // outer edge follows the waves/teeth like the printed band does.
      const frame = body.frame;
      if (frame && frame.widthMm > 0) {
        ctx.save();
        if (deco) clipDecoratedPlate(ctx);
        if (insetBodyPath(ctx, frame.widthMm / 2)) {
          ctx.strokeStyle = frame.color || "#000000";
          ctx.lineWidth = frame.widthMm * s;
          ctx.stroke();
        }
        ctx.restore();
      }
    } else if (shape === "circle") {
      // Circle plate: outline only (B5: no solid fill so elements/relief are visible).
      const r = Math.min(body.widthMm, body.heightMm) / 2 * s;
      const cx = mmX(body.widthMm / 2), cy = mmY(body.heightMm / 2);
      const decoC = edgeActive();
      // Clip to circle (decorated when a Zierkante is active).
      ctx.save();
      if (decoC) clipDecoratedPlate(ctx);
      else { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip(); }
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
      ctx.restore();
      ctx.strokeStyle = "#3a3a44"; ctx.lineWidth = 1;
      if (decoC) strokeDecoratedPlate(ctx);
      else { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      // Rand-Rahmen preview: ring stroke at r - widthMm/2 ("ring wins" over content).
      // Clipped to the decorated outline when a Zierkante is active (see rect).
      const frame = body.frame;
      if (frame && frame.widthMm > 0) {
        const fr = r - (frame.widthMm / 2) * s;
        if (fr > 0) {
          ctx.save();
          if (decoC) clipDecoratedPlate(ctx);
          ctx.beginPath(); ctx.arc(cx, cy, fr, 0, Math.PI * 2);
          ctx.strokeStyle = frame.color || "#000000";
          ctx.lineWidth = frame.widthMm * s;
          ctx.stroke();
          ctx.restore();
        }
      }
    } else {
      // free / image shape: draw elements only (no plate frame in 2D).
      // NOTE: true free-shape/image-object outline only shown in 3D/export (2D simplification).
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
      // Bild: outline the defining element's rectangle (the printed object edge) with a dashed
      // stroke, so the object bounds are visible even for images with transparent edges.
      if (shape === "image") {
        var visEls = doc.elements.filter(function (e) { return !e._hidden; });
        var oid = doc.body.freeOutlineFromElementId;
        var bel = (oid && visEls.find(function (e) { return e.id === oid; }))
          || visEls.find(function (e) { return e.type === "image"; }) || visEls[0];
        if (bel) {
          var a = (bel.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
          var hw = (bel.wMm || 0) / 2, hh = (bel.hMm || 0) / 2;
          ctx.save();
          ctx.strokeStyle = "#8a8f9c"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
          ctx.beginPath();
          [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(function (c, i) {
            var px = mmX(bel.cxMm + c[0] * ca - c[1] * sa), py = mmY(bel.cyMm + c[0] * sa + c[1] * ca);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.closePath(); ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Zierlinie preview (rect/circle plates only — mirrors the engine's scope).
    if ((shape === "rect" || shape === "circle") && doc.body.line &&
        doc.body.line.mode !== "none" && doc.body.line.widthMm > 0) {
      strokeZierlinie(ctx, s);
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
    const selEls = selectedEls();
    if (selEls.length === 1) {
      drawSelection(ctx, selEls[0], s);
    } else if (selEls.length > 1) {
      drawSelectionBox(ctx, window.selectionBBox(selEls), s);
    }

    // Snap guide lines (dashed accent; only while a move-drag is active).
    if (drag && state.snapGuides.length) {
      ctx.save();
      ctx.strokeStyle = "#e0245e";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      for (var gi = 0; gi < state.snapGuides.length; gi++) {
        var guide = state.snapGuides[gi];
        ctx.beginPath();
        if (guide.axis === 'x') {
          var gx = mmX(guide.mm);
          ctx.moveTo(gx, 0); ctx.lineTo(gx, cv.height);
        } else {
          var gy = mmY(guide.mm);
          ctx.moveTo(0, gy); ctx.lineTo(cv.width, gy);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Scatter path overlay: the stroke being drawn (px) or the stored path (mm→px).
    var scPathPts = (drag && (drag.handle === "scatterPath" || drag.handle === "textPath") && drag.ptsPx && drag.ptsPx.length > 1) ? drag.ptsPx
      : (scatter && scatter.mode === "path" && scatter.path && scatter.path.length > 1 && !(drag && drag.handle === "scatterPath"))
        ? scatter.path.map(function (p) { return { x: mmX(p.x), y: mmY(p.y) }; })
        : null;
    if (scPathPts) {
      ctx.save();
      ctx.strokeStyle = "#6b4fb0";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      scPathPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.stroke();
      ctx.restore();
    }
    if (drag && (drag.handle === "marquee" || drag.handle === "scatterRegion") && drag.rectPx) {
      ctx.save();
      ctx.strokeStyle = "#6b4fb0"; ctx.fillStyle = "rgba(107,79,176,0.10)";
      ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      const r = drag.rectPx;
      ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
    }

    drawThinOverlay(ctx);
  }

  // ---- Dünne-Stellen-Overlay (red cells from the last thinFeatureMask run) ----
  // The probe grid covers the body box [0..W, 0..H] mm; it is rasterized once
  // into an offscreen canvas and blitted over the design at the current zoom.
  function drawThinOverlay(ctx) {
    var ov = state.thinOverlay;
    if (!ov) return;
    if (!ov._canvas) {
      var oc = document.createElement("canvas");
      oc.width = ov.cols; oc.height = ov.rows;
      var octx = oc.getContext("2d");
      var od = octx.createImageData(ov.cols, ov.rows);
      for (var i = 0; i < ov.thin.length; i++) {
        if (!ov.thin[i]) continue;
        od.data[i * 4] = 224; od.data[i * 4 + 1] = 32; od.data[i * 4 + 2] = 32; od.data[i * 4 + 3] = 190;
      }
      octx.putImageData(od, 0, 0);
      ov._canvas = oc;
    }
    var w = ov.cols * ov.pitch, h = ov.rows * ov.pitch; // mm covered by the probe grid
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ov._canvas, mmX(0), mmY(0), w * state.scale, h * state.scale);
    ctx.restore();
  }

  // ---- Hit test: pointer canvas-px → element/handle ----
  function elemToLocal(el, px, py, s) {
    const dx = px - mmX(el.cxMm), dy = py - mmY(el.cyMm);
    const a = -(el.rotationDeg || 0) * Math.PI / 180;
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  }

  function hitTest(px, py) {
    const s = state.scale;
    // Priority pass: the current selection's transform handles always win over any
    // element body, so an overlapping neighbor can't steal a scale/rotate grab.

    // Multi-selection: the box's own handles take priority.
    if (state.selectionIds.length > 1) {
      const bb = window.selectionBBox(selectedEls());
      if (bb) {
        const x0 = mmX(bb.x0), y0 = mmY(bb.y0), x1 = mmX(bb.x1), y1 = mmY(bb.y1);
        const mx = (x0 + x1) / 2;
        if (Math.hypot(px - mx, py - (y0 - 22)) <= 9) return { box: true, handle: "rotate" };
        const corners = { nw: [x0, y0], ne: [x1, y0], se: [x1, y1], sw: [x0, y1] };
        for (const k in corners) {
          if (Math.hypot(px - corners[k][0], py - corners[k][1]) <= 9) return { box: true, handle: k };
        }
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return { box: true, handle: "move" };
      }
    }

    const selId = state.selectedId;
    if (selId != null) {
      const sel = doc.elements.find(e => e.id === selId);
      if (sel && !sel._hidden) {
        const [lx, ly] = elemToLocal(sel, px, py, s);
        const w = sel.wMm * s, h = sel.hMm * s;
        if (Math.hypot(lx, ly + h / 2 + 22) <= 9) return { id: sel.id, handle: "rotate" };
        const corners = { nw: [-w/2, -h/2], ne: [w/2, -h/2], se: [w/2, h/2], sw: [-w/2, h/2] };
        for (const k in corners) {
          if (Math.hypot(lx - corners[k][0], ly - corners[k][1]) <= 9) return { id: sel.id, handle: k };
        }
      }
    }
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

  // ---- Snap during move-drag ----
  // Adjusts el.cxMm/cyMm toward the nearest snap target (plate edges/center, other element
  // edges/centers) within a 6 px/scale threshold. Records guide lines in state.snapGuides.
  // Grid snaps the center to the nearest multiple of gridMm on axes not already edge/element-snapped.
  // NOTE: rotation is ignored — snap uses the axis-aligned bounding box only (see report).
  function applyMoveSnap(el) {
    state.snapGuides = [];
    var s = state.scale;
    var thr = 6 / s; // 6 canvas-px expressed in mm
    var W = doc.body.widthMm, H = doc.body.heightMm;
    var cx = el.cxMm, cy = el.cyMm;
    var hw = el.wMm / 2, hh = el.hMm / 2;

    // Snap points of the dragged element (axis-aligned).
    var snapPtsX = [cx - hw, cx, cx + hw];
    var snapPtsY = [cy - hh, cy, cy + hh];

    // Candidate lines per axis.
    var candidatesX = [], candidatesY = [];
    if (state.snap.plate) {
      candidatesX.push(0, W / 2, W);
      candidatesY.push(0, H / 2, H);
    }
    if (state.snap.elements) {
      for (var ei = 0; ei < doc.elements.length; ei++) {
        var o = doc.elements[ei];
        if (o.id === el.id || o._hidden) continue;
        var ohw = o.wMm / 2, ohh = o.hMm / 2;
        candidatesX.push(o.cxMm - ohw, o.cxMm, o.cxMm + ohw);
        candidatesY.push(o.cyMm - ohh, o.cyMm, o.cyMm + ohh);
      }
    }

    // Per-axis: find (snapPt, candidate) pair with smallest |Δ| < thr; shift cx/cy.
    var snappedX = false, snappedY = false;

    if (candidatesX.length) {
      var bestDX = thr, bestShiftX = 0, bestCandX = 0;
      for (var pi = 0; pi < snapPtsX.length; pi++) {
        for (var ci = 0; ci < candidatesX.length; ci++) {
          var dx = candidatesX[ci] - snapPtsX[pi];
          if (Math.abs(dx) < bestDX) { bestDX = Math.abs(dx); bestShiftX = dx; bestCandX = candidatesX[ci]; }
        }
      }
      if (bestDX < thr) { cx += bestShiftX; state.snapGuides.push({ axis: 'x', mm: bestCandX }); snappedX = true; }
    }

    if (candidatesY.length) {
      var bestDY = thr, bestShiftY = 0, bestCandY = 0;
      for (var pj = 0; pj < snapPtsY.length; pj++) {
        for (var cj = 0; cj < candidatesY.length; cj++) {
          var dy = candidatesY[cj] - snapPtsY[pj];
          if (Math.abs(dy) < bestDY) { bestDY = Math.abs(dy); bestShiftY = dy; bestCandY = candidatesY[cj]; }
        }
      }
      if (bestDY < thr) { cy += bestShiftY; state.snapGuides.push({ axis: 'y', mm: bestCandY }); snappedY = true; }
    }

    // Grid: snap center to nearest multiple on axes not already edge/element-snapped.
    var g = state.snap.gridMm;
    if (g > 0) {
      if (!snappedX) { cx = Math.round(cx / g) * g; }
      if (!snappedY) { cy = Math.round(cy / g) * g; }
    }

    el.cxMm = cx;
    el.cyMm = cy;
  }

  // ---- Pointer handlers (move / scale / rotate) ----
  let drag = null;
  var spacePan = false; // Space held → next canvas drag pans the view
  var textPathDraw = null; // text-element id waiting for a Pfadtext drag

  // Mouse wheel zooms the workbench toward the cursor (same convention as the
  // 3D stage); ctrl+wheel is the trackpad pinch (finer deltas, larger factor).
  cv.addEventListener("wheel", function (e) {
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    const scaleC = cv.width / rect.width;
    const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : 1); // line-mode wheels (Firefox)
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
    setZoom2d(state.zoom * factor, px, py);
  }, { passive: false });

  window.addEventListener("keydown", function (e) {
    if (e.key !== " " || e.repeat) return;
    var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || (t && t.isContentEditable)) return;
    spacePan = true;
    cv.style.cursor = "grab";
    e.preventDefault(); // keep the page from scrolling while the canvas has focus
  });
  window.addEventListener("keyup", function (e) {
    if (e.key !== " ") return;
    spacePan = false;
    if (!drag) cv.style.cursor = "";
  });

  (function () {
    var chip = document.getElementById("zoom2dChip");
    if (chip) chip.addEventListener("click", function () { setZoom2d(1); });
  }());

  cv.addEventListener("pointerdown", function (e) {
    const rect = cv.getBoundingClientRect();
    const scaleC = cv.width / rect.width;
    const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
    // Pan: middle button always, left button while Space is held.
    if (e.button === 1 || (e.button === 0 && spacePan)) {
      drag = { handle: "pan", px, py, ox: state.viewX0, oy: state.viewY0 };
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = "grabbing";
      e.preventDefault(); // suppress middle-click autoscroll
      return;
    }
    // Pfadtext: the next canvas drag records the path for the waiting text element.
    if (textPathDraw) {
      const toMmT = function (p, v0) { return (p - state.marginPx) / state.scale + v0; };
      drag = { handle: "textPath", px, py, ptsPx: [{ x: px, y: py }],
               pathMm: [{ x: toMmT(px, state.viewX0), y: toMmT(py, state.viewY0) }] };
      cv.setPointerCapture(e.pointerId);
      return;
    }
    // Scatter sub-mode: while the panel is open, a canvas drag defines the placement region.
    if (scatter) {
      if (scatter.mode === "path") {
        const toMm0 = function (p, v0) { return (p - state.marginPx) / state.scale + v0; };
        drag = { handle: "scatterPath", px, py, ptsPx: [{ x: px, y: py }],
                 pathMm: [{ x: toMm0(px, state.viewX0), y: toMm0(py, state.viewY0) }] };
        cv.setPointerCapture(e.pointerId);
        return;
      }
      drag = { handle: "scatterRegion", px, py };
      cv.setPointerCapture(e.pointerId);
      return;
    }
    const hit = hitTest(px, py);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (hit && hit.box) {
      const bb = window.selectionBBox(selectedEls());
      drag = {
        handle: hit.handle, box: true, px, py, bb: bb,
        center: { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 },
        pivot: hit.handle === "nw" ? { x: bb.x1, y: bb.y1 } : hit.handle === "ne" ? { x: bb.x0, y: bb.y1 }
             : hit.handle === "se" ? { x: bb.x0, y: bb.y0 } : { x: bb.x1, y: bb.y0 },
        starts: selectedEls().map(function (m) { return { id: m.id, cxMm: m.cxMm, cyMm: m.cyMm, wMm: m.wMm, hMm: m.hMm, rotationDeg: m.rotationDeg || 0 }; }),
      };
      cv.setPointerCapture(e.pointerId);
      render2D();
      return;
    }
    if (!hit) {
      // Empty canvas: start a marquee (rubber-band) selection.
      drag = { handle: "marquee", px, py, additive, base: additive ? state.selectionIds.slice() : [] };
      if (!additive) clearSelection();
      cv.setPointerCapture(e.pointerId);
      refreshAdvancedForSelection(); renderAdvancedLayers(); render2D();
      return;
    }
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
    if (hit.handle === "move") {
      if (additive) { toggleInSelection(hit.id); refreshAdvancedForSelection(); renderAdvancedLayers(); render2D(); return; }
      if (!isSelected(hit.id)) setSelection([hit.id]);   // clicking an unselected body selects just it
      // else: keep the existing multi-selection so a group-move drag can begin
    } else {
      setSelection([hit.id]);                            // a handle grab always focuses that element
    }
    const el = doc.elements.find(el => el.id === hit.id);
    drag = {
      handle: hit.handle, px, py,
      start: { cx: el.cxMm, cy: el.cyMm, w: el.wMm, h: el.hMm, rot: el.rotationDeg || 0 },
      // Snapshot every selected member for a group move.
      starts: selectedEls().map(function (m) { return { id: m.id, cxMm: m.cxMm, cyMm: m.cyMm, wMm: m.wMm, hMm: m.hMm, rotationDeg: m.rotationDeg || 0 }; }),
    };
    cv.setPointerCapture(e.pointerId);
    refreshAdvancedForSelection(); renderAdvancedLayers(); render2D();
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
          // Outside: negative distance to nearest edge. Inside: positive min distance to edge.
          var outside = dx > 0 || dy > 0;
          return outside ? -Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.min(-dx, -dy);
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
    if (drag && drag.box) {
      const applyUpdates = function (ups) {
        ups.forEach(function (u) {
          const m = doc.elements.find(function (x) { return x.id === u.id; });
          if (!m) return;
          m.cxMm = u.cxMm; m.cyMm = u.cyMm;
          if (u.wMm != null) m.wMm = u.wMm;
          if (u.hMm != null) m.hMm = u.hMm;
          if (u.rotationDeg != null) m.rotationDeg = u.rotationDeg;
        });
      };
      if (drag.handle === "move") {
        applyUpdates(window.applyMove(drag.starts, (px - drag.px) / s, (py - drag.py) / s));
      } else if (drag.handle === "rotate") {
        const cxpx = mmX(drag.center.x), cypx = mmY(drag.center.y);
        const theta = (Math.atan2(py - cypx, px - cxpx) - Math.atan2(drag.py - cypx, drag.px - cxpx)) * 180 / Math.PI;
        applyUpdates(window.applyRotate(drag.starts, drag.center, theta));
      } else {
        // corner: uniform factor = current pivot->cursor distance / pivot->start-corner distance
        const pivPx = { x: mmX(drag.pivot.x), y: mmY(drag.pivot.y) };
        const startD = Math.hypot(drag.px - pivPx.x, drag.py - pivPx.y) || 1;
        const nowD = Math.hypot(px - pivPx.x, py - pivPx.y);
        applyUpdates(window.applyScale(drag.starts, drag.pivot, Math.max(0.05, nowD / startD)));
      }
      render2D();
      return;
    }
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
        // Do NOT update viewX0/viewY0 mid-drag — keeping them fixed lets the marker track
        // the cursor via the delta math above. Re-anchor happens in endDrag via fitScale().
      } else {
        // Hole: classic inside-plate clamp.
        mount.xMm = clamp(rawX, 0, doc.body.widthMm);
        mount.yMm = clamp(rawY, 0, doc.body.heightMm);
      }
      render2D();
      scheduleRebuild3D();
      return;
    }
    if (drag.handle === "pan") {
      const visW = (cv.width - 2 * state.marginPx) / s;
      const visH = (cv.height - 2 * state.marginPx) / s;
      const o = window.clampViewOrigin(
        { x0: drag.ox - (px - drag.px) / s, y0: drag.oy - (py - drag.py) / s },
        viewDomain(), visW, visH);
      state.viewX0 = o.x0;
      state.viewY0 = o.y0;
      render2D();
      return;
    }
    if (drag.handle === "scatterPath" || drag.handle === "textPath") {
      // freehand path: sample a point every few pixels
      const last = drag.ptsPx[drag.ptsPx.length - 1];
      if (Math.hypot(px - last.x, py - last.y) >= 4) {
        const toMmP = function (p, v0) { return (p - state.marginPx) / s + v0; };
        drag.ptsPx.push({ x: px, y: py });
        drag.pathMm.push({ x: toMmP(px, state.viewX0), y: toMmP(py, state.viewY0) });
        render2D();
      }
      return;
    }
    if (drag.handle === "scatterRegion") {
      const toMm = function (p, v0) { return (p - state.marginPx) / s + v0; };
      scatter.region = {
        x0: Math.min(toMm(drag.px, state.viewX0), toMm(px, state.viewX0)),
        x1: Math.max(toMm(drag.px, state.viewX0), toMm(px, state.viewX0)),
        y0: Math.min(toMm(drag.py, state.viewY0), toMm(py, state.viewY0)),
        y1: Math.max(toMm(drag.py, state.viewY0), toMm(py, state.viewY0)),
      };
      drag.rectPx = { x0: Math.min(drag.px, px), y0: Math.min(drag.py, py), x1: Math.max(drag.px, px), y1: Math.max(drag.py, py) };
      render2D();
      return;
    }
    if (drag.handle === "marquee") {
      const rectMm = {
        x0: Math.min((drag.px - state.marginPx) / s + state.viewX0, (px - state.marginPx) / s + state.viewX0),
        x1: Math.max((drag.px - state.marginPx) / s + state.viewX0, (px - state.marginPx) / s + state.viewX0),
        y0: Math.min((drag.py - state.marginPx) / s + state.viewY0, (py - state.marginPx) / s + state.viewY0),
        y1: Math.max((drag.py - state.marginPx) / s + state.viewY0, (py - state.marginPx) / s + state.viewY0),
      };
      drag.rectPx = { x0: Math.min(drag.px, px), y0: Math.min(drag.py, py), x1: Math.max(drag.px, px), y1: Math.max(drag.py, py) };
      const hits = window.marqueeHits(doc.elements, rectMm);
      setSelection(drag.additive ? drag.base.concat(hits.filter(function (id) { return drag.base.indexOf(id) === -1; })) : hits);
      refreshAdvancedForSelection(); renderAdvancedLayers(); render2D();
      return;
    }
    const el = doc.elements.find(el => el.id === state.selectedId);
    if (!el) return;
    if (drag.handle === "move") {
      const dx = (px - drag.px) / s, dy = (py - drag.py) / s;
      if (drag.starts && drag.starts.length > 1) {
        drag.starts.forEach(function (st0) {           // inline (no applyMove dependency yet)
          const m = doc.elements.find(function (x) { return x.id === st0.id; });
          if (m) { m.cxMm = st0.cxMm + dx; m.cyMm = st0.cyMm + dy; }
        });
      } else {
        el.cxMm = drag.start.cx + dx;
        el.cyMm = drag.start.cy + dy;
        applyMoveSnap(el);
      }
    } else if (drag.handle === "rotate") {
      const ang = Math.atan2(py - mmY(el.cyMm), px - mmX(el.cxMm)) * 180 / Math.PI + 90;
      el.rotationDeg = Math.round(ang);
    } else {
      // Corner handle: scale width/height symmetrically. Shift = proportional —
      // keep the aspect ratio from the drag start, following the dominant axis.
      const [lx, ly] = elemToLocal(el, px, py, s);
      if (e.shiftKey && drag.start.w > 0 && drag.start.h > 0) {
        let k = Math.max((Math.abs(lx) * 2 / s) / drag.start.w, (Math.abs(ly) * 2 / s) / drag.start.h);
        k = Math.max(k, 2 / drag.start.w, 2 / drag.start.h); // 2mm floor on both axes, ratio intact
        el.wMm = drag.start.w * k;
        el.hMm = drag.start.h * k;
      } else {
        el.wMm = Math.max(2, Math.abs(lx) * 2 / s);
        el.hMm = Math.max(2, Math.abs(ly) * 2 / s);
      }
    }
    render2D();
  });

  function endDrag() {
    if (!drag) return;
    if (drag.handle === "pan") {
      // Pure view change: no re-fit, no 3D rebuild, no inspector refresh.
      drag = null;
      cv.style.cursor = spacePan ? "grab" : "";
      render2D();
      return;
    }
    if (drag.handle === "textPath") {
      // Pfadtext: store the smoothed path element-local (undo translate/rotate/flip).
      var rawPath = drag.pathMm;
      drag = null;
      var tpEl = doc.elements.find(function (e2) { return e2.id === textPathDraw; });
      textPathDraw = null;
      if (tpEl && rawPath.length > 1) {
        var smoothed = window.smoothPath ? window.smoothPath(rawPath, 2) : rawPath;
        var ang = -(tpEl.rotationDeg || 0) * Math.PI / 180;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        tpEl.textPath = smoothed.map(function (p) {
          var dx = p.x - tpEl.cxMm, dy = p.y - tpEl.cyMm;
          var lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
          if (tpEl.flipH) lx = -lx;
          if (tpEl.flipV) ly = -ly;
          return { x: lx, y: ly };
        });
      }
      refreshAdvancedForSelection();
      render2D();
      scheduleRebuild3D();
      return;
    }
    var wasScatter = drag.handle === "scatterRegion";
    var pathMm = drag.handle === "scatterPath" ? drag.pathMm : null;
    drag = null;
    if (wasScatter && scatter) scatterGenerate(); // re-roll the preview into the new region
    if (pathMm && scatter) {
      if (pathMm.length > 1) { scatter.path = pathMm; scatterGenerate(); }
      render2D();
    }
    state.snapGuides = []; // clear transient guide lines
    // Re-fit the canvas: a move/scale/rotate (or mount move) may have pushed the element past
    // the old bounds. viewportDomain now includes element bboxes, so this keeps handles on-canvas.
    // No-op view-wise while elements stay within the plate (domain unchanged → same fit).
    fitScale();
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
  function addImageFromDataURL(dataURL, fileName) {
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
        // File name (without extension) — labels the layer and feeds the export name.
        name: fileName ? String(fileName).replace(/\.[^.]+$/, "") : undefined,
      });
      el.depth.direction = defaultDirection;
      doc.elements.push(el);
      setSelection([el.id]);
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
    e.stopPropagation(); // #canvas2d sits inside #preview — both have this handler, so stop the bubble or one drop loads twice
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const rd = new FileReader();
    rd.onload = function () { addImageFromDataURL(rd.result, file.name); };
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
    setSelection([els[idx].id]);
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
        clearSelection(); refreshAdvancedForSelection(); renderLayers(); render2D();
        return; // do NOT preventDefault: focus leaves the canvas
      } else {
        if (cur === -1) { e.preventDefault(); selectByIndex(els.length - 1); return; }
        if (cur > 0) { e.preventDefault(); selectByIndex(cur - 1); return; }
        clearSelection(); refreshAdvancedForSelection(); renderLayers(); render2D();
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
        clearSelection(); refreshAdvancedForSelection(); renderLayers(); render2D();
      }
      cv.blur();
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") { // remove the selected element
      if (state.selectedId != null) { e.preventDefault(); deleteSelected(); }
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
    if (state.selectionIds.length > 1) {              // nudge the whole multi-selection together
      selectedEls().forEach(function (el) {
        el.cxMm = clamp(el.cxMm + dx * stepMm, 0, doc.body.widthMm);
        el.cyMm = clamp(el.cyMm + dy * stepMm, 0, doc.body.heightMm);
      });
      render2D(); scheduleRebuild3D();
    } else {
      withSelected(function (el) {
        el.cxMm = clamp(el.cxMm + dx * stepMm, 0, doc.body.widthMm);
        el.cyMm = clamp(el.cyMm + dy * stepMm, 0, doc.body.heightMm);
      });
    }
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
      rd.onload = function () { addImageFromDataURL(rd.result, f.name); };
      rd.readAsDataURL(f);
      addImageInput.value = "";
    });
  }

  // ---- Single resize listener: 2D re-render; 3D resize is handled by preview3d ----
  // In split mode, 3D is active but 2D still needs a re-fit on resize.
  window.addEventListener("resize", function () {
    var inSplit = document.getElementById("preview").classList.contains("split");
    if (!window.preview3d || !window.preview3d.isActive() || inSplit) {
      fitScale(); // B3: re-fit available space on window resize.
      render2D();
    }
  });

  // ---- 2D/3D/split preview mode ----
  const PREVIEW_MODE_KEY = "ukibori.previewMode";
  function getPartsFn() { return { parts: window.buildParts(visibleDoc()) }; }

  // setPreviewMode: unified handler for 2D, 3D, and split modes.
  // Order: set layout class + visibility first so clientWidth is the split half-width
  // before preview3d reads it, then fitScale (2D), then synthetic resize to settle both.
  function setPreviewMode(mode) {
    var preview = document.getElementById("preview");
    var canvas2d = document.getElementById("canvas2d");
    var canvas3d = document.getElementById("preview3dCanvas");

    // 1. Layout and visibility (before any 3D show call so clientWidth is correct).
    if (mode === "split") {
      preview.classList.add("split");
    } else {
      preview.classList.remove("split");
    }
    canvas2d.hidden = (mode === "3d");
    canvas3d.hidden = (mode === "2d");
    var lsw = document.getElementById("layerSliderWrap");
    if (lsw) lsw.hidden = (mode === "2d"); // Schicht-Vorschau only makes sense with 3D visible

    // 2. Button active state.
    document.getElementById("view2dBtn").classList.toggle("seg-active", mode === "2d");
    document.getElementById("view3dBtn").classList.toggle("seg-active", mode === "3d");
    document.getElementById("viewSplitBtn").classList.toggle("seg-active", mode === "split");

    // 3. 3D lifecycle.
    if (mode === "2d") {
      window.preview3d.hide();
      fitScale();
      render2D();
    } else {
      // mode is '3d' or 'split': layout is already applied, so clientWidth is the half-width in split.
      Promise.resolve(window.preview3d.show(canvas3d, getPartsFn)).catch(function (err) {
        if (window.__errs) window.__errs.push(String(err && err.message || err));
        // On GL failure fall back to 2D.
        setPreviewMode("2d");
        return;
      });
      fitScale();
      render2D();
      // Synthetic resize settles both: fitScale (2D) and preview3d's internal resize (3D).
      window.dispatchEvent(new Event("resize"));
    }

    // 4. Persist.
    try { localStorage.setItem(PREVIEW_MODE_KEY, mode); } catch (e) {}
  }

  document.getElementById("view2dBtn").addEventListener("click", function () { setPreviewMode("2d"); });
  document.getElementById("view3dBtn").addEventListener("click", function () { setPreviewMode("3d"); });
  document.getElementById("viewSplitBtn").addEventListener("click", function () { setPreviewMode("split"); });

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
    // Default the file name from the first imported element (its source file name);
    // a user-typed name is never overwritten (only the shipped default/empty is).
    var nameEl = document.getElementById("exportName");
    if (nameEl) nameEl.value = defaultExportName();
    document.getElementById("exportModal").removeAttribute("hidden");
    setExportStatus("");
  });

  document.getElementById("exportClose").addEventListener("click", function () {
    document.getElementById("exportModal").setAttribute("hidden", "");
  });

  document.getElementById("exportMf").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      const parts = window.buildParts(visibleDoc(), { layout: "bed" });
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
      const parts = window.buildParts(visibleDoc(), { layout: "bed" });
      const facets = parts.flatMap(function (p) { return p.facets; });
      const u8 = window.facetsToBinarySTL(facets);
      const blob = new Blob([u8], { type: "application/octet-stream" });
      downloadBlob(blob, exportFileName() + ".stl");
      setExportStatus("Fertig.");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });

  // Pausen-Spickzettel: exact pause layers for manual color swaps (no AMS).
  document.getElementById("exportPause").addEventListener("click", function () {
    try {
      const doc = visibleDoc();
      if (doc.shadowbox && doc.shadowbox.enabled) {
        setExportStatus("Im Schaukasten-Modus nicht verfügbar — jede Platte wird einzeln und einfarbig gedruckt.");
        return;
      }
      setExportStatus("Berechne …");
      const parts = window.buildParts(doc);
      const sheet = window.buildPauseSheet(parts, doc.body.layerHeightMm);
      if (sheet.swaps.length <= 1 && !sheet.mixed.length) {
        setExportStatus("Nur eine Farbe — keine Pausen nötig.");
        return;
      }
      const text = window.formatPauseSheet(sheet, { name: exportFileName(), layerHeightMm: doc.body.layerHeightMm });
      downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), exportFileName() + "-pausen.txt");
      setExportStatus(sheet.mixed.length
        ? "Fertig — Achtung: enthält Zonen, die nur mit AMS druckbar sind (siehe Zettel)."
        : "Fertig.");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });

  // Render the DESIGN to an off-screen PNG canvas. MIRRORS buildDesignSVG (base plate color
  // filled, elements on top, then everything outside the real footprint — rounded corners /
  // circle / free silhouette / mount hole — blanked to transparent), so the PNG matches the
  // SVG/print. Only difference from the SVG raster: we raster at "image DPI" (primary image
  // pixel-perfect) instead of the doc's grid resolution. No viewport margin, no checkerboard,
  // no editor chrome.
  function exportDesignCanvas() {
    var d = visibleDoc();
    var domain = (window.docDomain ? window.docDomain(d)
      : { x0: 0, y0: 0, wMm: d.body.widthMm, hMm: d.body.heightMm });
    // Target long-edge px: make the primary image pixel-perfect; else the doc's print resolution.
    var imgEl = d.elements.find(function (e) { return e.type === "image" && e._img; });
    var pxPerMm = imgEl ? ((imgEl._img.naturalWidth || 1) / Math.max(0.01, imgEl.wMm))
      : ((d.resolution || 1024) / Math.max(0.01, domain.wMm, domain.hMm));
    if (!(pxPerMm > 0)) pxPerMm = 10;
    var MAX = 4096; // clamp so huge plates/images can't blow up memory
    var longEdge = Math.round(Math.max(domain.wMm, domain.hMm) * pxPerMm);
    longEdge = Math.max(64, Math.min(MAX, longEdge));

    // Same grid + footprint the engine/SVG use, but at the higher export resolution.
    var dd = Object.assign({}, d, { resolution: longEdge });
    var gf = window.docGridAndFootprint(dd);
    var cols = gf.grid.cols, rows = gf.grid.rows, pitch = gf.grid.pitch, gx0 = gf.grid.x0, gy0 = gf.grid.y0;
    var s = 1 / pitch; // px per mm on this grid

    var oc = document.createElement("canvas"); oc.width = cols; oc.height = rows;
    var octx = oc.getContext("2d", { willReadFrequently: true });
    octx.fillStyle = d.body.baseColor;
    octx.fillRect(0, 0, cols, rows);
    // Elements on top (capOverride = longEdge → near-native image quality, cache bypassed).
    for (var i = 0; i < d.elements.length; i++) {
      drawElement(octx, d.elements[i], s, gx0, gy0, 0, 0, longEdge);
    }
    // Blank everything outside the real footprint (plate outline + mount hole), like the SVG.
    var im = octx.getImageData(0, 0, cols, rows), px = im.data;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (gf.footprint(c, r) <= 0) { var i4 = (r * cols + c) * 4; px[i4] = 0; px[i4 + 1] = 0; px[i4 + 2] = 0; px[i4 + 3] = 0; }
      }
    }
    octx.putImageData(im, 0, 0);
    return oc;
  }

  document.getElementById("exportPng").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      const name = exportFileName();
      exportDesignCanvas().toBlob(function (b) {
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
    // Use shared expanded-domain grid+footprint (T1). For non-loop docs this is identical
    // to the old gridForBody + shapeFootprintField/freeFootprintField path (x0=y0=0).
    var gf = window.docGridAndFootprint(d);
    var cols = gf.grid.cols, rows = gf.grid.rows, pitch = gf.grid.pitch;
    var x0 = gf.grid.x0, y0 = gf.grid.y0;
    var s = 1 / pitch; // px per mm so that drawElement places content on the engine grid

    // Footprint field: >0 inside the footprint (plate ∪ washer, with hole cut).
    var baseInside = function (c, r) { return gf.footprint(c, r) > 0; };

    // Composite raster: paint base color, then elements on top.
    var offcanvas = document.createElement("canvas");
    offcanvas.width = cols; offcanvas.height = rows;
    var offctx = offcanvas.getContext("2d", { willReadFrequently: true });

    // Base plate color.
    offctx.fillStyle = d.body.baseColor;
    offctx.fillRect(0, 0, cols, rows);

    // Elements on top (WYSIWYG — processImageForDisplay applied inside drawElement).
    // drawElement's trailing args are a view origin in MM (subtracted from el.cxMm
    // before scaling), so pass the grid origin (x0,y0) directly. When x0=y0=0 (no
    // overhang) this reduces to the old (0,0) — byte-identical.
    // Pass originPxX=0, originPxY=0 so NO canvas margin is baked into the SVG raster
    // (state.marginPx is a 2D-preview-only bleed border, not part of the SVG domain).
    for (var ei = 0; ei < d.elements.length; ei++) {
      drawElement(offctx, d.elements[ei], s, x0, y0, 0, 0);
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
  // Toggle [hidden] on an element by id, if present.
  function setHidden(id, hidden) { var n = document.getElementById(id); if (n) n.hidden = hidden; }

  function applyShape(shape) {
    doc.body.shape = shape;
    var seg = shape === "rect" ? "Rect" : shape === "circle" ? "Circle" : shape === "free" ? "Free" : "Image";
    setSegActive("shapeSeg", "shape" + seg);
    var isImage = shape === "image";
    // Plate-free "Bild": the image IS the object → hide all plate chrome (border/frame/corner
    // + plate size). border: free only; frame: rect/circle/free; corner: rect only.
    setHidden("borderField", shape !== "free");
    setHidden("frameField", isImage); // rect/circle/free all support the Rand-Rahmen
    setHidden("cornerField", shape !== "rect");
    setHidden("edgeField", shape !== "rect" && shape !== "circle"); // Zierkante needs the analytic outline
    setHidden("lineField", shape !== "rect" && shape !== "circle"); // Zierlinie too
    setHidden("simpleSizeSection", isImage);
    // A Bild object has no plate → mount (Befestigung) and plate-centered "Ausrichten" are
    // meaningless. Force mount off (so 2D marker, hit-test, and 3D geometry all agree) and hide
    // both control groups. Non-image shapes leave the mount untouched.
    if (isImage && doc.mount && doc.mount.type !== "none") {
      doc.mount.type = "none";
      setSegActive("mountSeg", "mountNone");
    }
    setHidden("simpleMountSection", isImage);
    setHidden("simpleCenterSection", isImage);
    syncShadowboxControls();
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("shapeRect").addEventListener("click", function () { applyShape("rect"); });
  document.getElementById("shapeCircle").addEventListener("click", function () { applyShape("circle"); });
  document.getElementById("shapeFree").addEventListener("click", function () { applyShape("free"); });
  document.getElementById("shapeImage").addEventListener("click", function () { applyShape("image"); });

  // Wire a number/color input to apply(v).
  function bindNum(id, min, apply) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener("input", function () {
      var v = parseFloat(node.value);
      if (isNaN(v) || v < min) return;
      apply(v);
    });
  }
  function bindColor(id, apply) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener("input", function () { apply(node.value); });
  }

  // Eckenradius (shown only for Rechteck)
  bindNum("cornerMm", 0, function (v) {
    doc.body.cornerRadiusMm = v; render2D(); scheduleRebuild3D();
  });

  // Zierkante (rect/circle): style select + size/period fields
  function syncEdgeFields() {
    var e = doc.body.edge || { style: "none", sizeMm: 2, periodMm: 8 };
    var st = document.getElementById("edgeStyle");
    if (st) st.value = e.style || "none";
    var params = document.getElementById("edgeParams");
    if (params) params.hidden = !e.style || e.style === "none";
    var sz = document.getElementById("edgeSizeMm");
    if (sz) sz.value = e.sizeMm;
    var pd = document.getElementById("edgePeriodMm");
    if (pd) pd.value = e.periodMm;
  }
  (function () {
    var st = document.getElementById("edgeStyle");
    if (st) st.addEventListener("change", function () {
      if (!doc.body.edge) doc.body.edge = window.defaultEdge();
      doc.body.edge.style = st.value;
      syncEdgeFields(); render2D(); scheduleRebuild3D();
    });
    bindNum("edgeSizeMm", 0.1, function (v) {
      if (!doc.body.edge) doc.body.edge = window.defaultEdge();
      doc.body.edge.sizeMm = v; render2D(); scheduleRebuild3D();
    });
    bindNum("edgePeriodMm", 0.5, function (v) {
      if (!doc.body.edge) doc.body.edge = window.defaultEdge();
      doc.body.edge.periodMm = v; render2D(); scheduleRebuild3D();
    });
  }());

  // Zierlinie (rect/circle): contour-following groove/ridge
  function syncLineFields() {
    var l = doc.body.line || window.defaultLine();
    var md = document.getElementById("lineMode");
    if (md) md.value = l.mode || "none";
    var params = document.getElementById("lineParams");
    if (params) params.hidden = !l.mode || l.mode === "none";
    var set = function (id, v) { var n = document.getElementById(id); if (n) n.value = v; };
    set("lineInset", l.insetMm); set("lineWidth", l.widthMm);
    set("lineDepth", l.depthMm); set("lineCount", l.count);
    set("lineColor", l.color || "#000000");
    var col = document.getElementById("lineColor");
    if (col) col.hidden = l.mode !== "raised"; // groove floor keeps the plate color
  }
  (function () {
    var ensure = function () { if (!doc.body.line) doc.body.line = window.defaultLine(); return doc.body.line; };
    var md = document.getElementById("lineMode");
    if (md) md.addEventListener("change", function () {
      ensure().mode = md.value;
      syncLineFields(); render2D(); scheduleRebuild3D();
    });
    bindNum("lineInset", 0, function (v) { ensure().insetMm = v; render2D(); scheduleRebuild3D(); });
    bindNum("lineWidth", 0.1, function (v) { ensure().widthMm = v; render2D(); scheduleRebuild3D(); });
    bindNum("lineDepth", 0.1, function (v) { ensure().depthMm = v; render2D(); scheduleRebuild3D(); });
    bindNum("lineCount", 1, function (v) { ensure().count = Math.max(1, Math.min(3, Math.round(v))); render2D(); scheduleRebuild3D(); });
    bindColor("lineColor", function (v) { ensure().color = v; render2D(); scheduleRebuild3D(); });
  }());

  // Border (shown only for Free)
  bindNum("borderMm", 0, function (v) {
    doc.body.borderMm = v; scheduleRebuild3D();
  });

  // Rand-Rahmen (Rechteck/Kreis/Frei; 'Bild' objects have no plate to frame)
  function ensureFrame() {
    if (!doc.body.frame) doc.body.frame = window.defaultFrame ? window.defaultFrame() : { widthMm: 0, heightMm: 2, color: "#000000" };
    return doc.body.frame;
  }
  bindNum("frameMm", 0, function (v) {
    ensureFrame().widthMm = v; render2D(); scheduleRebuild3D();
  });
  bindColor("frameColor", function (val) {
    ensureFrame().color = val; render2D(); scheduleRebuild3D();
  });
  document.getElementById("frameHeightMm").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) {
      ensureFrame().heightMm = v;
      render2D();
      scheduleRebuild3D();
    }
  });

  // Mount: Keine / Loch / Öse
  // opts.snap — when true the loop position is snapped to the top edge (used by the
  // button click handler). initSimpleUI and resetDocTo call WITHOUT opts so a saved
  // position is preserved across load.
  function applyMount(type, opts) {
    doc.mount.type = type;
    if (type === "loop") {
      // B1: ensure non-zero ring dimensions.
      if (!(doc.mount.ringThicknessMm > 0)) doc.mount.ringThicknessMm = 2;
      if (!(doc.mount.ringHeightMm > 0)) doc.mount.ringHeightMm = 2;
      // Snap to top edge only when the user explicitly requests it (button click).
      if (opts && opts.snap) {
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
    }
    var seg = type === "none" ? "None" : type === "hole" ? "Hole" : "Loop";
    setSegActive("mountSeg", "mount" + seg);
    // Re-fit canvas: domain may have expanded/contracted.
    fitScale();
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("mountNone").addEventListener("click", function () { applyMount("none", { snap: true }); });
  document.getElementById("mountHole").addEventListener("click", function () { applyMount("hole", { snap: true }); });
  document.getElementById("mountLoop").addEventListener("click", function () { applyMount("loop", { snap: true }); });

  // Size W/H
  bindNum("sizeW", 5, function (v) {
    doc.body.widthMm = v; fitScale(); render2D(); scheduleRebuild3D(); // B3: re-fit on dim change
  });
  bindNum("sizeH", 5, function (v) {
    doc.body.heightMm = v; fitScale(); render2D(); scheduleRebuild3D();
  });

  // ---- Named add-action functions (bound to both Simple and Advanced buttons) ----

  function addTextAction() {
    var el = window.makeElementV2("text", {
      cxMm: doc.body.widthMm / 2,
      cyMm: doc.body.heightMm / 2,
      wMm: Math.min(40, doc.body.widthMm * 0.6),
      hMm: 12,
    });
    el.depth.direction = defaultDirection;
    doc.elements.push(el);
    setSelection([el.id]);
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    render2D();
    scheduleRebuild3D();
    // Auto-focus the visible text input so the user can type immediately.
    var f = document.getElementById("advText");
    if (f) { f.value = selectedEl() && selectedEl().text || ""; f.focus(); if (f.select) f.select(); }
  }

  function addImageAction() {
    var inp = document.getElementById("addImageInput");
    if (inp) inp.click();
  }

  function addShapeAction(kind) {
    var sz = Math.min(doc.body.widthMm * 0.5, doc.body.heightMm * 0.5, 30);
    var el = window.makeElementV2("shape", {
      shape: kind,
      cxMm: doc.body.widthMm / 2,
      cyMm: doc.body.heightMm / 2,
      wMm: sz, hMm: sz,
    });
    el.depth.direction = defaultDirection;
    doc.elements.push(el);
    setSelection([el.id]);
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    render2D();
    scheduleRebuild3D();
  }

  function addQrAction() {
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
      setSelection([el.id]);
      refreshAdvancedForSelection();
      renderAdvancedLayers();
      render2D();
      scheduleRebuild3D();
    };
    img.src = dataURL;
  }

  // Bind Simple buttons.
  document.getElementById("addTextBtn").addEventListener("click", addTextAction);
  document.getElementById("addImageBtn").addEventListener("click", addImageAction);
  document.getElementById("addQrBtn").addEventListener("click", addQrAction);
  document.getElementById("addRectBtn").addEventListener("click", function () { addShapeAction("rect"); });
  document.getElementById("addCircleBtn").addEventListener("click", function () { addShapeAction("circle"); });

  // Bind Advanced buttons (guard each getElementById in case markup is missing).
  (function () {
  }());

  // ---- Remove Background (KI) ----
  document.getElementById("removeBgBtn").addEventListener("click", function () {
    // Setter proxies kept so the (special-char) body below stays untouched.
    var btn = { set disabled(v) { var n = document.getElementById("removeBgBtn"); if (n) n.disabled = v; } };
    var statusEl = { set textContent(v) { var n = document.getElementById("bgStatus"); if (n) n.textContent = v; } };

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
    // Eckenradius (rectangle)
    document.getElementById("cornerMm").value = doc.body.cornerRadiusMm != null ? doc.body.cornerRadiusMm : 6.5;
    // Zierkante + Zierlinie
    syncEdgeFields();
    syncLineFields();
    // Rahmen (Rand-Rahmen)
    var fr = doc.body.frame;
    document.getElementById("frameMm").value = fr && fr.widthMm != null ? fr.widthMm : 0;
    document.getElementById("frameHeightMm").value = fr && fr.heightMm != null ? fr.heightMm : 2;
    document.getElementById("frameColor").value = (fr && fr.color) || "#000000";
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
    } else if (el.type === "shape") {
      chip.style.color = el.color || "#333";
      chip.textContent = el.shape === "circle" ? "●" : "■";
    } else if (el.type === "qr" || el.qrData) {
      chip.textContent = "QR";
    } else {
      chip.textContent = "?";
    }
    return chip;
  }

  // Build a single layer <li> for element at index i. Clicking triggers renderLayers().
  // Monochrome inline icons (stroke = currentColor) for dynamic row buttons.
  var ICONS = {
    eye: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8 11.9 12.2 8 12.2 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.9"/></svg>',
    eyeOff: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8 11.9 12.2 8 12.2 1.8 8 1.8 8Z"/><path d="M3 13.5 13 2.5"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.8 4.3h10.4"/><path d="M6.2 4.3V3a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.3"/><path d="M4.3 4.3l.6 8.6a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.6-8.6"/></svg>'
  };

  function buildLayerRow(i, depth) {
    var el = doc.elements[i];
    var li = document.createElement("li");
    if (depth) li.style.paddingLeft = (6 + depth * 14) + "px";
    if (isSelected(el.id)) li.classList.add("adv-sel");
    if (el._hidden) li.classList.add("adv-hidden");

    var thumb = buildLayerThumb(el);
    li.appendChild(thumb);

    var nameSpan = document.createElement("span");
    nameSpan.className = "adv-lname";
    var isQR = el.type === "qr" || (el.type === "image" && el.qrData);
    var typeLabel = el.type === "text" ? "Text" : isQR ? "QR"
      : el.type === "shape" ? (el.shape === "circle" ? "Kreis" : "Rechteck") : "Bild";
    nameSpan.textContent = typeLabel + " " + (i + 1);
    if (el.name) nameSpan.textContent = el.name;                       // imported file name
    if (el.type === 'text' && el.text) nameSpan.textContent = '„' + el.text + '“';

    var vis = document.createElement("button");
    vis.className = "adv-lbtn";
    vis.innerHTML = el._hidden ? ICONS.eyeOff : ICONS.eye;
    vis.title = el._hidden ? "Einblenden" : "Ausblenden";

    var dup = document.createElement("button");
    dup.className = "adv-lbtn";
    dup.textContent = "⧉";
    dup.title = "Ebene duplizieren";

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
    del.innerHTML = ICONS.trash;
    del.title = "Löschen";

    // Print-info badge: at what height/mode this layer prints. Solid rows also
    // get a color dot (the thumb shows the source image, not the print color).
    var d = el.depth || {};
    var dirArrow = (d.direction === "engraved") ? "↓" : "↑";
    var badge = document.createElement("span");
    badge.className = "layer-badge";
    var pinned = false;
    if (d.mode === "heightmap") {
      badge.textContent = dirArrow + " Relief";
      badge.title = "Höhenrelief aus Bildhelligkeit";
    } else if (d.mode === "colorLayers") {
      var st = colorStyleOf(el);
      badge.textContent = dirArrow + " " + (st === "bands" ? "AMS" : st === "flush" ? "Fläche" : "Gestuft");
      badge.title = "Farbebenen (" + badge.textContent.slice(2) + ")";
    } else {
      var hmm = null;
      if (doc.autoLayerHeights) {
        if (d.heightOverrideMm != null) { hmm = d.heightOverrideMm; pinned = true; }
        else if (window.autoSolidHeightMm) hmm = window.autoSolidHeightMm(doc, el);
      }
      if (hmm == null) hmm = (d.heightMm != null ? d.heightMm : 1);
      badge.textContent = hmm <= 0 ? "bündig" : dirArrow + " " + (Math.round(hmm * 100) / 100) + (pinned ? " ✎" : "");
      badge.title = hmm <= 0
        ? "Bündig mit der Platte (Grundfarbe oder Höhe 0)"
        : "Druckhöhe " + (Math.round(hmm * 100) / 100) + " mm" + (pinned ? " — manuell fixiert" : d.direction === "engraved" ? " vertieft" : " erhaben");
    }
    if ((d.mode || "solid") === "solid" && el.color) {
      var dot = document.createElement("span");
      dot.className = "layer-dot";
      dot.style.background = el.color;
      dot.title = "Druckfarbe " + el.color;
      li.append(nameSpan, dot, badge, vis, dup, up, dn, del);
    } else {
      li.append(nameSpan, badge, vis, dup, up, dn, del);
    }

    // Drag to reorder (same pattern as the AMS palette rows). Ids as strings —
    // loaded docs may carry non-numeric ids.
    li.draggable = true;
    li.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", String(el.id));
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", function () { li.classList.remove("dragging"); });
    li.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      li.classList.add("drag-over");
    });
    li.addEventListener("dragleave", function () { li.classList.remove("drag-over"); });
    li.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation(); // never bubble into the file-drop chain
      li.classList.remove("drag-over");
      var fromId = e.dataTransfer.getData("text/plain");
      if (!fromId || fromId === String(el.id)) return;
      var from = doc.elements.findIndex(function (x) { return String(x.id) === fromId; });
      var to = doc.elements.findIndex(function (x) { return x.id === el.id; });
      if (from === -1 || to === -1) return;
      var moved = doc.elements.splice(from, 1)[0];
      moved.groupId = el.groupId != null ? el.groupId : null;  // adopt the target row's group
      doc.elements.splice(to, 0, moved); // take the drop target's position
      window.reindexContiguous(doc);
      renderLayers();
      render2D();
      scheduleRebuild3D();
    });

    li.addEventListener("click", function (e) {
      if (e.target.classList.contains("adv-lbtn")) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) toggleInSelection(el.id);
      else setSelection([el.id]);
      refreshAdvancedForSelection();
      renderLayers();
      render2D();
    });

    dup.addEventListener("click", function (e) {
      e.stopPropagation();
      duplicateElement(el);
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
      if (isSelected(el.id)) toggleInSelection(el.id);
      refreshAdvancedForSelection();
      renderLayers();
      render2D();
      scheduleRebuild3D();
    });

    return li;
  }

  // Build a group header <li> for a group node at the given depth.
  function buildGroupHeader(group, depth) {
    var li = document.createElement("li");
    li.className = "adv-group-head";
    li.style.paddingLeft = (6 + depth * 14) + "px";
    var leafIds = window.groupDescendantLeafIds(doc, group.id);
    var allSel = leafIds.length && leafIds.every(function (id) { return isSelected(id); });
    if (allSel) li.classList.add("adv-sel");

    var caret = document.createElement("button");
    caret.className = "adv-lbtn"; caret.textContent = group.collapsed ? "▸" : "▾"; caret.title = "Ein-/Ausklappen";
    caret.addEventListener("click", function (e) { e.stopPropagation(); group.collapsed = !group.collapsed; renderLayers(); });

    var name = document.createElement("span");
    name.className = "adv-lname"; name.textContent = group.name + " (" + leafIds.length + ")";
    name.title = "Doppelklick zum Umbenennen";
    name.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      var v = prompt("Gruppenname:", group.name);
      if (v != null && v.trim()) { group.name = v.trim(); renderLayers(); }
    });

    var anyHidden = leafIds.some(function (id) { var el = doc.elements.find(function (x) { return x.id === id; }); return el && el._hidden; });
    var vis = document.createElement("button");
    vis.className = "adv-lbtn"; vis.innerHTML = anyHidden ? ICONS.eyeOff : ICONS.eye; vis.title = anyHidden ? "Einblenden" : "Ausblenden";
    vis.addEventListener("click", function (e) {
      e.stopPropagation();
      leafIds.forEach(function (id) { var el = doc.elements.find(function (x) { return x.id === id; }); if (el) el._hidden = !anyHidden; });
      renderLayers(); render2D(); scheduleRebuild3D();
    });

    var del = document.createElement("button");
    del.className = "adv-lbtn"; del.innerHTML = ICONS.trash; del.title = "Gruppe löschen";
    del.addEventListener("click", function (e) {
      e.stopPropagation();
      // Delete the whole subtree: descendant leaves AND every descendant group record.
      var groupIds = [group.id];
      (function collect(gid) { window.childGroupIds(doc, gid).forEach(function (cg) { groupIds.push(cg); collect(cg); }); })(group.id);
      doc.elements = doc.elements.filter(function (el) { return leafIds.indexOf(el.id) === -1; });
      doc.groups = doc.groups.filter(function (g) { return groupIds.indexOf(g.id) === -1; });
      setSelection([]); refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
    });

    li.addEventListener("click", function (e) {
      if (e.target.classList.contains("adv-lbtn")) return;
      setSelection(leafIds);
      refreshAdvancedForSelection(); renderLayers(); render2D();
    });

    li.append(caret, name, vis, del);

    li.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; li.classList.add("drag-over"); });
    li.addEventListener("dragleave", function () { li.classList.remove("drag-over"); });
    li.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation(); li.classList.remove("drag-over");
      var fromId = e.dataTransfer.getData("text/plain");
      var el = doc.elements.find(function (x) { return String(x.id) === fromId; });
      if (!el) return;
      el.groupId = group.id;                 // join this group
      window.reindexContiguous(doc);
      renderLayers(); render2D(); scheduleRebuild3D();
    });

    return li;
  }

  function renderForestNodes(list, nodes, depth) {
    // nodes are bottom->top; the panel shows topmost first, so iterate reversed.
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      if (n.type === "element") {
        list.appendChild(buildLayerRow(doc.elements.indexOf(n.el), depth));
      } else {
        list.appendChild(buildGroupHeader(n.group, depth));
        if (!n.group.collapsed) renderForestNodes(list, n.children, depth + 1);
      }
    }
  }

  // Populate a layers <ul> container (and its paired empty <p>) with the current doc elements.
  function populateLayersList(list, empty) {
    if (!list) return;
    list.innerHTML = "";
    var els = doc.elements;
    if (!els || els.length === 0) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    renderForestNodes(list, window.flattenGroupForest(doc), 0);
  }

  // Refresh the (single) layer list. Also drives the stage hero: a big
  // drop-invitation while the project is empty.
  function renderLayers() {
    populateLayersList(
      document.getElementById("advLayers"),
      document.getElementById("advLayersEmpty")
    );
    var hero = document.getElementById("stageHero");
    if (hero) hero.hidden = doc.elements.length > 0;
    var cnt = document.getElementById("layerCount");
    if (cnt) { cnt.textContent = doc.elements.length; cnt.hidden = doc.elements.length === 0; }
  }

  // Backward-compat alias so existing call sites (and window.editor export) still work.
  function renderAdvancedLayers() { renderLayers(); }

  // -- Selection refresh hook --
  function refreshAdvancedForSelection() {
    var adv = document.getElementById("sidebarAdvanced");
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; }) || null;
    var disabled = !el;
    // Inspector empty state: dim the panel + show the hint when nothing is selected.
    var insp = document.getElementById("sidebarElement");
    if (insp) insp.classList.toggle("no-selection", disabled);
    // Umwandlung (Bild → Relief) applies to image elements only.
    var conv = document.getElementById("convGroup");
    if (conv) conv.hidden = !(el && el.type === "image");
    // Floating selection toolbar on the stage follows the selection.
    var selTb = document.getElementById("selToolbar");
    if (selTb) selTb.hidden = disabled;
    var multi = state.selectionIds.length > 1;
    document.querySelectorAll("#selToolbar .tb-multi, #selToolbar [data-multi]").forEach(function (n) { n.hidden = !multi; });
    var dist = state.selectionIds.length >= 3;
    var dH = document.getElementById("selDistH"), dV = document.getElementById("selDistV");
    if (dH) dH.disabled = !dist; if (dV) dV.disabled = !dist;
    // Streuen (scatter) applies to a single selected element.
    var scBtn = document.getElementById("selScatterBtn");
    if (scBtn) scBtn.hidden = state.selectionIds.length !== 1;
    var flipH = document.getElementById("selFlipHBtn"), flipV = document.getElementById("selFlipVBtn");
    if (flipH) { flipH.classList.toggle("tb-on", !!(el && el.flipH)); flipH.setAttribute("aria-pressed", String(!!(el && el.flipH))); }
    if (flipV) { flipV.classList.toggle("tb-on", !!(el && el.flipV)); flipV.setAttribute("aria-pressed", String(!!(el && el.flipV))); }
    // Layer badges mirror color/height/mode — keep them fresh with the panel.
    renderLayers();

    var threshold = document.getElementById("advThreshold");
    var thresholdVal = document.getElementById("advThresholdVal");
    var invert = document.getElementById("advInvert");
    var numColors = document.getElementById("advNumColors");
    var minIsland = document.getElementById("advMinIsland");
    var minIslandVal = document.getElementById("advMinIslandVal");
    if (threshold) { threshold.disabled = disabled; threshold.value = el ? (el.depth.threshold != null ? el.depth.threshold : 128) : 128; }
    if (thresholdVal) thresholdVal.textContent = el ? (el.depth.threshold != null ? el.depth.threshold : 128) : 128;
    if (invert) { invert.disabled = disabled; invert.checked = el ? !!el.depth.invert : false; }
    if (numColors) { numColors.disabled = disabled; numColors.value = el ? (el.depth.reduce && el.depth.reduce.numColors != null ? el.depth.reduce.numColors : 8) : 8; }
    // minIsland: visible for image elements in solid or colorLayers mode; hidden for heightmap and non-image.
    var minIslandField = document.getElementById("advMinIslandField");
    if (minIslandField) {
      var showIsland = el && el.type === "image" && ((el.depth && el.depth.mode) || "solid") !== "heightmap";
      minIslandField.hidden = !showIsland;
    }
    if (minIsland) {
      minIsland.disabled = disabled;
      minIsland.value = el ? (el.depth.minIsland != null ? el.depth.minIsland : 0) : 0;
    }
    if (minIslandVal) minIslandVal.textContent = el ? (el.depth.minIsland != null ? el.depth.minIsland : 0) : 0;
    // Farb-Stapelung: reflect the element's resolved style (new field, legacy flush fallback).
    var colorStyle = el ? colorStyleOf(el) : "stepped";
    setSegActive("colorStyleSeg", colorStyle === "flush" ? "colorFlush" : colorStyle === "bands" ? "colorBands" : "colorStepped");
    ["colorStepped", "colorFlush", "colorBands"].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = disabled; });

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

    // Text content field: show only for text elements; seed from el.text.
    var advTextField = document.getElementById("advTextField");
    var isText = el && el.type === "text";
    if (advTextField) advTextField.hidden = !isText;
    var advTextNode = document.getElementById("advText");
    if (advTextNode) advTextNode.value = isText ? (el.text || "") : "";

    // Font controls (Schriftart + Fett + Upload): text elements only.
    var advFontField = document.getElementById("advFontField");
    if (advFontField) advFontField.hidden = !isText;
    var advArcField = document.getElementById("advArcField");
    if (advArcField) advArcField.hidden = !isText;
    var advArcNode = document.getElementById("advArc");
    if (advArcNode) {
      advArcNode.value = isText ? (el.arcDeg || 0) : 0;
      // a Pfadtext overrides the arc — grey the arc input out while one is set
      advArcNode.disabled = !!(isText && el.textPath && el.textPath.length > 1);
    }
    var tpField = document.getElementById("advTextPathField");
    if (tpField) tpField.hidden = !isText;
    var tpClear = document.getElementById("textPathClearBtn");
    if (tpClear) tpClear.hidden = !(isText && el.textPath && el.textPath.length > 1);
    var tpHint = document.getElementById("textPathHint");
    if (tpHint) tpHint.hidden = !(isText && textPathDraw === el.id);
    if (isText) {
      populateFontSelect(document.getElementById("advFontFamily"), el.fontFamily || "system-ui");
      var boldNode = document.getElementById("advFontBold");
      if (boldNode) boldNode.checked = (el.fontWeight === "bold" || el.fontWeight === 700 || el.fontWeight === "700");
    }

    // Shape kind (Rechteck / Kreis): shape elements only.
    var advShapeField = document.getElementById("advShapeField");
    var isShape = el && el.type === "shape";
    if (advShapeField) advShapeField.hidden = !isShape;
    var shapeRect = document.getElementById("advShapeRect");
    var shapeCircle = document.getElementById("advShapeCircle");
    if (shapeRect) shapeRect.classList.toggle("seg-active", !!(isShape && el.shape !== "circle"));
    if (shapeCircle) shapeCircle.classList.toggle("seg-active", !!(isShape && el.shape === "circle"));
    // Element-Zierkante (shape elements): seed style + params, toggle param row.
    if (isShape) {
      var elEdge = el.edge || { style: "none", sizeMm: 1.5, periodMm: 6 };
      var edgeSel = document.getElementById("advEdgeStyle");
      if (edgeSel) edgeSel.value = elEdge.style || "none";
      var edgeParams = document.getElementById("advEdgeParams");
      if (edgeParams) edgeParams.hidden = !elEdge.style || elEdge.style === "none";
      var edgeSz = document.getElementById("advEdgeSize");
      if (edgeSz) edgeSz.value = elEdge.sizeMm;
      var edgePd = document.getElementById("advEdgePeriod");
      if (edgePd) edgePd.value = elEdge.periodMm;
    }

    // Relief height (depth.heightMm): shown for Einfarbig (solid/text) and Farbebenen→Gestuft.
    // With "Höhe je Farbe" (doc.autoLayerHeights) on, the field is the per-element OVERRIDE for
    // Einfarbig elements: empty = automatic height from the color (shown as placeholder).
    var reliefField = document.getElementById("advReliefHeightField");
    var em = el && el.depth && el.depth.mode;
    if (reliefField) {
      var estyle = (el && el.depth && el.depth.colorLayerStyle) || ((el && el.depth && el.depth.flush) ? "bands" : "stepped");
      var showRelief = el && (el.type === "text" || el.type === "image" || el.type === "shape") &&
        (em === "solid" || (em === "colorLayers" && estyle === "stepped"));
      reliefField.hidden = !showRelief;
      if (showRelief) {
        var rh = document.getElementById("advReliefHeight");
        var rab = document.getElementById("reliefAutoBtn");
        var isAutoOverride = doc.autoLayerHeights && em === "solid";
        if (rh) {
          if (isAutoOverride) {
            var ov = el.depth.heightOverrideMm;
            rh.value = ov != null ? ov : "";
            var autoH = window.autoSolidHeightMm ? window.autoSolidHeightMm(doc, el) : null;
            rh.placeholder = autoH != null ? "auto: " + (Math.round(autoH * 100) / 100) + " mm" : "auto";
          } else {
            rh.placeholder = "";
            rh.value = (el.depth && el.depth.heightMm != null) ? el.depth.heightMm : 1;
          }
        }
        if (rab) {
          rab.hidden = !isAutoOverride;                                  // only meaningful in Höhe-je-Farbe mode
          rab.disabled = isAutoOverride && el.depth.heightOverrideMm == null; // nothing to reset
        }
      }
    }
    // "Höhe je Farbe" + Deckschicht live in the Ebenen group (doc scope, always
    // visible) — only the state is synced here.
    var ah = document.getElementById("advAutoHeights");
    if (ah) ah.checked = !!doc.autoLayerHeights;
    var tl = document.getElementById("advTopLayer");
    var tlc = document.getElementById("advTopLayerColor");
    if (tl) tl.checked = doc.topLayerColor != null;
    if (tlc && doc.topLayerColor != null) tlc.value = doc.topLayerColor;

    // Palette swatches: show only for image elements in colorLayers mode.
    renderPaletteSwatches(el);
    // Doc-level AMS filament palette (Ebenen group).
    renderAmsPaletteField();
  }

  // AMS-Filament-Palette (Ebenen group, doc scope): visible whenever the shared
  // palette is in use — i.e. it has colors AND some element prints in the AMS style —
  // regardless of which element is selected.
  function renderAmsPaletteField() {
    var field = document.getElementById("amsPaletteField");
    var host = document.getElementById("amsPaletteHost");
    if (!field || !host) return;
    var hasPal = Array.isArray(doc.amsPalette) && doc.amsPalette.length > 0;
    var hasBandsEl = doc.elements.some(function (e) {
      return e && e.type === "image" && e.depth && e.depth.mode === "colorLayers" && colorStyleOf(e) === "bands";
    });
    var show = hasPal && hasBandsEl;
    field.hidden = !show;
    if (show) renderAmsPalette(host); else host.innerHTML = "";
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
    refreshAdvancedForSelection(); // recompute palette + relief-height field visibility for the new mode
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

  bindElementField("advMinIsland", "input", function (el, node) {
    var v = Number(node.value); if (isNaN(v) || v < 0) return false;
    el.depth.minIsland = Math.round(v);
    var badge = document.getElementById("advMinIslandVal"); if (badge) badge.textContent = Math.round(v);
  }, { invalidate: true });

  // Farb-Stapelung (color-layer stacking style): Gestuft / Eine Fläche / AMS.
  // Mirrors the engine's colorStyleOf: new depth.colorLayerStyle wins, legacy flush is
  // the fallback. Setting a style clears the legacy flush flag to keep the model clean.
  // No {invalidate} — 2D colors are unchanged; withSelected triggers the 3D rebuild.
  function setColorLayerStyle(style) {
    withSelected(function (el) {
      el.depth.colorLayerStyle = style;
      delete el.depth.flush;
      // First switch to AMS seeds the shared filament palette from this element's colors.
      if (style === "bands" && el.type === "image" && el._img) window.seedAmsPalette(doc, elementEffectiveHexes(el));
    });
    setSegActive("colorStyleSeg", style === "flush" ? "colorFlush" : style === "bands" ? "colorBands" : "colorStepped");
    refreshAdvancedForSelection();
  }
  (function () {
    var stepped = document.getElementById("colorStepped");
    var flush = document.getElementById("colorFlush");
    var bands = document.getElementById("colorBands");
    if (stepped) stepped.addEventListener("click", function () { setColorLayerStyle("stepped"); });
    if (flush) flush.addEventListener("click", function () { setColorLayerStyle("flush"); });
    if (bands) bands.addEventListener("click", function () { setColorLayerStyle("bands"); });
  })();

  // -- Element inputs --
  bindElementField("advColor", "input", function (el, node) {
    el.color = node.value;
    refreshAdvancedForSelection(); // auto-height placeholder follows the color (base-colored = flush)
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

  // -- Text content field --
  bindElementField("advText", "input", function (el, node) {
    if (el.type !== "text") return false;
    el.text = node.value;
    renderLayers();
  });

  // -- Font family + weight (text elements) --
  bindElementField("advFontFamily", "change", function (el, node) {
    if (el.type !== "text") return false;
    el.fontFamily = node.value;
    renderLayers();
  });

  bindElementField("advFontBold", "change", function (el, node) {
    if (el.type !== "text") return false;
    el.fontWeight = node.checked ? "bold" : "normal";
  });

  // -- Arc text (Bogen°, text elements): 0 = straight, ± bends up/down --
  bindElementField("advArc", "input", function (el, node) {
    if (el.type !== "text") return false;
    var v = parseFloat(node.value);
    el.arcDeg = isNaN(v) ? 0 : Math.max(-350, Math.min(350, v));
  });

  // -- Pfadtext: record / clear the freehand path of a text element --
  (function () {
    var draw = document.getElementById("textPathDrawBtn");
    if (draw) draw.addEventListener("click", function () {
      var el = selectedEl();
      if (!el || el.type !== "text") return;
      textPathDraw = el.id;
      refreshAdvancedForSelection();
    });
  }());
  bindElementField("textPathClearBtn", "click", function (el) {
    if (el.type !== "text") return false;
    el.textPath = null;
    textPathDraw = null;
    refreshAdvancedForSelection();
    renderLayers();
  });

  // -- Element-Zierkante (shape elements) --
  bindElementField("advEdgeStyle", "change", function (el, node) {
    if (el.type !== "shape") return false;
    if (!el.edge) el.edge = { style: "none", sizeMm: 1.5, periodMm: 6 };
    el.edge.style = node.value;
    var params = document.getElementById("advEdgeParams");
    if (params) params.hidden = node.value === "none";
    renderLayers();
  });
  bindElementField("advEdgeSize", "input", function (el, node) {
    if (el.type !== "shape" || !el.edge) return false;
    var v = parseFloat(node.value);
    if (isNaN(v) || v <= 0) return false;
    el.edge.sizeMm = v;
  });
  bindElementField("advEdgePeriod", "input", function (el, node) {
    if (el.type !== "shape" || !el.edge) return false;
    var v = parseFloat(node.value);
    if (isNaN(v) || v <= 0) return false;
    el.edge.periodMm = v;
  });

  // -- Shape kind (Rechteck / Kreis, shape elements) --
  bindElementField("advShapeRect", "click", function (el) {
    if (el.type !== "shape") return false;
    el.shape = "rect";
    refreshAdvancedForSelection(); // seg state + layer label/thumb
  });

  bindElementField("advShapeCircle", "click", function (el) {
    if (el.type !== "shape") return false;
    el.shape = "circle";
    refreshAdvancedForSelection();
  });

  // -- Relief height (Einfarbig + Gestuft): how far the element rises / recesses --
  // With "Höhe je Farbe" on (Einfarbig): edits the per-element OVERRIDE instead;
  // clearing the field returns the element to its automatic per-color height.
  bindElementField("advReliefHeight", "input", function (el, node) {
    if (!el.depth) return false;
    // A number input reports "" while holding invalid text (e.g. "1.4e") — badInput
    // distinguishes that from an intentionally cleared field, so typing garbage
    // doesn't silently drop the override.
    if (node.validity && node.validity.badInput) return false;
    if (doc.autoLayerHeights && el.depth.mode === "solid") {
      if (String(node.value).trim() === "") { el.depth.heightOverrideMm = null; renderLayers(); return; }
      var ov = parseFloat(node.value);
      if (isNaN(ov) || ov < 0) return false; // 0 allowed = flush with the plate
      el.depth.heightOverrideMm = ov;
      renderLayers(); // badge shows the pinned height
      return;
    }
    var v = parseFloat(node.value);
    if (isNaN(v) || v < 0) return false; // 0 allowed = no relief (off)
    el.depth.heightMm = v;
    renderLayers();
  });

  // -- Custom font upload (.ttf/.otf/.woff) → FontFace + doc.fonts --
  (function () {
    var btn = document.getElementById("fontUploadBtn");
    var inp = document.getElementById("fontUploadInput");
    if (btn && inp) {
      btn.addEventListener("click", function () { inp.click(); });
      inp.addEventListener("change", function (e) {
        var f = e.target.files && e.target.files[0];
        if (f) handleFontUpload(f);
        inp.value = "";
      });
    }
  })();

  // -- Per-element direction (Erhaben / Vertieft) --
  bindElementField("advDirRaised", "click", function (el) {
    el.depth.direction = "raised";
    var r = document.getElementById("advDirRaised"), g = document.getElementById("advDirEngraved");
    if (r) r.classList.add("seg-active"); if (g) g.classList.remove("seg-active");
    refreshAdvancedForSelection(); // auto-height ranks are per direction → placeholder changes
  });

  bindElementField("advDirEngraved", "click", function (el) {
    el.depth.direction = "engraved";
    var r = document.getElementById("advDirRaised"), g = document.getElementById("advDirEngraved");
    if (r) r.classList.remove("seg-active"); if (g) g.classList.add("seg-active");
    refreshAdvancedForSelection(); // auto-height ranks are per direction → placeholder changes
  });

  // -- 3D / Export doc-level inputs --
  document.getElementById("advThickness").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0.5) { doc.body.thicknessMm = v; scheduleRebuild3D(); }
  });

  document.getElementById("advBaseThickness").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) { doc.body.baseThicknessMm = v; render2D(); scheduleRebuild3D(); } // 0 = auto
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

  // Base color (Grundfarbe) for the base plate.
  (function () {
    var bc = document.getElementById("advBaseColor");
    if (bc) bc.addEventListener("input", function () {
      doc.body.baseColor = this.value;
      refreshAdvancedForSelection(); // auto-height placeholder can change (base-colored = flush)
      render2D();
      scheduleRebuild3D();
    });
  }());

  // "Höhe je Farbe" (auto layer heights): doc-level toggle, wired from the element panel.
  (function () {
    var ah = document.getElementById("advAutoHeights");
    if (ah) ah.addEventListener("change", function () {
      doc.autoLayerHeights = this.checked;
      refreshAdvancedForSelection(); // relief field switches between height and override semantics
      scheduleRebuild3D();
    });
  }());

  // Deckschicht (top layer): doc-level cover color at rank 0 of the auto stack.
  (function () {
    var tl = document.getElementById("advTopLayer");
    var tlc = document.getElementById("advTopLayerColor");
    if (tl) tl.addEventListener("change", function () {
      if (this.checked) {
        var v = (tlc && tlc.value) || "#ffffff";
        // The engine ignores a base-colored deck — seed a visible default instead of
        // silently storing a no-op (e.g. white deck on the default white plate).
        if (v.toUpperCase() === String(doc.body.baseColor || "").toUpperCase()) {
          var b = doc.body.baseColor || "#ffffff";
          var lum = 0.299 * parseInt(b.substr(1, 2), 16) + 0.587 * parseInt(b.substr(3, 2), 16) + 0.114 * parseInt(b.substr(5, 2), 16);
          v = lum > 128 ? "#333333" : "#ffffff";
          if (tlc) tlc.value = v;
        }
        doc.topLayerColor = v;
      } else {
        doc.topLayerColor = null;
      }
      refreshAdvancedForSelection(); // element ranks shift one step → placeholder changes
      scheduleRebuild3D();
    });
    if (tlc) tlc.addEventListener("input", function () {
      if (doc.topLayerColor == null) return; // checkbox off → color is inert
      doc.topLayerColor = this.value;
      refreshAdvancedForSelection();
      scheduleRebuild3D();
    });
  }());

  // ---- Snap settings UI wiring ----
  (function () {
    var snapPlate = document.getElementById("snapPlate");
    var snapElements = document.getElementById("snapElements");
    var snapGrid = document.getElementById("snapGrid");

    if (snapPlate) {
      snapPlate.checked = state.snap.plate;
      snapPlate.addEventListener("change", function () { state.snap.plate = this.checked; persistSnap(); });
    }
    if (snapElements) {
      snapElements.checked = state.snap.elements;
      snapElements.addEventListener("change", function () { state.snap.elements = this.checked; persistSnap(); });
    }
    if (snapGrid) {
      snapGrid.value = state.snap.gridMm;
      snapGrid.addEventListener("input", function () {
        var v = parseFloat(this.value);
        if (!isNaN(v) && v >= 0) { state.snap.gridMm = v; persistSnap(); }
      });
    }
  }());

  // ---- Delete (toolbar + Entf/Backspace on the canvas) ----
  function deleteSelected() {
    const ids = state.selectionIds.slice();
    if (!ids.length) return;
    doc.elements = doc.elements.filter(function (e) { return ids.indexOf(e.id) === -1; });
    clearSelection();
    refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
  }

  // ---- Duplicate (layer row, Ctrl/Cmd+D, stage toolbar) ----
  function duplicateElement(el) {
    if (!el) return;
    // Deep-copy the persisted fields; runtime caches are dropped and makeElementV2
    // mints a fresh id (the stripped id keeps props from overriding it).
    var drop = { _img: 1, _display: 1, _displayKey: 1, _hidden: 1, id: 1 };
    var props = JSON.parse(JSON.stringify(el, function (k, v) { return drop[k] ? undefined : v; }));
    var copy = window.makeElementV2(el.type, props);
    copy._img = el._img || null; // share the decoded bitmap (read-only)
    copy.cxMm = el.cxMm + 4; copy.cyMm = el.cyMm + 4; // nudge so the copy is visible
    doc.elements.splice(doc.elements.indexOf(el) + 1, 0, copy); // directly above the original
    setSelection([copy.id]);
    refreshAdvancedForSelection();
    renderLayers();
    render2D();
    scheduleRebuild3D();
  }
  function duplicateSelected() {
    const els = selectedEls();
    if (!els.length) return;
    if (els.length === 1) { duplicateElement(els[0]); return; }
    const copies = [];
    els.forEach(function (el) {
      const drop = { _img: 1, _display: 1, _displayKey: 1, _hidden: 1, id: 1 };
      const props = JSON.parse(JSON.stringify(el, function (k, v) { return drop[k] ? undefined : v; }));
      const copy = window.makeElementV2(el.type, props);
      copy._img = el._img || null; copy.groupId = null;
      copy.cxMm = el.cxMm + 4; copy.cyMm = el.cyMm + 4;
      doc.elements.push(copy); copies.push(copy.id);
    });
    setSelection(copies);
    var srcGroups = {}; els.forEach(function (el) { if (el.groupId != null) srcGroups[el.groupId] = 1; });
    if (Object.keys(srcGroups).length === 1) {
      var gid = window.groupElements(doc, copies);
      if (gid) setSelection(window.groupDescendantLeafIds(doc, gid));
    }
    refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
  }
  window.addEventListener("keydown", function (e) {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || String(e.key).toLowerCase() !== "d") return;
    var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
    if (!state.selectionIds.length) return; // nothing selected → leave Cmd+D to the browser
    e.preventDefault();
    duplicateSelected();
  });
  function doGroup() {
    if (state.selectionIds.length < 2) return;
    var gid = window.groupElements(doc, state.selectionIds.slice());
    if (gid) { setSelection(window.groupDescendantLeafIds(doc, gid)); refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D(); }
  }
  function doUngroup() {
    var els = selectedEls(), gids = {};
    els.forEach(function (el) { if (el.groupId != null) gids[el.groupId] = 1; });
    Object.keys(gids).forEach(function (gid) { window.ungroupGroup(doc, gid); });
    refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
  }
  window.addEventListener("keydown", function (e) {
    if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== "g") return;
    var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
    e.preventDefault();
    if (e.shiftKey) doUngroup(); else doGroup();
  });

  // ---- Streuen (scatter): panel · live preview · apply as a group ----
  function scatterOpen() {
    var el = selectedEl();
    if (!el || state.selectionIds.length !== 1) return;
    scatter = { sourceId: el.id, region: null, path: null, mode: "region", seed: (Date.now() >>> 0), previewIds: [] };
    var p = document.getElementById("scatterPanel"); if (p) p.hidden = false;
    scatterSyncMode();
    scatterGenerate();
  }

  // Reflect scatter.mode in the panel: seg buttons, per-mode rows, hint text.
  function scatterSyncMode() {
    var isPath = !!(scatter && scatter.mode === "path");
    var br = document.getElementById("scModeRegion"), bp = document.getElementById("scModePath");
    if (br) br.classList.toggle("seg-active", !isPath);
    if (bp) bp.classList.toggle("seg-active", isPath);
    var alignRow = document.getElementById("scAlignRow");
    if (alignRow) alignRow.hidden = !isPath;
    var avoidRow = document.getElementById("scAvoidRow");
    if (avoidRow) avoidRow.hidden = isPath; // even spacing needs no overlap avoidance
    var hint = document.getElementById("scHint");
    if (hint) hint.textContent = isPath
      ? "Zeichne einen Pfad auf der Fläche — die Kopien folgen ihm gleichmäßig."
      : "Ziehe auf der Fläche einen Bereich auf (sonst ganze Platte).";
  }
  function scatterClose(commit) {
    var p = document.getElementById("scatterPanel"); if (p) p.hidden = true;
    if (scatter && !commit) scatterClearPreview();
    scatter = null;
    render2D(); scheduleRebuild3D();
  }
  function scatterClearPreview() {
    if (!scatter) return;
    doc.elements = doc.elements.filter(function (e) { return scatter.previewIds.indexOf(e.id) === -1; });
    scatter.previewIds = [];
  }
  function scatterParams() {
    var num = function (id, d) { var n = document.getElementById(id); var v = n ? parseFloat(n.value) : NaN; return isNaN(v) ? d : v; };
    return {
      count: Math.max(1, Math.round(num("scCount", 12))),
      rotMin: num("scRotMin", 0), rotMax: num("scRotMax", 360),
      scaleMin: num("scScaleMin", 0.6), scaleMax: num("scScaleMax", 1.4),
      avoidOverlap: !!(document.getElementById("scAvoid") && document.getElementById("scAvoid").checked),
      alignToPath: !!(document.getElementById("scAlign") && document.getElementById("scAlign").checked),
    };
  }
  function scatterGenerate() {
    if (!scatter) return;
    scatterClearPreview();
    var src = doc.elements.find(function (e) { return e.id === scatter.sourceId; });
    if (!src) return;
    var transforms;
    if (scatter.mode === "path") {
      if (!scatter.path || scatter.path.length < 2) { render2D(); scheduleRebuild3D(); return; }
      transforms = window.scatterAlongPath({ wMm: src.wMm, hMm: src.hMm }, scatter.path, scatterParams(), scatter.seed);
    } else {
      var region = scatter.region || { x0: 0, y0: 0, x1: doc.body.widthMm, y1: doc.body.heightMm };
      transforms = window.scatterCopies({ wMm: src.wMm, hMm: src.hMm }, region, scatterParams(), scatter.seed);
    }
    var ids = [];
    transforms.forEach(function (t) {
      var drop = { _img: 1, _display: 1, _displayKey: 1, _hidden: 1, id: 1 };
      var props = JSON.parse(JSON.stringify(src, function (k, v) { return drop[k] ? undefined : v; }));
      var copy = window.makeElementV2(src.type, props);
      copy._img = src._img || null; copy.groupId = null;
      copy.cxMm = t.cxMm; copy.cyMm = t.cyMm; copy.wMm = t.wMm; copy.hMm = t.hMm; copy.rotationDeg = t.rotationDeg;
      doc.elements.push(copy); ids.push(copy.id);
    });
    scatter.previewIds = ids;
    render2D(); scheduleRebuild3D();
  }
  (function () {
    var wire = function (id, fn) { var n = document.getElementById(id); if (n) n.addEventListener("click", fn); };
    wire("selScatterBtn", scatterOpen);
    wire("scReroll", function () { if (scatter) { scatter.seed = (Date.now() >>> 0); scatterGenerate(); } });
    wire("scApply", function () {
      if (!scatter || !scatter.previewIds.length) { scatterClose(false); return; }
      var gid = window.groupElements(doc, scatter.previewIds.slice());
      var ids = gid ? window.groupDescendantLeafIds(doc, gid) : scatter.previewIds.slice();
      scatter.previewIds = []; // committed — keep the copies
      scatterClose(true);
      setSelection(ids); refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
    });
    wire("scCancel", function () { scatterClose(false); refreshAdvancedForSelection(); renderLayers(); });
    ["scCount", "scRotMin", "scRotMax", "scScaleMin", "scScaleMax"].forEach(function (id) {
      var n = document.getElementById(id); if (n) n.addEventListener("input", function () { if (scatter) scatterGenerate(); });
    });
    var av = document.getElementById("scAvoid"); if (av) av.addEventListener("change", function () { if (scatter) scatterGenerate(); });
    var al = document.getElementById("scAlign"); if (al) al.addEventListener("change", function () { if (scatter) scatterGenerate(); });
    // Mode toggle: Bereich (random in a region) vs Pfad (evenly along a drawn path).
    function setScatterMode(mode) {
      if (!scatter || scatter.mode === mode) return;
      scatter.mode = mode;
      var rMin = document.getElementById("scRotMin"), rMax = document.getElementById("scRotMax");
      if (mode === "path") {
        // Tangent alignment beats full random rotation: park the rotation range
        // while in path mode (restored on switching back to Bereich), so the
        // copies actually follow the drawn path.
        if (rMin && rMax) {
          scatter.rotBackup = { min: rMin.value, max: rMax.value };
          if (parseFloat(rMin.value) === 0 && parseFloat(rMax.value) === 360) rMax.value = 0;
        }
        scatterClearPreview();
      } else if (scatter.rotBackup && rMin && rMax) {
        rMin.value = scatter.rotBackup.min;
        rMax.value = scatter.rotBackup.max;
        scatter.rotBackup = null;
      }
      scatterSyncMode();
      scatterGenerate();
    }
    wire("scModeRegion", function () { setScatterMode("region"); });
    wire("scModePath", function () { setScatterMode("path"); });
  }());
  // ---- Relief height: the "Auto" button removes the manual override ----
  (function () {
    var b = document.getElementById("reliefAutoBtn");
    if (b) b.addEventListener("click", function () {
      var el = selectedEl();
      if (!el || !el.depth) return;
      el.depth.heightOverrideMm = null;
      refreshAdvancedForSelection();
      renderLayers();
      render2D();
      scheduleRebuild3D();
    });
  }());

  // ---- Undo boundary for user-initiated document swaps ("Neu" / Beispiel / "Öffnen").
  // Pushes the CURRENT state immediately (the debounced snapshot may still be
  // pending <500ms) resp. the new state right after the swap — even inside the
  // mute window after an undo, which should only suppress debounced re-snapshots.
  function undoBoundary(clearRedo) {
    clearTimeout(_undo.timer);
    var cur;
    try { cur = window.serializeProject(doc); } catch (e) { return; }
    if (cur !== _undo.stack[_undo.stack.length - 1]) {
      _undo.stack.push(cur);
      if (_undo.stack.length > _undo.cap) _undo.stack.shift();
    }
    if (clearRedo) _undo.redo = [];
  }

  // ---- Load example: the embedded Ukibori coin (js/example-project.js) ----
  // Embedded rather than fetched so it also works over file:// and offline.
  function loadExampleAction() {
    if (!window.EXAMPLE_PROJECT) {
      alert("Beispiel nicht verfügbar (js/example-project.js wurde nicht geladen).");
      return;
    }
    try {
      var json = JSON.stringify(window.EXAMPLE_PROJECT);
      var loaded = window.migrateProject(window.deserializeProject(json));
      undoBoundary(false);
      resetDocTo(loaded);
      undoBoundary(true);
    } catch (e) {
      if (window.__errs) window.__errs.push(String(e && e.message || e));
      alert("Fehler beim Laden des Beispiels: " + (e && e.message || e));
    }
  }

  // ---- "Neu": fresh empty project (undo brings the old one back) ----
  (function () {
    var btn = document.getElementById("newBtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var nameField = document.getElementById("exportName");
      // Confirm whenever real content would be lost — including plate/palette
      // changes without any elements, or a typed export name.
      var dirty;
      try { dirty = window.serializeProject(doc) !== window.serializeProject(window.defaultDoc()); } catch (e) { dirty = true; }
      if (nameField && nameField.value.trim()) dirty = true;
      if (dirty && !confirm("Aktuelles Projekt verwerfen und neu beginnen?")) return;
      if (nameField) nameField.value = "";
      undoBoundary(false);
      resetDocTo(window.defaultDoc());
      undoBoundary(true);
    });
  }());

  // ---- Stage hero: click opens the image dialog, drops land directly ----
  (function () {
    var hero = document.getElementById("stageHero");
    if (!hero) return;
    var card = hero.querySelector(".hero-card") || hero;
    card.addEventListener("click", function () { addImageAction(); });
    card.addEventListener("dragover", handleDragOver);
    card.addEventListener("drop", handleDrop);
    var ex = document.getElementById("heroExampleBtn");
    if (ex) ex.addEventListener("click", function (e) {
      e.stopPropagation(); // not a card click — don't open the image dialog
      loadExampleAction();
      // If the tour is currently spotlighting this button, advance to the next step.
      if (window.coachmarks && window.coachmarks.refresh) window.coachmarks.refresh();
    });
  }());

  // ---- Einrasten popover (topbar lock button) ----
  (function () {
    var btn = document.getElementById("snapBtn");
    var pop = document.getElementById("snapPopover");
    if (!btn || !pop) return;
    function close() { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.classList.remove("open"); }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var show = pop.hidden;
      pop.hidden = !show;
      btn.setAttribute("aria-expanded", String(show));
      btn.classList.toggle("open", show);
    });
    pop.addEventListener("click", function (e) { e.stopPropagation(); }); // clicks inside stay inside
    document.addEventListener("click", function () { if (!pop.hidden) close(); });
    window.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pop.hidden) close(); });
  }());

  // ---- Floating selection toolbar on the stage ----
  (function () {
    var wire = function (id, fn) { var n = document.getElementById(id); if (n) n.addEventListener("click", fn); };
    wire("selDupBtn", duplicateSelected);
    wire("selGroupBtn", doGroup);
    wire("selUngroupBtn", doUngroup);
    wire("selCenterHBtn", function () { centerH(); });
    wire("selCenterVBtn", function () { centerV(); });
    wire("selFlipHBtn", function () { flipSelected("h"); });
    wire("selFlipVBtn", function () { flipSelected("v"); });
    wire("selDelBtn", deleteSelected);
    function applyLayout(fn) {
      var els = selectedEls();
      if (els.length < 2) return;
      fn(els).forEach(function (u) {
        var m = doc.elements.find(function (x) { return x.id === u.id; });
        if (m) { if (u.cxMm != null) m.cxMm = u.cxMm; if (u.cyMm != null) m.cyMm = u.cyMm; }
      });
      refreshAdvancedForSelection(); render2D(); scheduleRebuild3D();
    }
    wire("selAlignL",  function () { applyLayout(function (e) { return window.alignElements(e, "left"); }); });
    wire("selAlignR",  function () { applyLayout(function (e) { return window.alignElements(e, "right"); }); });
    wire("selAlignT",  function () { applyLayout(function (e) { return window.alignElements(e, "top"); }); });
    wire("selAlignB",  function () { applyLayout(function (e) { return window.alignElements(e, "bottom"); }); });
    wire("selAlignCH", function () { applyLayout(function (e) { return window.alignElements(e, "centerH"); }); });
    wire("selAlignCV", function () { applyLayout(function (e) { return window.alignElements(e, "centerV"); }); });
    wire("selDistH",   function () { applyLayout(function (e) { return window.distributeElements(e, "h"); }); });
    wire("selDistV",   function () { applyLayout(function (e) { return window.distributeElements(e, "v"); }); });
  }());

  // ---- Dünne-Stellen prüfen (nozzle-width check) ----
  (function () {
    var btn = document.getElementById("thinCheckBtn");
    var status = document.getElementById("thinCheckStatus");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var res;
      try { res = window.thinFeatureMask(visibleDoc(), 0.4); }
      catch (e) {
        if (status) status.textContent = "Prüfung fehlgeschlagen: " + (e && e.message || e);
        return;
      }
      state.thinOverlay = res.count ? res : null;
      if (status) status.textContent = res.count
        ? "~" + res.areaMm2.toFixed(1) + " mm² schmaler als 0,4 mm — im 2D rot markiert"
        : "✓ Keine dünnen Stellen gefunden";
      render2D();
    });
  }());

  // ---- Schicht-Vorschau (3D layer scrubber) ----
  (function () {
    var s = document.getElementById("layerSlider");
    if (s) s.addEventListener("input", function () {
      if (window.preview3d && window.preview3d.setClipRatio) {
        window.preview3d.setClipRatio(parseFloat(this.value) / 100);
      }
    });
  }());

  // ---- Center buttons ----
  function centerH() {
    withSelected(function (el) { el.cxMm = doc.body.widthMm / 2; });
    refreshAdvancedForSelection();
  }
  function centerV() {
    withSelected(function (el) { el.cyMm = doc.body.heightMm / 2; });
    refreshAdvancedForSelection();
  }
  function flipSelected(axis) {
    withSelected(function (el) {
      if (axis === "h") el.flipH = !el.flipH; else el.flipV = !el.flipV;
    });
    refreshAdvancedForSelection();
  }

  (function () {
    var ch = document.getElementById("centerH"); if (ch) ch.addEventListener("click", centerH);
    var cv2 = document.getElementById("centerV"); if (cv2) cv2.addEventListener("click", centerV);
  }());

  // ---- Schaukasten (shadowbox) doc controls ----
  function sbState() { return doc.shadowbox; }

  function syncShadowboxControls() {
    const sb = sbState();
    if (!sb) return;
    const supported = doc.body.shape === "rect" || doc.body.shape === "circle";
    document.getElementById("sbEnabled").checked = !!sb.enabled;
    document.getElementById("sbEnabled").disabled = !supported;
    document.getElementById("sbShapeHint").hidden = supported;
    document.getElementById("sbParams").hidden = !sb.enabled || !supported;
    document.getElementById("sbLayers").value = sb.layers;
    document.getElementById("sbInset").value = sb.insetPerLayerMm;
    const auto = sb.opening.source !== "drawn";
    document.getElementById("sbOpeningAuto").classList.toggle("seg-active", auto);
    document.getElementById("sbOpeningDrawn").classList.toggle("seg-active", !auto);
    document.getElementById("sbAutoParams").hidden = !auto;
    document.getElementById("sbDrawnParams").hidden = auto;
    document.getElementById("sbMargin").value = sb.opening.marginMm;
    document.getElementById("sbPeriod").value = sb.opening.periodMm;
    document.getElementById("sbWaviness").value = sb.opening.waviness;
    document.getElementById("sbColorFront").value = sb.colorFront;
    document.getElementById("sbColorBack").value = sb.colorBack;
    document.getElementById("sbStand").checked = !!sb.stand.enabled;
    document.getElementById("sbStandHeight").value = sb.stand.heightMm;
  }

  function sbChanged() {
    syncShadowboxControls();
    render2D();
    scheduleRebuild3D();
  }

  function initShadowboxControls() {
    const on = (id, evt, fn) => document.getElementById(id).addEventListener(evt, fn);
    on("sbEnabled", "change", function () { sbState().enabled = this.checked; sbChanged(); });
    on("sbLayers", "change", function () {
      const v = parseInt(this.value, 10);
      if (!isNaN(v)) { sbState().layers = Math.max(3, Math.min(10, v)); sbChanged(); }
    });
    on("sbInset", "change", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v) && v > 0) { sbState().insetPerLayerMm = v; sbChanged(); }
    });
    on("sbOpeningAuto", "click", function () { sbState().opening.source = "auto"; sbChanged(); });
    on("sbOpeningDrawn", "click", function () { sbState().opening.source = "drawn"; sbChanged(); });
    on("sbMargin", "change", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v) && v >= 0.5) { sbState().opening.marginMm = v; sbChanged(); }
    });
    on("sbPeriod", "change", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v) && v >= 4) { sbState().opening.periodMm = v; sbChanged(); }
    });
    on("sbWaviness", "input", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v)) { sbState().opening.waviness = v; sbChanged(); }
    });
    on("sbReroll", "click", function () { sbState().opening.seed = (sbState().opening.seed | 0) + 1; sbChanged(); });
    on("sbColorFront", "input", function () { sbState().colorFront = this.value.toUpperCase(); sbChanged(); });
    on("sbColorBack", "input", function () { sbState().colorBack = this.value.toUpperCase(); sbChanged(); });
    on("sbStand", "change", function () { sbState().stand.enabled = this.checked; sbChanged(); });
    on("sbStandHeight", "change", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v) && v >= 6) { sbState().stand.heightMm = v; sbChanged(); }
    });
  }
  initShadowboxControls();

  // -- Init Advanced panel doc-level values (also called by resetDocTo) --
  function initAdvancedUI() {
    var t = document.getElementById("advThickness");
    if (t) t.value = doc.body.thicknessMm != null ? doc.body.thicknessMm : 2;
    var bt = document.getElementById("advBaseThickness");
    if (bt) bt.value = doc.body.baseThicknessMm != null ? doc.body.baseThicknessMm : 0;
    var lh = document.getElementById("advLayerHeight");
    if (lh) lh.value = doc.body.layerHeightMm != null ? doc.body.layerHeightMm : 0.4;
    var res = document.getElementById("advResolution");
    if (res) res.value = doc.resolution != null ? doc.resolution : 1024;
    var cs = document.getElementById("advColorStep");
    if (cs) cs.value = doc.colorStepLayers != null ? doc.colorStepLayers : 4;
    var bc = document.getElementById("advBaseColor");
    if (bc) bc.value = doc.body.baseColor || "#000000";
    // Plate controls (canonical ids; seg states + field visibility come from
    // applyShape/applyMount, called from initSimpleUI).
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    syncShadowboxControls();
  }
  initAdvancedUI();

  // ---- resetDocTo: in-place doc replacement (used by Open) ----
  function resetDocTo(newDoc) {
    Object.keys(doc).forEach(function (k) { delete doc[k]; });
    Object.assign(doc, newDoc);
    clearSelection();
    defaultDirection = "raised";
    // Register any embedded custom fonts before rendering, then repaint once ready.
    registerDocFonts(doc).then(function () { render2D(); scheduleRebuild3D(); });
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
  // Default file name: the export field if the user set one, else the first
  // imported element's file name, else "ukibori". Shared by Speichern + Export.
  function defaultExportName() {
    var field = document.getElementById("exportName");
    var v = field ? field.value.trim() : "";
    if (v && v !== "ukibori") return v;
    var named = doc.elements.find(function (e) { return e.name; });
    return named ? named.name : "ukibori";
  }

  document.getElementById("saveBtn").addEventListener("click", function () {
    try {
      var json = window.serializeProject(doc);
      var blob = new Blob([json], { type: "application/json" });
      var name = defaultExportName();
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
          undoBoundary(false);
          resetDocTo(loaded);
          undoBoundary(true);
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

  // Initial render: fit scale first (B3: fitScale not in render2D anymore).
  // Restore persisted preview mode; default 'split' (2D + 3D side by side) per user request.
  setPreviewMode((function () { try { return localStorage.getItem(PREVIEW_MODE_KEY) || "split"; } catch (e) { return "split"; } })());
  renderLayers();

  // Undo baseline: the pristine doc is the floor of the stack.
  try { _undo.stack = [window.serializeProject(doc)]; } catch (e) {}
  (function () {
    var ub = document.getElementById("undoBtn"), rb = document.getElementById("redoBtn");
    if (ub) ub.addEventListener("click", undoAction);
    if (rb) rb.addEventListener("click", redoAction);
  }());

  // Public interface. Expose state so tests can inspect/mutate selection.
  window.editor = { doc, render2D, refreshAdvancedForSelection, renderAdvancedLayers, renderLayers, resetDocTo, buildDesignSVG, exportDesignCanvas };
  // Expose for Playwright smoke tests.
  window.__editorState = state;
  window.__editorHitTest = hitTest;
})();
