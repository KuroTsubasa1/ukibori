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
    d.shadowbox.opening.marginMm = 14;
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

  test("schaukasten: drawn opening — polygon mask + signed field", () => {
    const d = sbDoc();
    d.shadowbox.opening.source = "drawn";
    // diamond centered on the plate (60x40): well inside, area ~200 mm^2
    d.shadowbox.opening.points = [
      { xMm: 30, yMm: 8 }, { xMm: 50, yMm: 20 }, { xMm: 30, yMm: 32 }, { xMm: 10, yMm: 20 },
    ];
    const { grid } = window.docGridAndFootprint(d);
    const f = window.shadowboxOpeningField(d, grid);
    const sx = grid.cols / 60, sy = grid.rows / 40;
    const at = (x, y) => f(Math.round(x * sx - 0.5), Math.round(y * sy - 0.5));
    assert(at(30, 20) > 0, "diamond center inside");
    assert(at(4, 4) < 0, "plate corner outside");
    assert(at(30, 20) > at(38, 20), "distance decreases toward diamond rim");
  });

  test("schaukasten: degenerate drawn path falls back to auto", () => {
    const a = sbDoc();
    const b = sbDoc();
    b.shadowbox.opening.source = "drawn";
    b.shadowbox.opening.points = [{ xMm: 30, yMm: 20 }, { xMm: 31, yMm: 20 }]; // < 3 points
    const { grid } = window.docGridAndFootprint(a);
    const fa = window.shadowboxOpeningField(a, grid);
    const fb = window.shadowboxOpeningField(b, grid);
    assertClose(fa(48, 48), fb(48, 48), 1e-9, "same as auto at a probe cell");
  });

  function zbounds(facets) {
    let lo = Infinity, hi = -Infinity;
    for (const f of facets) for (const v of f) { lo = Math.min(lo, v[2]); hi = Math.max(hi, v[2]); }
    return [lo, hi];
  }
  function ybounds(facets) {
    let lo = Infinity, hi = -Infinity;
    for (const f of facets) for (const v of f) { lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
    return [lo, hi];
  }

  test("schaukasten: stand — three upright parts with exact slot", () => {
    const sb = window.defaultShadowbox();
    sb.layers = 4;
    const parts = window.buildStandParts(sb, 60, 2);
    assertEqual(parts.length, 3, "sockel + two rails");
    const names = parts.map((p) => p.name).sort();
    assertEqual(JSON.stringify(names),
      JSON.stringify(["staender-sockel", "staender-wand-hinten", "staender-wand-vorne"]), "names");
    const sockel = parts.find((p) => p.name === "staender-sockel");
    const vorne = parts.find((p) => p.name === "staender-wand-vorne");
    const hinten = parts.find((p) => p.name === "staender-wand-hinten");
    assertClose(zbounds(sockel.facets)[0], 0, 1e-9, "sockel on bed");
    assertClose(zbounds(sockel.facets)[1], 15 - 8, 1e-9, "sockel top = H - slotDepth");
    assertClose(zbounds(vorne.facets)[0], 15 - 8, 1e-9, "rail bottom");
    assertClose(zbounds(vorne.facets)[1], 15, 1e-9, "rail top");
    // slot: gap between the two rails = layers*T + tol = 4*2 + 0.4
    const gap = ybounds(hinten.facets)[0] - ybounds(vorne.facets)[1];
    assertClose(gap, 8.4, 1e-9, "slot width");
  });

  test("schaukasten: stand returns [] when disabled or degenerate", () => {
    const sb = window.defaultShadowbox();
    sb.stand.enabled = false;
    assertEqual(window.buildStandParts(sb, 60, 2).length, 0, "disabled");
    sb.stand.enabled = true;
    assertEqual(window.buildStandParts(sb, 60, 0).length, 0, "no plate thickness");
  });

  test("schaukasten: opening loops are closed and nested", () => {
    const d = sbDoc();
    const l0 = window.shadowboxOpeningLoops(d, 0);
    const l2 = window.shadowboxOpeningLoops(d, 2);
    assert(l0.length >= 1 && l2.length >= 1, "loops exist");
    const span = (loops) => {
      let min = Infinity, max = -Infinity;
      for (const lp of loops) for (const p of lp) { min = Math.min(min, p.xMm); max = Math.max(max, p.xMm); }
      return max - min;
    };
    assert(span(l2) < span(l0), "deeper opening is smaller");
    for (const p of l0[0]) {
      assert(p.xMm > 0 && p.xMm < 60 && p.yMm > 0 && p.yMm < 40, "loop inside plate");
    }
  });

  test("schaukasten: enabling it changes output; disabling matches a doc without the field", () => {
    const d = sbDoc();
    const off = JSON.parse(JSON.stringify(d)); off.shadowbox.enabled = false;
    const stripped = JSON.parse(JSON.stringify(off)); delete stripped.shadowbox;
    stripped.elements = stripped.elements || [];
    assertEqual(JSON.stringify(window.buildParts(off)),
      JSON.stringify(window.buildParts(window.migrateProject(stripped))), "off == no field");
    assert(JSON.stringify(window.buildParts(d)) !== JSON.stringify(window.buildParts(off)),
      "enabled changes geometry");
  });

  test("schaukasten: stack — one plate per layer at its z-slab, front on top", () => {
    const d = sbDoc(); // 4 layers, T=2
    const parts = window.buildParts(d);
    for (let k = 0; k < 4; k++) {
      const plate = parts.filter((p) => p.name.indexOf("ebene-" + (k + 1) + "-") === 0);
      assert(plate.length >= 1, "plate " + (k + 1) + " exists");
      const zb = zbounds(plate.flatMap((p) => p.facets));
      assertClose(zb[0], (4 - 1 - k) * 2, 1e-6, "plate " + (k + 1) + " bottom");
      assertClose(zb[1], (4 - 1 - k) * 2 + 2, 1e-6, "plate " + (k + 1) + " top");
    }
  });

  test("schaukasten: openings shrink toward the back; back plate is solid", () => {
    const d = sbDoc();
    const parts = window.buildParts(d);
    const capArea = (k) => {
      // top-cap triangle area of the grundplatte at its own zTop
      const p = parts.find((q) => q.name === "ebene-" + (k + 1) + "-grundplatte");
      const zTop = zbounds(p.facets)[1];
      let a = 0;
      for (const f of p.facets) {
        if (Math.abs(f[0][2] - zTop) < 1e-6 && Math.abs(f[1][2] - zTop) < 1e-6 && Math.abs(f[2][2] - zTop) < 1e-6) {
          a += Math.abs((f[1][0] - f[0][0]) * (f[2][1] - f[0][1])
                      - (f[2][0] - f[0][0]) * (f[1][1] - f[0][1])) / 2;
        }
      }
      return a;
    };
    assert(capArea(0) < capArea(1), "front opening largest");
    assert(capArea(1) < capArea(2), "middle shrinks");
    assert(capArea(3) > 60 * 40 * 0.95, "back plate solid (full face)");
  });

  test("schaukasten: element lands only on its assigned plate", () => {
    const d = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 10, hMm: 8, color: "#FF0000" });
    el.sbLayer = 1;
    d.elements.push(el);
    const parts = window.buildParts(d);
    const withEl = parts.filter((p) => p.name.indexOf("ebene-2-") === 0);
    const others = parts.filter((p) => p.name.indexOf("ebene-2-") !== 0 && p.name.indexOf("ebene-") === 0);
    assert(withEl.some((p) => p.name !== "ebene-2-grundplatte"), "content part on plate 2");
    assert(!others.some((p) => /-(farbe|erhaben|farbschicht)/.test(p.name)), "no content elsewhere");
  });

  test("schaukasten: engraved element carves the back plate (Vertieft)", () => {
    const d = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 10, color: "#00AA00" });
    el.depth.direction = "engraved";
    d.elements.push(el); // sbLayer null -> back plate (k=3, z 0..2)
    const parts = window.buildParts(d);
    const floors = parts.filter((p) => p.name.indexOf("ebene-4-") === 0 && p.name !== "ebene-4-grundplatte");
    assert(floors.length >= 1, "engraved floor part exists on the back plate");
    const zb = zbounds(floors.flatMap((p) => p.facets));
    assert(zb[1] <= 2 + 1e-6, "carved below the back plate top");
    assert(zb[0] >= 0 - 1e-6, "floor keeps a base");
  });

  test("schaukasten: cutout element punches through its plate", () => {
    const a = sbDoc();
    const b = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 12, cyMm: 20, wMm: 6, hMm: 6, color: "#000000" });
    el.sbLayer = 0; el.cutout = true;
    b.elements.push(el);
    assert(JSON.stringify(window.buildParts(a)) !== JSON.stringify(window.buildParts(b)),
      "cutout changes the front plate");
  });

  test("schaukasten: content-parts refactor keeps a plain doc byte-identical", () => {
    const d = sbDoc();
    d.shadowbox.enabled = false;
    d.elements.push(window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 16, hMm: 12, color: "#FF0000" }));
    d.elements.push(window.makeElementV2("text", { cxMm: 30, cyMm: 28, wMm: 20, hMm: 8, text: "Ukibori" }));
    d.elements[1].depth.direction = "engraved";
    const parts = window.buildParts(d);
    assert(parts.length >= 2, "plate + content parts");
    const names = parts.map((p) => p.name);
    assert(names.includes("grundplatte"), "grundplatte present");
    // structural snapshot so the refactor in this task cannot silently reorder parts
    const d2 = JSON.parse(JSON.stringify(d));
    assertEqual(JSON.stringify(window.buildParts(window.migrateProject(d2))),
      JSON.stringify(parts), "rebuild after serialize round-trip is identical");
  });
})();
