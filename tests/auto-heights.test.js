"use strict";
// Auto layer heights (Höhe je Farbe): with doc.autoLayerHeights on, an Einfarbig (solid)
// element's height comes from its COLOR, AMS-style — same color = same layer, distinct
// colors stack in colorStepLayers*layerHeightMm steps (amsPalette order first, then element
// stacking order), base-colored elements stay flush with the plate, and a set
// depth.heightOverrideMm pins one element manually. Off → classic depth.heightMm parity.
(function () {
  function zbounds(f) { let mn = Infinity, mx = -Infinity; for (const t of f) for (const p of t) { if (p[2] < mn) mn = p[2]; if (p[2] > mx) mx = p[2]; } return { mn, mx }; }
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
  const raisedTops = (parts) => { // color hex -> max top z over its erhaben prisms
    const out = {};
    parts.filter(p => p.name.indexOf("erhaben-") === 0).forEach(p => {
      const h = hexOf(p.color), mx = zbounds(p.facets).mx;
      if (out[h] == null || mx > out[h]) out[h] = mx;
    });
    return out;
  };

  test("auto-heights raised: distinct colors stack in step increments (element order)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#FF0000", 15), solidEl(img, "#00FF00", 45)];
    const tops = raisedTops(buildParts(d));
    assertClose(tops["#FF0000"], T + 1 * step, 1e-4, "first color = layer 1");
    assertClose(tops["#00FF00"], T + 2 * step, 1e-4, "second color = layer 2");
  });

  test("auto-heights raised: elements sharing a color share one height", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#FF0000", 15), solidEl(img, "#FF0000", 45)];
    const parts = buildParts(d).filter(p => p.name.indexOf("erhaben-") === 0);
    assertEqual(parts.length, 2, "one prism per element");
    for (const p of parts) assertClose(zbounds(p.facets).mx, T + step, 1e-4, "both at layer 1");
  });

  test("auto-heights raised: base-colored element is flush (no prism, no rank)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#101010", 15), solidEl(img, "#FF0000", 45)]; // first = base color
    const parts = buildParts(d).filter(p => p.name.indexOf("erhaben-") === 0);
    assertEqual(parts.length, 1, "base-colored element emits no prism");
    assertEqual(hexOf(parts[0].color), "#FF0000", "only the red prism remains");
    assertClose(zbounds(parts[0].facets).mx, T + step, 1e-4, "red is layer 1 (base color takes no rank)");
  });

  test("auto-heights raised: heightOverrideMm pins one element; 0 = flush", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    const red = solidEl(img, "#FF0000", 12), green = solidEl(img, "#00FF00", 30), blue = solidEl(img, "#0000FF", 48);
    green.depth.heightOverrideMm = 1.4; blue.depth.heightOverrideMm = 0;
    d.elements = [red, green, blue];
    const tops = raisedTops(buildParts(d));
    assertClose(tops["#FF0000"], T + step, 1e-4, "red stays automatic (layer 1)");
    assertClose(tops["#00FF00"], T + 1.4, 1e-4, "green pinned at 1.4mm");
    assert(tops["#0000FF"] == null, "override 0 → flush, no prism");
  });

  test("auto-heights raised: amsPalette order beats element stacking order", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.amsPalette = ["#00FF00", "#FF0000"];
    d.elements = [solidEl(img, "#FF0000", 15), solidEl(img, "#00FF00", 45)];
    const tops = raisedTops(buildParts(d));
    assertClose(tops["#00FF00"], T + 1 * step, 1e-4, "palette layer 1");
    assertClose(tops["#FF0000"], T + 2 * step, 1e-4, "palette layer 2");
  });

  test("auto-heights off: classic depth.heightMm behavior, override ignored", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.autoLayerHeights = false;
    const red = solidEl(img, "#FF0000", 15), green = solidEl(img, "#00FF00", 45);
    green.depth.heightOverrideMm = 1.4; // must be inert when the feature is off
    d.elements = [red, green];
    const tops = raisedTops(buildParts(d));
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

  test("auto-heights raised: overridden element keeps its color's rank (others don't shift)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    const red = solidEl(img, "#FF0000", 12), green = solidEl(img, "#00FF00", 30), blue = solidEl(img, "#0000FF", 48);
    green.depth.heightOverrideMm = 1.4; // green's COLOR still occupies rank 1
    d.elements = [red, green, blue];
    const tops = raisedTops(buildParts(d));
    assertClose(tops["#0000FF"], T + 3 * step, 1e-4, "blue stays layer 3 — override doesn't re-rank");
  });

  test("auto-heights: lowercase hex matches base color and shares ranks (color inputs give lowercase)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc(); // baseColor '#101010' (lowercase in the doc)
    const a = solidEl(img, "#ff0000", 12), b = solidEl(img, "#FF0000", 30), c = solidEl(img, "#101010", 48);
    d.elements = [a, b, c];
    const parts = buildParts(d).filter(p => p.name.indexOf("erhaben-") === 0);
    assertEqual(parts.length, 2, "base-colored element (lowercase match) emits no prism");
    for (const p of parts) assertClose(zbounds(p.facets).mx, T + step, 1e-4, "ff0000 and FF0000 share layer 1");
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
    const tops = raisedTops(parts);
    assertClose(tops["#FF0000"], T + 1 * step, 1e-4, "red = raised layer 1 (blue takes no raised rank)");
    const blue = parts.filter(p => p.name.indexOf("farbe-") === 0).find(p => hexOf(p.color) === "#0000FF");
    const s1 = Math.min(step, maxRecess / 1); // blue is ALONE in the engraved stack
    assertClose(zbounds(blue.facets).mn, baseUnder(1 * s1), 1e-4, "blue = engraved layer 1, not layer 2");
  });

  test("auto-heights: cutout and undecoded-image elements take no rank", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    const hole = solidEl(img, "#FF0000", 12); hole.cutout = true;               // punches a hole, prints nothing
    const ghost = solidEl(null, "#00AA00", 30); ghost._img = null;              // undecoded image, prints nothing
    const black = solidEl(img, "#123456", 48);
    d.elements = [hole, ghost, black];
    const parts = buildParts(d).filter(p => p.name.indexOf("erhaben-") === 0);
    assertEqual(parts.length, 1, "only the printing element emits a prism");
    assertClose(zbounds(parts[0].facets).mx, T + 1 * step, 1e-4, "black is layer 1 — phantoms shift nothing");
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
