"use strict";
// Form-Elemente (Kreis / Rechteck): model defaults, rasterization, 3D parts.
(function () {
  function signedVol(facets) {
    let v = 0;
    for (const t of facets) { const [a, b, c] = t;
      v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6; }
    return v;
  }
  function xyBox(facets) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of facets) for (const p of t) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return { w: x1 - x0, h: y1 - y0 };
  }
  function zMax(facets) {
    let z = -Infinity;
    for (const t of facets) for (const p of t) if (p[2] > z) z = p[2];
    return z;
  }

  // 50×50mm plate, T=3, layerH=0.2, classic manual heights (no auto ranks).
  function shapeDoc(el) {
    const d = defaultDoc();
    d.body.widthMm = 50; d.body.heightMm = 50; d.body.cornerRadiusMm = 0;
    d.body.thicknessMm = 3; d.body.layerHeightMm = 0.2;
    d.resolution = 200;
    d.autoLayerHeights = false;
    d.mount = { type: "none", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    d.elements = [el];
    return d;
  }
  function mkShape(kind, props) {
    const el = makeElementV2("shape", Object.assign({ shape: kind, cxMm: 25, cyMm: 25, wMm: 20, hMm: 20, color: "#ff0000" }, props || {}));
    el.depth.direction = "raised";
    el.depth.heightMm = 1.2;
    return el;
  }

  test("makeElementV2('shape') defaults to rect with solid depth", () => {
    const el = makeElementV2("shape", {});
    assertEqual(el.type, "shape");
    assertEqual(el.shape, "rect", "default kind is rect");
    assert(el.depth && el.depth.mode === "solid", "depth.mode solid");
    assert(typeof el.color === "string" && el.color[0] === "#", "has a hex color");
  });

  test("makeElementV2('shape', {shape:'circle'}) keeps circle", () => {
    assertEqual(makeElementV2("shape", { shape: "circle" }).shape, "circle");
  });

  test("compose: rect shape owns its full bounding box", () => {
    const d = shapeDoc(mkShape("rect"));
    const { cols, rows } = gridForBody(d.body, d.resolution);
    const comp = composeDesignV2(d, cols, rows);
    const ix = (xMm, yMm) => Math.round(yMm / 50 * rows) * cols + Math.round(xMm / 50 * cols);
    assertEqual(comp.owner[ix(25, 25)], 0, "center owned by the shape");
    assertEqual(comp.owner[ix(16, 16)], 0, "bbox corner area owned (rect fills it)");
    assertEqual(comp.r[ix(25, 25)], 255, "painted in el.color red");
    assertEqual(comp.owner[ix(5, 5)], -1, "outside stays base");
  });

  test("compose: circle covers the center but NOT the bbox corners", () => {
    const d = shapeDoc(mkShape("circle"));
    const { cols, rows } = gridForBody(d.body, d.resolution);
    const comp = composeDesignV2(d, cols, rows);
    const ix = (xMm, yMm) => Math.round(yMm / 50 * rows) * cols + Math.round(xMm / 50 * cols);
    assertEqual(comp.owner[ix(25, 25)], 0, "center owned");
    assertEqual(comp.owner[ix(16, 16)], -1, "bbox corner is outside the circle");
    assertEqual(comp.owner[ix(25, 16)], 0, "top of the circle (on the axis) is inside");
  });

  test("raised circle → erhaben prism, round (volume ≈ πr²h), correct bbox + height", () => {
    const d = shapeDoc(mkShape("circle"));
    const parts = buildParts(d);
    const raised = parts.filter(p => p.name.indexOf("erhaben") === 0);
    assertEqual(raised.length, 1, "one raised part");
    const box = xyBox(raised[0].facets);
    assertClose(box.w, 20, 1.5, "raised bbox width ≈ diameter");
    assertClose(box.h, 20, 1.5, "raised bbox height ≈ diameter");
    assertClose(zMax(raised[0].facets), 3 + 1.2, 1e-6, "prism top = T + heightMm");
    const vol = Math.abs(signedVol(raised[0].facets));
    assertClose(vol, Math.PI * 10 * 10 * 1.2, 25, "volume of a CIRCLE prism, not the 480mm³ rect");
  });

  test("raised ellipse (20×10) → volume ≈ π·a·b·h", () => {
    const d = shapeDoc(mkShape("circle", { hMm: 10 }));
    const parts = buildParts(d);
    const raised = parts.filter(p => p.name.indexOf("erhaben") === 0);
    assertEqual(raised.length, 1, "one raised part");
    const vol = Math.abs(signedVol(raised[0].facets));
    assertClose(vol, Math.PI * 10 * 5 * 1.2, 15, "elliptical prism volume");
  });

  test("raised rect rotated 45° → bbox grows to ≈ side·√2", () => {
    const el = mkShape("rect", { rotationDeg: 45 });
    const parts = buildParts(shapeDoc(el));
    const raised = parts.filter(p => p.name.indexOf("erhaben") === 0);
    assertEqual(raised.length, 1, "one raised part");
    const box = xyBox(raised[0].facets);
    assertClose(box.w, 20 * Math.SQRT2, 1.5, "rotated bbox width");
    assertClose(box.h, 20 * Math.SQRT2, 1.5, "rotated bbox height");
  });

  test("engraved (Vertieft) circle → farbe floor at T − heightMm, plate present, watertight", () => {
    const el = mkShape("circle");
    el.depth.direction = "engraved";
    el.depth.heightMm = 1.0;
    const parts = buildParts(shapeDoc(el));
    const farbe = parts.filter(p => p.name.indexOf("farbe") === 0);
    assertEqual(farbe.length, 1, "one color floor");
    assertClose(zMax(farbe[0].facets), 3 - 1.0, 1e-6, "floor top recessed by heightMm");
    assertEqual(farbe[0].color[0], 255, "floor keeps el.color red");
    assert(parts.some(p => p.name.indexOf("grundplatte") === 0), "grundplatte exists");
    assert(parts.every(p => Math.abs(signedVol(p.facets)) > 0), "every part watertight");
  });

  test("circle cutout punches a hole (comp.cutout set inside, off outside)", () => {
    const el = mkShape("circle", { cutout: true });
    const d = shapeDoc(el);
    const { cols, rows } = gridForBody(d.body, d.resolution);
    const comp = composeDesignV2(d, cols, rows);
    const ix = (xMm, yMm) => Math.round(yMm / 50 * rows) * cols + Math.round(xMm / 50 * cols);
    assertEqual(comp.cutout[ix(25, 25)], 1, "cutout inside the circle");
    assertEqual(comp.cutout[ix(16, 16)], 0, "no cutout at the square corner");
  });

  test("serialize → deserialize → migrate keeps the shape kind", () => {
    const d = shapeDoc(mkShape("circle"));
    const d2 = migrateProject(deserializeProject(serializeProject(d)));
    assertEqual(d2.elements[0].type, "shape");
    assertEqual(d2.elements[0].shape, "circle");
  });

  test("migrate backfills a missing shape kind to rect (hand-edited save)", () => {
    const d = shapeDoc(mkShape("rect"));
    delete d.elements[0].shape;
    const d2 = migrateProject(JSON.parse(serializeProject(d)));
    assertEqual(d2.elements[0].shape, "rect");
  });

  test("Höhe je Farbe: a shape's color takes an auto rank like text", () => {
    const el = mkShape("rect", { color: "#ff0000" });
    const d = shapeDoc(el);
    d.autoLayerHeights = true;
    d.body.baseColor = "#ffffff";
    assertClose(autoSolidHeightMm(d, el), 2 * 0.2, 1e-9, "rank 1 × colorStepLayers × layerH");
  });
})();
