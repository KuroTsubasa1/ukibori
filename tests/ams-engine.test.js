"use strict";
// Phase 2: engine consumes doc.amsPalette. When the shared palette is non-empty, bands (AMS)
// elements quantize to it and a color's layer DEPTH/HEIGHT is keyed to its GLOBAL palette index
// (so the same color sits at the same layer across elements → shared filament layers). The base
// plate bands follow the full palette (multi-element works). Empty amsPalette → legacy parity.
(function () {
  function zbounds(f) { let mn = Infinity, mx = -Infinity; for (const t of f) for (const p of t) { if (p[2] < mn) mn = p[2]; if (p[2] > mx) mx = p[2]; } return { mn, mx }; }
  const hexOf = (rgb) => ("#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
  const partsJson = (parts) => JSON.stringify(parts.map(p => ({ name: p.name, color: p.color, facets: p.facets })));

  async function imgFromBands(colors, w, h) { // vertical stripes, one per color
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const cx = cv.getContext("2d");
    const bw = Math.floor(w / colors.length);
    colors.forEach((c, i) => { cx.fillStyle = c; cx.fillRect(i * bw, 0, (i === colors.length - 1 ? w - i * bw : bw), h); });
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  function sqDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 60;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
    d.body.layerHeightMm = 0.2; d.colorStepLayers = 2; d.resolution = 64;
    d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    d.amsPalette = [];
    return d;
  }
  function makeEl(img, direction) {
    const el = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 40, hMm: 40 });
    el.depth.direction = direction; el.depth.mode = "colorLayers"; el.depth.colorLayerStyle = "bands";
    el.depth.reduce = { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] };
    el._img = img;
    return el;
  }
  const step = 0.4, T = 3, layerH = 0.2;
  const floor = Math.min(2 * layerH, T);
  const minBase = Math.min(Math.max(0.8, T * 0.34, 2 * layerH), Math.max(0, T - floor));
  const maxRecess = Math.max(0, T - floor - minBase);
  const baseUnder = (dd) => T - Math.max(0, Math.min(dd, maxRecess)) - floor;
  // AMS layer alignment (2026-07-22): engraved motif floors now share the plate-band plan.
  // For a palette of N colors the grid-snapped band thickness is
  //   bandThick = layerH * max(1, floor(min(step, (T-minBase)/N) / layerH)).
  // A color at palette index j carves recess j*bandThick, so its floor's z0 (base-under
  // height) is max(T - j*bandThick - floor, minBase). The floor TOP == the plate band top
  // == T - j*bandThick. (Old model recessed by (j+1)*step, one step too deep — the bug.)
  const bandThickFor = (n) => layerH * Math.max(1, Math.floor(Math.min(step, (T - minBase) / n) / layerH));
  const alignedZ0 = (j, n) => Math.max(T - j * bandThickFor(n) - floor, minBase);

  test("global quantize: a bands element snaps its colors to the shared amsPalette", async () => {
    const img = await imgFromBands(["#101010", "#808080", "#f0f0f0"], 30, 20);
    const d = sqDoc(); d.amsPalette = ["#101010", "#F0F0F0"]; // only 2 layers
    d.elements = [makeEl(img, "engraved")];
    const floors = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0);
    const hexes = new Set(floors.map(p => hexOf(p.color)));
    for (const h of hexes) assert(d.amsPalette.indexOf(h) !== -1, "floor color " + h + " is a palette layer");
    assert(hexes.size <= 2, "at most the 2 palette colors appear");
  });

  test("engraved: layer DEPTH follows the global palette index (subset keeps global depths, with gaps)", async () => {
    // amsPalette has 3 layers; the image only uses layers 0 and 2 (skips the middle).
    const img = await imgFromBands(["#000000", "#ffffff"], 20, 20);
    const d = sqDoc(); d.amsPalette = ["#000000", "#808080", "#FFFFFF"];
    d.elements = [makeEl(img, "engraved")];
    const floors = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0);
    const byColor = {}; floors.forEach(p => { byColor[hexOf(p.color)] = +zbounds(p.facets).mn.toFixed(4); });
    // Alignment: layer 0 (#000000) floor top == its plate band top (flush, recess 0);
    // layer 2 (#FFFFFF) floor top == its band top (recess 2*bandThick, gap at index 1).
    assertClose(byColor["#000000"], alignedZ0(0, 3), 1e-4, "layer-0 color aligned to band index 0");
    assertClose(byColor["#FFFFFF"], alignedZ0(2, 3), 1e-4, "layer-2 color aligned to band index 2 (gap at 1)");
  });

  test("shared layers: a color shared by two engraved elements sits at the SAME depth", async () => {
    const imgA = await imgFromBands(["#000000", "#ffffff"], 20, 20); // layers 0,2
    const imgB = await imgFromBands(["#808080", "#ffffff"], 20, 20); // layers 1,2
    const d = sqDoc(); d.amsPalette = ["#000000", "#808080", "#FFFFFF"];
    const a = makeEl(imgA, "engraved"); a.cxMm = 18; a.wMm = 20;
    const b = makeEl(imgB, "engraved"); b.cxMm = 42; b.wMm = 20;
    d.elements = [a, b];
    const floors = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0 && hexOf(p.color) === "#FFFFFF");
    assert(floors.length >= 2, "white appears in both elements");
    const depths = floors.map(p => +zbounds(p.facets).mn.toFixed(4));
    // Alignment: white (palette index 2) sits at the SAME band-aligned depth in both elements.
    for (const z of depths) assertClose(z, alignedZ0(2, 3), 1e-4, "shared white aligned to band index 2 in both");
  });

  test("base bands: full palette on the plate, and MULTI-element no longer falls back", async () => {
    const imgA = await imgFromBands(["#000000", "#ffffff"], 20, 20);
    const imgB = await imgFromBands(["#808080", "#ffffff"], 20, 20);
    const d = sqDoc(); d.amsPalette = ["#000000", "#808080", "#FFFFFF"];
    const a = makeEl(imgA, "engraved"); a.cxMm = 18; a.wMm = 16;
    const b = makeEl(imgB, "engraved"); b.cxMm = 42; b.wMm = 16;
    d.elements = [a, b];
    const base = buildParts(d).filter(p => p.name.indexOf("grundplatte-band") === 0);
    assertEqual(base.length, 3, "3 base bands = full palette, despite 2 elements");
    const cols = base.map(p => hexOf(p.color));
    ["#000000", "#808080", "#FFFFFF"].forEach(h => assert(cols.indexOf(h) !== -1, "base band for layer " + h));
  });

  test("reorder: swapping amsPalette order changes which layer a color prints on", async () => {
    const img = await imgFromBands(["#000000", "#ffffff"], 20, 20);
    const mk = (pal) => { const d = sqDoc(); d.amsPalette = pal; d.elements = [makeEl(img, "engraved")]; return d; };
    const depthOf = (d, hex) => { const p = buildParts(d).filter(q => q.name.indexOf("farbe-") === 0 && hexOf(q.color) === hex)[0]; return +zbounds(p.facets).mn.toFixed(4); };
    const white1 = depthOf(mk(["#000000", "#FFFFFF"]), "#FFFFFF"); // white = band index 1
    const white0 = depthOf(mk(["#FFFFFF", "#000000"]), "#FFFFFF"); // white = band index 0
    // Alignment: white's floor top == its plate band top; index 0 is flush (recess 0),
    // index 1 recesses one bandThick. (Old model: (index+1)*step, one step too deep.)
    assertClose(white1, alignedZ0(1, 2), 1e-4, "white at band index 1 aligned to its band");
    assertClose(white0, alignedZ0(0, 2), 1e-4, "reordered: white at band index 0 (flush)");
    assert(Math.abs(white1 - white0) > 1e-3, "reordering changed the depth");
  });

  test("raised: global filament stack — each pixel is layers 0..own (own color on top)", async () => {
    const img = await imgFromBands(["#000000", "#ffffff"], 20, 20); // layers 0,2 of a 3-layer palette
    const d = sqDoc(); d.amsPalette = ["#000000", "#808080", "#FFFFFF"];
    d.elements = [makeEl(img, "raised")];
    const bands = buildParts(d).filter(p => p.name.indexOf("farbschicht") === 0);
    // white pixels reach layer 2 → a stack of levels 0,1,2 exists over them; top at T+3*step.
    const tops = bands.map(p => zbounds(p.facets).mx);
    assertClose(Math.max(...tops), T + 3 * step, 1e-4, "tallest raised band top at T+3*step (layer 2)");
    // continuous: some band bottom sits at T (level 0), no floating gap.
    assert(bands.some(p => Math.abs(zbounds(p.facets).mn - T) < 1e-4), "a band starts at the plate top (level 0, no gap)");
  });

  test("lingering palette, NO bands element → base plate is NOT striped (regression)", async () => {
    const img = await imgFromBands(["#101010", "#f0f0f0"], 20, 20);
    const d = sqDoc(); d.amsPalette = ["#101010", "#808080", "#F0F0F0"]; // populated but unused
    const el = makeEl(img, "engraved"); el.depth.colorLayerStyle = "stepped"; // NOT bands
    d.elements = [el];
    const parts = buildParts(d);
    assert(!parts.some(p => p.name.indexOf("grundplatte-band") === 0), "no base bands without a bands element");
    assert(parts.some(p => p.name === "grundplatte"), "plain full base slab present");
    // text-only doc with a lingering palette: also no stripes
    const d2 = sqDoc(); d2.amsPalette = ["#101010", "#F0F0F0"];
    const t = makeElementV2("text", { text: "Hi", cxMm: 30, cyMm: 30 });
    d2.elements = [t];
    assert(!buildParts(d2).some(p => p.name.indexOf("grundplatte-band") === 0), "text-only + lingering palette → no base bands");
  });

  test("deep AMS palette: engraved floors stay DISTINCT (compressed to the carve budget)", async () => {
    const cols6 = ["#000000", "#333333", "#666666", "#999999", "#cccccc", "#ffffff"];
    const img = await imgFromBands(cols6, 60, 12);
    const d = sqDoc(); d.amsPalette = ["#000000", "#333333", "#666666", "#999999", "#CCCCCC", "#FFFFFF"];
    const el = makeEl(img, "engraved"); el.depth.reduce.numColors = 6; d.elements = [el];
    const floors = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0);
    assert(floors.length >= 4, "several deep layers present");
    const z0s = floors.map(p => +zbounds(p.facets).mn.toFixed(4)).sort((a, b) => a - b);
    for (let i = 1; i < z0s.length; i++) assert(z0s[i] - z0s[i - 1] > 1e-3, "floors at distinct depths (no clamp-collapse): " + z0s.join(","));
  });

  test("base floor: body.baseThicknessMm sets the solid backing thickness (engraved)", async () => {
    const img = await imgFromBands(["#000000", "#ffffff"], 20, 20);
    const d = sqDoc(); d.amsPalette = ["#000000", "#FFFFFF"]; d.body.baseThicknessMm = 2.0;
    d.elements = [makeEl(img, "engraved")];
    const floor = buildParts(d).filter(p => p.name === "grundplatte")
      .map(p => zbounds(p.facets)).filter(z => Math.abs(z.mn) < 1e-6)[0];
    assert(floor, "has a z=0 base floor slab");
    assertClose(floor.mx, 2.0, 1e-4, "base floor top = baseThicknessMm (2.0)");
  });

  test("amsSolidBase: surrounding plate stays solid (no base bands); inlay still multicolor", async () => {
    const img = await imgFromBands(["#000000", "#ffffff"], 20, 20);
    const d = sqDoc(); d.amsPalette = ["#000000", "#FFFFFF"]; d.amsSolidBase = true;
    d.elements = [makeEl(img, "engraved")];
    const parts = buildParts(d);
    assert(!parts.some(p => p.name.indexOf("grundplatte-band") === 0), "no base bands when amsSolidBase");
    assert(parts.some(p => p.name === "grundplatte"), "solid base present");
    assert(parts.filter(p => p.name.indexOf("farbe-") === 0).length >= 2, "inlay stays multicolor");
  });

  test("parity: empty amsPalette leaves bands geometry byte-identical (engraved + raised)", async () => {
    const img = await imgFromBands(["#1a1a1a", "#888888", "#e0e0e0"], 24, 24);
    for (const dir of ["engraved", "raised"]) {
      const a = sqDoc(); a.amsPalette = []; a.elements = [makeEl(img, dir)];
      const b = sqDoc(); delete b.amsPalette; b.elements = [makeEl(img, dir)];
      assertEqual(partsJson(buildParts(a)), partsJson(buildParts(b)), dir + ": [] and absent amsPalette identical");
    }
  });
})();
