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
    assert(at(1, 20) < 0, "1mm from edge is outside (margin 14)");
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
    assertEqual(parts.length, 5, "sockel + two rails + two end caps");
    const names = parts.map((p) => p.name).sort();
    assertEqual(JSON.stringify(names),
      JSON.stringify(["staender-sockel", "staender-wand-hinten", "staender-wand-links",
        "staender-wand-rechts", "staender-wand-vorne"]), "names");
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

  test("schaukasten-v2: stand v2 — closed pocket with end caps", () => {
    const sb = window.defaultShadowbox();
    sb.layers = 4;
    const parts = window.buildStandParts(sb, 60, 2);
    assertEqual(parts.length, 5, "sockel + four walls");
    const names = parts.map((p) => p.name).sort();
    assertEqual(JSON.stringify(names), JSON.stringify([
      "staender-sockel", "staender-wand-hinten", "staender-wand-links",
      "staender-wand-rechts", "staender-wand-vorne"]), "names");
    const xb = (fs) => { let lo = Infinity, hi = -Infinity; for (const f of fs) for (const v of f) { lo = Math.min(lo, v[0]); hi = Math.max(hi, v[0]); } return [lo, hi]; };
    const links = parts.find((p) => p.name === "staender-wand-links");
    const rechts = parts.find((p) => p.name === "staender-wand-rechts");
    // pocket between the caps = plate width + tolerance
    assertClose(xb(rechts.facets)[0] - xb(links.facets)[1], 60 + 0.4, 1e-9, "pocket length");
    assertClose(zbounds(links.facets)[0], 15 - 8, 1e-9, "cap at rail height");
    assertClose(zbounds(links.facets)[1], 15, 1e-9, "cap top");
    const sockel = parts.find((p) => p.name === "staender-sockel");
    assertClose(xb(sockel.facets)[1], 60 + 0.4 + 10, 1e-9, "total length = pocket + 2 rails");
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
    const l1 = window.shadowboxOpeningLoops(d, 1);
    assert(l0.length >= 1 && l1.length >= 1, "loops exist");
    const span = (loops) => {
      let min = Infinity, max = -Infinity;
      for (const lp of loops) for (const p of lp) { min = Math.min(min, p.xMm); max = Math.max(max, p.xMm); }
      return max - min;
    };
    assert(span(l1) < span(l0), "deeper opening is smaller");
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
    d.topLayerColor = "#FF00FF";
    const parts = window.buildParts(d);
    for (let k = 0; k < 4; k++) {
      const plate = parts.filter((p) => p.name.indexOf("ebene-" + (k + 1) + "-") === 0);
      assert(plate.length >= 1, "plate " + (k + 1) + " exists");
      const zb = zbounds(plate.flatMap((p) => p.facets));
      assertClose(zb[0], (4 - 1 - k) * 2, 1e-6, "plate " + (k + 1) + " bottom");
      assertClose(zb[1], (4 - 1 - k) * 2 + 2, 1e-6, "plate " + (k + 1) + " top");
    }
    const zAll = zbounds(parts.filter(p => p.name.indexOf("ebene-") === 0).flatMap(p => p.facets));
    assert(zAll[1] <= 4 * 2 + 1e-6, "no deckschicht slab above any plate");
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
    // Element near the left edge of the plate (d∈[3,13] keeps it on the ring material)
    const el = window.makeElementV2("shape", { cxMm: 8, cyMm: 20, wMm: 10, hMm: 8, color: "#FF0000" });
    el.sbLayer = 1;
    d.elements.push(el);
    const parts = window.buildParts(d);
    const withEl = parts.filter((p) => p.name.indexOf("ebene-2-") === 0);
    const others = parts.filter((p) => p.name.indexOf("ebene-2-") !== 0 && p.name.indexOf("ebene-") === 0);
    assert(withEl.some((p) => p.name !== "ebene-2-grundplatte"), "content part on plate 2");
    assert(!others.some((p) => /-(farbe|erhaben|farbschicht)/.test(p.name)), "no content elsewhere");
  });

  test("schaukasten: no floating content over a plate's own opening", () => {
    const d = sbDoc();
    d.shadowbox.opening.waviness = 0; // remove wobble so field is clean at center
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 6, hMm: 6, color: "#FF0000" });
    el.sbLayer = 1; // fully inside plate 2's opening (f(center)=8.4 > inset 3)
    d.elements.push(el);
    const parts = window.buildParts(d, { layout: "bed" });
    const content = parts.filter((p) => p.name.indexOf("ebene-2-") === 0 && p.name !== "ebene-2-grundplatte");
    assertEqual(content.length, 0, "no unsupported prisms in the opening");
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

  test("schaukasten: overhang element extends the plate into the opening", () => {
    const mk = (rim) => {
      const d = sbDoc();
      const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 14, hMm: 10, color: "#FFFFFF" });
      el.sbLayer = 1; if (rim) el.sbMode = "rim";
      d.elements.push(el);
      return window.buildParts(d).filter((p) => p.name === "ebene-2-grundplatte")[0];
    };
    const zTopArea = (p) => {
      const zTop = zbounds(p.facets)[1];
      let a = 0;
      for (const f of p.facets) if (f.every((v) => Math.abs(v[2] - zTop) < 1e-6)) {
        a += Math.abs((f[1][0] - f[0][0]) * (f[2][1] - f[0][1])
                    - (f[2][0] - f[0][0]) * (f[1][1] - f[0][1])) / 2;
      }
      return a;
    };
    assert(zTopArea(mk(true)) > zTopArea(mk(false)) + 20, "overhang grows the plate face");
  });

  test("schaukasten: bed layout — all plates on the bed, disjoint in x", () => {
    const d = sbDoc();
    const parts = window.buildParts(d, { layout: "bed" });
    const xbounds = (fs) => {
      let lo = Infinity, hi = -Infinity;
      for (const f of fs) for (const v of f) { lo = Math.min(lo, v[0]); hi = Math.max(hi, v[0]); }
      return [lo, hi];
    };
    let prevHi = -Infinity;
    for (let k = 0; k < 4; k++) {
      const plate = parts.filter((p) => p.name.indexOf("ebene-" + (k + 1) + "-") === 0);
      const zb = zbounds(plate.flatMap((p) => p.facets));
      assertClose(zb[0], 0, 1e-6, "plate " + (k + 1) + " on the bed");
      assert(zb[1] <= 2 + 1e-6, "plate " + (k + 1) + " content stays within reason for empty plates");
      const xb = xbounds(plate.flatMap((p) => p.facets));
      assert(xb[0] > prevHi - 1e-6, "plate " + (k + 1) + " right of plate " + k);
      prevHi = xb[1];
    }
  });

  test("schaukasten-v2: sbMode defaults and pins block", () => {
    const el = window.makeElementV2("shape", {});
    assertEqual(el.sbMode, "plate", "default mode");
    const sb = window.defaultShadowbox();
    assert(sb.pins && sb.pins.enabled === true, "pins on");
    assertEqual(sb.pins.diameterMm, 3, "peg diameter");
    assertClose(sb.pins.clearanceMm, 0.35, 1e-9, "hole clearance");
  });

  test("schaukasten-v2: migration upgrades sbOverhang to rim and backfills pins", () => {
    const d = window.defaultDoc();
    delete d.shadowbox.pins;
    const a = window.makeElementV2("shape", {}); delete a.sbMode; a.sbOverhang = true;
    const b = window.makeElementV2("shape", {}); delete b.sbMode;
    d.elements.push(a, b);
    const m = window.migrateProject(d);
    assertEqual(m.elements[0].sbMode, "rim", "overhang upgraded");
    assertEqual(m.elements[1].sbMode, "plate", "plain element");
    assert(m.shadowbox.pins && m.shadowbox.pins.enabled === true, "pins backfilled");
    const once = JSON.stringify(m);
    assertEqual(JSON.stringify(window.migrateProject(m)), once, "idempotent");
  });

  function blobMask(cols, rows, sx, sy, discs) {
    const m = new Uint8Array(cols * rows);
    for (const d of discs) window.__sbStampDisk(m, cols, rows, sx, sy, d.x, d.y, d.r, 1);
    return m;
  }

  test("schaukasten-v2: pin spots — one centered spot for a single blob", () => {
    const cols = 96, rows = 64, sx = cols / 60, sy = rows / 40;
    const m = blobMask(cols, rows, sx, sy, [{ x: 30, y: 20, r: 8 }]);
    const spots = window.shadowboxPinSpots(m, cols, rows, sx, sy, 2.5, 12);
    assertEqual(spots.length, 1, "one spot (blob too small for two 12mm apart)");
    assertClose(spots[0].xMm, 30, 1.5, "centered x");
    assertClose(spots[0].yMm, 20, 1.5, "centered y");
  });

  test("schaukasten-v2: pin spots — two spots for two distant blobs, none for slivers", () => {
    const cols = 96, rows = 64, sx = cols / 60, sy = rows / 40;
    const two = blobMask(cols, rows, sx, sy, [{ x: 14, y: 20, r: 7 }, { x: 46, y: 20, r: 7 }]);
    assertEqual(window.shadowboxPinSpots(two, cols, rows, sx, sy, 2.5, 12).length, 2, "two anchors");
    const sliver = blobMask(cols, rows, sx, sy, [{ x: 30, y: 20, r: 1.2 }]);
    assertEqual(window.shadowboxPinSpots(sliver, cols, rows, sx, sy, 2.5, 12).length, 0, "sliver skipped");
    assertEqual(window.shadowboxPinSpots(new Uint8Array(cols * rows), cols, rows, sx, sy, 2.5, 12).length, 0, "empty mask");
  });

  test("schaukasten-v2: rim element — prism one level forward, footprint kept", () => {
    const d = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 8, color: "#FFFFFF" });
    el.sbLayer = 1; el.sbMode = "rim";
    d.elements.push(el);
    const parts = window.buildParts(d); // stack layout; plate 2 slab = [4,6]
    // piece may be split into two slabs when pins are on; gather all by prefix
    const prismParts = parts.filter((p) => p.name.indexOf("ebene-2-rand-1") === 0);
    assert(prismParts.length >= 1, "prism part exists");
    const zb = zbounds(prismParts.flatMap((p) => p.facets));
    assertClose(zb[0], 6, 1e-6, "prism starts at plate top");
    assertClose(zb[1], 8, 1e-6, "prism ends one level forward");
    assert(!parts.some((p) => /^ebene-2-(farbe|erhaben|farbschicht)/.test(p.name)),
      "rim element emits no ordinary content");
  });

  test("schaukasten-v2: rim prism is clipped by the front plate's opening", () => {
    const mk = (cx) => {
      const d = sbDoc();
      const el = window.makeElementV2("shape", { cxMm: cx, cyMm: 20, wMm: 10, hMm: 8, color: "#FFFFFF" });
      el.sbLayer = 2; el.sbMode = "rim"; // front plate above is k=1 (opening threshold 3mm)
      d.elements.push(el);
      const p = window.buildParts(d).find((q) => q.name === "ebene-3-rand-1");
      return p ? p.facets.length : 0;
    };
    // near the plate edge the front plate is solid above -> heavy clipping
    assert(mk(9) < mk(30), "edge-hugging prism is clipped harder than a centered one");
  });

  test("schaukasten-v2: rim on the front plate is unclipped decorative relief", () => {
    const d = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 10, hMm: 8, color: "#FFFFFF" });
    el.sbLayer = 0; el.sbMode = "rim";
    d.elements.push(el);
    // piece may be split into two slabs when pins are on; gather all by prefix
    const prismParts = window.buildParts(d).filter((p) => p.name.indexOf("ebene-1-rand-1") === 0);
    assert(prismParts.length >= 1, "front-plate prism exists");
    // front plate slab [6,8] in a 4x2mm stack; the prism adds one more level
    assertClose(zbounds(prismParts.flatMap((p) => p.facets))[1], 4 * 2 + 2, 1e-6, "pokes above the whole stack");
  });

  test("schaukasten-v2: floating piece — clipped to its opening, own part, right slab", () => {
    const d = sbDoc(); // 4 layers, T=2, inset 3
    // deterministic field: no wobble, margin 12 -> opening_2 = {d > 18} (exists at plate center)
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 12;
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 40, hMm: 20, color: "#FF7700" });
    el.sbLayer = 2; el.sbMode = "float"; // deepest allowed level (n-2)
    d.elements.push(el);
    const parts = window.buildParts(d);
    const piece = parts.filter((p) => p.name.indexOf("ebene-3-schwebeteil-") === 0);
    assert(piece.length >= 1, "piece exists");
    const zb = zbounds(piece.flatMap((p) => p.facets));
    assertClose(zb[0], (4 - 1 - 2) * 2, 1e-6, "piece bottom at its level slab");
    assertClose(zb[1], (4 - 1 - 2) * 2 + 2, 1e-6, "piece top");
    // 40x20 element vs opening threshold 6mm: the ring collision is cut off
    const xb = (fs) => { let lo = Infinity, hi = -Infinity; for (const f2 of fs) for (const v of f2) { lo = Math.min(lo, v[0]); hi = Math.max(hi, v[0]); } return [lo, hi]; };
    const [x0, x1] = xb(piece.flatMap((p) => p.facets));
    assert(x1 - x0 < 40 - 1, "wider than the opening -> clipped");
    assert(!parts.some((p) => /^ebene-3-(farbe|erhaben|farbschicht)/.test(p.name)), "not plate content");
  });

  test("schaukasten-v2: floating level clamps to n-2 and bed layout gives it its own spot", () => {
    const d = sbDoc();
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 12; // deterministic field
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 10, hMm: 8, color: "#FF7700" });
    el.sbLayer = null; el.sbMode = "float"; // null would be back plate -> clamped to n-2
    d.elements.push(el);
    const stack = window.buildParts(d);
    assert(stack.some((p) => p.name.indexOf("ebene-3-schwebeteil-") === 0), "clamped to level n-2");
    const bed = window.buildParts(d, { layout: "bed" });
    const piece = bed.filter((p) => p.name.indexOf("schwebeteil") >= 0);
    const zb = zbounds(piece.flatMap((p) => p.facets));
    assertClose(zb[0], 0, 1e-6, "on the bed");
    assertClose(zb[1], 2, 1e-6, "one plate thick");
    let plateHiX = -Infinity;
    for (const p of bed) if (p.name.indexOf("schwebeteil") < 0) for (const f2 of p.facets) for (const v of f2) plateHiX = Math.max(plateHiX, v[0]);
    let pieceLoX = Infinity;
    for (const p of piece) for (const f2 of p.facets) for (const v of f2) pieceLoX = Math.min(pieceLoX, v[0]);
    assert(pieceLoX > plateHiX - 1e-6, "piece placed right of plates and stand");
  });

  function sbFloatDoc() { // two stacked floating pieces with a fat overlap
    const d = sbDoc();
    d.shadowbox.layers = 5; // levels 0..3 usable for floats (n-2 = 3)
    // deterministic field with generous deep openings: level3 = {d > 12}, level2 = {d > 10}
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    const lo = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 18, hMm: 12, color: "#00AA00" });
    lo.sbLayer = 3; lo.sbMode = "float";
    const up = window.makeElementV2("shape", { cxMm: 33, cyMm: 20, wMm: 14, hMm: 10, color: "#FF7700" });
    up.sbLayer = 2; up.sbMode = "float";
    d.elements.push(lo, up);
    return d;
  }

  test("schaukasten-v2: pins — peg on the lower piece, hole splits the upper piece", () => {
    const parts = window.buildParts(sbFloatDoc()); // stack: level3 slab [2,4], level2 slab [4,6]
    const peg = parts.filter((p) => p.name.indexOf("ebene-4-stift-") === 0);
    assert(peg.length >= 1, "peg exists on the lower piece");
    const zp = zbounds(peg.flatMap((p) => p.facets));
    assertClose(zp[0], 4, 1e-6, "peg base on lower piece's face");
    assertClose(zp[1], 4 + 1.2, 1e-6, "peg height 1.2 (0.6*T)");
    const upper = parts.filter((p) => p.name.indexOf("ebene-3-schwebeteil-") === 0);
    assert(upper.some((p) => /-oben$/.test(p.name)), "upper piece split into two slabs");
    const bottom = upper.find((p) => !/-oben$/.test(p.name));
    const top = upper.find((p) => /-oben$/.test(p.name));
    assertClose(zbounds(bottom.facets)[1], 4 + 1.4, 1e-6, "bottom sub-slab up to holeDepth");
    assertClose(zbounds(top.facets)[0], 4 + 1.4, 1e-6, "top sub-slab from holeDepth");
  });

  test("schaukasten-v2: pins — back plate anchors the deepest piece; toggle off is clean", () => {
    const d = sbFloatDoc();
    const parts = window.buildParts(d);
    assert(parts.some((p) => p.name.indexOf("ebene-5-stift-") === 0), "back plate peg for level n-2 piece");
    const off = sbFloatDoc(); off.shadowbox.pins.enabled = false;
    const po = window.buildParts(off);
    assert(!po.some((p) => p.name.indexOf("-stift-") >= 0), "no pegs when disabled");
    assert(!po.some((p) => /-oben$/.test(p.name)), "no split slabs when disabled");
  });

  test("schaukasten-v2: pins — tiny overlap yields no pin", () => {
    const d = sbDoc();
    d.shadowbox.layers = 5;
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    const lo = window.makeElementV2("shape", { cxMm: 26, cyMm: 20, wMm: 8, hMm: 8, color: "#00AA00" });
    lo.sbLayer = 3; lo.sbMode = "float";
    const up = window.makeElementV2("shape", { cxMm: 33.5, cyMm: 20, wMm: 8, hMm: 8, color: "#FF7700" });
    up.sbLayer = 2; up.sbMode = "float"; // true 0.5mm sliver overlap (x 29.5..30 vs lo 22..30):
    // the overlap is non-empty, so the pin is rejected by the clearance check, not the empty gate
    d.elements.push(lo, up);
    const parts = window.buildParts(d);
    assert(!parts.some((p) => p.name.indexOf("ebene-4-stift-") === 0), "sliver overlap -> no piece-piece pin");
  });

  test("schaukasten-v2: rand piece is separate with plate pegs and underside holes", () => {
    const d = sbDoc(); // 4 layers, T=2
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 12;
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 8, color: "#FFFFFF" });
    el.sbLayer = 1; el.sbMode = "rim";
    d.elements.push(el);
    const parts = window.buildParts(d); // plate 2 slab [4,6]; rand piece [6,8]
    const rand = parts.filter((p) => p.name.indexOf("ebene-2-rand-1") === 0);
    assert(rand.length >= 1, "rand piece exists");
    const zb = zbounds(rand.flatMap((p) => p.facets));
    assertClose(zb[0], 6, 1e-6, "piece sits one level forward");
    assertClose(zb[1], 8, 1e-6, "piece top");
    assert(rand.some((p) => /-oben$/.test(p.name)), "hole splits the piece");
    const peg = parts.filter((p) => p.name.indexOf("ebene-2-stift-") === 0);
    assert(peg.length >= 1, "peg on the plate's rim extension");
    const zp = zbounds(peg.flatMap((p) => p.facets));
    assertClose(zp[0], 6, 1e-6, "peg base on plate top (shifted)");
    assertClose(zp[1], 6 + 1.2, 1e-6, "peg height");
    const pegColor = JSON.stringify(peg[0].color);
    const pieceColor = JSON.stringify(rand[0].color);
    assert(pegColor !== pieceColor, "peg is plate-colored, piece element-colored");
  });

  test("schaukasten-v2: rand piece gets its own bed spot; pins off keeps separation", () => {
    const d = sbDoc();
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 12;
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 8, color: "#FFFFFF" });
    el.sbLayer = 1; el.sbMode = "rim";
    d.elements.push(el);
    const bed = window.buildParts(d, { layout: "bed" });
    const rand = bed.filter((p) => p.name.indexOf("-rand-") >= 0);
    assert(rand.length >= 1, "rand piece on the bed");
    const zb = zbounds(rand.flatMap((p) => p.facets));
    assertClose(zb[0], 0, 1e-6, "printed flat");
    assert(zb[1] <= 2 + 1e-6, "one plate thick");
    const off = JSON.parse(JSON.stringify(d)); off.shadowbox.pins.enabled = false;
    const po = window.buildParts(window.migrateProject(off));
    assert(po.some((p) => p.name.indexOf("-rand-") >= 0), "still separate without pins");
    assert(!po.some((p) => p.name.indexOf("-stift-") >= 0), "no pegs when disabled");
    assert(!po.some((p) => /-rand-1-oben$/.test(p.name)), "no hole split when disabled");
  });

  test("schaukasten-v2: explode spreads stack levels; 0 is byte-identical", () => {
    const d = sbDoc();
    const a = JSON.stringify(window.buildParts(d));
    assertEqual(JSON.stringify(window.buildParts(d, { explodeMm: 0 })), a, "explode 0 == default");
    const ex = window.buildParts(d, { explodeMm: 5 });
    for (let k = 0; k < 4; k++) {
      const plate = ex.filter((p) => p.name.indexOf("ebene-" + (k + 1) + "-") === 0);
      const zb = zbounds(plate.flatMap((p) => p.facets));
      assertClose(zb[0], (4 - 1 - k) * (2 + 5), 1e-6, "plate " + (k + 1) + " exploded z");
    }
    const bedA = JSON.stringify(window.buildParts(d, { layout: "bed" }));
    assertEqual(JSON.stringify(window.buildParts(d, { layout: "bed", explodeMm: 5 })), bedA, "bed ignores explode");
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

  test("schaukasten-v2: back pegs avoid engraved back-plate content", () => {
    const d = sbDoc();
    d.shadowbox.layers = 5;
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    // engraved plate-mode element covering the whole central region of the back plate
    const eng = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 40, hMm: 24, color: "#333333" });
    eng.depth.direction = "engraved"; // sbLayer null -> back plate, mode plate
    const fl = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 18, hMm: 12, color: "#00AA00" });
    fl.sbLayer = 3; fl.sbMode = "float"; // deepest level, fully over the engraved region
    d.elements.push(eng, fl);
    const parts = window.buildParts(d);
    assert(!parts.some((p) => p.name.indexOf("ebene-5-stift-") === 0),
      "no back peg lands on the engraved face");
    assert(parts.some((p) => p.name.indexOf("ebene-4-schwebeteil-") === 0), "float piece still emitted");
  });

  function rimAdaptDoc() {
    const d = sbDoc(); // 60x40, T=2, 4 layers, inset 3
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 8; // openings: j*3+8 from edge
    const cloud = window.makeElementV2("shape", { cxMm: 30, cyMm: 13, wMm: 10, hMm: 6, color: "#FFFFFF" });
    cloud.sbLayer = 1; cloud.sbMode = "rim"; // on plate 2 of 4, bulging into the tunnel
    d.elements.push(cloud);
    return d;
  }
  function grundArea(parts, name) {
    const p = parts.find((q) => q.name === name);
    if (!p) return 0;
    const zTop = zbounds(p.facets)[1];
    let a = 0;
    for (const f2 of p.facets) if (f2.every((v) => Math.abs(v[2] - zTop) < 1e-6)) {
      a += Math.abs((f2[1][0] - f2[0][0]) * (f2[2][1] - f2[0][1])
                  - (f2[2][0] - f2[0][0]) * (f2[1][1] - f2[0][1])) / 2;
    }
    return a;
  }

  test("schaukasten-v3: deeper plates wrap the rim object; front plates untouched", () => {
    const withCloud = window.buildParts(rimAdaptDoc());
    const bare = rimAdaptDoc(); bare.elements = [];
    const without = window.buildParts(bare);
    // own plate grows around the object (border B)
    assert(grundArea(withCloud, "ebene-2-grundplatte") > grundArea(without, "ebene-2-grundplatte") + 10,
      "own plate grows around the object");
    // deeper plate wraps it one inset step wider
    const gain2 = grundArea(withCloud, "ebene-2-grundplatte") - grundArea(without, "ebene-2-grundplatte");
    const gain3 = grundArea(withCloud, "ebene-3-grundplatte") - grundArea(without, "ebene-3-grundplatte");
    assert(gain3 > gain2 + 5, "deeper ring wraps wider (one more inset step)");
    // plates in FRONT are byte-identical
    const pick = (parts, pre) => JSON.stringify(parts.filter((p) => p.name.indexOf(pre) === 0 && p.name.indexOf("grundplatte") >= 0));
    assertEqual(pick(withCloud, "ebene-1-"), pick(without, "ebene-1-"), "front plate unaffected");
  });

  test("schaukasten-v3: floats are clipped by the adapted opening", () => {
    const d = rimAdaptDoc();
    const fl = window.makeElementV2("shape", { cxMm: 30, cyMm: 16, wMm: 16, hMm: 8, color: "#00AA00" });
    fl.sbLayer = 2; fl.sbMode = "float"; // overlaps the cloud's wrap region on level 2
    d.elements.push(fl);
    const withCloud = window.buildParts(d);
    const noCloud = rimAdaptDoc(); noCloud.elements = [JSON.parse(JSON.stringify(fl))];
    const without = window.buildParts(window.migrateProject(noCloud));
    const area = (parts) => parts.filter((p) => p.name.indexOf("schwebeteil") >= 0)
      .reduce((a, p) => a + p.facets.length, 0);
    assert(area(withCloud) < area(without), "float loses the region claimed by the wrap");
  });

  test("schaukasten-v3: adapted contour loops wrap the rim object", () => {
    const d = rimAdaptDoc();
    const base = window.shadowboxOpeningLoops(d, 2);
    const adapted = window.shadowboxAdaptedOpeningLoops(d, 2);
    const len = (loops) => loops.reduce((a, lp) => a + lp.length, 0);
    assert(len(adapted) > 0, "adapted loops exist");
    assert(JSON.stringify(adapted) !== JSON.stringify(base), "wrap changes the contour");
    const bare = rimAdaptDoc(); bare.elements = [];
    assertEqual(JSON.stringify(window.shadowboxAdaptedOpeningLoops(bare, 2)),
      JSON.stringify(window.shadowboxOpeningLoops(bare, 2)), "no rims -> identical to base loops");
  });

  test("schaukasten-v3: spacer peg anchors a shallow float chain to the back wall", () => {
    const d = sbDoc(); // 4 layers, T=2, n-2 = 2
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    const fl = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 8, color: "#00AA00" });
    fl.sbLayer = 1; fl.sbMode = "float"; // one level short of the back wall
    d.elements.push(fl);
    const parts = window.buildParts(d);
    const peg = parts.filter((p) => p.name.indexOf("ebene-4-stift-") === 0);
    assert(peg.length >= 1, "spacer peg exists");
    const zp = zbounds(peg.flatMap((p) => p.facets));
    assertClose(zp[0], 2, 1e-6, "peg base on back plate top");
    assertClose(zp[1], 2 + 2 + 1.2, 1e-6, "peg spans the missing level plus engagement");
    // peg xy must lie inside the smallest traversed opening ({d > 10} here)
    let sx = 0, sy = 0, cnt = 0;
    for (const p of peg) for (const f2 of p.facets) for (const v of f2) { sx += v[0]; sy += v[1]; cnt++; }
    const cx = sx / cnt, cyMesh = sy / cnt, cyDoc = 40 - cyMesh; // mesh y-up -> doc y-down
    const dEdge = Math.min(cx, 60 - cx, Math.min(cyDoc, 40 - cyDoc));
    assert(dEdge > 10, "peg stays inside the deepest traversed opening");
    // the piece still gets its underside hole (split slab)
    assert(parts.some((p) => /ebene-2-schwebeteil-\d+-oben$/.test(p.name)), "hole splits the piece");
  });

  test("schaukasten-v3: chain middle members get no back anchor", () => {
    const d = sbDoc();
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    const lo = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 16, hMm: 10, color: "#00AA00" });
    lo.sbLayer = 2; lo.sbMode = "float"; // deepest (n-2): normal anchor
    const up = window.makeElementV2("shape", { cxMm: 32, cyMm: 20, wMm: 12, hMm: 8, color: "#FF7700" });
    up.sbLayer = 1; up.sbMode = "float"; // pinned onto lo -> NO own back anchor
    d.elements.push(lo, up);
    const parts = window.buildParts(d);
    const backPegs = parts.filter((p) => p.name.indexOf("ebene-4-stift-") === 0);
    assertEqual(backPegs.length, 1, "exactly one back peg — the pinned upper piece gets none");
    const zTops = backPegs.map((p) => zbounds(p.facets)[1]);
    assert(zTops.every((z) => Math.abs(z - (2 + 1.2)) < 1e-6),
      "only the short peg of the deepest member — no spacer peg for the pinned upper piece");
  });

  test("schaukasten-v3: alignment dowels — holes in every plate, dowels span the stack", () => {
    const d = sbDoc(); // 4 layers, T=2, margin 14, W=60 H=40
    const withD = window.buildParts(d);
    const dowels = withD.filter((p) => p.name.indexOf("duebel-") === 0);
    assertEqual(dowels.length, 2, "two dowels");
    const zb = zbounds(dowels.flatMap((p) => p.facets));
    assertClose(zb[0], 0.3, 1e-6, "recessed at the back");
    assertClose(zb[1], 4 * 2 - 0.3, 1e-6, "recessed at the front");
    const off = JSON.parse(JSON.stringify(d)); off.shadowbox.pins.enabled = false;
    const po = window.buildParts(window.migrateProject(off));
    assert(!po.some((p) => p.name.indexOf("duebel-") === 0), "no dowels when pins off");
    assert(JSON.stringify(po.filter((p) => /grundplatte/.test(p.name)))
      !== JSON.stringify(withD.filter((p) => /grundplatte/.test(p.name))),
      "holes really punched (plates differ vs pins off)");
    // dowel centers sit in the bottom strip, hidden by the stand pocket
    let sy = 0, cnt = 0;
    for (const p of dowels) for (const f2 of p.facets) for (const v of f2) { sy += v[1]; cnt++; }
    const yDoc = 40 - sy / cnt; // mesh y-up -> doc y-down
    assertClose(yDoc, 40 - 4, 1.0, "bottom strip (y = H - 4)");
  });

  test("schaukasten-v3: dowel spots dodge elements; explode stretches the dowel", () => {
    const d = sbDoc();
    const blocker = window.makeElementV2("shape", { cxMm: 15, cyMm: 36, wMm: 22, hMm: 7, color: "#333333" });
    d.elements.push(blocker); // sits on the back plate over the bottom-left strip
    const parts = window.buildParts(d);
    const dowels = parts.filter((p) => p.name.indexOf("duebel-") === 0);
    assert(dowels.length >= 1, "dowels still placed");
    let minX = Infinity;
    for (const p of dowels) for (const f2 of p.facets) for (const v of f2) minX = Math.min(minX, v[0]);
    assert(minX > 15 + 11 + 1 - 1e-6, "spots cleared the blocker's inflated AABB");
    const ex = window.buildParts(sbDoc(), { explodeMm: 5 });
    const exD = ex.filter((p) => p.name.indexOf("duebel-") === 0);
    assertClose(zbounds(exD.flatMap((p) => p.facets))[1], (4 - 1) * (2 + 5) + 2 - 0.3, 1e-6,
      "dowel stretches with the exploded stack");
  });

  test("schaukasten-v3: colorLayers float renders raised content on the piece", () => {
    const d = sbDoc(); // 4 layers, T=2
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 12;
    const fl = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 8, color: "#FF0000" });
    fl.sbLayer = 2; fl.sbMode = "float";
    fl.depth.mode = "colorLayers"; fl.depth.direction = "raised";
    d.elements.push(fl);
    const parts = window.buildParts(d);
    const content = parts.filter((p) => /^ebene-3-schwebeteil-1-/.test(p.name));
    assert(content.length >= 1, "raised content part exists on the piece");
    const zb = zbounds(content.flatMap((p) => p.facets));
    // piece slab (level 2 of 4) sits at [2,4]; content rises above its face
    assert(zb[0] >= 4 - 1e-6, "content starts at the piece face");
    assert(zb[1] > 4 + 1e-6, "content rises above the face");
    const slab = parts.filter((p) => p.name === "ebene-3-schwebeteil-1" || /^ebene-3-schwebeteil-1-oben$/.test(p.name));
    assert(slab.length >= 1, "base slab still emitted");
  });

  test("schaukasten-v3: solid float stays flat; engraved falls back to flat", () => {
    const mk = (mode, dir) => {
      const d = sbDoc();
      d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 12;
      const fl = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 8, color: "#FF0000" });
      fl.sbLayer = 2; fl.sbMode = "float";
      fl.depth.mode = mode; fl.depth.direction = dir;
      d.elements.push(fl);
      return window.buildParts(d).filter((p) => /^ebene-3-schwebeteil-1-/.test(p.name) && !/-oben$/.test(p.name));
    };
    assertEqual(mk("solid", "raised").length, 0, "solid: no extra content parts");
    assertEqual(mk("colorLayers", "engraved").length, 0, "engraved: flat fallback");
  });

  test("schaukasten-v3: pegs avoid a piece's raised content", () => {
    const d = sbDoc();
    d.shadowbox.layers = 5;
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    const lo = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 18, hMm: 12, color: "#00AA00" });
    lo.sbLayer = 3; lo.sbMode = "float";
    lo.depth.mode = "colorLayers"; lo.depth.direction = "raised"; // whole face raised -> flat(lo) empty
    const up = window.makeElementV2("shape", { cxMm: 33, cyMm: 20, wMm: 14, hMm: 10, color: "#FF7700" });
    up.sbLayer = 2; up.sbMode = "float";
    d.elements.push(lo, up);
    const parts = window.buildParts(d);
    // flat(lo) is empty -> no float-float pin (lo is chain-deepest, up gets no float-float pin either)
    assert(!parts.some((p) => p.name.indexOf("ebene-4-stift-") === 0),
      "no peg on a fully raised piece face");
    // lo has no float below it in pinList -> becomes back-anchor eligible;
    // back anchor uses only backplate-flatTop ^ openN2 ^ lo.mask (no flat-top intersection on piece)
    assert(parts.some((p) => p.name.indexOf("ebene-5-stift-") === 0),
      "raised piece still anchored from the back wall");
  });

  test("schaukasten-v3: fully raised upper piece still gets pinned to a flat lower piece", () => {
    const d = sbDoc();
    d.shadowbox.layers = 5;
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    const lo = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 18, hMm: 12, color: "#00AA00" });
    lo.sbLayer = 3; lo.sbMode = "float"; // flat wings
    const up = window.makeElementV2("shape", { cxMm: 33, cyMm: 20, wMm: 14, hMm: 10, color: "#FF7700" });
    up.sbLayer = 2; up.sbMode = "float";
    up.depth.mode = "colorLayers"; up.depth.direction = "raised"; // fully raised body
    d.elements.push(lo, up);
    const parts = window.buildParts(d);
    assert(parts.some((p) => p.name.indexOf("ebene-4-stift-") === 0),
      "peg on the flat lower piece exists despite the raised upper");
    const upper = parts.filter((p) => /^ebene-3-schwebeteil-\d+(-oben)?$/.test(p.name));
    assert(upper.some((p) => /-oben$/.test(p.name)), "upper piece drilled (hole split)");
  });
})();
