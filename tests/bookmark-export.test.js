"use strict";
(function () {
  // Build a 20×20 solid-red canvas to act as a decoded image.
  function redCanvas() {
    const cv = document.createElement("canvas"); cv.width = 20; cv.height = 20;
    const cx = cv.getContext("2d"); cx.fillStyle = "#ff0000"; cx.fillRect(0, 0, 20, 20);
    return cv;
  }

  test("compose: empty doc is all base", () => {
    const d = defaultBookmark();
    const out = composeDesign(d, 25, 75);
    let allBase = true;
    for (let i = 0; i < out.isBase.length; i++) if (!out.isBase[i]) allBase = false;
    assert(allBase, "every pixel should be base");
    assertClose(out.depthMm[0], d.thicknessMm, 1e-4, "base depth = thickness");
  });

  test("compose: a solid image paints its color over the center", () => {
    const d = defaultBookmark();
    const el = makeImageElement({ src: "x", colorMode: "solid", color: "#00ff00",
      cxMm: 25, cyMm: 75, wMm: 40, hMm: 40, depthLayers: 2, threshold: 200 });
    el._img = redCanvas(); // red, luminance ~76 < 200 -> below threshold -> part of silhouette
    d.elements.push(el);
    const cols = 50, rows = 150;
    const out = composeDesign(d, cols, rows);
    const idx = 75 * cols + 25; // center
    assertEqual(out.isBase[idx], 0, "center owned by element");
    assertEqual(out.g[idx], 255, "center is green (element color)");
    assertClose(out.depthMm[idx], 2 * d.layerHeightMm, 1e-4, "depth = layers*height");
  });

  test("compose: later element wins (z-order) and cutout flagged", () => {
    const d = defaultBookmark();
    const under = makeImageElement({ src: "x", color: "#0000ff", cxMm: 25, cyMm: 75,
      wMm: 40, hMm: 40, threshold: 200, cutout: false });
    under._img = redCanvas();
    const over = makeImageElement({ src: "x", color: "#ffffff", cxMm: 25, cyMm: 75,
      wMm: 40, hMm: 40, threshold: 200, cutout: true });
    over._img = redCanvas();
    d.elements.push(under, over);
    const cols = 50, rows = 150, idx = 75 * cols + 25;
    const out = composeDesign(d, cols, rows);
    assertEqual(out.r[idx], 255, "top element (white) wins R");
    assertEqual(out.g[idx], 255, "top element (white) wins G");
    assertEqual(out.cutout[idx], 1, "top element cutout flag set");
  });
})();
