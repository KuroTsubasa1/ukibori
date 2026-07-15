"use strict";
// Zierkante für Formen: decorated outlines on rect/circle shape elements.
(function () {
  function shapeEl(props) {
    return makeElementV2("shape", Object.assign({ cxMm: 30, cyMm: 30, wMm: 30, hMm: 30 }, props));
  }

  test("shape-edge: off/degenerate configs return null", () => {
    assert(buildShapeEdgePolys(shapeEl({})) === null, "default style none");
    const el = shapeEl({}); el.edge = { style: "wave", sizeMm: 0, periodMm: 6 };
    assert(buildShapeEdgePolys(el) === null, "sizeMm 0");
    const tiny = shapeEl({ wMm: 3, hMm: 3 }); tiny.edge = { style: "wave", sizeMm: 1.5, periodMm: 6 };
    assert(buildShapeEdgePolys(tiny) === null, "too small to keep a core");
    const img = makeElementV2("image", {}); img.edge = { style: "wave", sizeMm: 1.5, periodMm: 6 };
    assert(buildShapeEdgePolys(img) === null, "non-shape element");
  });

  test("shape-edge: wave circle oscillates between nominal and carved radius", () => {
    const el = shapeEl({ shape: "circle", wMm: 40, hMm: 40 });
    el.edge = { style: "wave", sizeMm: 2, periodMm: 8 };
    const polys = buildShapeEdgePolys(el);
    assert(polys && polys.outline.length > 32, "outline sampled");
    assert(polys.holes === null, "no holes for wave");
    const radii = polys.outline.map(q => Math.hypot(q.x, q.y));
    const mn = Math.min.apply(null, radii), mx = Math.max.apply(null, radii);
    assertClose(mx, 20, 0.1, "nominal radius reached");
    assertClose(mn, 18, 0.1, "carved by sizeMm");
  });

  test("shape-edge: ellipse (w != h) decorates on the ellipse outline", () => {
    const el = shapeEl({ shape: "circle", wMm: 40, hMm: 24 });
    el.edge = { style: "wave", sizeMm: 1.5, periodMm: 6 };
    const polys = buildShapeEdgePolys(el);
    assert(polys, "ellipse supported");
    // every outline point lies inside the nominal ellipse (+eps) — carve is inward
    polys.outline.forEach(q => {
      const v = (q.x / 20) * (q.x / 20) + (q.y / 12) * (q.y / 12);
      assert(v <= 1.02, "inside nominal ellipse, got " + v);
    });
    // and the carve actually happens somewhere
    const minV = Math.min.apply(null, polys.outline.map(q => (q.x / 20) * (q.x / 20) + (q.y / 12) * (q.y / 12)));
    assert(minV < 0.95, "carved inward");
  });

  test("shape-edge: perforation returns period-snapped holes on the outline", () => {
    const el = shapeEl({ shape: "rect", wMm: 40, hMm: 20 });
    el.edge = { style: "perforation", sizeMm: 2, periodMm: 10 };
    const polys = buildShapeEdgePolys(el);
    assert(polys && polys.holes, "holes present");
    const L = 2 * (40 + 20);
    assertEqual(polys.holes.length, Math.round(L / 10), "n = round(L/period)");
    polys.holes.forEach(h => {
      assertClose(h.r, 1, 1e-9, "hole radius = sizeMm/2");
      const onEdge = Math.abs(Math.abs(h.x) - 20) < 1e-6 || Math.abs(Math.abs(h.y) - 10) < 1e-6;
      assert(onEdge, "hole center on the rect outline");
    });
  });

  test("shape-edge: buildParts differs with vs without an element edge", () => {
    function edgeDoc(style) {
      const d = defaultDoc();
      d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 60;
      d.body.thicknessMm = 3; d.resolution = 96;
      d.autoLayerHeights = false;
      d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
      const el = makeElementV2("shape", { cxMm: 30, cyMm: 30, wMm: 30, hMm: 30, shape: "circle" });
      el.color = "#000000";
      el.edge = { style: style, sizeMm: 2, periodMm: 8 };
      d.elements.push(el);
      return d;
    }
    const plain = buildParts(edgeDoc("none"));
    const wave = buildParts(edgeDoc("wave"));
    const elPart = parts => parts.filter(p => p.name !== "grundplatte");
    assert(elPart(plain).length > 0 && elPart(wave).length > 0, "element parts built");
    assert(JSON.stringify(elPart(plain)) !== JSON.stringify(elPart(wave)), "edge changes geometry");
  });
})();
