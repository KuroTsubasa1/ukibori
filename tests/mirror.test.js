"use strict";
// Spiegeln: el.flipH / el.flipV mirror the artwork in ELEMENT-LOCAL space at
// draw time (after rotation) — geometry (center/size/rotation) is untouched,
// so hit-tests, handles and snapping are unaffected. Verified end-to-end via
// the engine: raised prisms must land on the mirrored side of the element.
(function () {
  // 100x100px canvas, ink on ONE half. axis "x": left half; axis "y": top half.
  async function halfImg(axis) {
    const cv = document.createElement("canvas"); cv.width = 100; cv.height = 100;
    const cx = cv.getContext("2d"); cx.fillStyle = "#000000";
    if (axis === "x") cx.fillRect(0, 0, 50, 100); else cx.fillRect(0, 0, 100, 50);
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  function mirrorDoc(img, props) {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 50;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 2; d.body.baseColor = "#ffffff";
    d.resolution = 200;
    d.autoLayerHeights = false; // classic raised prisms ("erhaben-*"), not auto bands
    d.mount = { type: "none", xMm: 25, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    const el = makeElementV2("image", Object.assign({ src: "a", cxMm: 25, cyMm: 25, wMm: 20, hMm: 20 }, props));
    el.depth.direction = "raised"; el._img = img;
    d.elements = [el];
    return d;
  }
  // Min/max of one coordinate axis over all raised-prism facet vertices.
  function inkRange(parts, ax) {
    let min = Infinity, max = -Infinity;
    for (const p of parts) {
      if (p.name.indexOf("erhaben") !== 0) continue;
      for (const f of p.facets) for (const v of f) { if (v[ax] < min) min = v[ax]; if (v[ax] > max) max = v[ax]; }
    }
    assert(min < max, "raised prisms exist (axis " + ax + ")");
    return [min, max];
  }
  // Both ranges must be mirror images around c, and sit on opposite sides of it.
  function assertMirrored(a, b, c, label) {
    const tol = 0.8; // raster pitch 0.25mm + trace rounding
    assert(Math.abs(b[0] - (2 * c - a[1])) < tol && Math.abs(b[1] - (2 * c - a[0])) < tol,
      label + ": range mirrors around " + c + " (got [" + a + "] vs [" + b + "])");
    const aMid = (a[0] + a[1]) / 2, bMid = (b[0] + b[1]) / 2;
    assert((aMid - c) * (bMid - c) < 0, label + ": ink switched sides");
  }

  test("mirror: flipH moves half-ink to the opposite x half", async () => {
    const img = await halfImg("x");
    const a = inkRange(buildParts(mirrorDoc(img, {})), 0);
    const b = inkRange(buildParts(mirrorDoc(img, { flipH: true })), 0);
    assertMirrored(a, b, 25, "flipH/x");
  });

  test("mirror: flipV moves half-ink to the opposite y half", async () => {
    const img = await halfImg("y");
    const a = inkRange(buildParts(mirrorDoc(img, {})), 1);
    const b = inkRange(buildParts(mirrorDoc(img, { flipV: true })), 1);
    assertMirrored(a, b, 25, "flipV/y");
  });

  test("mirror: flip is element-local — flipH on a 90°-rotated element mirrors across the ROTATED axis", async () => {
    const img = await halfImg("x");
    const a = buildParts(mirrorDoc(img, { rotationDeg: 90 }));
    const b = buildParts(mirrorDoc(img, { rotationDeg: 90, flipH: true }));
    // Local x maps to world y under 90° rotation: y mirrors, x extent stays put.
    assertMirrored(inkRange(a, 1), inkRange(b, 1), 25, "local-flip/y");
    const ax = inkRange(a, 0), bx = inkRange(b, 0);
    assert(Math.abs(ax[0] - bx[0]) < 0.8 && Math.abs(ax[1] - bx[1]) < 0.8,
      "x extent unchanged (got [" + ax + "] vs [" + bx + "])");
  });

  test("mirror: model defaults + v2 migration backfill flipH/flipV=false", () => {
    const el = makeElementV2("image", {});
    assert(el.flipH === false && el.flipV === false, "factory defaults");
    const d = defaultDoc();
    d.elements = [makeElementV2("text", {})];
    delete d.elements[0].flipH; delete d.elements[0].flipV; // pre-feature save
    const m = migrateProject(JSON.parse(serializeProject(d)));
    assert(m.elements[0].flipH === false && m.elements[0].flipV === false, "migration backfills false");
  });
})();
