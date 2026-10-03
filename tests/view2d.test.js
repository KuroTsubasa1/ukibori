"use strict";
// 2D-workbench viewport math (zoom & pan).
(function () {
  const MARGIN = 48;

  test("view2d: anchored zoom keeps the mm point under the cursor", () => {
    const origin = { x0: 10, y0: 20 };
    const scaleOld = 4, scaleNew = 8;
    const cursor = { px: 300, py: 220 };
    const mmBefore = {
      x: (cursor.px - MARGIN) / scaleOld + origin.x0,
      y: (cursor.py - MARGIN) / scaleOld + origin.y0,
    };
    const o = zoomAnchoredOrigin(origin, cursor.px, cursor.py, scaleOld, scaleNew, MARGIN);
    const mmAfter = {
      x: (cursor.px - MARGIN) / scaleNew + o.x0,
      y: (cursor.py - MARGIN) / scaleNew + o.y0,
    };
    assertClose(mmAfter.x, mmBefore.x, 1e-9, "x anchored");
    assertClose(mmAfter.y, mmBefore.y, 1e-9, "y anchored");
  });

  test("view2d: zoom-out through the same anchor round-trips to the origin", () => {
    const origin = { x0: -3, y0: 7 };
    const o1 = zoomAnchoredOrigin(origin, 500, 100, 2, 10, MARGIN);
    const o2 = zoomAnchoredOrigin(o1, 500, 100, 10, 2, MARGIN);
    assertClose(o2.x0, origin.x0, 1e-9);
    assertClose(o2.y0, origin.y0, 1e-9);
  });

  test("view2d: clamp keeps the window on the domain", () => {
    const domain = { x0: 0, y0: 0, wMm: 100, hMm: 60 };
    // window 40x30 pushed past the right/bottom edge
    let o = clampViewOrigin({ x0: 90, y0: 55 }, domain, 40, 30);
    assertClose(o.x0, 60, 1e-9, "right edge");
    assertClose(o.y0, 30, 1e-9, "bottom edge");
    // pushed past the left/top edge
    o = clampViewOrigin({ x0: -20, y0: -5 }, domain, 40, 30);
    assertClose(o.x0, 0, 1e-9, "left edge");
    assertClose(o.y0, 0, 1e-9, "top edge");
    // inside stays untouched
    o = clampViewOrigin({ x0: 25, y0: 10 }, domain, 40, 30);
    assertClose(o.x0, 25, 1e-9);
    assertClose(o.y0, 10, 1e-9);
  });

  test("view2d: window larger than the domain centers it", () => {
    const domain = { x0: 10, y0: 10, wMm: 20, hMm: 20 };
    const o = clampViewOrigin({ x0: 0, y0: 999 }, domain, 40, 30);
    assertClose(o.x0, 10 + (20 - 40) / 2, 1e-9, "x centered");
    assertClose(o.y0, 10 + (20 - 30) / 2, 1e-9, "y centered");
  });
})();
