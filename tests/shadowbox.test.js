"use strict";
// Schaukasten: stacked paper-cut plates with a shared tunnel-opening field.
(function () {
  test("schaukasten: defaultDoc carries disabled shadowbox defaults", () => {
    const d = window.defaultDoc();
    assert(d.shadowbox && d.shadowbox.enabled === false, "shadowbox present + off");
    assertEqual(d.shadowbox.layers, 6, "layers default");
    assertEqual(d.shadowbox.insetPerLayerMm, 4, "inset default");
    assertEqual(d.shadowbox.opening.source, "auto", "opening source");
    assertEqual(d.shadowbox.opening.points, null, "no drawn points");
    assert(d.shadowbox.stand.enabled === true, "stand on by default");
  });

  test("schaukasten: makeElementV2 carries sbLayer/sbOverhang defaults", () => {
    const el = window.makeElementV2("text", {});
    assertEqual(el.sbLayer, null, "sbLayer null = back plate");
    assertEqual(el.sbOverhang, false, "no overhang");
  });

  test("schaukasten: migrateProject backfills v2 docs and elements", () => {
    const d = window.defaultDoc();
    delete d.shadowbox;
    d.elements.push(window.makeElementV2("shape", {}));
    delete d.elements[0].sbLayer; delete d.elements[0].sbOverhang;
    const m = window.migrateProject(d);
    assert(m.shadowbox && m.shadowbox.enabled === false, "doc backfilled");
    assertEqual(m.elements[0].sbLayer, null, "element sbLayer backfilled");
    assertEqual(m.elements[0].sbOverhang, false, "element sbOverhang backfilled");
  });

  test("schaukasten: migrateProject is idempotent on v2 docs", () => {
    const d = window.migrateProject(window.defaultDoc());
    const once = JSON.stringify(d);
    assertEqual(JSON.stringify(window.migrateProject(d)), once, "idempotent");
  });

  function sbDoc() {
    const d = window.defaultDoc();
    d.body.widthMm = 60; d.body.heightMm = 40; d.body.thicknessMm = 2;
    d.resolution = 96; d.autoLayerHeights = false;
    d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    d.shadowbox.enabled = true;
    d.shadowbox.layers = 4;
    d.shadowbox.insetPerLayerMm = 3;
    d.shadowbox.opening.marginMm = 8;
    d.shadowbox.stand.enabled = false;
    return d;
  }

  test("schaukasten: plate colors lerp front to back", () => {
    const cols = window.shadowboxPlateColors({ layers: 4, colorFront: "#000000", colorBack: "#FFFFFF" });
    assertEqual(cols.length, 4, "one color per plate");
    assertEqual(cols[0], "#000000", "front endpoint");
    assertEqual(cols[3], "#FFFFFF", "back endpoint");
    assertEqual(cols[1], "#555555", "1/3 lerp");
  });

  test("schaukasten: auto opening field sign and margin", () => {
    const d = sbDoc();
    const { grid } = window.docGridAndFootprint(d);
    const f = window.shadowboxOpeningField(d, grid);
    assert(typeof f === "function", "field exists for rect body");
    const sx = grid.cols / d.body.widthMm, sy = grid.rows / d.body.heightMm;
    const at = (xMm, yMm) => f(Math.round(xMm * sx - 0.5), Math.round(yMm * sy - 0.5));
    assert(at(30, 20) > 0, "center inside opening");
    assert(at(1, 20) < 0, "1mm from edge is outside (margin 8)");
    assert(at(30, 20) > at(15, 20), "field decreases toward the rim");
  });

  test("schaukasten: opening keeps a 2mm ring even with tiny margin", () => {
    const d = sbDoc();
    d.shadowbox.opening.marginMm = 0.5; d.shadowbox.opening.waviness = 0;
    const { grid } = window.docGridAndFootprint(d);
    const f = window.shadowboxOpeningField(d, grid);
    const sx = grid.cols / d.body.widthMm, sy = grid.rows / d.body.heightMm;
    // 1 mm inside the plate edge must stay plate (field < 0): ring clamp >= 2 mm
    assert(f(Math.round(1 * sx - 0.5), Math.round(20 * sy - 0.5)) < 0, "ring clamp holds");
  });

  test("schaukasten: field is null for free-form bodies", () => {
    const d = sbDoc();
    d.body.shape = "free";
    const { grid } = window.docGridAndFootprint(d);
    assertEqual(window.shadowboxOpeningField(d, grid), null, "no analytic perimeter");
  });
})();
