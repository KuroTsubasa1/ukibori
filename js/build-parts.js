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
  // The element that defines a plate-free "Bild" object: body.freeOutlineFromElementId if set,
  // else the first image element, else the first element. null if the doc has no elements.
  function __bildElement(doc) {
    // Skip hidden elements so the 2D view (raw doc) and 3D/export (visibleDoc, which strips
    // _hidden) resolve the SAME defining element — otherwise hiding it silently resizes the object.
    const els = (doc.elements || []).filter(e => !e._hidden);
    const id = doc.body && doc.body.freeOutlineFromElementId;
    let el = id ? els.find(e => e.id === id) : null;
    return el || els.find(e => e.type === "image") || els[0] || null;
  }

  function docDomain(doc) {
    const W = doc.body.widthMm, H = doc.body.heightMm;
    const m = doc.mount;
    const PAD = 1.0; // mm of extra padding on expanded sides
    // Plate-free "Bild" object: the domain is the defining image element's rotated bounding box
    // (its rectangle IS the object). No plate box; mount/washer handled by the normal path below
    // once the image element defines the extent.
    if (doc.body.shape === "image") {
      const bel = __bildElement(doc);
      if (bel) {
        const cx = bel.cxMm, cy = bel.cyMm, hw = (bel.wMm || 0) / 2, hh = (bel.hMm || 0) / 2;
        const a = (bel.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const [ddx, ddy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
          const px = cx + ddx * ca - ddy * sa, py = cy + ddx * sa + ddy * ca;
          bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py);
        }
        return { x0: bx0, y0: by0, wMm: bx1 - bx0, hMm: by1 - by0 };
      }
    }
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

  // Editor-only: docDomain (the engine's plate/washer box) unioned with every visible
  // element's rotated bounding box + handle padding, so the 2D canvas grows to contain
  // transform handles. NOT used by the engine — docDomain stays the print source of truth.
  function viewportDomain(doc) {
    const base = docDomain(doc);
    let x0 = base.x0, y0 = base.y0, x1 = base.x0 + base.wMm, y1 = base.y0 + base.hMm;
    const PAD = 6; // mm — cushion so corner/rotate handles never sit on the canvas edge
    for (const el of (doc.elements || [])) {
      if (el._hidden) continue;
      const cx = el.cxMm, cy = el.cyMm, hw = (el.wMm || 0) / 2, hh = (el.hMm || 0) / 2;
      const a = (el.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
        const px = cx + dx * ca - dy * sa, py = cy + dx * sa + dy * ca;
        if (px - PAD < x0) x0 = px - PAD;
        if (py - PAD < y0) y0 = py - PAD;
        if (px + PAD > x1) x1 = px + PAD;
        if (py + PAD > y1) y1 = py + PAD;
      }
    }
    return { x0, y0, wMm: x1 - x0, hMm: y1 - y0 };
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
    // Default (no grid): per-axis body-box mapping — byte-identical to the
    // pre-domain code (sx=cols/W, sy=rows/H). With grid (expanded domain):
    // uniform square-pitch mapping, origin shifted by x0/y0.
    const sx = grid ? 1 / grid.pitch : cols / doc.body.widthMm;
    const sy = grid ? 1 / grid.pitch : rows / doc.body.heightMm;
    const ox = grid ? -grid.x0 * sx : 0;
    const oy = grid ? -grid.y0 * sy : 0;
    const cv = document.createElement("canvas"); cv.width = cols; cv.height = rows;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const w = el.wMm * sx, h = el.hMm * sy;
    ctx.save();
    ctx.translate(el.cxMm * sx + ox, el.cyMm * sy + oy);
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    if (el.flipH || el.flipV) ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1); // Spiegeln: element-local mirror
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
  //
  // Island removal (depth.minIsland > 0, image elements only, not heightmap):
  //   The engine raster resolution differs from the source image resolution, so the
  //   pixel threshold is scaled: the number of grid cells corresponding to one source
  //   image pixel squared is:
  //     cellsPerImagePixel = (el.wMm / pitch) / el._img.width
  //     minSizeCells = Math.round(depth.minIsland * cellsPerImagePixel^2)
  //   where pitch = doc.body.widthMm / cols. This preserves the user's intuition that
  //   "5 pixels" means 5 pixels in the source image regardless of engine resolution.
  //   Text elements (no source image) skip removal.
  function __renderElementV2(el, doc, cols, rows, grid) {
    const d = __drawElement(el, doc, cols, rows, grid);
    const n = cols * rows;
    const mask = new Uint8Array(n);
    const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
    const depth = el.depth || {};

    // Compute scaled minSizeCells for island removal (image elements only).
    // Guard: skip for text/qr (no source image), skip for heightmap (continuous surface).
    const islandPx = (depth.minIsland || 0);
    const doIsland = islandPx > 0 && el.type === "image" && el._img && depth.mode !== "heightmap";
    let minSizeCells = 0;
    if (doIsland) {
      // pitch: use grid.pitch when available (expanded domain), else derive from body width.
      const pitch = (grid && grid.pitch) ? grid.pitch : (doc.body.widthMm / cols);
      const cellsPerImagePixel = (el.wMm / pitch) / (el._img.naturalWidth || el._img.width || 1);
      minSizeCells = Math.round(islandPx * cellsPerImagePixel * cellsPerImagePixel);
    }

    if (el.type === "image" && depth.mode === "colorLayers" && el._img) {
      // AMS shared palette active (bands style + non-empty doc.amsPalette): snap each pixel to
      // the nearest shared filament color, bypassing the per-element palette/merges/remap.
      const useGlobalAms = colorStyleOf(el) === "bands" && doc && Array.isArray(doc.amsPalette) && doc.amsPalette.length > 0;
      if (useGlobalAms) {
        for (let i = 0; i < n; i++) {
          if (d[i * 4 + 3] < __ALPHA_CUTOFF) continue;
          const c = window.hexToRgb(window.nearestAmsColor(doc.amsPalette, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]));
          mask[i] = 1; r[i] = c[0]; g[i] = c[1]; b[i] = c[2];
        }
      } else {
        const red = depth.reduce || { method: "palette", numColors: 8, levels: 4, remap: {} };
        const pal = window.__imagePaletteFromImg(el._img, red.method, red.numColors, red.levels);
        const remap = red.remap || {};
        // Color merge: fold merged natural colors into their root, THEN apply the root's remap.
        // Empty/absent merges → mergeRoots = {} → root === nat → byte-identical to pre-merge.
        const mergeRoots = window.resolveMergeRoots ? window.resolveMergeRoots(red.merges) : {};
        const hx = (R, G, B) => ("#" + [R, G, B].map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
        for (let i = 0; i < n; i++) {
          if (d[i * 4 + 3] < __ALPHA_CUTOFF) continue;
          const near = window.__nearestColor(pal, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
          let cr = near[0], cg = near[1], cb = near[2];
          const nat = hx(cr, cg, cb);
          const root = mergeRoots[nat] || nat;
          const m = remap[root] || (root !== nat ? root : null);
          if (m) { const c = window.hexToRgb(m); cr = c[0]; cg = c[1]; cb = c[2]; }
          mask[i] = 1; r[i] = cr; g[i] = cg; b[i] = cb;
        }
      }
      if (doIsland && minSizeCells > 0) {
        // colorLayers island removal: build a flat-color RGBA from r/g/b, white for
        // mask-off pixels (old white-fill pattern), run removeSmallColorIslands, read
        // back r/g/b. Mask itself is unchanged (alpha/mask stays as-is).
        const islandData = new Uint8ClampedArray(n * 4);
        for (let i = 0; i < n; i++) {
          if (mask[i]) {
            islandData[i * 4] = r[i]; islandData[i * 4 + 1] = g[i]; islandData[i * 4 + 2] = b[i]; islandData[i * 4 + 3] = 255;
          } else {
            islandData[i * 4] = 255; islandData[i * 4 + 1] = 255; islandData[i * 4 + 2] = 255; islandData[i * 4 + 3] = 255;
          }
        }
        const islandImgData = { width: cols, height: rows, data: islandData };
        window.removeSmallColorIslands(islandImgData, minSizeCells);
        for (let i = 0; i < n; i++) {
          if (mask[i]) {
            r[i] = islandData[i * 4]; g[i] = islandData[i * 4 + 1]; b[i] = islandData[i * 4 + 2];
          }
        }
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
    if (doIsland && minSizeCells > 0) {
      // solid island removal: build a binary RGBA (mask-on=black, mask-off=white),
      // run removeSmallIslands, rebuild mask from result.
      const islandData = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) {
        const v = mask[i] ? 0 : 255;
        islandData[i * 4] = v; islandData[i * 4 + 1] = v; islandData[i * 4 + 2] = v; islandData[i * 4 + 3] = 255;
      }
      const islandImgData = { width: cols, height: rows, data: islandData };
      window.removeSmallIslands(islandImgData, minSizeCells);
      for (let i = 0; i < n; i++) {
        const nowOn = islandData[i * 4] === 0;
        mask[i] = nowOn ? 1 : 0;
        if (nowOn) { r[i] = col[0]; g[i] = col[1]; b[i] = col[2]; }
        else { r[i] = 0; g[i] = 0; b[i] = 0; }
      }
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

  // Resolve a colorLayers element's stacking style once, honoring the new
  // depth.colorLayerStyle field and falling back to the legacy depth.flush
  // (post-T13: flush=true meant bands). 'stepped' | 'flush' | 'bands'.
  function colorStyleOf(el) {
    const d = (el && el.depth) || {};
    return d.colorLayerStyle || (d.flush ? "bands" : "stepped");
  }

  // Engraved carve budget: color-floor slab thickness, solid base under the deepest
  // recess (user body.baseThicknessMm override, clamped to leave room for a color
  // floor, else auto-derived from the overall thickness), and the recess depth left
  // for color floors. Shared by __engravedBaseAndFloors and the auto-layer-height
  // preview (window.autoSolidHeightMm) so both see the same numbers.
  function __engravedBudget(body) {
    const T = body.thicknessMm, layerH = body.layerHeightMm;
    const floor = Math.min(2 * layerH, T);
    const autoMinBase = Math.min(Math.max(0.8, T * 0.34, 2 * layerH), Math.max(0, T - floor));
    const setBase = (body.baseThicknessMm || 0);
    const minBase = setBase > 0 ? Math.max(0, Math.min(setBase, T - floor)) : autoMinBase;
    const maxRecess = Math.max(0, T - floor - minBase);
    return { floor, minBase, maxRecess };
  }

  // --- Auto layer heights (Höhe je Farbe) -----------------------------------
  // When doc.autoLayerHeights is on, an Einfarbig (solid-mode) element's height
  // comes from its COLOR, AMS-style: elements sharing a color share one height;
  // distinct colors stack in steps of colorStepLayers*layerHeightMm. Colors
  // present in doc.amsPalette rank first (palette order = layer order), the
  // remaining colors follow in element stacking order (doc.elements[0] lowest).
  // An element in the base-plate color gets 0 — flush with the plate. A set
  // depth.heightOverrideMm wins over the derived height (null = auto; keeps its
  // color's rank so the other layers don't shift) and gets the same printability
  // clamp as depth.heightMm (0 = flush, else >= layerH). Elements that print
  // nothing (hidden, cutout holes, undecoded images) take no rank. Ranks are per
  // direction (raised and engraved stacks are independent); pass maxRecessMm on
  // the engraved path to compress the stack into the carve budget (like AMS
  // bands). Derived heights carry NO layerH floor so a compressed stack keeps
  // DISTINCT floors (uncompressed step is >= layerH anyway). Returns null when
  // the feature is off / not applicable → classic depth.heightMm behavior.
  // Ordered auto-layer colors for one direction: the FULL doc.amsPalette leads
  // the order — used or not — so a palette color sits at its ABSOLUTE slot,
  // identical to its layer in AMS Farbebenen images (unused slots print as
  // under-layers, exactly like the AMS image stack does for skipped layers).
  // Non-palette colors follow in element stacking order (doc.elements[0]
  // lowest). Base-colored and non-printing (hidden / cutout / undecoded-image)
  // elements take no extra slot. UPPERCASE hexes.
  function __autoSolidOrder(doc, dir) {
    const baseHex = String(doc.body.baseColor || "").toUpperCase();
    const ams = Array.isArray(doc.amsPalette) ? doc.amsPalette : [];
    const rest = [];
    for (const e of doc.elements) {
      if (!e || !e.depth || e.depth.mode !== "solid" || e._hidden || e.cutout) continue;
      if (e.type === "image" && !e._img) continue; // undecoded image prints nothing
      if ((e.depth.direction || "raised") !== dir) continue;
      const h = String(e.color || "").toUpperCase();
      if (!h || h === baseHex) continue;
      if (ams.indexOf(h) === -1 && rest.indexOf(h) === -1) rest.push(h);
    }
    const order = ams.concat(rest);
    // Deckschicht (top layer): the doc-level cover color always takes rank 0 — the
    // workpiece's face (engraved: topmost plate band; raised: full-face slab) — and
    // pushes element colors one step further. Ignored when it matches the base color
    // (the plate face already IS that color).
    const top = doc.topLayerColor ? String(doc.topLayerColor).toUpperCase() : null;
    if (top && top !== baseHex) {
      const i = order.indexOf(top);
      if (i !== -1) order.splice(i, 1);
      order.unshift(top);
    }
    return order;
  }

  function __autoSolidHeight(doc, el, maxRecessMm, ignoreOverride) {
    if (!doc.autoLayerHeights) return null;
    if (!el || !el.depth || el.depth.mode !== "solid") return null;
    const layerH = doc.body.layerHeightMm;
    if (!ignoreOverride && el.depth.heightOverrideMm != null) {
      const ov = el.depth.heightOverrideMm;
      return ov <= 0 ? 0 : Math.max(ov, layerH);
    }
    const baseHex = String(doc.body.baseColor || "").toUpperCase();
    const hex = String(el.color || "").toUpperCase();
    if (hex === baseHex) {
      // Flush with the plate FACE. On engraved plates a valid Deckschicht IS the
      // face — base-colored elements then carve through it and rest one band down,
      // level with the base band under the deck. (Raised decks need no depth: the
      // punch-through hole already exposes the plate one band below the deck.)
      const top = doc.topLayerColor ? String(doc.topLayerColor).toUpperCase() : null;
      if (!(top && top !== baseHex) || (el.depth.direction || "raised") !== "engraved") return 0;
      const ord = __autoSolidOrder(doc, "engraved");
      let s = Math.max(1, doc.colorStepLayers || 2) * layerH;
      if (maxRecessMm != null && ord.length > 0) s = Math.min(s, maxRecessMm / ord.length);
      return s;
    }
    const order = __autoSolidOrder(doc, el.depth.direction || "raised");
    const rank = order.indexOf(hex);
    if (rank < 0) return null; // element itself prints nothing (hidden/cutout/undecoded)
    let step = Math.max(1, doc.colorStepLayers || 2) * layerH;
    if (maxRecessMm != null && order.length > 0) step = Math.min(step, maxRecessMm / order.length);
    return (rank + 1) * step;
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
  // band: optional Rand-Rahmen mask (see __frameBand). Ring wins: band cells emit
  // no color floors/recesses — they are treated as full-height base instead (the
  // "rand" part sits on top of them). band == null => byte-identical to pre-band code.
  function __engravedBaseAndFloors(doc, comp, cols, rows, pitch, footprint, band) {
    const T = doc.body.thicknessMm, layerH = doc.body.layerHeightMm;
    const baseHex = doc.body.baseColor.toUpperCase();
    const idx = (c, r) => r * cols + c;
    const inBand = band ? ((i) => band[i] === 1) : (() => false);
    const colorParts = [], baseParts = [];
    const tracedFacets = (member, thickness, z0) => window.orientOutward(
      window.traceMaskToFacets((c, r) => member(c, r) && footprint(c, r) > 0, cols, rows, pitch, thickness, z0));

    const { floor, minBase, maxRecess } = __engravedBudget(doc.body);
    const recessOf = (d) => Math.max(0, Math.min(d, maxRecess));
    const baseUnder = (d) => T - recessOf(d) - floor;

    const step = Math.max(1, doc.colorStepLayers || 2) * layerH;

    // T14 dispatch: colorLayers elements with style 'flush' or 'bands' are handled by
    // dedicated per-element passes below. Their pixels are EXCLUDED from the global
    // stepped machinery so the stepped/solid/text path stays byte-identical (parity).
    // (When no element is flush/bands, `special` is empty → nothing changes.)
    const special = new Set(); // ei of colorLayers elements needing flush/bands treatment
    doc.elements.forEach((el, ei) => {
      if (el.type === "image" && el.depth && el.depth.mode === "colorLayers") {
        const s = colorStyleOf(el);
        if (s === "flush" || s === "bands") special.add(ei);
      }
    });
    const isSpecial = (i) => special.has(comp.owner[i]);

    // Per-element recess depth: solid/text recess by the element's relief height (depth.heightMm);
    // stepped colorLayers split that height evenly across their colors (topmost color = full
    // height). Depth is per element, so each element's relief height is independent of the others.
    const depthForOwnerHex = (ei, hex) => {
      const el = doc.elements[ei];
      // Auto layer heights: Einfarbig recess derived from the element's color,
      // stack compressed into the carve budget (maxRecess) like AMS bands.
      const autoD = __autoSolidHeight(doc, el, maxRecess);
      if (autoD != null) return autoD;
      const hm = (el && el.depth && el.depth.heightMm != null) ? el.depth.heightMm : layerH;
      const h = hm <= 0 ? 0 : Math.max(hm, layerH); // Relief-Höhe 0 = no recess (off)
      if (h <= 0) return 0;
      if (el && el.depth && el.depth.mode === "colorLayers") {
        const remap = (el.depth.reduce && el.depth.reduce.remap) || {};
        const seq = __orderedNaturalHexesV2(el).map(nat => { const c = window.hexToRgb(remap[nat] || nat); return __hex(c[0], c[1], c[2]); });
        const N = seq.length || 1;
        const rank = seq.indexOf(hex); const r = rank < 0 ? 0 : rank;
        // Each rank is at least one printed layer (printable), but the whole stack is compressed
        // into the plate's carve budget so deep palettes stay distinct instead of clamping onto
        // one floor. maxRecess === 0 (base fills the plate) → 0 depth (graceful, no recess).
        const perRank = Math.min(Math.max(layerH, h / N), maxRecess / N);
        return (r + 1) * perRank;
      }
      return h;
    };

    let cn = 0;
    const addFloor = (member, hex, depthMm) => {
      const facets = tracedFacets(member, floor, baseUnder(depthMm));
      if (facets.length) colorParts.push({ name: "farbe-" + (++cn), color: window.hexToRgb(hex), facets });
    };

    // --- Stepped/solid/text color floors. Grouped per (element, color) so each element recesses
    // by its OWN relief height (depthForOwnerHex), independent of the others. ---
    const groups = new Map(); // "ei|hex" -> {ei, hex, set}
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (comp.isBase[i] || comp.cutout[i] || inBand(i) || isSpecial(i)) continue;
      const ei = comp.owner[i];
      const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
      const key = ei + "|" + hex;
      let grp = groups.get(key); if (!grp) groups.set(key, grp = { ei, hex, set: new Uint8Array(cols * rows) });
      grp.set[i] = 1;
    }
    for (const grp of groups.values()) {
      addFloor((c, r) => grp.set[idx(c, r)] === 1, grp.hex, depthForOwnerHex(grp.ei, grp.hex));
    }

    // --- flush / bands color floors (per-element). ---
    // effDepth[i] = the DEEPEST floor recess depth at pixel i (used for base-fill-behind).
    // For special pixels it is set here; for stepped pixels it stays depthFor(hex) below.
    const effDepth = new Float32Array(cols * rows);
    // Global luminance helper + collector of the effective (remap-applied) band colors across
    // all engraved 'bands' elements — used below to split the surrounding plate into AMS bands.
    const lumHex = (hex) => { const c = window.hexToRgb(hex); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
    const bandHexSet = new Set();
    let bandsElemCount = 0;
    // AMS shared palette: when set, a color's layer index (and thus depth) is its position in the
    // global palette, so the same color lands at the same depth across every element.
    const ams = (Array.isArray(doc.amsPalette) && doc.amsPalette.length) ? doc.amsPalette : null;
    const amsRank = ams ? ((hex) => { const i = ams.indexOf(hex); return i < 0 ? ams.length - 1 : i; }) : null;
    // Deckschicht on the shared palette: the deck color becomes the topmost plate band
    // and every palette layer carves ONE STEP DEEPER (through the deck). The deck also
    // counts in the carve-budget compression. Motif pixels never quantize to the deck
    // color — it is the workpiece's face, not a palette slot.
    const deckHexE = doc.topLayerColor ? String(doc.topLayerColor).toUpperCase() : null;
    const deckShiftE = (deckHexE && deckHexE !== baseHex && ams) ? 1 : 0;
    // Compress the per-layer step so the whole palette fits the plate's carve budget — deep
    // palettes then keep DISTINCT floors instead of clamping several layers onto one depth.
    const amsStep = ams ? Math.min(step, maxRecess / (ams.length + deckShiftE)) : step;
    for (const ei of special) {
      const el = doc.elements[ei];
      const style = colorStyleOf(el);
      // Element's per-color ordered hexes (natural palette order, remap applied).
      const remap = (el.depth.reduce && el.depth.reduce.remap) || {};
      const elemHexes = __orderedNaturalHexesV2(el).map(nat => { const c = window.hexToRgb(remap[nat] || nat); return __hex(c[0], c[1], c[2]); });
      // Restrict to hexes actually present in this element's pixels, preserving order.
      const presentSets = new Map(); // hex -> Uint8Array
      for (let i = 0; i < cols * rows; i++) {
        if (comp.owner[i] !== ei || comp.isBase[i] || comp.cutout[i] || inBand(i)) continue;
        const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
        let set = presentSets.get(hex); if (!set) presentSets.set(hex, set = new Uint8Array(cols * rows));
        set[i] = 1;
      }
      const orderedPresent = elemHexes.filter(h => presentSets.has(h));
      for (const h of presentSets.keys()) if (orderedPresent.indexOf(h) === -1) orderedPresent.push(h);

      if (style === "flush") {
        // Every color of the element recessed to ONE depth (step) → one flat inlay level.
        for (const hex of orderedPresent) {
          const set = presentSets.get(hex);
          addFloor((c, r) => set[idx(c, r)] === 1, hex, step);
        }
        for (let i = 0; i < cols * rows; i++) if (comp.owner[i] === ei && !comp.isBase[i] && !comp.cutout[i] && !inBand(i)) effDepth[i] = step;
      } else {
        // bands (AMS), engraved = downward mirror of raised bands. Sort colors by
        // luminance ASCENDING (rank 1 = darkest). region(rank k) = union of ranks <= k,
        // depth = k*step. So each pixel's OWN color is the SHALLOWEST floor covering it
        // (visible from the top); deeper floors are the lighter colors nested beneath.
        // Emit DEEPEST first (largest region) so shallower nested floors sit inside.
        // Order colors by LAYER INDEX: global amsPalette index when the shared palette is active
        // (so a color sits at the same depth in every element), else per-element luminance.
        const sorted = orderedPresent.slice().sort((a, b) => ams ? amsRank(a) - amsRank(b) : lumHex(a) - lumHex(b));
        sorted.forEach(h => bandHexSet.add(h)); // contribute to the AMS base-band palette
        bandsElemCount++;
        const N = sorted.length;
        const n = cols * rows;
        // depth of the color at sorted position k: global (amsRank+1)*step, else per-element (k+1)*step.
        // deckShiftE: with a Deckschicht, every palette layer carves one step deeper (through the deck).
        const depthOfPos = (k) => ams ? (amsRank(sorted[k]) + 1 + deckShiftE) * amsStep : (k + 1) * step;
        // cumUpTo[k] = union of pixels of the colors at sorted positions 0..k (layer index <= this).
        const cumUpTo = new Array(N);
        cumUpTo[0] = presentSets.get(sorted[0]);
        for (let k = 1; k < N; k++) {
          const u = new Uint8Array(n), prev = cumUpTo[k - 1], own = presentSets.get(sorted[k]);
          for (let i = 0; i < n; i++) u[i] = prev[i] | own[i];
          cumUpTo[k] = u;
        }
        // Deepest first: the highest-index present color has the largest region (all) + deepest floor.
        for (let k = N - 1; k >= 0; k--) {
          const region = cumUpTo[k];
          addFloor((c, r) => region[idx(c, r)] === 1, sorted[k], depthOfPos(k));
        }
        // Base beneath a pixel reaches the deepest floor covering it = the deepest present color.
        const deepest = depthOfPos(N - 1);
        for (let i = 0; i < cols * rows; i++) {
          if (comp.owner[i] !== ei || comp.isBase[i] || comp.cutout[i] || inBand(i)) continue;
          effDepth[i] = deepest;
        }
      }
    }

    const baseAdd = (member, thickness, z0) => {
      const facets = tracedFacets(member, thickness, z0);
      if (facets.length) baseParts.push({ name: "grundplatte", color: window.hexToRgb(baseHex), facets });
    };
    baseAdd((c, r) => comp.cutout[idx(c, r)] !== 1, minBase, 0);
    // Surrounding plate = base cells + Rand-Rahmen band cells (ring wins; band never has cutouts).
    // AMS engraved-bands change request: when any engraved element uses the bands style, split
    // this surrounding plate into horizontal color bands matching the inlay — one filament color
    // per printed layer across the whole piece. Darkest on top (the carve reveals darkest
    // shallowest), lightest at the bottom of the stack; below the deepest band the interior stays
    // base color. No bands element → single full-height base slab (byte-identical parity).
    const surroundMember = (c, r) => { const i = idx(c, r); return comp.isBase[i] === 1 || inBand(i); };
    // Split the plate only when EXACTLY ONE engraved element uses bands — its palette then maps
    // 1:1 onto its own inlay. Multiple bands elements with distinct palettes are ambiguous (a
    // global sort/count would carve deeper than any single inlay), so fall back to a plain base.
    // AMS shared palette → band the base with the FULL palette in layer order (multi-element safe).
    // No shared palette → legacy: only band for a single bands element (else plain base).
    // Band the base ONLY when an engraved bands element is actually present in this build — a
    // lingering (populated-but-unused) amsPalette must NOT stripe the plate of a non-AMS design.
    // amsSolidBase keeps the surrounding plate one solid base color (only the inlay is multicolor).
    let bandHexes = (doc.amsSolidBase || bandsElemCount === 0)
      ? []
      : (ams ? (deckShiftE ? [deckHexE].concat(ams) : ams.slice())
             : (bandsElemCount === 1 ? [...bandHexSet].sort((a, b) => lumHex(a) - lumHex(b)) : []));
    // Auto layer heights (Höhe je Farbe): engraved Einfarbig elements split the plate
    // the same way — the whole workpiece becomes solid single-color layers. The FACE
    // of the plate is band 1 and stays the BASE color: base-colored elements are
    // flush with it, so the surface prints as ONE solid base-colored layer; rank-k
    // colors band one step further down, where their carve floors actually sit.
    // (Without the base band, the rank-0 color capped the plate while flush elements
    // stayed base-colored — a two-color top layer, and a base-colored Deckschicht
    // seemed to "vanish".) A valid (non-base) Deckschicht replaces the face — it
    // already leads the order, so no base band is prepended then. Only when no
    // colorLayers-bands element is in the build (those keep the AMS palette above),
    // and only if at least one auto-ranked engraved solid element actually prints
    // (a manual heightOverrideMm opts an element out; its color still holds its rank).
    if (!bandHexes.length && doc.autoLayerHeights && !doc.amsSolidBase && bandsElemCount === 0) {
      const order = __autoSolidOrder(doc, "engraved");
      const deckValidE = !!(deckHexE && deckHexE !== baseHex);
      const hasParticipant = order.length && doc.elements.some((e) => {
        if (!e || !e.depth || e.depth.mode !== "solid" || e._hidden || e.cutout) return false;
        if (e.type === "image" && !e._img) return false;
        if ((e.depth.direction || "raised") !== "engraved") return false;
        if (e.depth.heightOverrideMm != null) return false;
        const h = String(e.color || "").toUpperCase();
        // base-colored elements participate when a deck exists (they carve through it)
        return order.indexOf(h) !== -1 || (deckValidE && h === baseHex);
      });
      if (hasParticipant) {
        // Valid deck = band 1 (the face); the BASE band sits directly below it —
        // base-colored elements carve through the deck and level with that band.
        bandHexes = deckValidE ? [order[0], baseHex].concat(order.slice(1)) : [baseHex].concat(order);
      }
    }
    if (bandHexes.length > 0) {
      const N = bandHexes.length;
      const avail = Math.max(0, T - minBase);
      const bandThick = Math.min(step, avail / N); // compress to fit; never silently drop a color
      const interiorTop = T - N * bandThick;
      // The Rand-Rahmen understructure bands together with the interior — the border is
      // part of the workpiece, so its printed layers stay one solid color too (the frame
      // cap in frame.color still sits on top of it, above T).
      if (interiorTop - minBase > 1e-6) baseAdd(surroundMember, interiorTop - minBase, minBase); // base below the bands
      // Rank k (1=darkest .. N=lightest) occupies [T-k*bandThick, T-(k-1)*bandThick].
      for (let k = N; k >= 1; k--) {
        const zBot = T - k * bandThick;
        if (bandThick <= 1e-6) continue;
        const facets = tracedFacets(surroundMember, bandThick, zBot);
        if (facets.length) baseParts.push({ name: "grundplatte-band-" + k, color: window.hexToRgb(bandHexes[k - 1]), facets });
      }
    } else {
      baseAdd(surroundMember, T - minBase, minBase);
    }
    const behind = new Map();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (comp.cutout[i] || comp.isBase[i] || inBand(i)) continue;
      // Fill the base beneath the DEEPEST floor at this pixel down to minBase.
      // Stepped/solid/text: per-element depth. flush/bands: effDepth[i] set above.
      const d = isSpecial(i) ? effDepth[i] : depthForOwnerHex(comp.owner[i], __hex(comp.r[i], comp.g[i], comp.b[i]));
      const h = baseUnder(d);
      if (h - minBase <= 1e-6) continue;
      const key = h.toFixed(4);
      let set = behind.get(key); if (!set) behind.set(key, set = { h, m: new Uint8Array(cols * rows) });
      set.m[i] = 1;
    }
    for (const set of behind.values()) baseAdd((c, r) => set.m[idx(c, r)] === 1, set.h - minBase, minBase);

    return [...baseParts, ...colorParts];
  }

  function buildEngravedParts(doc, gridArg, footprintArg, band) {
    const grid = gridArg || gridForBody(doc.body, doc.resolution);
    const { cols, rows, pitch } = grid;
    const comp = composeDesignV2(doc, cols, rows, gridArg);
    const footprint = footprintArg || window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    return __engravedBaseAndFloors(doc, comp, cols, rows, pitch, footprint, band);
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
    const image = doc.body.shape === "image";

    // Determine whether the domain actually expanded beyond the body box.
    // An unexpanded domain has x0=y0=0 and the same dimensions as the body box.
    const domainExpanded = domain.x0 !== 0 || domain.y0 !== 0 ||
      domain.wMm !== doc.body.widthMm || domain.hMm !== doc.body.heightMm;

    // Build the composed footprint.
    // The washer union fires for EVERY loop doc (amended 2026-07-02):
    //   - Expanded path: square-pitch grid mapping (washer overhangs the body box).
    //   - Default rect/circle path: rectangular-cell mapping (sx=cols/W, sy=rows/H);
    //     compose via lattice identity min(max(p,w),h)=max(min(p,h),min(w,h)), i.e.
    //     max(shapeFootprintField_output, min(washerSdf, holeSdf)*s) — geometry.js untouched.
    //   - Default free path: handled in freeFootprintField (washer union always active).
    // Parity: when washer ⊆ plate, max() never flips sign — loop-inside==hole holds.
    let footprint;
    const m = doc.mount;
    const isLoop = m && m.type === "loop" && (m.ringThicknessMm || 0) > 0 && (m.diameterMm || 0) > 0;
    if (image) {
      // Plate-free Bild object: footprint = the defining image element's rectangle.
      footprint = imageFootprintField(doc, cols, rows, pitch, grid);
    } else if (free) {
      // Pass grid only for expanded domain; default branch handles washer union itself.
      footprint = freeFootprintField(doc, cols, rows, pitch, domainExpanded ? grid : null);
    } else if (isLoop && domainExpanded) {
      // Expanded path: square-pitch mapping; washer union + hole cut in one closure.
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
    } else if (isLoop) {
      // Default path (unexpanded), non-free: washer union via lattice identity.
      // shapeFootprintField already encodes A = min(plate, holeSdf)*s with rect mapping.
      // Compose: max(A(c,r), min(washerSdf, holeSdf)*s) — identical to min(max(plate,washer),holeSdf)*s.
      const A = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
      const W = doc.body.widthMm, H = doc.body.heightMm;
      const sx = cols / W, sy = rows / H, s = (sx + sy) / 2;
      const outerR = m.diameterMm / 2 + m.ringThicknessMm;
      const holeR = m.diameterMm / 2;
      footprint = (c, r) => {
        const x = (c + 0.5) / sx, y = (r + 0.5) / sy;
        const washerSdf = outerR - Math.hypot(x - m.xMm, y - m.yMm); // >0 inside washer disk
        const holeSdf = Math.hypot(x - m.xMm, y - m.yMm) - holeR;    // >0 outside hole
        return Math.max(A(c, r), Math.min(washerSdf, holeSdf) * s);   // lattice union
      };
    } else {
      // Default path (no expansion, degenerate/no loop): plain shapeFootprintField.
      footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    }

    // Rand-Rahmen band (rect/circle only; frame.widthMm > 0): footprint cells whose
    // center lies within frame.widthMm of the plate edge (plate SDF <= widthMm).
    // Cell-center mm mapping matches the footprint's own mapping (expanded: square
    // pitch with x0/y0 shift; default: rectangular cells sx=cols/W, sy=rows/H).
    // "Ring wins": band cells are excluded from content parts (band passed down);
    // element cutout holes win over the ring (cutout cells never join the band).
    // band === null => frame off => all content builders byte-identical (parity).
    const band = __frameBand(doc, grid, footprint, comp, domainExpanded);

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
      ...__engravedBaseAndFloors(doc, engComp, cols, rows, pitch, footprint, band),
      ...buildRaisedParts(doc, footprint, comp, grid, band),
      ...buildHeightmapParts(doc, footprint, grid, band),
      ...buildFrameParts(doc, band, cols, rows, pitch),
      ...buildMountRingParts(doc),
    ];
  }

  // Compute the Rand-Rahmen band mask (Uint8Array[cols*rows], 1 = band cell), or
  // null when the frame is off (body.frame absent, widthMm <= 0, heightMm <= 0,
  // or free body).
  // band(c,r) = footprint(c,r) > 0 && plateSdfMm(x,y) <= frame.widthMm && !cutout.
  function __frameBand(doc, grid, footprint, comp, domainExpanded) {
    const frame = doc.body.frame;
    if (doc.body.shape === "image" || !frame || !((frame.widthMm || 0) > 0)) return null;
    // heightMm <= 0 emits no "rand" part, so the frame must be FULLY off (no band
    // either) — otherwise content in the band is silently swallowed with nothing
    // added (review finding).
    if (!((frame.heightMm || 0) > 0)) return null;
    const { cols, rows, pitch } = grid;
    const sx = cols / doc.body.widthMm, sy = rows / doc.body.heightMm;
    const band = new Uint8Array(cols * rows);

    if (doc.body.shape === "free") {
      // Free outline: no analytic SDF — measure the depth inside the plate with a
      // chamfer DT seeded on the OUTSIDE cells; band = within frame.widthMm of the
      // outer edge. (The border-capped footprint field can't be used directly: its
      // values saturate at borderMm, so widthMm >= borderMm would swallow the whole
      // silhouette.) The mount hole counts as INSIDE for the distance — like the
      // rect/circle analytic SDF, the frame hugs the outer rim only and never rings
      // the hole; band cells still require footprint>0, so the hole itself is clear.
      const m = doc.mount || { type: "none" };
      const hasHole = m.type === "hole" || m.type === "loop";
      const holeR = hasHole ? (m.diameterMm || 0) / 2 : 0;
      const outside = new Uint8Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (footprint(c, r) > 0) continue;
        if (hasHole) {
          const x = domainExpanded ? grid.x0 + (c + 0.5) * pitch : (c + 0.5) / sx;
          const y = domainExpanded ? grid.y0 + (r + 0.5) * pitch : (r + 0.5) / sy;
          if (Math.hypot(x - m.xMm, y - m.yMm) <= holeR + pitch) continue; // hole ≠ outside
        }
        outside[r * cols + c] = 1;
      }
      const depth = __chamferDT(outside, cols, rows); // cells to the outer edge
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (comp && comp.cutout[i]) continue;        // cutout holes win over the ring
        if (!(footprint(c, r) > 0)) continue;
        if (depth[i] * pitch <= frame.widthMm) band[i] = 1;
      }
      return band;
    }

    const plateSdfMm = window.bodySdfMm(doc.body);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (comp && comp.cutout[i]) continue;        // cutout holes win over the ring
      if (!(footprint(c, r) > 0)) continue;        // respects mount hole + Öse tab
      const x = domainExpanded ? grid.x0 + (c + 0.5) * pitch : (c + 0.5) / sx;
      const y = domainExpanded ? grid.y0 + (r + 0.5) * pitch : (r + 0.5) / sy;
      if (plateSdfMm(x, y) <= frame.widthMm) band[i] = 1;
    }
    return band;
  }

  // The Rand-Rahmen part: the band extruded from the base top face (thicknessMm)
  // up by frame.heightMm, in frame.color. Emitted as a single "rand" part.
  function buildFrameParts(doc, band, cols, rows, pitch) {
    if (!band) return [];
    const frame = doc.body.frame;
    if (!((frame.heightMm || 0) > 0)) return [];   // no degenerate zero-height solid
    const facets = window.orientOutward(window.traceMaskToFacets(
      (c, r) => band[r * cols + c] === 1, cols, rows, pitch, frame.heightMm, doc.body.thicknessMm));
    if (!facets.length) return [];
    return [{ name: "rand", color: window.hexToRgb(frame.color), facets }];
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
  // depth.flush===true (Farbschichten/AMS): stacked height bands instead of side-by-side
  // prisms — each reduced color occupies its own z-range [T+(k-1)*step, T+k*step], ordered
  // dark->light bottom->top. Top face of every pixel = its own color. Enables >4 colors
  // with AMS (one filament swap per band boundary). Non-flush + solid/text: UNCHANGED.
  // band: optional Rand-Rahmen mask; band cells are skipped (ring wins).
  function buildRaisedParts(doc, footprintArg, compArg, gridArg, band) {
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
      // Auto layer heights: Einfarbig height derived from the element's color
      // (override/printability clamps applied inside; base color = 0 = flush).
      const autoH = __autoSolidHeight(doc, el, null);
      if (autoH != null) return autoH;
      const hm = (el.depth && el.depth.heightMm != null) ? el.depth.heightMm : layerH;
      const h = hm <= 0 ? 0 : Math.max(hm, layerH); // Relief-Höhe 0 = no relief (off)
      if (el.depth && el.depth.mode === "colorLayers") {
        // flush (Eine Fläche): every color spans [T, T+step] → one flat surface.
        if (colorStyleOf(el) === "flush") return step;
        if (h <= 0) return 0;
        // stepped: colors split the relief height evenly (topmost color reaches heightMm).
        const remap = (el.depth.reduce && el.depth.reduce.remap) || {};
        const seq = __orderedNaturalHexesV2(el).map(nat => { const c = window.hexToRgb(remap[nat] || nat); return __hex(c[0], c[1], c[2]); });
        const N = seq.length || 1;
        const rank = seq.indexOf(hex); const r = rank < 0 ? 0 : rank;
        // Each color layer is at least one printed layer thick (raised builds up freely, so no
        // upper cap); topmost color reaches ~heightMm when heightMm/N ≥ layerH.
        const perRank = Math.max(layerH, h / N);
        return (r + 1) * perRank;
      }
      return h;
    };

    // Luminance of a #RRGGBB hex string (0-255 scale, BT.601).
    const hexLum = (hex) => { const c = window.hexToRgb(hex); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
    // AMS shared palette: a color's height layer = its global palette index (shared across elements).
    const ams = (Array.isArray(doc.amsPalette) && doc.amsPalette.length) ? doc.amsPalette : null;
    const amsRankR = ams ? ((hex) => { const i = ams.indexOf(hex); return i < 0 ? ams.length - 1 : i; }) : null;

    const groups = new Map(); // "ei|hex" -> {ei, hex, set}
    for (let i = 0; i < cols * rows; i++) {
      const ei = comp.owner[i];
      if (ei < 0 || comp.cutout[i] || (band && band[i] === 1)) continue;
      const el = doc.elements[ei];
      if (!(el.depth && el.depth.direction === "raised")) continue;
      const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
      const key = ei + "|" + hex;
      let g = groups.get(key); if (!g) groups.set(key, g = { ei, hex, set: new Uint8Array(cols * rows) });
      g.set[i] = 1;
    }

    const parts = []; let pn = 0;

    // Partition groups by element index.
    const byElem = new Map(); // ei -> [{hex, set}]
    for (const g of groups.values()) {
      let arr = byElem.get(g.ei); if (!arr) byElem.set(g.ei, arr = []);
      arr.push({ hex: g.hex, set: g.set });
    }

    // --- Auto layer heights (Höhe je Farbe): ONE global banded stack --------
    // Like the AMS filament stack below: level L is a full slab
    // [T+L*step, T+(L+1)*step] colored autoOrder[L] over every participating
    // pixel whose element color ranks >= L — so each printed layer is a single
    // solid color across the whole piece, lower colors running through under
    // higher ones. Elements with a manual heightOverrideMm keep their classic
    // own-color prism below (their color still holds its rank, so the other
    // layers don't shift); base-colored elements own their pixels but appear in
    // no band region — they punch through the stack down to the plate.
    const autoOrder = doc.autoLayerHeights ? __autoSolidOrder(doc, "raised") : [];
    const autoRank = new Map(); // ei -> rank, banded participants only
    if (autoOrder.length) {
      doc.elements.forEach((el, ei) => {
        if (!el || !el.depth || el.depth.mode !== "solid" || el._hidden || el.cutout) return;
        if (el.type === "image" && !el._img) return;
        if ((el.depth.direction || "raised") !== "raised") return;
        if (el.depth.heightOverrideMm != null) return; // manual height → own prism
        const r = autoOrder.indexOf(String(el.color || "").toUpperCase());
        if (r >= 0) autoRank.set(ei, r);
      });
    }
    // --- Deckschicht: the workpiece's face at [T, T+step] --------------------
    // Independent of the Höhe-je-Farbe flag so it also serves pure Farbebenen-AMS
    // docs. It carries: the solid auto participants (their ranks already include
    // the deck at order[0]) and raised AMS-bands elements with a shared palette
    // (their filament stacks shift one step up). Everything else punches through:
    // base-colored/overridden solids, engraved motifs (they carve down from T),
    // stepped/flush colorLayers and heightmap elements (they own [T..] themselves),
    // cutouts and the frame ring.
    const baseHexR = String(doc.body.baseColor || "").toUpperCase();
    const deckHex = (doc.topLayerColor ? String(doc.topLayerColor).toUpperCase() : null);
    const deckValid = !!(deckHex && deckHex !== baseHexR);
    const amsShifted = new Set(); // raised AMS-bands elements riding on the deck
    if (deckValid && ams) {
      doc.elements.forEach((el, ei) => {
        if (el && el.type === "image" && !el._hidden && el._img &&
            el.depth && el.depth.mode === "colorLayers" && colorStyleOf(el) === "bands" &&
            (el.depth.direction || "raised") === "raised") amsShifted.add(ei);
      });
    }
    if (autoRank.size || (deckValid && amsShifted.size)) {
      const nn = cols * rows;
      if (deckValid) {
        // Heightmap elements build UP from the plate top regardless of direction, but an
        // engraved-direction heightmap claims no ownership of its BRIGHT pixels (the
        // generic mask is luminance-filtered for non-raised), so the owner-based punch-
        // through below misses them. Exclude their opaque regions explicitly — same
        // alpha>=128 criterion as buildHeightmapParts — or deck and heightmap floor
        // would interpenetrate in [T, T+step].
        let hmExclude = null;
        for (const el of doc.elements) {
          if (!el || !el.depth || el.depth.mode !== "heightmap") continue;
          if (el.type === "image" && !el._img) continue;
          const d = __drawElement(el, doc, cols, rows, grid);
          if (!hmExclude) hmExclude = new Uint8Array(cols * rows);
          for (let i = 0; i < cols * rows; i++) if (d[i * 4 + 3] >= 128) hmExclude[i] = 1;
        }
        const deckMember = (c, r) => {
          const i = idx(c, r);
          if (comp.cutout[i] || (band && band[i] === 1)) return false;
          if (hmExclude && hmExclude[i] === 1) return false;
          const o = comp.owner[i];
          return o < 0 || autoRank.has(o) || amsShifted.has(o);
        };
        const facets = tracedFacets(deckMember, step, T);
        if (facets.length) parts.push({ name: "deckschicht", color: window.hexToRgb(deckHex), facets });
      }
      // Solid participant levels. With a valid deck, autoOrder[0] is the deck color and
      // element ranks start at 1 — their slabs land on top of the deck automatically.
      if (autoRank.size) {
        let maxL = 0; for (const r of autoRank.values()) if (r > maxL) maxL = r;
        for (let L = (deckValid ? 1 : 0); L <= maxL; L++) {
          const region = new Uint8Array(nn);
          for (const [ei, r] of autoRank) {
            if (r < L) continue;
            for (const g of (byElem.get(ei) || [])) { const s = g.set; for (let i = 0; i < nn; i++) region[i] |= s[i]; }
          }
          const facets = tracedFacets((c, r) => region[idx(c, r)] === 1, step, T + L * step);
          if (facets.length) parts.push({ name: "farbschicht-auto-" + (L + 1), color: window.hexToRgb(autoOrder[L]), facets });
        }
      }
    }

    for (const [ei, colorGroups] of byElem) {
      if (autoRank.has(ei)) continue; // already printed by the shared auto stack
      const el = doc.elements[ei];
      const isBandsColorLayers = el.depth && el.depth.mode === "colorLayers" && colorStyleOf(el) === "bands";

      if (isBandsColorLayers && ams) {
        // Global filament stack: each Z-level L (0..maxLayer) is one shared filament layer,
        // color amsPalette[L], over every pixel that reaches layer >= L. A pixel of layer j is a
        // solid stack of layers 0..j (own color on top) — gap-free even when the element skips
        // palette layers, and a given color always sits at the same height across elements.
        const nn = cols * rows;
        let maxG = -1;
        colorGroups.forEach((g) => { const rk = amsRankR(g.hex); if (rk > maxG) maxG = rk; });
        // Deckschicht: the whole filament stack rides one step up on the deck slab.
        const zOff = amsShifted.has(ei) ? 1 : 0;
        for (let L = 0; L <= maxG; L++) {
          const region = new Uint8Array(nn);
          for (const g of colorGroups) if (amsRankR(g.hex) >= L) { const s = g.set; for (let i = 0; i < nn; i++) region[i] |= s[i]; }
          const facets = tracedFacets((c, r) => region[idx(c, r)] === 1, step, T + (L + zOff) * step);
          if (facets.length) parts.push({ name: "farbschicht-" + (ei + 1) + "-" + (L + 1), color: window.hexToRgb(ams[L]), facets });
        }
      } else if (isBandsColorLayers) {
        // Height-band path (AMS, per-element luminance — no shared palette): sort dark->light,
        // emit N stacked slabs. Band k: footprint = union of sets for ranks k+1..N, z0 = T + k*step,
        // thickness = step. Nested footprints shrink upward; top face shows each pixel's own color.
        const sorted = colorGroups.slice().sort((a, b) => hexLum(a.hex) - hexLum(b.hex)); // rank 1=darkest
        const N = sorted.length;
        const n = cols * rows;
        // Precompute cumulative union masks from top (rank N) down to rank 1.
        // unionFromRank[k] = pixels belonging to colors at ranks k+1..N (0-indexed: k=0 is rank 1).
        const unionFromRank = new Array(N);
        unionFromRank[N - 1] = sorted[N - 1].set; // rank N: only the lightest color's set
        for (let k = N - 2; k >= 0; k--) {
          const u = new Uint8Array(n);
          const src = unionFromRank[k + 1];
          const own = sorted[k].set;
          for (let i = 0; i < n; i++) u[i] = own[i] | src[i];
          unionFromRank[k] = u;
        }
        for (let k = 0; k < N; k++) {
          const bandSet = unionFromRank[k];
          const z0 = T + k * step;
          const facets = tracedFacets((c, r) => bandSet[idx(c, r)] === 1, step, z0);
          if (facets.length) parts.push({ name: "farbschicht-" + (ei + 1) + "-" + (k + 1), color: window.hexToRgb(sorted[k].hex), facets });
        }
      } else {
        // Path 2 — existing per-color prism logic (non-flush or non-colorLayers). UNCHANGED.
        for (const g of colorGroups) {
          const h = heightForElemColor(el, g.hex);
          if (h <= 0) continue; // Relief-Höhe 0 → no raised prism (element flush with the plate)
          const facets = tracedFacets((c, r) => g.set[idx(c, r)] === 1, h, T);
          if (facets.length) parts.push({ name: "erhaben-" + (++pn), color: window.hexToRgb(g.hex), facets });
        }
      }
    }

    return parts;
  }

  // Continuous brightness->height relief for depth.mode==='heightmap' elements:
  // a floor slab over the silhouette + K super-level slabs (region where brightness
  // >= k/K), each a flat extrusion. Prints identically to a smooth surface after
  // slicing. Single color (el.color); height from luminance.
  // band: optional Rand-Rahmen mask; band cells are skipped (ring wins).
  function buildHeightmapParts(doc, footprintArg, gridArg, band) {
    const grid = gridArg || gridForBody(doc.body, doc.resolution);
    const { cols, rows, pitch } = grid;
    const footprint = footprintArg || window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    const T = doc.body.thicknessMm, layerH = doc.body.layerHeightMm;
    const idx = (c, r) => r * cols + c;
    const inBand = band ? ((i) => band[i] === 1) : (() => false);
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
      const floor = tracedFacets((c, r) => inRegion[idx(c, r)] === 1 && !inBand(idx(c, r)), baseFloor, T);
      if (floor.length) parts.push({ name: "hoehe-" + (ei + 1) + "-boden", color: col, facets: floor });
      const K = Math.max(0, Math.min(48, Math.round(availH / layerH)));
      const dz = K > 0 ? availH / K : 0;
      for (let k = 1; k <= K; k++) {
        const thr = k / K, z0 = T + baseFloor + (k - 1) * dz;
        const facets = tracedFacets((c, r) => inRegion[idx(c, r)] === 1 && bright[idx(c, r)] >= thr && !inBand(idx(c, r)), dz, z0);
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
    // Washer union fires for EVERY loop doc (amended 2026-07-02 — not gated on expansion).
    // In the expanded-grid path the union uses square-pitch mapping; in the default path
    // the union uses rectangular-cell mapping (sx/sy). Both paths check hasWasher.
    const hasWasher = m.type === "loop" && (m.ringThicknessMm || 0) > 0 && (m.diameterMm || 0) > 0;
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
      // DEFAULT path: ORIGINAL rectangular-cell mapping (byte-identical to pre-T1 for
      // non-loop docs). For loop docs, washer union is composed BEFORE the hole cut:
      //   v = max(borderCells - dt, washerSdf*s) then min(v, holeSdf*s).
      // When washer ⊆ plate the max() is a no-op (parity holds for loop-inside==hole).
      const sx = cols / doc.body.widthMm, sy = rows / doc.body.heightMm, s = (sx + sy) / 2;
      // outerR already computed above (hasWasher controls whether to apply it).
      return (c, r) => {
        let v = borderCells - dt[idx(c, r)];            // >0 within borderCells of silhouette
        if (hasWasher) {
          const x = (c + 0.5) / sx, y = (r + 0.5) / sy;
          v = Math.max(v, (outerR - Math.hypot(x - cx, y - cy)) * s); // washer union
        }
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
  // Washer union fires for EVERY loop doc (amended 2026-07-02 — see buildParts comment).
  // Loop fully inside → max() is a no-op (parity preserved); degenerate → plain hole.
  function docGridAndFootprint(doc) {
    const domain = docDomain(doc);
    const grid = gridForDomain(domain, doc.resolution);
    const { cols, rows, pitch } = grid;
    const m = doc.mount;
    const free = doc.body.shape === "free";
    const image = doc.body.shape === "image";
    const isLoop = m && m.type === "loop" && (m.ringThicknessMm || 0) > 0 && (m.diameterMm || 0) > 0;
    const domainExpanded = domain.x0 !== 0 || domain.y0 !== 0 ||
      domain.wMm !== doc.body.widthMm || domain.hMm !== doc.body.heightMm;
    let footprint;
    if (image) {
      // Plate-free Bild object: footprint = the defining image element's rectangle.
      footprint = imageFootprintField(doc, cols, rows, pitch, grid);
    } else if (free) {
      // Pass grid only when domain expanded; default branch handles washer union itself.
      footprint = freeFootprintField(doc, cols, rows, pitch, domainExpanded ? grid : null);
    } else if (isLoop && domainExpanded) {
      // Expanded path: square-pitch mapping; washer union + hole cut in one closure.
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
    } else if (isLoop) {
      // Default path (unexpanded), non-free: lattice-identity washer union (rect mapping).
      // max(A(c,r), min(washerSdf, holeSdf)*s) where A = shapeFootprintField output.
      const A = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
      const W = doc.body.widthMm, H = doc.body.heightMm;
      const sx = cols / W, sy = rows / H, s = (sx + sy) / 2;
      const outerR = m.diameterMm / 2 + m.ringThicknessMm;
      const holeR = m.diameterMm / 2;
      footprint = (c, r) => {
        const x = (c + 0.5) / sx, y = (r + 0.5) / sy;
        const washerSdf = outerR - Math.hypot(x - m.xMm, y - m.yMm);
        const holeSdf = Math.hypot(x - m.xMm, y - m.yMm) - holeR;
        return Math.max(A(c, r), Math.min(washerSdf, holeSdf) * s);
      };
    } else {
      // Default / degenerate: plain shapeFootprintField (cuts hole for type='hole'/'loop').
      footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    }
    return { grid, footprint };
  }

  window.gridForBody = gridForBody;
  window.docDomain = docDomain;
  window.viewportDomain = viewportDomain;
  window.gridForDomain = gridForDomain;
  window.docGridAndFootprint = docGridAndFootprint;
  window.buildBaseParts = buildBaseParts;
  window.composeDesignV2 = composeDesignV2;
  window.buildEngravedParts = buildEngravedParts;
  window.buildMountRingParts = buildMountRingParts;
  window.buildRaisedParts = buildRaisedParts;
  window.buildHeightmapParts = buildHeightmapParts;
  window.buildFrameParts = buildFrameParts;
  window.buildParts = buildParts;

  // Dünne-Stellen-Prüfung: flag printed regions narrower than minWidthMm (nozzle
  // width). Morphological opening via two chamfer DTs: erode the element mask by
  // r = minWidth/2 (pixels deeper than r survive as the core), dilate the core
  // back by r — mask pixels NOT recovered belong to features thinner than 2r
  // (hairlines, thin necks, small islands). Returns the flag mask on a modest
  // probe grid plus mm² total for a human-readable verdict.
  function thinFeatureMask(doc, minWidthMm) {
    // Probe at the doc's OWN resolution — a coarser grid would drop sub-cell
    // hairlines from the mask and report "clean" for features the build includes.
    const grid = gridForBody(doc.body, doc.resolution || 1024);
    const { cols, rows, pitch } = grid;
    const comp = composeDesignV2(doc, cols, rows);
    const n = cols * rows;
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = (!comp.isBase[i] && !comp.cutout[i] && comp.owner[i] >= 0) ? 1 : 0;
    const r = ((minWidthMm || 0.4) / 2) / pitch;   // radius in cells
    const inv = new Uint8Array(n);
    for (let i = 0; i < n; i++) inv[i] = mask[i] ? 0 : 1;
    const dIn = __chamferDT(inv, cols, rows);      // depth inside the mask
    const core = new Uint8Array(n);
    for (let i = 0; i < n; i++) core[i] = (mask[i] && dIn[i] > r) ? 1 : 0;
    const dCore = __chamferDT(core, cols, rows);   // distance to the eroded core
    const thin = new Uint8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) if (mask[i] && !(dCore[i] <= r)) { thin[i] = 1; count++; }
    return { thin, cols, rows, pitch, count, areaMm2: count * pitch * pitch };
  }
  window.thinFeatureMask = thinFeatureMask;

  // Editor UI: preview the AUTO height (Höhe je Farbe) an Einfarbig element falls
  // back to — ignores a set override (the input shows that itself) and applies the
  // engraved carve-budget compression so the shown value matches the build.
  window.autoSolidHeightMm = (doc, el) => __autoSolidHeight(
    doc, el,
    (el && el.depth && el.depth.direction) === "engraved" ? __engravedBudget(doc.body).maxRecess : null,
    true);
  // Footprint = the defining image element's rotated rectangle (plate-free "Bild" object).
  // >0 inside the rectangle, in cell units. borderMm is ignored (the image IS the object).
  function imageFootprintField(doc, cols, rows, pitch, grid) {
    const x0 = grid ? grid.x0 : 0, y0 = grid ? grid.y0 : 0;
    const el = __bildElement(doc);
    if (!el) return () => -1;
    const cx = el.cxMm, cy = el.cyMm, hw = (el.wMm || 0) / 2, hh = (el.hMm || 0) / 2;
    const a = -(el.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); // inverse rotate
    const s = 1 / pitch;
    return (c, r) => {
      const x = x0 + (c + 0.5) * pitch, y = y0 + (r + 0.5) * pitch;
      const dx = x - cx, dy = y - cy;
      const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca; // into element-local space
      return Math.min(hw - Math.abs(lx), hh - Math.abs(ly)) * s; // >0 inside the rectangle, cell units
    };
  }

  window.freeFootprintField = freeFootprintField;
  window.imageFootprintField = imageFootprintField;
  // Test-only: expose __renderElementV2 so island-removal.test.js can inspect mask/r/g/b
  // directly without going through full buildParts. Not called by production code.
  window.__renderElementV2ForTest = __renderElementV2;
})();
