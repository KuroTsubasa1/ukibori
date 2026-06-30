"use strict";
(function () {
  test("v2: defaultDoc has version 2 and nested body/mount", () => {
    const d = defaultDoc();
    assertEqual(d.version, 2, "version");
    assertEqual(d.body.shape, "rect", "shape");
    assertEqual(d.body.widthMm, 50, "body width");
    assertEqual(d.body.heightMm, 150, "body height");
    assertEqual(d.body.cornerRadiusMm, 4, "corner");
    assertEqual(d.body.thicknessMm, 3, "thickness");
    assertEqual(d.body.layerHeightMm, 0.2, "layerHeight");
    assertEqual(d.body.baseColor, "#000000", "baseColor");
    assertEqual(d.body.autoSizeFromElementId, null, "autoSize null");
    assertEqual(d.body.freeOutlineFromElementId, null, "freeOutline null");
    assertEqual(d.mount.type, "none", "mount none by default");
    assertEqual(d.resolution, 1024, "resolution");
    assertEqual(d.colorStepLayers, 2, "colorStepLayers");
    assertEqual(d.elements.length, 0, "no elements");
  });

  test("v2: defaultDepth forces text/qr to solid, image defaults raised", () => {
    assertEqual(defaultDepth("text").mode, "solid", "text solid");
    assertEqual(defaultDepth("qr").mode, "solid", "qr solid");
    const di = defaultDepth("image");
    assertEqual(di.mode, "solid", "image default mode solid");
    assertEqual(di.direction, "raised", "image default raised");
    assertEqual(di.reduce.method, "palette", "reduce method default");
    assert(Array.isArray(di.reduce.order), "reduce.order is an array");
    assertEqual(di.threshold, 128, "threshold default");
    assertEqual(di.invert, false, "invert default");
  });

  test("migrate: v1 doc -> v2 body + mount(hole)", () => {
    const v2 = migrateProject(defaultBookmark());
    assertEqual(v2.version, 2, "version");
    assertEqual(v2.body.shape, "rect", "shape rect");
    assertEqual(v2.body.widthMm, 50, "body width carried");
    assertEqual(v2.body.cornerRadiusMm, 4, "corner carried");
    assertEqual(v2.body.thicknessMm, 3, "thickness carried");
    assertEqual(v2.body.layerHeightMm, 0.2, "layerHeight carried");
    assertEqual(v2.mount.type, "hole", "v1 hole -> mount hole");
    assertEqual(v2.mount.diameterMm, 5, "hole diameter");
    assertClose(v2.mount.yMm, 10.5, 1e-9, "hole CENTER y = marginTop + radius");
    assertEqual(v2.mount.marginMm, 8, "marginMm keeps the original top-margin");
    assertClose(v2.mount.xMm, 25, 1e-9, "hole centered x");
  });

  test("migrate: v1 doc without a hole -> mount.type none", () => {
    const v1 = defaultBookmark(); delete v1.hole;
    const m = migrateProject(v1).mount;
    assertEqual(m.type, "none", "no hole -> mount none");
  });

  test("migrate: reduce image -> colorLayers engraved, v1 keys folded", () => {
    const v1 = defaultBookmark();
    v1.elements.push(makeImageElement({ src: "data:x", colorMode: "reduce", depthLayers: 3 }));
    const e = migrateProject(v1).elements[0];
    assertEqual(e.depth.mode, "colorLayers", "reduce -> colorLayers");
    assertEqual(e.depth.direction, "engraved", "engraved");
    assertClose(e.depth.heightMm, 0.6, 1e-9, "height = depthLayers*layerH");
    assertEqual(e.depth.reduce.method, "palette", "reduce method carried");
    assert(Array.isArray(e.depth.reduce.order), "reduce.order array");
    assert(!("colorMode" in e), "colorMode folded away");
    assert(!("depthLayers" in e), "depthLayers folded away");
    assertEqual(e.src, "data:x", "src preserved");
    assert(e._img === null, "_img slot present");
  });

  test("migrate: solid image -> solid depth, threshold/invert moved to depth", () => {
    const v1 = defaultBookmark();
    v1.elements.push(makeImageElement({ src: "data:y", colorMode: "solid", threshold: 100, invert: true }));
    const e = migrateProject(v1).elements[0];
    assertEqual(e.depth.mode, "solid", "solid mode");
    assertEqual(e.depth.threshold, 100, "threshold in depth");
    assertEqual(e.depth.invert, true, "invert in depth");
  });

  test("migrate: text element -> solid depth, text fields preserved", () => {
    const v1 = defaultBookmark();
    v1.elements.push(makeTextElement({ text: "Hi", color: "#ff0000" }));
    const e = migrateProject(v1).elements[0];
    assertEqual(e.type, "text", "type text");
    assertEqual(e.depth.mode, "solid", "text solid");
    assertEqual(e.text, "Hi", "text preserved");
    assertEqual(e.color, "#ff0000", "color preserved");
  });

  test("migrate: idempotent on a v2 doc (same reference)", () => {
    const v2 = defaultDoc();
    assert(migrateProject(v2) === v2, "v2 returned unchanged");
  });

  test("migrate: null/undefined passthrough", () => {
    assert(migrateProject(null) === null, "null passthrough");
    assert(migrateProject(undefined) === undefined, "undefined passthrough");
  });

  test("migrate: preserves fonts", () => {
    const v1 = defaultBookmark();
    v1.fonts = { "bmfont-x": "data:font" };
    assertEqual(migrateProject(v1).fonts["bmfont-x"], "data:font", "fonts carried");
  });
})();
