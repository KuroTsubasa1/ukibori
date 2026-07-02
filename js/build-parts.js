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

  // Compute the raster domain for a doc. Normally the body box {x0:0,y0:0,wMm:W,hMm:H}.
  // When mount.type==='loop' and the washer overhangs beyond the body box (per-side),
  // expand to the union bbox (washer + plate) with ~1mm pad on overhanging sides only.
  // Degenerate loop (ringThicknessMm<=0 or diameterMm<=0) falls back to body box.
  function docDomain(doc) {
    const W = doc.body.widthMm, H = doc.body.heightMm;
    const m = doc.mount;
    const PAD = 1.0; // mm of extra padding on expanded sides
    if (m && m.type === "loop" && (m.ringThicknessMm || 0) > 0 && (m.diameterMm || 0) > 0) {
      const outerR = m.diameterMm / 2 + m.ringThicknessMm;
      const cx = m.xMm, cy = m.yMm;
      // Washer bbox:
      const wx0 = cx - outerR, wx1 = cx + outerR;
      const wy0 = cy - outerR, wy1 = cy + outerR;
      // Only expand sides that actually overhang (beyond body box)
      const x0 = wx0 < 0 ? wx0 - PAD : 0;
      const y0 = wy0 < 0 ? wy0 - PAD : 0;
      const x1 = wx1 > W ? wx1 + PAD : W;
      const y1 = wy1 > H ? wy1 + PAD : H;
      // If no expansion happened, return the body box exactly
      if (x0 === 0 && y0 === 0 && x1 === W && y1 === H) {
        return { x0: 0, y0: 0, wMm: W, hMm: H };
      }
      return { x0, y0, wMm: x1 - x0, hMm: y1 - y0 };
    }
    return { x0: 0, y0: 0, wMm: W, hMm: H };
  }

  // Raster grid for an arbitrary domain. Same longest-side=resolution rule as gridForBody,
  // delegating to it so the default body-box path is provably identical.
  // Returns {cols, rows, pitch, x0, y0}.
  function gridForDomain(domain, resolution) {
    // Delegate by constructing a pseudo-body matching the domain dimensions
    const pseudoBody = { widthMm: domain.wMm, heightMm: domain.hMm };
    const { cols, rows, pitch } = gridForBody(pseudoBody, resolution);
    return { cols, rows, pitch, x0: domain.x0, y0: domain.y0 };
  }

  // Base plate: the body footprint (with the mount hole cut) extruded from z=0 to
  // body.thicknessMm, colored body.baseColor. The loop's raised ring is built
  // separately (later task).
  // grid: optional shared grid {cols,rows,pitch,x0,y0}; footprintArg: optional field.
  // If omitted, defaults to the body-box domain (byte-identical to prior behavior).
  function buildBaseParts(doc, grid, footprintArg) {
    const body = doc.body;
    const { cols, rows, pitch } = grid || gridForBody(body, doc.resolution);
    const field = footprintArg || window.shapeFootprintField(cols, rows, body, doc.mount);
    const inside = (c, r) => field(c, r) > 0;
    const facets = window.orientOutward(
      window.traceMaskToFacets(inside, cols, rows, pitch, body.thicknessMm, 0)
    );
    if (!facets.length) return [];
    return [{ name: "grundplatte", color: window.hexToRgb(body.baseColor), facets }];
  }

  // IIFE-local; intentionally distinct from bookmark-export.js's module-scope __hex/__ALPHA_CUTOFF (no collision).
  const __ALPHA_CUTOFF = 128;

  // Draw one element (translate/rotate + text/image) to a cols×rows canvas and
  // return its RGBA pixel data. Shared by __renderElementV2 (mask/color) and the
  // heightmap builder (luminance). Canvas ops are identical to the prior inline
  // version, so engraved parity is unaffected.
  // grid: optional {x0,y0,pitch} for expanded-domain mapping; default = body-box.
  function __drawElement(el, doc, cols, rows, grid) {
    // Map element mm coordinates to canvas pixels.
    // Default: sx=cols/W (body-box origin). With grid: origin is shifted by x0/y0.
    const pitch = grid ? grid.pitch : doc.body.widthMm / cols;
    const sx = 1 / pitch, sy = 1 / pitch;
    const ox = grid ? -grid.x0 * sx : 0;
    const oy = grid ? -grid.y0 * sy : 0;
    const cv = document.createElement("canvas"); cv.width = cols; cv.height = rows;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const w = el.wMm * sx, h = el.hMm * sy;
    ctx.save();
    ctx.translate(el.cxMm * sx + ox, el.cyMm * sy + oy);
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
    return ctx.getImageData(0, 0, cols, rows).data;
  }

  // v2 analogue of bookmark-export __renderElement: rasterize one element to a
  // cols×rows grid. mask[i]=1 where opaque; r/g/b per pixel. Reads el.depth.* for
  // mode/threshold/invert/reduce (v1 read el.colorMode/threshold/invert/reduce).
  // grid: optional shared grid for expanded-domain drawing.
  function __renderElementV2(el, doc, cols, rows, grid) {
    const d = __drawElement(el, doc, cols, rows, grid);
    const n = cols * rows;
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
    // Raised elements are colored "stamps" -> alpha-only silhouette. Engraved/default
    // images use the luminance threshold (a stencil), preserving bookmark parity.
    const raised = depth.direction === "raised";
    for (let i = 0; i < n; i++) {
      let on = d[i * 4 + 3] >= __ALPHA_CUTOFF;
      if (on && el.type === "image" && !raised) {
        const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        on = depth.invert ? lum >= thr : lum < thr;
      }
      if (on) { mask[i] = 1; r[i] = col[0]; g[i] = col[1]; b[i] = col[2]; }
    }
    return { mask, r, g, b };
  }

  // v2 analogue of bookmark-export composeDesign: composite elements (last = on
  // top) into per-pixel front color/depth/flags. Same return shape as composeDesign.
  // grid: optional shared grid for expanded-domain drawing.
  function composeDesignV2(doc, cols, rows, grid) {
    const n = cols * rows;
    const base = window.hexToRgb(doc.body.baseColor);
    const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
    const depthMm = new Float32Array(n), cutout = new Uint8Array(n), isBase = new Uint8Array(n);
    const owner = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) { r[i] = base[0]; g[i] = base[1]; b[i] = base[2]; depthMm[i] = doc.body.thicknessMm; isBase[i] = 1; }
    doc.elements.forEach((el, ei) => {
      if (el.type === "image" && !el._img) return;
      const layer = __renderElementV2(el, doc, cols, rows, grid);
      const eh = (el.depth && el.depth.heightMm) || 0;
      for (let i = 0; i < n; i++) {
        if (!layer.mask[i]) continue;
        r[i] = layer.r[i]; g[i] = layer.g[i]; b[i] = layer.b[i];
        depthMm[i] = eh; cutout[i] = el.cutout ? 1 : 0; isBase[i] = 0; owner[i] = ei;
      }
    });
    return { r, g, b, depthMm, cutout, isBase, owner };
  }

  // IIFE-local; intentionally distinct from bookmark-export.js's module-scope __hex/__ALPHA_CUTOFF (no collision).
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

  // Engraved base slab + risers + per-color recess floors, from a pre-composed grid.
  // (Body extracted verbatim from buildEngravedParts so a pure-engraved comp is
  // unchanged — parity preserved. buildParts feeds it a comp where non-engraved
  // pixels have been reclassified as base.)
  function __engravedBaseAndFloors(doc, comp, cols, rows, pitch, footprint) {
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

  function buildEngravedParts(doc, gridArg, footprintArg) {
    const grid = gridArg || gridForBody(doc.body, doc.resolution);
    const { cols, rows, pitch } = grid;
    const comp = composeDesignV2(doc, cols, rows, gridArg);
    const footprint = footprintArg || window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    return __engravedBaseAndFloors(doc, comp, cols, rows, pitch, footprint);
  }

  // Unified entry: base (recessed under engraved pixels, full-thickness elsewhere) +
  // engraved colored floors + raised prisms + heightmap slabs. Mount ring no longer
  // emitted (Öse is now a flat tab via footprint union on the expanded domain).
  // Handles rect/circle/free bodies.
  function buildParts(doc) {
    // Compute a single shared grid over the expanded domain (expanded only when the
    // Öse washer overhangs the body box; default = body box, byte-identical path).
    const domain = docDomain(doc);
    const grid = gridForDomain(domain, doc.resolution);
    const { cols, rows, pitch } = grid;

    const comp = composeDesignV2(doc, cols, rows, grid);
    const free = doc.body.shape === "free";

    // Determine whether the domain actually expanded beyond the body box.
    // An unexpanded domain has x0=y0=0 and the same dimensions as the body box.
    const domainExpanded = domain.x0 !== 0 || domain.y0 !== 0 ||
      domain.wMm !== doc.body.widthMm || domain.hMm !== doc.body.heightMm;

    // Build the composed footprint.
    // ONLY use the union (washer-expanded) path when the domain actually expanded.
    // When fully inside: degrade to the exact plain-hole path (spec decision 3).
    let footprint;
    const m = doc.mount;
    const isLoop = m && m.type === "loop" && (m.ringThicknessMm || 0) > 0 && (m.diameterMm || 0) > 0;
    if (free) {
      // Pass grid only for expanded domain; default branch uses rect-cell mapping.
      footprint = freeFootprintField(doc, cols, rows, pitch, domainExpanded ? grid : null);
    } else if (isLoop && domainExpanded) {
      // Expanded path: union plate SDF with washer disk SDF, then cut hole.
      const plateSdf = window.bodySdfMm(doc.body);
      const outerR = m.diameterMm / 2 + m.ringThicknessMm;
      const holeR = m.diameterMm / 2;
      const s = 1 / pitch;
      const x0 = grid.x0, y0 = grid.y0;
      footprint = (c, r) => {
        const x = x0 + (c + 0.5) * pitch, y = y0 + (r + 0.5) * pitch;
        const plate = plateSdf(x, y);
        const washer = outerR - Math.hypot(x - m.xMm, y - m.yMm);
        const unionDist = Math.max(plate, washer);       // inside plate OR washer
        const holeDist = Math.hypot(x - m.xMm, y - m.yMm) - holeR; // >0 outside hole
        return Math.min(unionDist, holeDist) * s;        // hole cut, cell units
      };
    } else {
      // Default path (no expansion, or degenerate loop): plain shapeFootprintField.
      // For a loop fully inside the body, this cuts the hole exactly like type='hole'.
      footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    }

    const isEngravedEi = (ei) => {
      const d = doc.elements[ei] && doc.elements[ei].depth;
      return !!(d && d.direction === "engraved" && d.mode !== "heightmap");
    };
    const base = window.hexToRgb(doc.body.baseColor);
    // depthMm and cutout are shared read-only (alias intentional; only r/g/b/isBase/owner are sliced because only they are rewritten).
    const engComp = {
      r: comp.r.slice(), g: comp.g.slice(), b: comp.b.slice(),
      depthMm: comp.depthMm, cutout: comp.cutout,
      isBase: comp.isBase.slice(), owner: comp.owner.slice(),
    };
    for (let i = 0; i < cols * rows; i++) {
      const ei = comp.owner[i];
      if (ei >= 0 && !isEngravedEi(ei)) {
        engComp.isBase[i] = 1; engComp.owner[i] = -1;
        engComp.r[i] = base[0]; engComp.g[i] = base[1]; engComp.b[i] = base[2];
      }
    }
    return [
      ...__engravedBaseAndFloors(doc, engComp, cols, rows, pitch, footprint),
      ...buildRaisedParts(doc, footprint, comp, grid),
      ...buildHeightmapParts(doc, footprint, grid),
      ...buildMountRingParts(doc),
    ];
  }

  // The loop (Öse) ring: formerly emitted a raised annulus rim.
  // Redesigned: the Öse is now a flat protruding tab (part of the base footprint).
  // This function returns [] for loop (no rim geometry); kept for API compat.
  function buildMountRingParts(doc) {
    return [];
  }

  // Raised element prisms: for depth.direction==='raised' elements, extrude their
  // colored regions UP from the base top face. Base plate is built separately.
  // Height: depth.heightMm for solid/text; (rank+1)*step per color for colorLayers.
  // Uses the shared composeDesignV2 rasterizer; a raised "colored stamp" that should
  // keep bright pixels uses a high depth.threshold (256 => alpha-only).
  function buildRaisedParts(doc, footprintArg, compArg, gridArg) {
    const grid = gridArg || gridForBody(doc.body, doc.resolution);
    const { cols, rows, pitch } = grid;
    const comp = compArg || composeDesignV2(doc, cols, rows, gridArg);
    const footprint = footprintArg || window.shapeFootprintField(cols, rows, doc.body, doc.mount);
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

    const groups = new Map(); // "ei|hex" -> {ei, hex, set}
    for (let i = 0; i < cols * rows; i++) {
      const ei = comp.owner[i];
      if (ei < 0 || comp.cutout[i]) continue;
      const el = doc.elements[ei];
      if (!(el.depth && el.depth.direction === "raised")) continue;
      const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
      const key = ei + "|" + hex;
      let g = groups.get(key); if (!g) groups.set(key, g = { ei, hex, set: new Uint8Array(cols * rows) });
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

  // Continuous brightness->height relief for depth.mode==='heightmap' elements:
  // a floor slab over the silhouette + K super-level slabs (region where brightness
  // >= k/K), each a flat extrusion. Prints identically to a smooth surface after
  // slicing. Single color (el.color); height from luminance.
  function buildHeightmapParts(doc, footprintArg, gridArg) {
    const grid = gridArg || gridForBody(doc.body, doc.resolution);
    const { cols, rows, pitch } = grid;
    const footprint = footprintArg || window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    const T = doc.body.thicknessMm, layerH = doc.body.layerHeightMm;
    const idx = (c, r) => r * cols + c;
    const tracedFacets = (member, thickness, z0) => window.orientOutward(
      window.traceMaskToFacets((c, r) => member(c, r) && footprint(c, r) > 0, cols, rows, pitch, thickness, z0));
    const parts = [];
    doc.elements.forEach((el, ei) => {
      const depth = el.depth || {};
      if (depth.mode !== "heightmap") return;
      if (el.type === "image" && !el._img) return;
      const d = __drawElement(el, doc, cols, rows, gridArg);
      const maxH = Math.max(layerH, depth.heightMm || 0);
      const baseFloor = Math.min(Math.max(depth.baseFloorMm || 0, layerH), maxH);
      const availH = Math.max(0, maxH - baseFloor);
      const invert = !!depth.invert;
      const col = window.hexToRgb(el.color);
      const n = cols * rows;
      const bright = new Float32Array(n), inRegion = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (d[i * 4 + 3] < 128) continue;
        let lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
        if (invert) lum = 1 - lum;
        bright[i] = lum; inRegion[i] = 1;
      }
      const floor = tracedFacets((c, r) => inRegion[idx(c, r)] === 1, baseFloor, T);
      if (floor.length) parts.push({ name: "hoehe-" + (ei + 1) + "-boden", color: col, facets: floor });
      const K = Math.max(0, Math.min(48, Math.round(availH / layerH)));
      const dz = K > 0 ? availH / K : 0;
      for (let k = 1; k <= K; k++) {
        const thr = k / K, z0 = T + baseFloor + (k - 1) * dz;
        const facets = tracedFacets((c, r) => inRegion[idx(c, r)] === 1 && bright[idx(c, r)] >= thr, dz, z0);
        if (facets.length) parts.push({ name: "hoehe-" + (ei + 1) + "-" + k, color: col, facets });
      }
    });
    return parts;
  }

  // Union of the elements' opaque silhouette on the grid (or just the element named
  // by body.freeOutlineFromElementId, if set). Uses __drawElement (alpha cutoff 128).
  // grid: optional shared grid for expanded-domain drawing.
  function __silhouetteMask(doc, cols, rows, grid) {
    const n = cols * rows, mask = new Uint8Array(n);
    const only = doc.body.freeOutlineFromElementId;
    doc.elements.forEach((el) => {
      if (only != null && el.id !== only) return;
      if (el.type === "image" && !el._img) return;
      const d = __drawElement(el, doc, cols, rows, grid);
      for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= 128) mask[i] = 1;
    });
    return mask;
  }

  // Two-pass chamfer distance transform: distance (in cells) to the nearest set
  // pixel. D1=1 (orthogonal), D2=sqrt(2) (diagonal) — near-Euclidean.
  function __chamferDT(mask, cols, rows) {
    const INF = 1e9, n = cols * rows, dist = new Float32Array(n);
    for (let i = 0; i < n; i++) dist[i] = mask[i] ? 0 : INF;
    const D1 = 1.0, D2 = Math.SQRT2, at = (c, r) => r * cols + c;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = at(c, r); let v = dist[i];
      if (r > 0) {
        v = Math.min(v, dist[at(c, r - 1)] + D1);
        if (c > 0) v = Math.min(v, dist[at(c - 1, r - 1)] + D2);
        if (c < cols - 1) v = Math.min(v, dist[at(c + 1, r - 1)] + D2);
      }
      if (c > 0) v = Math.min(v, dist[at(c - 1, r)] + D1);
      dist[i] = v;
    }
    for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
      const i = at(c, r); let v = dist[i];
      if (r < rows - 1) {
        v = Math.min(v, dist[at(c, r + 1)] + D1);
        if (c > 0) v = Math.min(v, dist[at(c - 1, r + 1)] + D2);
        if (c < cols - 1) v = Math.min(v, dist[at(c + 1, r + 1)] + D2);
      }
      if (c < cols - 1) v = Math.min(v, dist[at(c + 1, r)] + D1);
      dist[i] = v;
    }
    return dist;
  }

  // Free-outline footprint: the content silhouette dilated outward by body.borderMm
  // (the offset-margin border), with the mount hole cut. >0 inside the plate. Same
  // contract as shapeFootprintField (cell units, sign-based).
  // grid: optional shared {cols,rows,pitch,x0,y0} for an EXPANDED domain (washer
  // overhangs the body box). When grid is provided and the domain is expanded
  // (x0≠0 or y0≠0 or the domain differs from the body box), the washer is unioned
  // into the plate BEFORE the hole cut using square-pitch mapping on the shared grid.
  // When grid is absent or the domain equals the body box, the ORIGINAL rectangular-
  // cell mapping is used (sx=cols/W, sy=rows/H, s=(sx+sy)/2) — byte-identical to
  // pre-T1 behavior on the default path.
  function freeFootprintField(doc, cols, rows, pitch, grid) {
    const dt = __chamferDT(__silhouetteMask(doc, cols, rows, grid), cols, rows);
    const borderCells = (doc.body.borderMm || 0) / pitch;
    const idx = (c, r) => r * cols + c;
    const m = doc.mount || { type: "none" };
    const hasHole = m.type === "hole" || m.type === "loop";
    const holeR = hasHole ? (m.diameterMm || 0) / 2 : 0;
    const cx = hasHole ? m.xMm : 0, cy = hasHole ? m.yMm : 0;
    // Washer union only when called with an expanded shared grid (overhanging case).
    const hasWasher = grid && m.type === "loop" && (m.ringThicknessMm || 0) > 0 && (m.diameterMm || 0) > 0;
    const outerR = hasWasher ? m.diameterMm / 2 + m.ringThicknessMm : 0;

    if (grid) {
      // EXPANDED path: square-pitch mapping on the shared grid, washer unioned in.
      const s = 1 / pitch;
      const x0 = grid.x0, y0 = grid.y0;
      return (c, r) => {
        const x = x0 + (c + 0.5) * pitch, yy = y0 + (r + 0.5) * pitch;
        let v = borderCells - dt[idx(c, r)];            // >0 within borderCells of silhouette
        if (hasWasher) {
          const washerSdf = (outerR - Math.hypot(x - cx, yy - cy)) * s; // >0 inside washer disk
          v = Math.max(v, washerSdf);                   // union: inside plate OR inside washer
        }
        if (hasHole) {
          v = Math.min(v, (Math.hypot(x - cx, yy - cy) - holeR) * s); // hole cut
        }
        return v;
      };
    } else {
      // DEFAULT path: ORIGINAL rectangular-cell mapping (byte-identical to pre-T1).
      // sx/sy account for non-square cells; s=(sx+sy)/2 scales mm→cell-units.
      const sx = cols / doc.body.widthMm, sy = rows / doc.body.heightMm, s = (sx + sy) / 2;
      return (c, r) => {
        let v = borderCells - dt[idx(c, r)];            // >0 within borderCells of silhouette
        if (hasHole) {
          const x = (c + 0.5) / sx, y = (r + 0.5) / sy;
          v = Math.min(v, (Math.hypot(x - cx, y - cy) - holeR) * s); // hole cut
        }
        return v;
      };
    }
  }

  // Single public entry point for domain + footprint. Consumed by buildParts internally
  // and by T3's SVG. Returns {grid:{cols,rows,pitch,x0,y0}, footprint:(c,r)=>cellUnits}.
  // Non-loop docs return the body-box grid (x0=y0=0) and the standard shapeFootprintField.
  // Loop fully inside the body → degrades to shapeFootprintField (plain hole, spec decision 3).
  function docGridAndFootprint(doc) {
    const domain = docDomain(doc);
    const grid = gridForDomain(domain, doc.resolution);
    const { cols, rows, pitch } = grid;
    const m = doc.mount;
    const free = doc.body.shape === "free";
    const isLoop = m && m.type === "loop" && (m.ringThicknessMm || 0) > 0 && (m.diameterMm || 0) > 0;
    const domainExpanded = domain.x0 !== 0 || domain.y0 !== 0 ||
      domain.wMm !== doc.body.widthMm || domain.hMm !== doc.body.heightMm;
    let footprint;
    if (free) {
      // Pass grid only when domain expanded; default branch uses rect-cell mapping.
      footprint = freeFootprintField(doc, cols, rows, pitch, domainExpanded ? grid : null);
    } else if (isLoop && domainExpanded) {
      // Expanded path: washer overhangs body box — union SDF.
      const plateSdf = window.bodySdfMm(doc.body);
      const outerR = m.diameterMm / 2 + m.ringThicknessMm;
      const holeR = m.diameterMm / 2;
      const s = 1 / pitch;
      const x0 = grid.x0, y0 = grid.y0;
      footprint = (c, r) => {
        const x = x0 + (c + 0.5) * pitch, y = y0 + (r + 0.5) * pitch;
        const plate = plateSdf(x, y);
        const washer = outerR - Math.hypot(x - m.xMm, y - m.yMm);
        const unionDist = Math.max(plate, washer);
        const holeDist = Math.hypot(x - m.xMm, y - m.yMm) - holeR;
        return Math.min(unionDist, holeDist) * s;
      };
    } else {
      // Default / loop-fully-inside: plain shapeFootprintField (cuts hole for type='loop').
      footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    }
    return { grid, footprint };
  }

  window.gridForBody = gridForBody;
  window.docDomain = docDomain;
  window.gridForDomain = gridForDomain;
  window.docGridAndFootprint = docGridAndFootprint;
  window.buildBaseParts = buildBaseParts;
  window.composeDesignV2 = composeDesignV2;
  window.buildEngravedParts = buildEngravedParts;
  window.buildMountRingParts = buildMountRingParts;
  window.buildRaisedParts = buildRaisedParts;
  window.buildHeightmapParts = buildHeightmapParts;
  window.buildParts = buildParts;
  window.freeFootprintField = freeFootprintField;
})();
