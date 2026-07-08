"use strict";
// Auto layer heights (Höhe je Farbe): with doc.autoLayerHeights on, Einfarbig (solid)
// elements print AMS-style — the raised relief becomes ONE global banded stack where
// level L is a full slab colored by the L-th distinct color (amsPalette order first,
// then element stacking order), so every printed layer is a single solid color across
// the whole piece. Base-colored elements stay flush with the plate (they punch through
// the stack), a set depth.heightOverrideMm opts an element out into its own classic
// prism (its color keeps its rank). Engraved elements recess by (rank+1)*step,
// compressed into the carve budget. Off → classic depth.heightMm parity.
(function () {
  function zbounds(f) { let mn = Infinity, mx = -Infinity; for (const t of f) for (const p of t) { if (p[2] < mn) mn = p[2]; if (p[2] > mx) mx = p[2]; } return { mn, mx }; }
  function xbounds(f) { let mn = Infinity, mx = -Infinity; for (const t of f) for (const p of t) { if (p[0] < mn) mn = p[0]; if (p[0] > mx) mx = p[0]; } return { mn, mx }; }
  const hexOf = (rgb) => ("#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();

  async function imgSolid(w, h) { // opaque black square: alpha silhouette (raised) + dark under threshold (engraved)
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.fillStyle = "#000000"; cx.fillRect(0, 0, w, h);
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  function autoDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 60;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
    d.body.layerHeightMm = 0.2; d.colorStepLayers = 2; d.resolution = 64;
    d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    d.autoLayerHeights = true;
    return d;
  }
  function solidEl(img, color, cxMm, direction) {
    const el = makeElementV2("image", { src: "a", cxMm, cyMm: 30, wMm: 14, hMm: 14 });
    el.color = color; el.depth.direction = direction || "raised"; el._img = img;
    return el;
  }
  const T = 3, layerH = 0.2, step = 0.4; // step = colorStepLayers(2) * layerH
  const floor = Math.min(2 * layerH, T);
  const minBase = Math.min(Math.max(0.8, T * 0.34, 2 * layerH), Math.max(0, T - floor));
  const maxRecess = Math.max(0, T - floor - minBase);
  const baseUnder = (dd) => T - Math.max(0, Math.min(dd, maxRecess)) - floor;
  // The global auto stack: farbschicht-auto-N parts sorted bottom-up.
  const bandsOf = (parts) => parts
    .filter(p => p.name.indexOf("farbschicht-auto-") === 0)
    .map(p => ({ hex: hexOf(p.color), zb: zbounds(p.facets), xb: xbounds(p.facets) }))
    .sort((a, b) => a.zb.mn - b.zb.mn);
  const prismsOf = (parts) => parts.filter(p => p.name.indexOf("erhaben-") === 0);

  test("auto-heights raised: full solid slab per color — lower colors run under higher ones", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#FF0000", 15), solidEl(img, "#00FF00", 45)];
    const parts = buildParts(d);
    const bands = bandsOf(parts);
    assertEqual(bands.length, 2, "one slab per distinct color");
    assertEqual(bands[0].hex, "#FF0000", "level 1 = first color");
    assertClose(bands[0].zb.mn, T, 1e-4, "level 1 starts at the plate top");
    assertClose(bands[0].zb.mx, T + step, 1e-4, "level 1 is one step thick");
    assert(bands[0].xb.mx > 45 - 7 + 1, "level 1 runs UNDER the green element too (solid layer)");
    assertEqual(bands[1].hex, "#00FF00", "level 2 = second color");
    assertClose(bands[1].zb.mn, T + step, 1e-4, "level 2 sits on level 1");
    assertClose(bands[1].zb.mx, T + 2 * step, 1e-4, "level 2 tops at 2*step");
    assert(bands[1].xb.mn > 15 + 7 - 1, "level 2 covers only the green element");
    assertEqual(prismsOf(parts).length, 0, "no classic prisms — all elements live in the stack");
  });

  test("auto-heights raised: elements sharing a color share one level", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#FF0000", 15), solidEl(img, "#FF0000", 45)];
    const bands = bandsOf(buildParts(d));
    assertEqual(bands.length, 1, "one shared level for one color");
    assertClose(bands[0].zb.mx, T + step, 1e-4, "level 1 top");
    assert(bands[0].xb.mn < 15 && bands[0].xb.mx > 45, "slab spans both elements");
  });

  test("auto-heights raised: base-colored element is flush — punches through the stack", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#101010", 15), solidEl(img, "#FF0000", 45)]; // first = base color
    const parts = buildParts(d);
    const bands = bandsOf(parts);
    assertEqual(bands.length, 1, "base-colored element takes no level");
    assertEqual(bands[0].hex, "#FF0000", "only red prints");
    assert(bands[0].xb.mn > 15 + 7 - 1, "no slab over the base-colored element (flush)");
    assertEqual(prismsOf(parts).length, 0, "no classic prisms in full-auto mode");
  });

  test("auto-heights raised: base-colored element ON TOP punches through the stack (occlusion)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    const red = solidEl(img, "#FF0000", 30); red.wMm = 20; red.hMm = 20;        // x [20,40], y [20,40]
    const mask = makeElementV2("image", { src: "a", cxMm: 23, cyMm: 30, wMm: 18, hMm: 26 }); // x [14,32], y ⊇ red's
    mask.color = "#101010"; mask.depth.direction = "raised"; mask._img = img;   // base color, stacked ON TOP of red
    d.elements = [red, mask];
    const bands = bandsOf(buildParts(d));
    assertEqual(bands.length, 1, "only red prints a level");
    assert(bands[0].xb.mn > 30, "level 1 has a hole where the base-colored element covers red");
    assert(bands[0].xb.mx > 38, "level 1 still covers the un-occluded remainder of red");
  });

  test("auto-heights raised: heightOverrideMm opts the element out into its own prism; 0 = flush", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    const red = solidEl(img, "#FF0000", 12), green = solidEl(img, "#00FF00", 30), blue = solidEl(img, "#0000FF", 48);
    green.depth.heightOverrideMm = 1.4; blue.depth.heightOverrideMm = 0;
    d.elements = [red, green, blue];
    const parts = buildParts(d);
    const bands = bandsOf(parts);
    assertEqual(bands.length, 1, "only red remains in the auto stack");
    assertEqual(bands[0].hex, "#FF0000", "red is level 1");
    assert(bands[0].xb.mx < 30 - 7 + 1, "red slab does NOT run under overridden/flush elements");
    const pr = prismsOf(parts);
    assertEqual(pr.length, 1, "green prints as its own pinned prism; blue (0) is flush");
    assertEqual(hexOf(pr[0].color), "#00FF00", "prism keeps the element's own color");
    assertClose(zbounds(pr[0].facets).mx, T + 1.4, 1e-4, "green pinned at 1.4mm");
  });

  test("auto-heights raised: overridden element's color keeps its rank (others don't shift)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    const red = solidEl(img, "#FF0000", 12), green = solidEl(img, "#00FF00", 30), blue = solidEl(img, "#0000FF", 48);
    green.depth.heightOverrideMm = 1.4; // green's COLOR still occupies rank 1
    d.elements = [red, green, blue];
    const bands = bandsOf(buildParts(d));
    assertEqual(bands.length, 3, "levels 1..3 present — green's level prints under blue");
    assertEqual(bands[1].hex, "#00FF00", "level 2 keeps green's filament color");
    assert(bands[1].xb.mn > 30 + 7 - 1, "phantom green level covers only blue, not green's own (overridden) footprint");
    assertEqual(bands[2].hex, "#0000FF", "blue stays level 3 — override doesn't re-rank");
    assertClose(bands[2].zb.mx, T + 3 * step, 1e-4, "blue tops at 3 steps");
  });

  test("auto-heights raised: amsPalette order beats element stacking order", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.amsPalette = ["#00FF00", "#FF0000"];
    d.elements = [solidEl(img, "#FF0000", 15), solidEl(img, "#00FF00", 45)];
    const bands = bandsOf(buildParts(d));
    assertEqual(bands[0].hex, "#00FF00", "palette layer 1 prints first");
    assertEqual(bands[1].hex, "#FF0000", "palette layer 2 on top");
    assertClose(bands[1].zb.mx, T + 2 * step, 1e-4, "red tops at 2 steps");
  });

  test("auto-heights: lowercase hex matches base color and shares levels (color inputs give lowercase)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc(); // baseColor '#101010' (lowercase in the doc)
    d.elements = [solidEl(img, "#ff0000", 12), solidEl(img, "#FF0000", 30), solidEl(img, "#101010", 48)];
    const bands = bandsOf(buildParts(d));
    assertEqual(bands.length, 1, "ff0000 and FF0000 share one level; base-colored takes none");
    assert(bands[0].xb.mn < 12 && bands[0].xb.mx > 30, "slab spans both red elements");
    assert(bands[0].xb.mx < 48 + 7 - 1, "no slab over the base-colored element");
  });

  test("auto-heights off: classic depth.heightMm behavior, override ignored", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.autoLayerHeights = false;
    const red = solidEl(img, "#FF0000", 15), green = solidEl(img, "#00FF00", 45);
    green.depth.heightOverrideMm = 1.4; // must be inert when the feature is off
    d.elements = [red, green];
    const parts = buildParts(d);
    assertEqual(bandsOf(parts).length, 0, "no auto stack when off");
    const tops = {}; prismsOf(parts).forEach(p => { tops[hexOf(p.color)] = zbounds(p.facets).mx; });
    assertClose(tops["#FF0000"], T + 1.0, 1e-4, "default heightMm = 1.0");
    assertClose(tops["#00FF00"], T + 1.0, 1e-4, "override ignored when off");
  });

  test("auto-heights engraved: distinct floor depths; base-colored carves nothing", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#FF0000", 12, "engraved"), solidEl(img, "#00FF00", 30, "engraved"),
                  solidEl(img, "#101010", 48, "engraved")];
    const floors = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0);
    const byColor = {}; floors.forEach(p => { const h = hexOf(p.color); const zb = zbounds(p.facets); byColor[h] = zb; });
    const s = Math.min(step, maxRecess / 2); // 2 non-base colors in the engraved stack
    assertClose(byColor["#FF0000"].mn, baseUnder(1 * s), 1e-4, "first color at depth 1*step");
    assertClose(byColor["#00FF00"].mn, baseUnder(2 * s), 1e-4, "second color at depth 2*step");
    assertClose(byColor["#101010"].mx, T, 1e-4, "base-colored floor flush with the plate top");
  });

  test("auto-heights engraved: tight carve budget compresses the stack but keeps floors DISTINCT", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.body.baseThicknessMm = 2.4; // floor=0.4, minBase=2.4 → maxRecess=0.2 → step'=0.1 (< layerH!)
    d.elements = [solidEl(img, "#FF0000", 15, "engraved"), solidEl(img, "#00FF00", 45, "engraved")];
    const floors = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0);
    const byColor = {}; floors.forEach(p => { byColor[hexOf(p.color)] = zbounds(p.facets).mn; });
    const bu = (dd) => T - Math.min(dd, 0.2) - floor; // local budget: maxRecess = 3 - 0.4 - 2.4 = 0.2
    assertClose(byColor["#FF0000"], bu(0.1), 1e-4, "rank 0 at compressed 0.1mm (no layerH clamp)");
    assertClose(byColor["#00FF00"], bu(0.2), 1e-4, "rank 1 at 0.2mm — floors stay distinct");
  });

  test("auto-heights engraved: override recesses by its value, clamped to >= layerH", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    const red = solidEl(img, "#FF0000", 12, "engraved"), green = solidEl(img, "#00FF00", 30, "engraved"),
          blue = solidEl(img, "#0000FF", 48, "engraved");
    green.depth.heightOverrideMm = 1.0; blue.depth.heightOverrideMm = 0.05; // 0.05 < layerH → clamps to 0.2
    d.elements = [red, green, blue];
    const floors = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0);
    const byColor = {}; floors.forEach(p => { byColor[hexOf(p.color)] = zbounds(p.facets).mn; });
    const s3 = Math.min(step, maxRecess / 3); // overridden colors keep their ranks → 3 in the stack
    assertClose(byColor["#FF0000"], baseUnder(1 * s3), 1e-4, "red automatic at rank-0 depth");
    assertClose(byColor["#00FF00"], baseUnder(1.0), 1e-4, "green pinned at 1.0mm recess");
    assertClose(byColor["#0000FF"], baseUnder(0.2), 1e-4, "blue 0.05 clamps up to layerH (printable)");
  });

  test("auto-heights: raised and engraved stacks rank independently (per direction)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#FF0000", 15, "raised"), solidEl(img, "#0000FF", 45, "engraved")];
    const parts = buildParts(d);
    const bands = bandsOf(parts);
    assertEqual(bands.length, 1, "red is raised level 1 (blue takes no raised rank)");
    assertClose(bands[0].zb.mx, T + 1 * step, 1e-4, "red level 1 top");
    const blue = parts.filter(p => p.name.indexOf("farbe-") === 0).find(p => hexOf(p.color) === "#0000FF");
    const s1 = Math.min(step, maxRecess / 1); // blue is ALONE in the engraved stack
    assertClose(zbounds(blue.facets).mn, baseUnder(1 * s1), 1e-4, "blue = engraved layer 1, not layer 2");
  });

  test("auto-heights: cutout and undecoded-image elements take no level", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    const hole = solidEl(img, "#FF0000", 12); hole.cutout = true;               // punches a hole, prints nothing
    const ghost = solidEl(null, "#00AA00", 30); ghost._img = null;              // undecoded image, prints nothing
    const black = solidEl(img, "#123456", 48);
    d.elements = [hole, ghost, black];
    const bands = bandsOf(buildParts(d));
    assertEqual(bands.length, 1, "only the printing element gets a level");
    assertEqual(bands[0].hex, "#123456", "black is level 1 — phantoms shift nothing");
    assertClose(bands[0].zb.mx, T + 1 * step, 1e-4, "level 1 top");
  });

  test("auto-heights model: defaults, migration backfill, round-trip", () => {
    assert(defaultDoc().autoLayerHeights === true, "new docs default ON");
    assert(makeElementV2("text", {}).depth.heightOverrideMm === null, "new elements have no override");
    // Pre-feature v2 save: flag + override absent → OFF / null (geometry unchanged).
    const d = defaultDoc(); d.elements = [makeElementV2("text", {})];
    const saved = JSON.parse(serializeProject(d));
    delete saved.autoLayerHeights; delete saved.elements[0].depth.heightOverrideMm;
    const m = migrateProject(saved);
    assert(m.autoLayerHeights === false, "pre-feature saves migrate OFF");
    assert(m.elements[0].depth.heightOverrideMm === null, "override backfilled to null");
    // Post-feature save keeps both verbatim.
    const d2 = defaultDoc(); d2.elements = [makeElementV2("text", {})];
    d2.elements[0].depth.heightOverrideMm = 1.2;
    const m2 = migrateProject(JSON.parse(serializeProject(d2)));
    assert(m2.autoLayerHeights === true, "flag survives round-trip");
    assertClose(m2.elements[0].depth.heightOverrideMm, 1.2, 1e-9, "override survives round-trip");
  });
})();
