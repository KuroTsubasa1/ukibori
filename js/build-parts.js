"use strict";
// Unified geometry engine (additive; nothing calls it yet — the UI switches over
// in a later phase). Turns a v2 doc into 3D parts [{name, color:[r,g,b], facets}],
// reusing the shared primitives (shapeFootprintField, traceMaskToFacets,
// extrudeLoops, orientOutward, hexToRgb) via window globals.
(function () {
  // Aspect-preserving raster grid for a v2 body: longest side = resolution.
  // pitch = widthMm / cols (mm per cell). Mirrors the bookmark __gridFor logic.
  function gridForBody(body, resolution) {
    const res = Math.max(8, Math.round(resolution));
    let cols, rows;
    if (body.widthMm >= body.heightMm) {
      cols = res; rows = Math.max(2, Math.round(res * body.heightMm / body.widthMm));
    } else {
      rows = res; cols = Math.max(2, Math.round(res * body.widthMm / body.heightMm));
    }
    return { cols, rows, pitch: body.widthMm / cols };
  }

  // Base plate: the body footprint (with the mount hole cut) extruded from z=0 to
  // body.thicknessMm, colored body.baseColor. The loop's raised ring is built
  // separately (later task).
  function buildBaseParts(doc) {
    const body = doc.body, mount = doc.mount;
    const { cols, rows, pitch } = gridForBody(body, doc.resolution);
    const field = window.shapeFootprintField(cols, rows, body, mount);
    const inside = (c, r) => field(c, r) > 0;
    const facets = window.orientOutward(
      window.traceMaskToFacets(inside, cols, rows, pitch, body.thicknessMm, 0)
    );
    if (!facets.length) return [];
    return [{ name: "grundplatte", color: window.hexToRgb(body.baseColor), facets }];
  }

  const __ALPHA_CUTOFF = 128;

  // v2 analogue of bookmark-export __renderElement: rasterize one element to a
  // cols×rows grid. mask[i]=1 where opaque; r/g/b per pixel. Reads el.depth.* for
  // mode/threshold/invert/reduce (v1 read el.colorMode/threshold/invert/reduce).
  function __renderElementV2(el, doc, cols, rows) {
    const sx = cols / doc.body.widthMm, sy = rows / doc.body.heightMm;
    const cv = document.createElement("canvas"); cv.width = cols; cv.height = rows;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const w = el.wMm * sx, h = el.hMm * sy;
    ctx.save();
    ctx.translate(el.cxMm * sx, el.cyMm * sy);
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    if (el.type === "text") {
      ctx.fillStyle = el.color;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${el.fontWeight} ${Math.max(1, Math.round(h))}px ${el.fontFamily}`;
      ctx.fillText(el.text, 0, 0);
    } else if (el._img) {
      ctx.drawImage(el._img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
    const d = ctx.getImageData(0, 0, cols, rows).data, n = cols * rows;
    const mask = new Uint8Array(n);
    const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
    const depth = el.depth || {};

    if (el.type === "image" && depth.mode === "colorLayers" && el._img) {
      const red = depth.reduce || { method: "palette", numColors: 8, levels: 4, remap: {} };
      const pal = window.__imagePaletteFromImg(el._img, red.method, red.numColors, red.levels);
      const remap = red.remap || {};
      const hx = (R, G, B) => ("#" + [R, G, B].map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
      for (let i = 0; i < n; i++) {
        if (d[i * 4 + 3] < __ALPHA_CUTOFF) continue;
        const near = window.__nearestColor(pal, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        let cr = near[0], cg = near[1], cb = near[2];
        const m = remap[hx(cr, cg, cb)];
        if (m) { const c = window.hexToRgb(m); cr = c[0]; cg = c[1]; cb = c[2]; }
        mask[i] = 1; r[i] = cr; g[i] = cg; b[i] = cb;
      }
      return { mask, r, g, b };
    }

    const col = window.hexToRgb(el.color);
    const thr = depth.threshold != null ? depth.threshold : 128;
    for (let i = 0; i < n; i++) {
      let on = d[i * 4 + 3] >= __ALPHA_CUTOFF;
      if (on && el.type === "image") {
        const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        on = depth.invert ? lum >= thr : lum < thr;
      }
      if (on) { mask[i] = 1; r[i] = col[0]; g[i] = col[1]; b[i] = col[2]; }
    }
    return { mask, r, g, b };
  }

  // v2 analogue of bookmark-export composeDesign: composite elements (last = on
  // top) into per-pixel front color/depth/flags. Same return shape as composeDesign.
  function composeDesignV2(doc, cols, rows) {
    const n = cols * rows;
    const base = window.hexToRgb(doc.body.baseColor);
    const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
    const depthMm = new Float32Array(n), cutout = new Uint8Array(n), isBase = new Uint8Array(n);
    const owner = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) { r[i] = base[0]; g[i] = base[1]; b[i] = base[2]; depthMm[i] = doc.body.thicknessMm; isBase[i] = 1; }
    doc.elements.forEach((el, ei) => {
      if (el.type === "image" && !el._img) return;
      const layer = __renderElementV2(el, doc, cols, rows);
      const eh = (el.depth && el.depth.heightMm) || 0;
      for (let i = 0; i < n; i++) {
        if (!layer.mask[i]) continue;
        r[i] = layer.r[i]; g[i] = layer.g[i]; b[i] = layer.b[i];
        depthMm[i] = eh; cutout[i] = el.cutout ? 1 : 0; isBase[i] = 0; owner[i] = ei;
      }
    });
    return { r, g, b, depthMm, cutout, isBase, owner };
  }

  function __hex(r, g, b) {
    return ("#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
  }

  // v2 analogue of bookmark-export __orderedNaturalHexes: a reduce-image element's
  // natural palette in the user's preferred order (el.depth.reduce.order first, then
  // any new colors). Reads el.depth.reduce (v1 read el.reduce).
  function __orderedNaturalHexesV2(el) {
    if (!(el.type === "image" && el.depth && el.depth.mode === "colorLayers" && el._img)) return [];
    const red = el.depth.reduce || {};
    const pal = window.__imagePaletteFromImg(el._img, red.method, red.numColors, red.levels)
      .map(c => __hex(c[0], c[1], c[2]));
    const ord = red.order || [];
    const out = [];
    for (const h of ord) { const H = String(h).toUpperCase(); if (pal.indexOf(H) !== -1 && out.indexOf(H) === -1) out.push(H); }
    for (const h of pal) if (out.indexOf(h) === -1) out.push(h);
    return out;
  }

  // Engraved model for a v2 doc: a v2 port of buildBookmarkParts. Solid base plate;
  // each color is a recess floor whose depth = rank * step (front-most = shallowest);
  // continuous bottom slab + background/under-color risers keep it manifold. Reuses
  // the same slab+riser construction as the bookmark builder (so a migrated v1 doc
  // reproduces buildBookmarkParts output). Raised/heightmap directions are separate
  // builders (later tasks); this is the engraved path.
  function buildEngravedParts(doc) {
    const { cols, rows, pitch } = gridForBody(doc.body, doc.resolution);
    const comp = composeDesignV2(doc, cols, rows);
    const footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    const T = doc.body.thicknessMm, layerH = doc.body.layerHeightMm;
    const baseHex = doc.body.baseColor.toUpperCase();
    const idx = (c, r) => r * cols + c;
    const colorParts = [], baseParts = [];
    const tracedFacets = (member, thickness, z0) => window.orientOutward(
      window.traceMaskToFacets((c, r) => member(c, r) && footprint(c, r) > 0, cols, rows, pitch, thickness, z0));

    const floor = Math.min(2 * layerH, T);
    const minBase = Math.min(Math.max(0.8, T * 0.34, 2 * layerH), Math.max(0, T - floor));
    const maxRecess = Math.max(0, T - floor - minBase);
    const recessOf = (d) => Math.max(0, Math.min(d, maxRecess));
    const baseUnder = (d) => T - recessOf(d) - floor;

    const step = Math.max(1, doc.colorStepLayers || 2) * layerH;
    const ownerEff = new Map();
    for (let i = 0; i < cols * rows; i++) {
      if (comp.isBase[i] || comp.cutout[i] || comp.owner[i] < 0) continue;
      const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
      let s = ownerEff.get(comp.owner[i]); if (!s) ownerEff.set(comp.owner[i], s = new Set());
      s.add(hex);
    }
    const orderedColors = [];
    const pushC = (h) => { if (orderedColors.indexOf(h) === -1) orderedColors.push(h); };
    for (let ei = doc.elements.length - 1; ei >= 0; ei--) {
      const present = ownerEff.get(ei); if (!present) continue;
      const el = doc.elements[ei], mode = el.depth && el.depth.mode;
      const seq = [];
      if (el.type === "text" || (el.type === "image" && mode !== "colorLayers")) {
        const c = window.hexToRgb(el.color); seq.push(__hex(c[0], c[1], c[2]));
      } else if (el.type === "image" && mode === "colorLayers") {
        const remap = (el.depth.reduce && el.depth.reduce.remap) || {};
        for (const nat of __orderedNaturalHexesV2(el)) { const c = window.hexToRgb(remap[nat] || nat); seq.push(__hex(c[0], c[1], c[2])); }
      }
      for (const h of seq) if (present.has(h)) pushC(h);
      for (const h of present) pushC(h);
    }
    const depthByHex = new Map();
    orderedColors.forEach((hex, rank) => depthByHex.set(hex, (rank + 1) * step));
    const depthFor = (hex) => depthByHex.get(hex) || step;

    const groups = new Map();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (comp.isBase[i] || comp.cutout[i]) continue;
      const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
      let grp = groups.get(hex); if (!grp) groups.set(hex, grp = { hex, set: new Uint8Array(cols * rows) });
      grp.set[i] = 1;
    }
    let cn = 0;
    for (const grp of groups.values()) {
      const z0 = baseUnder(depthFor(grp.hex));
      const facets = tracedFacets((c, r) => grp.set[idx(c, r)] === 1, floor, z0);
      if (facets.length) colorParts.push({ name: "farbe-" + (++cn), color: window.hexToRgb(grp.hex), facets });
    }

    const baseAdd = (member, thickness, z0) => {
      const facets = tracedFacets(member, thickness, z0);
      if (facets.length) baseParts.push({ name: "grundplatte", color: window.hexToRgb(baseHex), facets });
    };
    baseAdd((c, r) => comp.cutout[idx(c, r)] !== 1, minBase, 0);
    baseAdd((c, r) => comp.isBase[idx(c, r)] === 1, T - minBase, minBase);
    const behind = new Map();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (comp.cutout[i] || comp.isBase[i]) continue;
      const h = baseUnder(depthFor(__hex(comp.r[i], comp.g[i], comp.b[i])));
      if (h - minBase <= 1e-6) continue;
      const key = h.toFixed(4);
      let set = behind.get(key); if (!set) behind.set(key, set = { h, m: new Uint8Array(cols * rows) });
      set.m[i] = 1;
    }
    for (const set of behind.values()) baseAdd((c, r) => set.m[idx(c, r)] === 1, set.h - minBase, minBase);

    return [...baseParts, ...colorParts];
  }

  // The loop (Öse) ring: an annulus around the mount hole, standing proud of the
  // base top face. Only for mount.type==='loop' with a positive ring wall + height.
  // Body-colored, intersected with the (no-hole) body footprint so it can't overhang.
  function buildMountRingParts(doc) {
    const m = doc.mount || {};
    if (m.type !== "loop" || !(m.ringThicknessMm > 0) || !(m.ringHeightMm > 0)) return [];
    const { cols, rows, pitch } = gridForBody(doc.body, doc.resolution);
    const bodyOnly = window.shapeFootprintField(cols, rows, doc.body, { type: "none" });
    const sx = cols / doc.body.widthMm, sy = rows / doc.body.heightMm;
    const innerR = m.diameterMm / 2, outerR = innerR + m.ringThicknessMm;
    const cx = m.xMm, cy = m.yMm;
    const inRing = (c, r) => {
      const x = (c + 0.5) / sx, y = (r + 0.5) / sy;
      const d = Math.hypot(x - cx, y - cy);
      return d >= innerR && d <= outerR && bodyOnly(c, r) > 0;
    };
    const facets = window.orientOutward(
      window.traceMaskToFacets(inRing, cols, rows, pitch, m.ringHeightMm, doc.body.thicknessMm));
    if (!facets.length) return [];
    return [{ name: "oese", color: window.hexToRgb(doc.body.baseColor), facets }];
  }

  // Rasterize one raised element with alpha-only masking (no luminance threshold).
  // For colorLayers: nearest-palette per pixel. For solid/text: flat el.color on
  // every opaque pixel. Raised elements are colored stamps, not silhouettes.
  function __renderRaisedElement(el, doc, cols, rows) {
    const sx = cols / doc.body.widthMm, sy = rows / doc.body.heightMm;
    const cv = document.createElement("canvas"); cv.width = cols; cv.height = rows;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const w = el.wMm * sx, h = el.hMm * sy;
    ctx.save();
    ctx.translate(el.cxMm * sx, el.cyMm * sy);
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    if (el.type === "text") {
      ctx.fillStyle = el.color;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${el.fontWeight} ${Math.max(1, Math.round(h))}px ${el.fontFamily}`;
      ctx.fillText(el.text, 0, 0);
    } else if (el._img) {
      ctx.drawImage(el._img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
    const d = ctx.getImageData(0, 0, cols, rows).data, n = cols * rows;
    const mask = new Uint8Array(n);
    const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
    const depth = el.depth || {};
    if (el.type === "image" && depth.mode === "colorLayers" && el._img) {
      const red = depth.reduce || { method: "palette", numColors: 8, levels: 4, remap: {} };
      const pal = window.__imagePaletteFromImg(el._img, red.method, red.numColors, red.levels);
      const remap = red.remap || {};
      const hx = (R, G, B) => ("#" + [R, G, B].map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
      for (let i = 0; i < n; i++) {
        if (d[i * 4 + 3] < __ALPHA_CUTOFF) continue;
        const near = window.__nearestColor(pal, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        let cr = near[0], cg = near[1], cb = near[2];
        const m = remap[hx(cr, cg, cb)];
        if (m) { const c = window.hexToRgb(m); cr = c[0]; cg = c[1]; cb = c[2]; }
        mask[i] = 1; r[i] = cr; g[i] = cg; b[i] = cb;
      }
      return { mask, r, g, b };
    }
    // Solid/text: alpha-only mask; raised elements are colored stamps, not lum-thresholded silhouettes.
    const col = window.hexToRgb(el.color);
    for (let i = 0; i < n; i++) {
      if (d[i * 4 + 3] >= __ALPHA_CUTOFF) { mask[i] = 1; r[i] = col[0]; g[i] = col[1]; b[i] = col[2]; }
    }
    return { mask, r, g, b };
  }

  // Raised element prisms: for depth.direction==='raised' elements, extrude their
  // colored regions UP from the base top face. Base plate is built separately.
  // Height: depth.heightMm for solid/text; (rank+1)*step per color for colorLayers.
  // Uses alpha-only rasterization for raised elements (not lum-threshold silhouettes).
  function buildRaisedParts(doc) {
    const { cols, rows, pitch } = gridForBody(doc.body, doc.resolution);
    const footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    const T = doc.body.thicknessMm, layerH = doc.body.layerHeightMm;
    const step = Math.max(1, doc.colorStepLayers || 2) * layerH;
    const idx = (c, r) => r * cols + c;
    const tracedFacets = (member, thickness, z0) => window.orientOutward(
      window.traceMaskToFacets((c, r) => member(c, r) && footprint(c, r) > 0, cols, rows, pitch, thickness, z0));

    const heightForElemColor = (el, hex) => {
      if (el.depth && el.depth.mode === "colorLayers") {
        const remap = (el.depth.reduce && el.depth.reduce.remap) || {};
        const seq = __orderedNaturalHexesV2(el).map(nat => { const c = window.hexToRgb(remap[nat] || nat); return __hex(c[0], c[1], c[2]); });
        const rank = seq.indexOf(hex);
        return ((rank < 0 ? 0 : rank) + 1) * step;
      }
      return Math.max((el.depth && el.depth.heightMm) || 0, layerH);
    };

    // Composite only the raised elements (last = on top), alpha-only mask.
    const n = cols * rows;
    const compR = new Uint8ClampedArray(n), compG = new Uint8ClampedArray(n), compB = new Uint8ClampedArray(n);
    const owner = new Int32Array(n).fill(-1);
    const cutout = new Uint8Array(n);
    doc.elements.forEach((el, ei) => {
      if (!(el.depth && el.depth.direction === "raised")) return;
      if (el.type === "image" && !el._img) return;
      if (el.cutout) return; // cutout raised elements don't extrude
      const layer = __renderRaisedElement(el, doc, cols, rows);
      for (let i = 0; i < n; i++) {
        if (!layer.mask[i]) continue;
        compR[i] = layer.r[i]; compG[i] = layer.g[i]; compB[i] = layer.b[i];
        owner[i] = ei;
      }
    });

    const groups = new Map(); // "ei|hex" -> {ei, hex, set}
    for (let i = 0; i < n; i++) {
      const ei = owner[i];
      if (ei < 0 || cutout[i]) continue;
      const hex = __hex(compR[i], compG[i], compB[i]);
      const key = ei + "|" + hex;
      let g = groups.get(key); if (!g) groups.set(key, g = { ei, hex, set: new Uint8Array(n) });
      g.set[i] = 1;
    }
    const parts = []; let pn = 0;
    for (const g of groups.values()) {
      const h = heightForElemColor(doc.elements[g.ei], g.hex);
      const facets = tracedFacets((c, r) => g.set[idx(c, r)] === 1, h, T);
      if (facets.length) parts.push({ name: "erhaben-" + (++pn), color: window.hexToRgb(g.hex), facets });
    }
    return parts;
  }

  window.gridForBody = gridForBody;
  window.buildBaseParts = buildBaseParts;
  window.composeDesignV2 = composeDesignV2;
  window.buildEngravedParts = buildEngravedParts;
  window.buildMountRingParts = buildMountRingParts;
  window.buildRaisedParts = buildRaisedParts;
})();
