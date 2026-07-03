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
    selectedId: null, scale: 1, ox: 0, oy: 0, viewX0: 0, viewY0: 0, marginPx: 48,
    snap: {
      plate:    _snapLoaded.plate    !== undefined ? !!_snapLoaded.plate    : _snapDefault.plate,
      elements: _snapLoaded.elements !== undefined ? !!_snapLoaded.elements : _snapDefault.elements,
      gridMm:   _snapLoaded.gridMm   !== undefined ? +_snapLoaded.gridMm   : _snapDefault.gridMm,
    },
    snapGuides: [],
  };
  function persistSnap() { try { localStorage.setItem(SNAP_KEY, JSON.stringify(state.snap)); } catch (e) {} }

  var MARGIN_PX = 48;

  // ---- mm↔px helpers — all drawing/hit-test coordinates go through these ----
  // mmX(x): mm doc-space x → canvas px (includes marginPx bleed border).
  // Inverse: (px - state.marginPx) / s + viewX0.
  function mmX(x) { return state.marginPx + (x - state.viewX0) * state.scale; }
  function mmY(y) { return state.marginPx + (y - state.viewY0) * state.scale; }

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
    // In split mode the 2D canvas occupies half the preview width. The canvas is now
    // aspect-preserving (flex:0 1 auto), so cv.clientWidth follows the buffer — using it
    // here would be circular. Always derive the split width from the preview (minus the
    // 8px inter-pane gap).
    var inSplit = preview && preview.classList.contains("split");
    var rawW = preview ? (inSplit ? Math.floor((preview.clientWidth - 8) / 2) : preview.clientWidth) : 600;
    const availW = rawW - pad;
    const availH = (preview ? preview.clientHeight : 700) - pad;
    // Use expanded domain (docDomain exported by T1; falls back to body box if unavailable).
    var domain = (window.docDomain ? window.docDomain(doc) : { x0: 0, y0: 0, wMm: doc.body.widthMm, hMm: doc.body.heightMm });
    state.viewX0 = domain.x0;
    state.viewY0 = domain.y0;
    state.marginPx = MARGIN_PX;
    // Subtract 2× margin from each dimension so the plate fits within the usable area.
    var uw = availW - 2 * MARGIN_PX;
    var uh = availH - 2 * MARGIN_PX;
    // Fit BOTH dimensions (drop the max(1,…) floor so tall plates can shrink; keep 0.2 floor).
    const s = Math.max(0.2, Math.min(uw / domain.wMm, uh / domain.hMm));
    state.scale = s;
    cv.width = Math.round(domain.wMm * s + 2 * MARGIN_PX);
    cv.height = Math.round(domain.hMm * s + 2 * MARGIN_PX);
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
      (d && d.minIsland != null ? d.minIsland : 0)
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
        // Resolve color merges → root, then apply the root's remap — mirrors __renderElementV2
        // so the 2D preview matches the 3D/export exactly. Empty merges ⇒ no-op.
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
    // Farb-Stapelung selector shares the palette's visibility group (colorLayers only).
    var colorStyleField = document.getElementById('colorStyleField');
    if (colorStyleField) colorStyleField.hidden = !isColorLayers;
    if (!isColorLayers) { cont.innerHTML = ''; return; }
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
    var html = visible.map(function (nat) {
      var eff = remap[nat] || nat.toLowerCase();
      var count = childCount[nat] || 1;
      // Merge menu: fold THIS color into another visible color, or split it back apart.
      var opts = '<option value="">⤵</option>';
      visible.forEach(function (other) {
        if (other === nat) return;
        opts += '<option value="' + other + '">→ ' + (remap[other] || other.toLowerCase()) + '</option>';
      });
      if (count > 1) opts += '<option value="__unmerge">↩ auftrennen (' + count + ')</option>';
      return '<span class="pal-entry" draggable="true" data-orig="' + nat + '">'
        + '<span class="grip" aria-hidden="true">⠿</span>'
        + '<input type="color" class="sw-edit" data-orig="' + nat + '" value="' + eff + '" title="' + nat + ' → ' + eff + '">'
        + (count > 1 ? '<span class="pal-count" title="' + count + ' Farben zusammengeführt">' + count + '</span>' : '')
        + '<select class="sw-merge" data-orig="' + nat + '" title="Farbe zusammenführen">' + opts + '</select>'
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
  function drawElement(ctx, el, s, vx0, vy0, originPxX, originPxY) {
    var ox = (vx0 !== undefined ? vx0 : state.viewX0);
    var oy = (vy0 !== undefined ? vy0 : state.viewY0);
    var ax = (originPxX !== undefined ? originPxX : state.marginPx);
    var ay = (originPxY !== undefined ? originPxY : state.marginPx);
    ctx.save();
    ctx.translate(ax + (el.cxMm - ox) * s, ay + (el.cyMm - oy) * s);
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
      // Rand-Rahmen preview: stroke inset by widthMm/2 with lineWidth widthMm*s
      // (drawn over the content — "ring wins"; exact band comes from the engine).
      const frame = body.frame;
      if (frame && frame.widthMm > 0 && insetBodyPath(ctx, frame.widthMm / 2)) {
        ctx.save();
        ctx.strokeStyle = frame.color || "#000000";
        ctx.lineWidth = frame.widthMm * s;
        ctx.stroke();
        ctx.restore();
      }
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
      // Rand-Rahmen preview: ring stroke at r - widthMm/2 ("ring wins" over content).
      const frame = body.frame;
      if (frame && frame.widthMm > 0) {
        const fr = r - (frame.widthMm / 2) * s;
        if (fr > 0) {
          ctx.save();
          ctx.beginPath(); ctx.arc(cx, cy, fr, 0, Math.PI * 2);
          ctx.strokeStyle = frame.color || "#000000";
          ctx.lineWidth = frame.widthMm * s;
          ctx.stroke();
          ctx.restore();
        }
      }
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
    const el = doc.elements.find(el => el.id === state.selectedId);
    if (!el) return;
    if (drag.handle === "move") {
      el.cxMm = drag.start.cx + (px - drag.px) / s;
      el.cyMm = drag.start.cy + (py - drag.py) / s;
      applyMoveSnap(el);
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
    state.snapGuides = []; // clear transient guide lines
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
  function applyShape(shape) {
    doc.body.shape = shape;
    setSegActive("shapeSeg", shape === "rect" ? "shapeRect" : shape === "circle" ? "shapeCircle" : "shapeFree");
    document.getElementById("borderField").hidden = (shape !== "free");
    // Rand-Rahmen: only meaningful for rect/circle plates (engine ignores it for free).
    document.getElementById("frameField").hidden = (shape === "free");
    // Eckenradius: only meaningful for the rectangle plate.
    var cf = document.getElementById("cornerField");
    if (cf) cf.hidden = (shape !== "rect");
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("shapeRect").addEventListener("click", function () { applyShape("rect"); });
  document.getElementById("shapeCircle").addEventListener("click", function () { applyShape("circle"); });
  document.getElementById("shapeFree").addEventListener("click", function () { applyShape("free"); });

  // Eckenradius (shown only for Rechteck)
  document.getElementById("cornerMm").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) {
      doc.body.cornerRadiusMm = v;
      render2D();
      scheduleRebuild3D();
    }
  });

  // Border (shown only for Free)
  document.getElementById("borderMm").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) {
      doc.body.borderMm = v;
      scheduleRebuild3D();
    }
  });

  // Rand-Rahmen (shown for Rechteck/Kreis; engine ignores it for Frei)
  function ensureFrame() {
    if (!doc.body.frame) doc.body.frame = window.defaultFrame ? window.defaultFrame() : { widthMm: 0, heightMm: 2, color: "#000000" };
    return doc.body.frame;
  }
  document.getElementById("frameMm").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) {
      ensureFrame().widthMm = v;
      render2D();
      scheduleRebuild3D();
    }
  });
  document.getElementById("frameColor").addEventListener("input", function () {
    ensureFrame().color = this.value;
    render2D();
    scheduleRebuild3D();
  });
  // Höhe in the Simple row; kept in sync with the Advanced #advFrameHeight field
  // (both write body.frame.heightMm).
  document.getElementById("frameHeightMm").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) {
      ensureFrame().heightMm = v;
      var adv = document.getElementById("advFrameHeight");
      if (adv) adv.value = v;
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
    setSegActive("mountSeg", type === "none" ? "mountNone" : type === "hole" ? "mountHole" : "mountLoop");
    // Re-fit canvas: domain may have expanded/contracted.
    fitScale();
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("mountNone").addEventListener("click", function () { applyMount("none", { snap: true }); });
  document.getElementById("mountHole").addEventListener("click", function () { applyMount("hole", { snap: true }); });
  document.getElementById("mountLoop").addEventListener("click", function () { applyMount("loop", { snap: true }); });

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
    state.selectedId = el.id;
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    render2D();
    scheduleRebuild3D();
    // Auto-focus the visible text input so the user can type immediately.
    var f = (getView() === "advanced") ? document.getElementById("advText") : document.getElementById("simpleText");
    if (f) { f.value = selectedEl() && selectedEl().text || ""; f.focus(); if (f.select) f.select(); }
  }

  function addImageAction() {
    var inp = document.getElementById("addImageInput");
    if (inp) inp.click();
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
      state.selectedId = el.id;
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

  // Bind Advanced buttons (guard each getElementById in case markup is missing).
  (function () {
    var ib = document.getElementById("addImageBtnAdv"); if (ib) ib.addEventListener("click", addImageAction);
    var tb = document.getElementById("addTextBtnAdv");  if (tb) tb.addEventListener("click", addTextAction);
    var qb = document.getElementById("addQrBtnAdv");    if (qb) qb.addEventListener("click", addQrAction);
  }());

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
    // Eckenradius (rectangle)
    document.getElementById("cornerMm").value = doc.body.cornerRadiusMm != null ? doc.body.cornerRadiusMm : 4;
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

    // Text content fields: show only for text elements; seed from el.text.
    var advTextField = document.getElementById("advTextField");
    var simpleTextSection = document.getElementById("simpleTextSection");
    var isText = el && el.type === "text";
    if (advTextField) advTextField.hidden = !isText;
    if (simpleTextSection) simpleTextSection.hidden = !isText;
    var advTextNode = document.getElementById("advText");
    var simpleTextNode = document.getElementById("simpleText");
    if (advTextNode) advTextNode.value = isText ? (el.text || "") : "";
    if (simpleTextNode) simpleTextNode.value = isText ? (el.text || "") : "";

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

  // -- Text content fields (advText + simpleText, kept in sync) --
  bindElementField("advText", "input", function (el, node) {
    if (el.type !== "text") return false;
    el.text = node.value;
    // Keep Simple field in sync.
    var simple = document.getElementById("simpleText");
    if (simple) simple.value = node.value;
    renderLayers();
  });

  bindElementField("simpleText", "input", function (el, node) {
    if (el.type !== "text") return false;
    el.text = node.value;
    // Keep Advanced field in sync.
    var adv = document.getElementById("advText");
    if (adv) adv.value = node.value;
    renderLayers();
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

  document.getElementById("advFrameHeight").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) {
      ensureFrame().heightMm = v;
      var simple = document.getElementById("frameHeightMm");
      if (simple) simple.value = v; // keep the Simple row in sync
      scheduleRebuild3D();
    }
  });

  // Base color (Grundfarbe) for the base plate.
  (function () {
    var bc = document.getElementById("advBaseColor");
    if (bc) bc.addEventListener("input", function () {
      doc.body.baseColor = this.value;
      render2D();
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

  // ---- Center buttons ----
  function centerH() {
    withSelected(function (el) { el.cxMm = doc.body.widthMm / 2; });
    refreshAdvancedForSelection();
  }
  function centerV() {
    withSelected(function (el) { el.cyMm = doc.body.heightMm / 2; });
    refreshAdvancedForSelection();
  }

  (function () {
    var ch = document.getElementById("centerH"); if (ch) ch.addEventListener("click", centerH);
    var cv2 = document.getElementById("centerV"); if (cv2) cv2.addEventListener("click", centerV);
    var chA = document.getElementById("centerHAdv"); if (chA) chA.addEventListener("click", centerH);
    var cvA = document.getElementById("centerVAdv"); if (cvA) cvA.addEventListener("click", centerV);
  }());

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
    var fh = document.getElementById("advFrameHeight");
    if (fh) fh.value = (doc.body.frame && doc.body.frame.heightMm != null) ? doc.body.frame.heightMm : 2;
    var bc = document.getElementById("advBaseColor");
    if (bc) bc.value = doc.body.baseColor || "#000000";
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
  // Restore persisted preview mode; default 'split' (2D + 3D side by side) per user request.
  setPreviewMode((function () { try { return localStorage.getItem(PREVIEW_MODE_KEY) || "split"; } catch (e) { return "split"; } })());
  renderLayers();

  // Public interface. Expose state so tests can inspect/mutate selection.
  window.editor = { doc, setView, getView, render2D, refreshAdvancedForSelection, renderAdvancedLayers, renderLayers, resetDocTo, buildDesignSVG };
  // Expose for Playwright smoke tests.
  window.__editorState = state;
  window.__editorHitTest = hitTest;
})();
