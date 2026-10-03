"use strict";
// Zierlinie: contour-following groove/ridge on rect/circle plates.
(function () {
  function zbounds(facets) {
    let mn = Infinity, mx = -Infinity;
    facets.forEach(t => t.forEach(v => { mn = Math.min(mn, v[2]); mx = Math.max(mx, v[2]); }));
    return { mn, mx };
  }

  function lineDoc(mode, over) {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 40;
    d.body.cornerRadiusMm = 4; d.body.thicknessMm = 3; d.body.layerHeightMm = 0.2;
    d.resolution = 96;
    d.autoLayerHeights = false;
    d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    d.body.line = Object.assign({ mode, insetMm: 3, widthMm: 1.2, depthMm: 0.6, count: 1, color: "#FF0000" }, over || {});
    return d;
  }

  test("zierlinie: mode none is byte-identical to the default doc", () => {
    const a = buildParts(lineDoc("none"));
    const d = lineDoc("none"); delete d.body.line;
    d.body.line = defaultLine();
    const b = buildParts(d);
    assertEqual(JSON.stringify(a), JSON.stringify(b), "parity with defaults");
  });

  test("zierlinie: raised emits a 'zierlinie' part on the plate top", () => {
    const parts = buildParts(lineDoc("raised"));
    const line = parts.filter(p => p.name === "zierlinie");
    assertEqual(line.length, 1, "one zierlinie part");
    const zb = zbounds(line[0].facets);
    assertClose(zb.mn, 3, 1e-9, "starts at the plate top");
    assertClose(zb.mx, 3.6, 1e-9, "depthMm tall");
    assertEqual(line[0].color[0], 255, "line color red");
    // the plate itself stays a full solid
    const grund = parts.filter(p => p.name === "grundplatte");
    assert(grund.some(p => Math.abs(zbounds(p.facets).mx - 3) < 1e-9), "plate reaches the top");
  });

  test("zierlinie: engraved splits the plate into floor and carved top slab", () => {
    const parts = buildParts(lineDoc("engraved"));
    const grund = parts.filter(p => p.name === "grundplatte");
    // top slab [T-depth, T] exists (carved: the groove band is missing from it)
    assert(grund.some(p => {
      const zb = zbounds(p.facets);
      return Math.abs(zb.mx - 3) < 1e-9 && Math.abs(zb.mn - 2.4) < 1e-9;
    }), "carved top slab [2.4, 3.0]");
    // and a slab below the groove floor tops out at T-depth
    assert(grund.some(p => Math.abs(zbounds(p.facets).mx - 2.4) < 1e-9), "slab below the groove floor");
    assertEqual(parts.filter(p => p.name === "zierlinie").length, 0, "no raised part in engraved mode");
    // geometry actually differs from no line
    assert(JSON.stringify(parts) !== JSON.stringify(buildParts(lineDoc("none"))), "differs from none");
  });

  test("zierlinie: double line differs from a single line", () => {
    const one = buildParts(lineDoc("raised"));
    const two = buildParts(lineDoc("raised", { count: 2 }));
    assert(JSON.stringify(one) !== JSON.stringify(two), "count changes the band");
  });

  test("zierlinie: an inset beyond the plate leaves no band (falls back to parity)", () => {
    const parts = buildParts(lineDoc("raised", { insetMm: 100 }));
    assertEqual(parts.filter(p => p.name === "zierlinie").length, 0, "no band, no part");
    assertEqual(JSON.stringify(parts), JSON.stringify(buildParts(lineDoc("none"))), "identical to none");
  });

  test("zierlinie: follows a Zierkante (wave edge changes the band)", () => {
    const plain = buildParts(lineDoc("raised"));
    const dWave = lineDoc("raised");
    dWave.body.edge = { style: "wave", sizeMm: 2, periodMm: 8 };
    const wave = buildParts(dWave);
    const lp = plain.find(p => p.name === "zierlinie");
    const lw = wave.find(p => p.name === "zierlinie");
    assert(lp && lw, "both variants emit the line");
    assert(JSON.stringify(lp) !== JSON.stringify(lw), "the line rides the decorated SDF");
  });
})();
