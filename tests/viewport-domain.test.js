"use strict";
// viewportDomain: editor-only domain that contains the plate AND every element's rotated
// bounding box + handle padding, so 2D transform handles never clip. docDomain (engine) is
// unchanged — verified separately by the existing parity suites staying green.
(function () {
  function doc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 50;
    d.mount = { type: "none", xMm: 25, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    return d;
  }
  const PAD = 6;

  test("viewportDomain contains the plate box when the only element is inside it", () => {
    const d = doc();
    d.elements = [makeElementV2("image", { cxMm: 25, cyMm: 25, wMm: 10, hMm: 10 })];
    const v = window.viewportDomain(d);
    assert(v.x0 <= 0 && v.y0 <= 0, "origin at/below plate origin");
    assert(v.x0 + v.wMm >= 50 && v.y0 + v.hMm >= 50, "covers the full plate");
  });

  test("viewportDomain expands to include an element pushed far past the plate", () => {
    const d = doc();
    d.elements = [makeElementV2("image", { cxMm: 90, cyMm: 90, wMm: 20, hMm: 20, rotationDeg: 0 })];
    const v = window.viewportDomain(d);
    assertClose(v.x0 + v.wMm, 100 + PAD, 1e-6, "right edge reaches element right + pad");
    assertClose(v.y0 + v.hMm, 100 + PAD, 1e-6, "bottom edge reaches element bottom + pad");
    assert(v.x0 <= 0 && v.y0 <= 0, "still includes the plate origin");
  });

  test("viewportDomain accounts for rotation (rotated square's AABB is larger)", () => {
    const d = doc();
    d.elements = [makeElementV2("image", { cxMm: 25, cyMm: 25, wMm: 20, hMm: 20, rotationDeg: 45 })];
    const v = window.viewportDomain(d);
    const half = 10 * Math.SQRT2;
    assert(v.x0 <= 25 - half && v.x0 + v.wMm >= 25 + half, "covers rotated AABB horizontally");
  });

  test("hidden elements are ignored", () => {
    const d = doc();
    const el = makeElementV2("image", { cxMm: 200, cyMm: 200, wMm: 10, hMm: 10 });
    el._hidden = true;
    d.elements = [el];
    const v = window.viewportDomain(d);
    assert(v.x0 + v.wMm < 100, "hidden far element does not expand the domain");
  });
})();
