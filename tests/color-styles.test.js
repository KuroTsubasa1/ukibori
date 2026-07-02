"use strict";
// T14: three color-layer stacking styles (stepped / flush / bands), raised + engraved.
// stepped = rank-height relief; flush = all colors one height/one flat surface (restored);
// bands = stacked height bands, one color per printed layer (AMS). Each works in BOTH
// directions: raised (build up above the plate) and engraved (recess down into it).
(function () {
  function zbounds(f) { let mn = Infinity, mx = -Infinity; for (const t of f) for (const p of t) { if (p[2] < mn) mn = p[2]; if (p[2] > mx) mx = p[2]; } return { mn, mx }; }
  function signedVol(f) { let v = 0; for (const t of f) { const [a, b, c] = t; v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6; } return v; }
  function xyArea(f) { const seen = new Set(); for (const t of f) for (const p of t) seen.add(Math.round(p[0]*100) + "," + Math.round(p[1]*100)); return seen.size; }
  const partsJson = (parts) => JSON.stringify(parts.map(p => ({ name: p.name, color: p.color, facets: p.facets })));
  // A part "spans" z if its z-range strictly straddles z (some top above, some bottom below).
  function spansZ(facets, z) { const zb = zbounds(facets); return zb.mn < z && zb.mx > z; }

  // Three-color image: left third dark (#1a1a1a, lum~26.7), middle mid (#888888, lum~136.5),
  // right third light (#e0e0e0, lum~224). Distinct -> rank 1=dark, 2=mid, 3=light.
  async function threeColorImg(w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#1a1a1a"; cx.fillRect(0, 0, Math.floor(w / 3), h);
    cx.fillStyle = "#888888"; cx.fillRect(Math.floor(w / 3), 0, Math.floor(w / 3), h);
    cx.fillStyle = "#e0e0e0"; cx.fillRect(Math.floor(w / 3) * 2, 0, w - Math.floor(w / 3) * 2, h);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }

  function sqDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 60;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
    d.body.layerHeightMm = 0.2;
    d.colorStepLayers = 2; // step = 0.4 mm
    d.resolution = 64;
    d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    return d;
  }

  // colorLayers image element with a given direction + style. If style === undefined, no
  // colorLayerStyle field is written (legacy/absent). If legacyFlush is set, writes depth.flush.
  function makeEl(img, direction, style, legacyFlush) {
    const el = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 40, hMm: 40 });
    el.depth.direction = direction; el.depth.mode = "colorLayers";
    el.depth.reduce = { method: "palette", numColors: 3, levels: 4, remap: {}, order: [] };
    if (style === undefined) delete el.depth.colorLayerStyle; else el.depth.colorLayerStyle = style;
    if (legacyFlush === undefined) delete el.depth.flush; else el.depth.flush = legacyFlush;
    el._img = img;
    return el;
  }

  const T = 3, step = 0.4;

  // ============================ RAISED ============================
  test("raised stepped: 3 colors → 3 per-color prisms at rank heights", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc(); d.elements = [makeEl(img, "raised", "stepped")];
    const parts = buildParts(d);
    const pr = parts.filter(p => p.name.indexOf("erhaben") === 0);
    assertEqual(pr.length, 3, "3 erhaben prisms");
    const tops = pr.map(p => zbounds(p.facets).mx).sort((a, b) => a - b);
    assertClose(tops[0], T + step,   1e-5, "rank-0 prism top at T+step");
    assertClose(tops[1], T + 2*step, 1e-5, "rank-1 prism top at T+2step");
    assertClose(tops[2], T + 3*step, 1e-5, "rank-2 prism top at T+3step");
    assert(!parts.some(p => p.name.indexOf("farbschicht") === 0), "no farbschicht parts in stepped");
  });

  test("raised flush: all colors span [T, T+step] (one flat multi-color surface)", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc(); d.elements = [makeEl(img, "raised", "flush")];
    const parts = buildParts(d);
    const pr = parts.filter(p => p.name.indexOf("erhaben") === 0);
    assertEqual(pr.length, 3, "3 erhaben prisms (one per color, side by side)");
    for (const p of pr) {
      const zb = zbounds(p.facets);
      assertClose(zb.mn, T,        1e-5, "flush prism bottom at T");
      assertClose(zb.mx, T + step, 1e-5, "flush prism top at T+step (all same height)");
    }
    assert(!parts.some(p => p.name.indexOf("farbschicht") === 0), "no farbschicht parts in flush");
  });

  test("raised bands: 3 nested stacked slabs, dark→light bottom→top, one color per layer", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc(); d.elements = [makeEl(img, "raised", "bands")];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("farbschicht") === 0);
    assertEqual(bands.length, 3, "3 farbschicht band parts");
    const sorted = bands.slice().sort((a, b) => zbounds(a.facets).mn - zbounds(b.facets).mn);
    // Stacked z-ranges
    assertClose(zbounds(sorted[0].facets).mn, T,          1e-5, "band 1 bottom = T");
    assertClose(zbounds(sorted[2].facets).mx, T + 3*step, 1e-5, "band 3 top = T+3step");
    // Nested footprints shrink upward
    const areas = sorted.map(p => xyArea(p.facets));
    assert(areas[0] >= areas[1] && areas[1] >= areas[2], "footprints shrink upward (nested)");
    // One color per layer: probe middle of band 2 → exactly one part spans it
    const zProbe = T + step + step / 2;
    assertEqual(bands.filter(p => spansZ(p.facets, zProbe)).length, 1, "exactly one band covers mid-band-2 z");
  });

  // ============================ ENGRAVED ============================
  // For engraved colorLayers, floors are recessed BELOW the plate top (z < T).
  // A floor slab spans [z0, z0+floor]; the recess depth = T - (z0+floor).
  test("engraved stepped: 3 floors at DISTINCT recess depths (rank depths)", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc(); d.elements = [makeEl(img, "engraved", "stepped")];
    const parts = buildParts(d);
    const floors = parts.filter(p => p.name.indexOf("farbe-") === 0);
    assertEqual(floors.length, 3, "3 color floors");
    const z0s = floors.map(p => zbounds(p.facets).mn).sort((a, b) => a - b);
    // Distinct z0 → distinct recess depths
    assert(z0s[0] < z0s[1] - 1e-6 && z0s[1] < z0s[2] - 1e-6, "three distinct recess depths (stepped)");
  });

  test("engraved flush: all 3 floors at the SAME recess depth (one flat inlay level)", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc(); d.elements = [makeEl(img, "engraved", "flush")];
    const parts = buildParts(d);
    const floors = parts.filter(p => p.name.indexOf("farbe-") === 0);
    assertEqual(floors.length, 3, "3 color floors");
    const z0s = floors.map(p => zbounds(p.facets).mn);
    for (const z of z0s) assertClose(z, z0s[0], 1e-6, "all floor z0 equal (one recess depth)");
    // And the recess depth equals `step` (depthFor = step for all): z0 = baseUnder(step).
    const T2 = 3, layerH = 0.2;
    const floor = Math.min(2 * layerH, T2);
    const minBase = Math.min(Math.max(0.8, T2 * 0.34, 2 * layerH), Math.max(0, T2 - floor));
    const maxRecess = Math.max(0, T2 - floor - minBase);
    const recessOf = (dd) => Math.max(0, Math.min(dd, maxRecess));
    const baseUnder = (dd) => T2 - recessOf(dd) - floor;
    assertClose(z0s[0], baseUnder(step), 1e-6, "flush recess depth = one step");
  });

  test("engraved bands: nested recessed floors, each DEPTH-band a single color", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc(); d.elements = [makeEl(img, "engraved", "bands")];
    const parts = buildParts(d);
    const floors = parts.filter(p => p.name.indexOf("farbe-") === 0);
    assertEqual(floors.length, 3, "3 recessed floor bands");
    // Downward mirror of raised bands: each pixel's OWN color is the shallowest floor
    // covering it (visible from the top), deeper floors are the lighter colors nested
    // beneath. region(rank k) = union of ranks <= k, depth = k*step (dark→light ascending).
    // So: deepest floor (rank N) = lightest = largest region (all pixels); shallowest
    // floor (rank 1) = darkest = smallest region.
    const sorted = floors.slice().sort((a, b) => zbounds(a.facets).mn - zbounds(b.facets).mn); // deepest first
    const areas = sorted.map(p => xyArea(p.facets));
    assert(areas[0] >= areas[1] && areas[1] >= areas[2], "deeper floors cover >= shallower (nested union)");
    // Distinct recess depths spaced by ~step (k*step for k=1..3).
    const T2 = 3, layerH = 0.2;
    const floor = Math.min(2 * layerH, T2);
    const minBase = Math.min(Math.max(0.8, T2 * 0.34, 2 * layerH), Math.max(0, T2 - floor));
    const maxRecess = Math.max(0, T2 - floor - minBase);
    const baseUnder = (dd) => T2 - Math.max(0, Math.min(dd, maxRecess)) - floor;
    const z0s = sorted.map(p => zbounds(p.facets).mn);
    assertClose(z0s[0], baseUnder(3 * step), 1e-6, "deepest floor at depth 3*step");
    assertClose(z0s[1], baseUnder(2 * step), 1e-6, "mid floor at depth 2*step");
    assertClose(z0s[2], baseUnder(1 * step), 1e-6, "shallowest floor at depth 1*step");
    // One color per depth-layer: deepest floor = lightest, shallowest = darkest.
    const lum = (c) => 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
    const lums = sorted.map(p => lum(p.color));
    assert(lums[0] >= lums[1] && lums[1] >= lums[2], "deepest floor lightest, shallowest darkest (each pixel's own color visible from top)");
  });

  // ============================ PARITY ============================
  test("parity: colorLayerStyle='stepped' deep-equals no-style-no-flush (RAISED)", async () => {
    const img = await threeColorImg(24, 24);
    const a = sqDoc(); a.elements = [makeEl(img, "raised", "stepped")];
    const b = sqDoc(); b.elements = [makeEl(img, "raised", undefined)]; // no style, no flush
    assertEqual(partsJson(buildParts(a)), partsJson(buildParts(b)), "raised stepped byte-identical to legacy default");
  });

  test("parity: colorLayerStyle='stepped' deep-equals no-style-no-flush (ENGRAVED)", async () => {
    const img = await threeColorImg(24, 24);
    const a = sqDoc(); a.elements = [makeEl(img, "engraved", "stepped")];
    const b = sqDoc(); b.elements = [makeEl(img, "engraved", undefined)];
    assertEqual(partsJson(buildParts(a)), partsJson(buildParts(b)), "engraved stepped byte-identical to legacy default");
  });

  // ============================ MIGRATION ============================
  test("migration: legacy flush:true (no colorLayerStyle) → treated as bands (raised)", async () => {
    const img = await threeColorImg(24, 24);
    // Legacy doc: flush=true, no colorLayerStyle. Engine colorStyleOf → 'bands'.
    const legacy = sqDoc(); legacy.elements = [makeEl(img, "raised", undefined, true)];
    const bandsExplicit = sqDoc(); bandsExplicit.elements = [makeEl(img, "raised", "bands")];
    assertEqual(partsJson(buildParts(legacy)), partsJson(buildParts(bandsExplicit)),
      "legacy flush:true renders identically to explicit bands");
    // And it produces farbschicht parts, not erhaben prisms.
    assert(buildParts(legacy).some(p => p.name.indexOf("farbschicht") === 0), "legacy flush → farbschicht bands");
  });

  test("migration model: migrateProject sets colorLayerStyle from legacy flush", () => {
    // v2 doc with legacy flush:true, no colorLayerStyle → migrate to 'bands'.
    const v2 = defaultDoc();
    const el = makeElementV2("image", { src: "a" });
    el.depth.mode = "colorLayers"; el.depth.flush = true; delete el.depth.colorLayerStyle;
    v2.elements = [el];
    const m = migrateProject(v2);
    assertEqual(m.elements[0].depth.colorLayerStyle, "bands", "flush:true migrates to bands");
    // v2 doc with flush:false, no colorLayerStyle → 'stepped'.
    const v2b = defaultDoc();
    const el2 = makeElementV2("image", { src: "a" });
    el2.depth.flush = false; delete el2.depth.colorLayerStyle;
    v2b.elements = [el2];
    const mb = migrateProject(v2b);
    assertEqual(mb.elements[0].depth.colorLayerStyle, "stepped", "flush:false migrates to stepped");
  });

  test("model: defaultDepth has colorLayerStyle 'stepped'; round-trips", () => {
    assertEqual(defaultDepth("image").colorLayerStyle, "stepped", "defaultDepth().colorLayerStyle is 'stepped'");
    const d = defaultDoc();
    const el = makeElementV2("image", { src: "a" });
    el.depth.colorLayerStyle = "bands";
    d.elements = [el];
    const rt = deserializeProject(serializeProject(d));
    assertEqual(rt.elements[0].depth.colorLayerStyle, "bands", "colorLayerStyle round-trips");
  });

  // ============================ MANIFOLD ============================
  test("manifold: raised bands + engraved bands parts are watertight", async () => {
    const img = await threeColorImg(24, 24);
    const rd = sqDoc(); rd.elements = [makeEl(img, "raised", "bands")];
    for (const p of buildParts(rd).filter(p => p.name.indexOf("farbschicht") === 0))
      assert(signedVol(p.facets) > 0, "raised band " + p.name + " watertight (vol=" + signedVol(p.facets).toFixed(6) + ")");
    const ed = sqDoc(); ed.elements = [makeEl(img, "engraved", "bands")];
    for (const p of buildParts(ed).filter(p => p.name.indexOf("farbe-") === 0))
      assert(Math.abs(signedVol(p.facets)) > 0, "engraved band " + p.name + " watertight (vol=" + signedVol(p.facets).toFixed(6) + ")");
  });

  // ============================ DISTINCTNESS ============================
  test("distinctness: the 3 engraved styles produce DIFFERENT geometry", async () => {
    const img = await threeColorImg(24, 24);
    const geo = (style) => { const d = sqDoc(); d.elements = [makeEl(img, "engraved", style)]; return partsJson(buildParts(d)); };
    const s = geo("stepped"), f = geo("flush"), b = geo("bands");
    assert(s !== f, "engraved stepped != flush");
    assert(s !== b, "engraved stepped != bands");
    assert(f !== b, "engraved flush != bands");
  });
})();
