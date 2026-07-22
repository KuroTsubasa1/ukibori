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

  async function imgSolid(w, h, fill) { // opaque square: alpha silhouette (raised) + luminance vs threshold (engraved)
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.fillStyle = fill || "#000000"; cx.fillRect(0, 0, w, h);
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  // True iff the part's horizontal cap at height z covers point (x,y): barycentric test
  // over facets whose three vertices all sit at z. Robust against triangulation choices
  // (a centroid-in-box probe is NOT — large cap triangles can miss any given box).
  function faceCovers(part, x, y, z) {
    for (const t of part.facets) {
      if (Math.abs(t[0][2] - z) > 1e-6 || Math.abs(t[1][2] - z) > 1e-6 || Math.abs(t[2][2] - z) > 1e-6) continue;
      const ax = t[0][0], ay = t[0][1], bx = t[1][0], by = t[1][1], cx = t[2][0], cy = t[2][1];
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
      if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) return true;
    }
    return false;
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

  test("auto-heights: palette colors sit at ABSOLUTE slots (consistent with AMS images)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.amsPalette = ["#112233", "#FF0000"]; // slot 1 is used by NO element
    d.elements = [solidEl(img, "#FF0000", 30)];
    const bands = bandsOf(buildParts(d));
    assertEqual(bands.length, 2, "unused slot 1 prints as under-layer, red on top");
    assertEqual(bands[0].hex, "#112233", "level 1 = palette slot 1 (unused → under-layer, like AMS images)");
    assertClose(bands[0].zb.mx, T + step, 1e-4, "slot-1 under-layer one step thick");
    assertEqual(bands[1].hex, "#FF0000", "red keeps its ABSOLUTE palette slot 2");
    assertClose(bands[1].zb.mx, T + 2 * step, 1e-4, "red tops at 2 steps (not compacted to 1)");
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

  test("auto-heights engraved: tight carve budget keeps floors DISTINCT and grid-aligned", async () => {
    // AMS layer alignment (2026-07-22): floors now share the plate-band plan. bandHexes =
    // [base, #FF0000, #00FF00] (N=3); avail = T-minBase = 0.6; bandThick = layerH * floor(
    // min(step, 0.6/3=0.2)/layerH) = 0.2 (snapped, still a whole layer). Each floor TOP == its
    // plate band top (T - index*bandThick), distinct per color; their bottoms both meet the
    // solid base (minBase=2.4) so distinctness lives at the visible TOP, on the grid. (Old
    // model compressed z0 to 0.1/0.2mm off-grid steps below T-floor.)
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.body.baseThicknessMm = 2.4; // floor=0.4, minBase=2.4 → avail=0.6
    d.elements = [solidEl(img, "#FF0000", 15, "engraved"), solidEl(img, "#00FF00", 45, "engraved")];
    const floors = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0);
    const topByColor = {}; floors.forEach(p => { topByColor[hexOf(p.color)] = zbounds(p.facets).mx; });
    const bandThick = 0.2; // snapped
    assertClose(topByColor["#FF0000"], T - 1 * bandThick, 1e-4, "rank 0 floor top == its band top (T-bandThick)");
    assertClose(topByColor["#00FF00"], T - 2 * bandThick, 1e-4, "rank 1 floor top == its band top (distinct)");
    assert(Math.abs(topByColor["#FF0000"] - topByColor["#00FF00"]) > 1e-3, "floors stay distinct at the top");
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
    // AMS layer alignment (2026-07-22): overridden colors keep their plan slots, so bandHexes =
    // [base, #FF0000, #00FF00, #0000FF] (N=4). Red is auto → aligned to its band (index 1,
    // recess bandThick). Green/blue are pinned by heightOverrideMm (opt out of the plan), so
    // they keep their classic baseUnder recess. (bandThick = 0.4 here → red z0 == old rank-0.)
    const bandThick = layerH * Math.max(1, Math.floor(Math.min(step, (T - minBase) / 4) / layerH));
    const alignedZ0 = (j) => Math.max(T - j * bandThick - floor, minBase);
    assertClose(byColor["#FF0000"], alignedZ0(1), 1e-4, "red automatic, aligned to band index 1");
    assertClose(byColor["#00FF00"], baseUnder(1.0), 1e-4, "green pinned at 1.0mm recess (override opts out)");
    assertClose(byColor["#0000FF"], baseUnder(0.2), 1e-4, "blue 0.05 clamps up to layerH (printable)");
  });

  test("auto-heights engraved: plate splits into solid color bands matching the carve ranks", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.elements = [solidEl(img, "#FF0000", 12, "engraved"), solidEl(img, "#00FF00", 45, "engraved")];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0)
      .map(p => ({ name: p.name, hex: hexOf(p.color), zb: zbounds(p.facets) }))
      .sort((a, b) => b.zb.mn - a.zb.mn); // top first
    assertEqual(bands.length, 3, "base face band + one band per color");
    const bt = Math.min(step, (T - minBase) / 3);
    assertEqual(bands[0].hex, "#101010", "the FACE stays the base color");
    assertClose(bands[0].zb.mx, T, 1e-4, "face band reaches the plate top");
    assertClose(bands[0].zb.mn, T - bt, 1e-4, "face band is one band step thick");
    assertEqual(bands[1].hex, "#FF0000", "rank-0 color one step below the face");
    assertEqual(bands[2].hex, "#00FF00", "rank-1 color below that");
    assertClose(bands[2].zb.mn, T - 3 * bt, 1e-4, "third band bottom");
  });

  test("auto-heights engraved: base-colored elements + base face = ONE solid top layer (user scenario)", async () => {
    // 3 engraved motifs: black + two base-blue ones; base = same blue. Blue is flush,
    // black carves — the workpiece face must be SOLID blue (base band + flush floors
    // share the color AND the z-range), black bands one step below. A Deckschicht in
    // the base color changes nothing (it IS the face).
    const img = await imgSolid(20, 20);
    const mk = (deck) => {
      const d = autoDoc();
      d.body.baseColor = "#2244cc";
      if (deck) d.topLayerColor = "#2244cc"; // same as base → ignored, face stays base
      d.elements = [solidEl(img, "#2244CC", 12, "engraved"), solidEl(img, "#000000", 30, "engraved"),
                    solidEl(img, "#2244CC", 48, "engraved")];
      return d;
    };
    for (const deck of [false, true]) {
      const parts = buildParts(mk(deck));
      const bands = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0)
        .map(p => ({ hex: hexOf(p.color), zb: zbounds(p.facets) }))
        .sort((a, b) => b.zb.mn - a.zb.mn);
      assertEqual(bands.length, 2, "face + black band (deck=" + deck + ")");
      assertEqual(bands[0].hex, "#2244CC", "face band = base blue (deck=" + deck + ")");
      assertClose(bands[0].zb.mx, T, 1e-4, "face at the top");
      assertEqual(bands[1].hex, "#000000", "black one step below the face");
      // flush blue floors sit exactly IN the face band's z-range → the top layer is one color
      const flushFloors = parts.filter(p => p.name.indexOf("farbe-") === 0 && hexOf(p.color) === "#2244CC");
      assert(flushFloors.length >= 1, "flush blue floors present");
      for (const f of flushFloors) {
        const zb = zbounds(f.facets);
        assertClose(zb.mx, T, 1e-4, "flush floor tops at the plate face");
        assert(zb.mn >= bands[0].zb.mn - 1e-4 || zb.mn >= T - floor - 1e-4, "flush floor inside the face zone");
      }
    }
  });

  test("auto-heights engraved: no plate bands when off, raised-only, or all overridden", async () => {
    const img = await imgSolid(20, 20);
    const noBands = (d) => !buildParts(d).some(p => p.name.indexOf("grundplatte-band-") === 0);
    const d1 = autoDoc(); d1.autoLayerHeights = false;
    d1.elements = [solidEl(img, "#FF0000", 15, "engraved")];
    assert(noBands(d1), "flag off → plain plate");
    const d2 = autoDoc();
    d2.elements = [solidEl(img, "#FF0000", 15, "raised")];
    assert(noBands(d2), "raised-only doc → plain plate (the raised stack carries the layers)");
    const d3 = autoDoc();
    const ov = solidEl(img, "#FF0000", 15, "engraved"); ov.depth.heightOverrideMm = 1.0;
    d3.elements = [ov];
    assert(noBands(d3), "only overridden elements → no participants → plain plate");
  });

  test("auto-heights engraved: Rand-Rahmen understructure bands with the interior", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.body.frame = { widthMm: 6, heightMm: 2, color: "#00AA00" };
    d.elements = [solidEl(img, "#FF0000", 15, "engraved"), solidEl(img, "#00FF00", 45, "engraved")];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0);
    assertEqual(bands.length, 3, "plate bands present (base face + 2 colors)");
    let x0 = Infinity, x1 = -Infinity;
    for (const p of bands) for (const t of p.facets) for (const pt of t) { if (pt[0] < x0) x0 = pt[0]; if (pt[0] > x1) x1 = pt[0]; }
    assert(x0 <= 1 && x1 >= 59, "bands span the whole plate incl. the border ring: x∈[" + x0.toFixed(1) + "," + x1.toFixed(1) + "]");
    assert(parts.some(p => p.name === "rand"), "frame cap still present above the bands");
  });

  test("auto-heights Deckschicht raised: full-face level 1, motifs stack on top, base color punches through", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.topLayerColor = "#FFFFFF";
    const mask = solidEl(img, "#101010", 30); // base-colored, punches through the deck
    d.elements = [solidEl(img, "#FF0000", 12), mask, solidEl(img, "#00FF00", 48)];
    const parts = buildParts(d);
    const deckPart = parts.find(p => p.name === "deckschicht");
    assert(!!deckPart, "deck slab present as its own part");
    assertEqual(hexOf(deckPart.color), "#FFFFFF", "deck in the Deckschicht color");
    const dzb = zbounds(deckPart.facets), dxb = xbounds(deckPart.facets);
    assertClose(dzb.mn, T, 1e-4, "deck starts at the plate top");
    assertClose(dzb.mx, T + step, 1e-4, "deck is one step thick");
    assert(dxb.mn < 2 && dxb.mx > 58, "deck covers the whole plate face");
    // punch-through, pinned by real cap coverage (centroid probes cannot see a missing hole)
    assert(!faceCovers(deckPart, 30, 30, T + step), "deck cap has a hole over the base-colored element");
    assert(faceCovers(deckPart, 12, 30, T + step), "deck cap covers a participating motif region");
    assert(faceCovers(deckPart, 30, 8, T + step), "deck cap covers plain plate face");
    const bands = bandsOf(parts);
    assertEqual(bands.length, 2, "one level per motif color above the deck");
    assertEqual(bands[0].hex, "#FF0000", "red is layer 2 now");
    assertClose(bands[0].zb.mx, T + 2 * step, 1e-4, "red pushed one step up by the deck");
    assertClose(bands[1].zb.mx, T + 3 * step, 1e-4, "green tops at 3 steps");
  });

  test("auto-heights Deckschicht engraved: top band = deck color, carves deeper; deck counts in the carve budget", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.topLayerColor = "#FFFFFF";
    d.body.baseThicknessMm = 2.4; // TIGHT budget: maxRecess=0.2 → compression divisor (3, incl. deck) is live
    d.elements = [solidEl(img, "#FF0000", 12, "engraved"), solidEl(img, "#00FF00", 45, "engraved")];
    const parts = buildParts(d);
    const pb = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0)
      .map(p => ({ hex: hexOf(p.color), zb: zbounds(p.facets) })).sort((a, b) => b.zb.mn - a.zb.mn);
    assertEqual(pb.length, 4, "deck + base band + one band per color");
    assertEqual(pb[0].hex, "#FFFFFF", "top band = Deckschicht");
    assertEqual(pb[1].hex, "#101010", "base band directly below the deck");
    assertClose(pb[0].zb.mx, T, 1e-4, "deck band at the plate top");
    // AMS layer alignment (2026-07-22): bandHexes = [deck, base, #FF0000, #00FF00] (N=4). avail =
    // T-2.4 = 0.6 < N*layerH = 0.8, so bandThick uses the documented degenerate fallback
    // min(step, avail/N) = 0.15 (colors still distinct, off-grid because the plate is too thin to
    // fit 4 whole layers). Each motif floor TOP == its plate band top = T - index*bandThick.
    const bandThick = Math.min(step, (T - 2.4) / 4);
    assertClose(pb[0].zb.mn, T - bandThick, 1e-4, "deck band thickness = degenerate bandThick");
    const topByColor = {}; parts.filter(p => p.name.indexOf("farbe-") === 0).forEach(p => { topByColor[hexOf(p.color)] = zbounds(p.facets).mx; });
    assertClose(topByColor["#FF0000"], T - 2 * bandThick, 1e-4, "red floor top == its band top (index 2, through the deck)");
    assertClose(topByColor["#00FF00"], T - 3 * bandThick, 1e-4, "green floor top == its band top (index 3, distinct)");
    assert(Math.abs(topByColor["#FF0000"] - topByColor["#00FF00"]) > 1e-3, "floors stay distinct at the top");
  });

  test("Deckschicht AMS raised: shared-palette stack rides one step up on the full-face deck", async () => {
    // Pin flag-independence: the deck serves pure Farbebenen-AMS docs without Höhe je Farbe.
    const cv = document.createElement("canvas"); cv.width = 30; cv.height = 20;
    const c2 = cv.getContext("2d");
    c2.fillStyle = "#000000"; c2.fillRect(0, 0, 15, 20);
    c2.fillStyle = "#f0f0f0"; c2.fillRect(15, 0, 15, 20);
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    const d = autoDoc();
    d.autoLayerHeights = false;
    d.amsPalette = ["#000000", "#F0F0F0"];
    d.topLayerColor = "#FFCC00";
    const el = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 20, hMm: 20 });
    el.depth.direction = "raised"; el.depth.mode = "colorLayers"; el.depth.colorLayerStyle = "bands";
    el.depth.reduce = { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] };
    el._img = img;
    d.elements = [el];
    const parts = buildParts(d);
    const deck = parts.find(p => p.name === "deckschicht");
    assert(!!deck, "deck slab present (no Höhe-je-Farbe flag needed)");
    assertEqual(hexOf(deck.color), "#FFCC00", "deck in the Deckschicht color");
    assertClose(zbounds(deck.facets).mn, T, 1e-4, "deck starts at the plate top");
    assertClose(zbounds(deck.facets).mx, T + step, 1e-4, "deck is one step thick");
    const xbD = xbounds(deck.facets);
    assert(xbD.mn < 2 && xbD.mx > 58, "deck covers the whole plate face");
    assert(faceCovers(deck, 30, 30, T + step), "deck runs UNDER the AMS element (stack rides on it)");
    const l1 = parts.find(p => p.name === "farbschicht-1-1"), l2 = parts.find(p => p.name === "farbschicht-1-2");
    assert(!!l1 && !!l2, "both palette layers present");
    assertClose(zbounds(l1.facets).mn, T + step, 1e-4, "palette layer 1 sits ON the deck");
    assertClose(zbounds(l2.facets).mx, T + 3 * step, 1e-4, "palette layer 2 shifted one step up");
  });

  test("Deckschicht AMS engraved: deck tops the plate bands, palette carves deeper (budget incl. deck)", async () => {
    const cv = document.createElement("canvas"); cv.width = 30; cv.height = 20;
    const c2 = cv.getContext("2d");
    c2.fillStyle = "#000000"; c2.fillRect(0, 0, 15, 20);
    c2.fillStyle = "#f0f0f0"; c2.fillRect(15, 0, 15, 20);
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    const d = autoDoc();
    d.autoLayerHeights = false;
    d.amsPalette = ["#000000", "#F0F0F0"];
    d.topLayerColor = "#FFCC00";
    d.body.baseThicknessMm = 2.4; // TIGHT budget: maxRecess=0.2 → divisor (palette+deck=3) is live
    const el = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 20, hMm: 20 });
    el.depth.direction = "engraved"; el.depth.mode = "colorLayers"; el.depth.colorLayerStyle = "bands";
    el.depth.reduce = { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] };
    el._img = img;
    d.elements = [el];
    const parts = buildParts(d);
    const pb = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0)
      .map(p => ({ hex: hexOf(p.color), zb: zbounds(p.facets) })).sort((a, b) => b.zb.mn - a.zb.mn);
    assertEqual(pb.length, 3, "deck + one plate band per palette layer");
    assertEqual(pb[0].hex, "#FFCC00", "top band = Deckschicht");
    assertClose(pb[0].zb.mx, T, 1e-4, "deck band at the plate top");
    assertEqual(pb[1].hex, "#000000", "palette layer 1 below the deck");
    // AMS layer alignment (2026-07-22): bandHexes = [deck, #000000, #F0F0F0] (deckShift=1, N=3).
    // avail = T-2.4 = 0.6 == N*layerH, so bandThick snaps to 0.2 (one whole layer). Each motif
    // floor TOP == its plate band top = T - index*bandThick (index = ams index + deck shift).
    const bandThick = layerH * Math.max(1, Math.floor(Math.min(step, (T - 2.4) / 3) / layerH));
    const topByColor = {}; parts.filter(p => p.name.indexOf("farbe-") === 0).forEach(p => { topByColor[hexOf(p.color)] = zbounds(p.facets).mx; });
    assertClose(topByColor["#000000"], T - 1 * bandThick, 1e-4, "palette layer 1 floor top == its band top (through the deck)");
    assertClose(topByColor["#F0F0F0"], T - 2 * bandThick, 1e-4, "palette layer 2 floor top == its band top (distinct)");
    assert(Math.abs(topByColor["#000000"] - topByColor["#F0F0F0"]) > 1e-3, "floors stay distinct at the top");
  });

  test("auto-heights engraved: deck ≠ base → deck ONE band on top, flush level one band down (user scenario)", async () => {
    // base blue, deck yellow, black motif + blue (base-colored) motifs: expected
    // stack top-down = yellow (deck) · blue (base + flush floors) · black.
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.body.baseColor = "#2244cc";
    d.topLayerColor = "#FFCC00";
    d.elements = [solidEl(img, "#2244CC", 12, "engraved"), solidEl(img, "#000000", 30, "engraved"),
                  solidEl(img, "#2244CC", 48, "engraved")];
    const parts = buildParts(d);
    const pb = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0)
      .map(p => ({ hex: hexOf(p.color), zb: zbounds(p.facets) })).sort((a, b) => b.zb.mn - a.zb.mn);
    assertEqual(pb.length, 3, "deck + base + black bands");
    assertEqual(pb[0].hex, "#FFCC00", "deck is the topmost band");
    assertEqual(pb[1].hex, "#2244CC", "base band directly below the deck");
    assertEqual(pb[2].hex, "#000000", "black below the base level");
    // blue flush floors carve through the deck: tops at T - 1*step', inside the base band zone
    const sD = Math.min(step, maxRecess / 2); // order = [deck, black] → divisor 2
    const blueFloors = parts.filter(p => p.name.indexOf("farbe-") === 0 && hexOf(p.color) === "#2244CC");
    assert(blueFloors.length >= 1, "flush blue floors present");
    for (const f of blueFloors) assertClose(zbounds(f.facets).mx, T - sD, 1e-4, "flush floor one band below the deck");
    // black carves one step deeper than the flush level
    const black = parts.filter(p => p.name.indexOf("farbe-") === 0 && hexOf(p.color) === "#000000")[0];
    assertClose(zbounds(black.facets).mx, T - 2 * sD, 1e-4, "black floor below the flush level");
  });

  test("auto-heights Deckschicht: engraved-direction heightmap keeps its z-space (no deck overlap)", async () => {
    const img = await imgSolid(20, 20);
    const bright = await imgSolid(20, 20, "#C8C8C8"); // lum >= threshold → unowned pixels when engraved
    const d = autoDoc();
    d.topLayerColor = "#FFFFFF";
    const hm = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 14, hMm: 14 });
    hm.color = "#888888"; hm.depth.mode = "heightmap"; hm.depth.direction = "engraved";
    hm.depth.heightMm = 1; hm._img = bright;
    d.elements = [solidEl(img, "#FF0000", 12), hm];
    const parts = buildParts(d);
    const deck = parts.find(p => p.name === "deckschicht");
    assert(!!deck, "deck present");
    assert(!faceCovers(deck, 30, 30, T + step), "deck keeps out of the heightmap element's region");
    assert(faceCovers(deck, 30, 8, T + step), "deck still covers the plain plate face");
    assert(parts.some(p => p.name.indexOf("hoehe-") === 0), "heightmap relief present");
  });

  test("auto-heights Deckschicht: base-colored deck is ignored (plate face already is that color)", async () => {
    const img = await imgSolid(20, 20);
    const d = autoDoc();
    d.topLayerColor = "#101010"; // == baseColor
    d.elements = [solidEl(img, "#FF0000", 15), solidEl(img, "#00FF00", 45)];
    const parts = buildParts(d);
    assert(!parts.some(p => p.name === "deckschicht"), "no deck part");
    const bands = bandsOf(parts);
    assertEqual(bands.length, 2, "no deck level");
    assertEqual(bands[0].hex, "#FF0000", "red stays level 1");
    assertClose(bands[0].zb.mx, T + step, 1e-4, "heights unshifted");
  });

  test("auto-heights Deckschicht model: default off, migration backfill, round-trip", () => {
    assert(defaultDoc().topLayerColor === null, "new docs: no deck");
    const d = defaultDoc(); d.elements = [];
    const saved = JSON.parse(serializeProject(d));
    delete saved.topLayerColor;
    assert(migrateProject(saved).topLayerColor === null, "pre-feature saves backfill null");
    const d2 = defaultDoc(); d2.topLayerColor = "#FFAA00"; d2.elements = [];
    assertEqual(migrateProject(JSON.parse(serializeProject(d2))).topLayerColor, "#FFAA00", "deck color survives round-trip");
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
