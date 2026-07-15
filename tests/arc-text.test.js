"use strict";
// Arc text (Bogentext): pure layout math + end-to-end through buildParts.
(function () {
  const ADV = [10, 10, 10, 10, 10]; // five equal glyph advances

  test("arc-text: degenerates to null for arcDeg 0 / empty advances", () => {
    assert(arcTextPositions(ADV, 0, 20) === null, "arcDeg 0 -> null");
    assert(arcTextPositions([], 90, 20) === null, "no advances -> null");
    assert(arcTextPositions([0, 0], 90, 20) === null, "zero total advance -> null");
  });

  test("arc-text: symmetric advances give a symmetric layout", () => {
    const l = arcTextPositions(ADV, 120, 20);
    assertEqual(l.glyphs.length, 5);
    // middle glyph sits on the arc apex: x=0, rot=0
    assertClose(l.glyphs[2].x, 0, 1e-9, "mid x");
    assertClose(l.glyphs[2].rot, 0, 1e-9, "mid rot");
    // ends mirror each other
    assertClose(l.glyphs[0].x, -l.glyphs[4].x, 1e-9, "x mirror");
    assertClose(l.glyphs[0].y, l.glyphs[4].y, 1e-9, "y mirror");
    assertClose(l.glyphs[0].rot, -l.glyphs[4].rot, 1e-9, "rot mirror");
    // glyphs read left to right
    assert(l.glyphs[0].x < l.glyphs[1].x && l.glyphs[3].x < l.glyphs[4].x, "ordered x");
  });

  test("arc-text: arch up puts the middle glyph on top, arch down below", () => {
    const up = arcTextPositions(ADV, 150, 20);
    const dn = arcTextPositions(ADV, -150, 20);
    // canvas y grows downward: apex above the ends means smaller y
    assert(up.glyphs[2].y < up.glyphs[0].y, "up: apex above ends");
    assert(dn.glyphs[2].y > dn.glyphs[0].y, "down: apex below ends");
    // up/down are exact mirror images in y and rotation
    for (let i = 0; i < 5; i++) {
      assertClose(dn.glyphs[i].y, -up.glyphs[i].y, 1e-9, "y mirrored " + i);
      assertClose(dn.glyphs[i].rot, -up.glyphs[i].rot, 1e-9, "rot mirrored " + i);
      assertClose(dn.glyphs[i].x, up.glyphs[i].x, 1e-9, "x identical " + i);
    }
  });

  test("arc-text: rotation spans the arc angle; chord narrower than the line", () => {
    const l = arcTextPositions(ADV, 180, 0);
    const total = 50;
    // first/last glyph centers sit half a glyph in from the arc ends
    const expected = (total / 2 - 5) / (total / Math.PI); // phi of last glyph mid
    assertClose(l.glyphs[4].rot, expected, 1e-9, "end rotation");
    assert(l.width < total, "arc layout narrower than straight text");
  });

  test("arc-text: layout is centered on the origin", () => {
    const l = arcTextPositions([7, 13, 5, 21], 200, 16);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    l.glyphs.forEach(g => {
      x0 = Math.min(x0, g.x - 8); x1 = Math.max(x1, g.x + 8);
      y0 = Math.min(y0, g.y - 8); y1 = Math.max(y1, g.y + 8);
    });
    assertClose((x0 + x1) / 2, 0, 1e-9, "x centered");
    assertClose((y0 + y1) / 2, 0, 1e-9, "y centered");
  });

  test("arc-text: buildParts renders arc text differently from straight text", () => {
    function textDoc(arcDeg) {
      const d = defaultDoc();
      d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 60;
      d.body.thicknessMm = 3; d.body.layerHeightMm = 0.2;
      d.resolution = 96;
      d.autoLayerHeights = false; // manual heights: keep the element a plain raised prism
      d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
      const el = makeElementV2("text", { cxMm: 30, cyMm: 30, wMm: 40, hMm: 12, text: "UKIBORI" });
      el.color = "#000000"; // distinct from the white base color (base-colored would sit flush)
      el.arcDeg = arcDeg;
      d.elements.push(el);
      return d;
    }
    const straight = buildParts(textDoc(0));
    const arc = buildParts(textDoc(180));
    const elPart = parts => parts.filter(p => p.name !== "grundplatte");
    assert(elPart(straight).length > 0, "straight text produced an element part");
    assert(elPart(arc).length > 0, "arc text produced an element part");
    assert(JSON.stringify(elPart(straight)) !== JSON.stringify(elPart(arc)), "arc changes the geometry");
  });
})();
