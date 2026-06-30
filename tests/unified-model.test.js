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
})();
