"use strict";
// Engraved AMS stack separation: with 5+ palette colors the stack used to be compressed by
// maxRecess/N without regard to the printer's layer grid, while every color floor kept a fixed
// 2-layer slab → nested floors interpenetrated (clipping) and band boundaries fell between
// printed layers. Contract: every floor/band boundary sits on the layer grid, nested floors
// never overlap in z, and the plate bands line up with the inlay step.
(function () {
  const hexOf = (rgb) => ("#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
  function zb(f) { let mn = Infinity, mx = -Infinity; for (const t of f) for (const p of t) { if (p[2] < mn) mn = p[2]; if (p[2] > mx) mx = p[2]; } return { mn, mx }; }
  async function stripes(colors) {
    const cv = document.createElement("canvas"); cv.width = 60; cv.height = 20; const cx = cv.getContext("2d");
    const bw = Math.floor(60 / colors.length);
    colors.forEach((c, i) => { cx.fillStyle = c; cx.fillRect(i * bw, 0, i === colors.length - 1 ? 60 - i * bw : bw, 20); });
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  const PAL = ["#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#888888", "#884400", "#004488"];
  async function amsDoc(N, opts) {
    const o = opts || {};
    const pal = PAL.slice(0, N);
    const d = defaultDoc();
    d.body.widthMm = 60; d.body.heightMm = 60; d.body.cornerRadiusMm = 0; d.body.baseColor = "#FFFFFF";
    d.body.thicknessMm = o.T || 3; d.body.layerHeightMm = 0.2; d.resolution = 64; d.autoLayerHeights = false;
    d.colorStepLayers = 2; // fixtures assume a 2-layer step (defaultDoc may change it)
    d.amsPalette = o.legacy ? [] : pal.slice();
    if (o.deck) d.topLayerColor = o.deck;
    if (o.solidBase) d.amsSolidBase = true;
    const el = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 40, hMm: 40 });
    el.depth.direction = "engraved"; el.depth.mode = "colorLayers"; el.depth.colorLayerStyle = "bands";
    el.depth.reduce = { method: "palette", numColors: Math.min(N, 8), levels: 4, remap: {}, order: [] };
    el._img = await stripes(pal);
    d.elements = [el];
    return d;
  }
  const onGrid = (z) => Math.abs(z / 0.2 - Math.round(z / 0.2)) < 1e-4;

  function checkStack(d, label) {
    const parts = buildParts(d);
    const floors = parts.filter(p => p.name.indexOf("farbe-") === 0).map(p => ({ hex: hexOf(p.color), ...zb(p.facets) }))
      .sort((a, b) => a.mn - b.mn);
    const bands = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0).map(p => zb(p.facets)).sort((a, b) => a.mn - b.mn);
    assert(floors.length >= 2, label + ": has a multi-color stack");
    for (const f of floors) {
      assert(onGrid(f.mn) && onGrid(f.mx), label + ": floor " + f.hex + " " + f.mn.toFixed(3) + ".." + f.mx.toFixed(3) + " on layer grid");
      assert(f.mx - f.mn >= 0.2 - 1e-6, label + ": floor at least one layer thick");
    }
    // Nested regions (all share the stack footprint) must not overlap in z.
    for (let k = 1; k < floors.length; k++) {
      assert(floors[k].mn >= floors[k - 1].mx - 1e-6,
        label + ": floor " + floors[k].hex + " (" + floors[k].mn.toFixed(3) + ") overlaps " + floors[k - 1].hex + " (top " + floors[k - 1].mx.toFixed(3) + ")");
    }
    // Distinct visible surfaces: one floor top per color.
    const tops = new Set(floors.map(f => f.mx.toFixed(4)));
    assertEqual(tops.size, floors.length, label + ": every color keeps its own floor height");
    // Plate bands on the grid and stacked gap-free.
    for (const b of bands) assert(onGrid(b.mn) && onGrid(b.mx), label + ": plate band " + b.mn.toFixed(3) + ".." + b.mx.toFixed(3) + " on layer grid");
    for (let k = 1; k < bands.length; k++) assertClose(bands[k].mn, bands[k - 1].mx, 1e-6, label + ": plate bands gap-free");
    return { floors, bands };
  }

  for (const N of [4, 5, 6, 8, 10]) {
    test("ams stack: " + N + " palette colors stay separated on the layer grid", async () => {
      checkStack(await amsDoc(N), "N=" + N);
    });
  }
  test("ams stack: 6 colors + Deckschicht stay separated", async () => {
    checkStack(await amsDoc(6, { deck: "#123456" }), "N=6+deck");
  });
  test("ams stack: legacy per-element bands (no shared palette) with 6 colors stay separated", async () => {
    checkStack(await amsDoc(6, { legacy: true }), "legacy N=6");
  });
  test("ams stack: 6 colors with a solid base (no plate bands → fallback layout) stay separated", async () => {
    const { bands } = checkStack(await amsDoc(6, { solidBase: true }), "N=6 solid base");
    assertEqual(bands.length, 0, "amsSolidBase keeps the plate one color");
  });
  test("ams stack: plate bands use the SAME step as the inlay floors", async () => {
    const { floors, bands } = checkStack(await amsDoc(6), "N=6 align");
    const floorStep = floors[floors.length - 1].mx - floors[floors.length - 2].mx;
    const bandStep = bands[bands.length - 1].mx - bands[bands.length - 1].mn;
    assertClose(bandStep, floorStep, 1e-6, "plate band thickness == inlay layer step");
  });
  // --- Höhe je Farbe (auto layer heights): engraved Einfarbig elements share the same layout.
  // Floor TOP of rank r sits at depth (r+1)*s, exactly where plate band (base, c0, c1, …)
  // for that color begins — so every printed layer stays one solid color across the piece.
  async function autoDoc(N, opts) {
    const o = opts || {};
    const cv = document.createElement("canvas"); cv.width = 10; cv.height = 10;
    const cx = cv.getContext("2d"); cx.fillStyle = "#000"; cx.fillRect(0, 0, 10, 10);
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    const d = defaultDoc();
    d.body.widthMm = 120; d.body.heightMm = 40; d.body.cornerRadiusMm = 0; d.body.baseColor = "#FFFFFF";
    d.body.thicknessMm = 3; d.body.layerHeightMm = 0.2; d.resolution = 96; d.autoLayerHeights = true; d.amsPalette = [];
    d.colorStepLayers = 2;
    if (o.base != null) d.body.baseThicknessMm = o.base;
    if (o.deck) d.topLayerColor = o.deck;
    d.elements = PAL.slice(0, N).map((hex, i) => {
      const el = makeElementV2("image", { src: "a", cxMm: 8 + i * 11, cyMm: 20, wMm: 8, hMm: 8 });
      el.color = hex; el.depth.mode = "solid"; el.depth.direction = "engraved"; el._img = img;
      return el;
    });
    return d;
  }
  function checkAuto(d, label) {
    const parts = buildParts(d);
    const floors = parts.filter(p => p.name.indexOf("farbe-") === 0).map(p => ({ hex: hexOf(p.color), ...zb(p.facets) }));
    const bands = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0)
      .map(p => ({ hex: hexOf(p.color), ...zb(p.facets) })).sort((a, b) => b.mx - a.mx);
    for (const f of floors) assert(onGrid(f.mn) && onGrid(f.mx), label + ": floor " + f.hex + " " + f.mn.toFixed(3) + ".." + f.mx.toFixed(3) + " on layer grid");
    assertEqual(new Set(floors.map(f => f.mx.toFixed(4))).size, floors.length, label + ": distinct floor heights");
    for (const b of bands) assert(onGrid(b.mn) && onGrid(b.mx), label + ": plate band " + b.hex + " " + b.mn.toFixed(3) + ".." + b.mx.toFixed(3) + " on layer grid");
    // Each color's floor surface is level with the TOP of its own plate band.
    for (const f of floors) {
      const b = bands.find(x => x.hex === f.hex);
      assert(b, label + ": plate band for " + f.hex);
      assertClose(f.mx, b.mx, 1e-6, label + ": floor " + f.hex + " level with its plate band");
    }
    return { floors, bands };
  }
  for (const N of [4, 6, 8]) {
    test("auto stack: " + N + " engraved Einfarbig colors on the layer grid, aligned with plate bands", async () => {
      checkAuto(await autoDoc(N), "auto N=" + N);
    });
  }
  test("auto stack: tight base still gets whole-layer steps", async () => {
    checkAuto(await autoDoc(3, { base: 2.4 }), "auto tight");
  });
  test("auto stack: 6 colors + Deckschicht aligned", async () => {
    checkAuto(await autoDoc(6, { deck: "#123456" }), "auto N=6+deck");
  });
  test("auto stack: editor height readout matches the build", async () => {
    const d = await autoDoc(6);
    const { floors } = checkAuto(d, "auto readout");
    for (const el of d.elements) {
      const f = floors.find(x => x.hex === el.color.toUpperCase());
      assertClose(window.autoSolidHeightMm(d, el), 3 - f.mx, 1e-6, "readout for " + el.color);
    }
  });

  test("ams stack: up to 3 colors keep the full colorStepLayers step (unchanged look)", async () => {
    const { floors } = checkStack(await amsDoc(3), "N=3");
    assertClose(floors[1].mx - floors[0].mx, 0.4, 1e-6, "2-layer step preserved when it fits");
  });
})();
