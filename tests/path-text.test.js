"use strict";
// Pfadtext: glyph layout along a freehand path.
(function () {
  const ADV5 = [10, 10, 10, 10, 10]; // 50 units of text

  test("path-text: straight path centers the text with 0 rotation", () => {
    const g = pathTextPositions(ADV5, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    assertEqual(g.length, 5);
    // total 50 on a 100 path → start offset 25; first glyph center at 30
    assertClose(g[0].x, 30, 1e-9);
    assertClose(g[4].x, 70, 1e-9);
    g.forEach(p => { assertClose(p.y, 0, 1e-9); assertClose(p.rot, 0, 1e-9); });
  });

  test("path-text: text longer than the path overhangs both ends", () => {
    const g = pathTextPositions(ADV5, [{ x: 0, y: 0 }, { x: 30, y: 0 }]);
    // 50 units on a 30 path → start offset -10; first glyph center at -5
    assertClose(g[0].x, -5, 1e-9, "extrapolated before the start");
    assertClose(g[4].x, 35, 1e-9, "extrapolated past the end");
  });

  test("path-text: glyphs rotate to the segment tangent", () => {
    const g = pathTextPositions([10, 10], [{ x: 0, y: 0 }, { x: 0, y: 100 }]);
    g.forEach(p => assertClose(p.rot, Math.PI / 2, 1e-9, "vertical tangent"));
    const l = pathTextPositions([10, 10, 10, 10], [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]);
    assertClose(l[0].rot, 0, 1e-9, "first segment horizontal");
    assertClose(l[3].rot, Math.PI / 2, 1e-9, "last segment vertical");
  });

  test("path-text: degenerate inputs return null", () => {
    assert(pathTextPositions(ADV5, []) === null, "no path");
    assert(pathTextPositions(ADV5, [{ x: 1, y: 1 }]) === null, "single point");
    assert(pathTextPositions([], [{ x: 0, y: 0 }, { x: 10, y: 0 }]) === null, "no advances");
    assert(pathTextPositions([0, 0], [{ x: 0, y: 0 }, { x: 10, y: 0 }]) === null, "zero advance");
  });

  test("path-text: smoothPath keeps endpoints and softens corners", () => {
    const raw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const sm = smoothPath(raw, 2);
    assertClose(sm[0].x, 0, 1e-9); assertClose(sm[0].y, 0, 1e-9);
    assertClose(sm[sm.length - 1].x, 10, 1e-9); assertClose(sm[sm.length - 1].y, 10, 1e-9);
    assert(sm.length > raw.length, "densified");
    // no smoothed point still sits exactly on the sharp corner
    const onCorner = sm.some(p => Math.hypot(p.x - 10, p.y - 0) < 1e-9);
    assert(!onCorner, "corner cut");
  });

  test("path-text: buildParts renders path text differently from straight text", () => {
    function textDoc(withPath) {
      const d = defaultDoc();
      d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 60;
      d.body.thicknessMm = 3; d.resolution = 96;
      d.autoLayerHeights = false;
      d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
      const el = makeElementV2("text", { cxMm: 30, cyMm: 30, wMm: 40, hMm: 10, text: "UKIBORI" });
      el.color = "#000000";
      if (withPath) el.textPath = [{ x: -20, y: 8 }, { x: 0, y: -8 }, { x: 20, y: 8 }];
      d.elements.push(el);
      return d;
    }
    const straight = buildParts(textDoc(false));
    const curved = buildParts(textDoc(true));
    const elPart = parts => parts.filter(p => p.name !== "grundplatte");
    assert(elPart(straight).length > 0 && elPart(curved).length > 0, "both build");
    assert(JSON.stringify(elPart(straight)) !== JSON.stringify(elPart(curved)), "path changes geometry");
  });
})();
