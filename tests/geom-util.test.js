"use strict";
(function () {
  test("geom: elementAABB of an unrotated element is its box", () => {
    const bb = elementAABB({ cxMm: 10, cyMm: 20, wMm: 8, hMm: 4, rotationDeg: 0 });
    assertClose(bb.x0, 6); assertClose(bb.x1, 14);
    assertClose(bb.y0, 18); assertClose(bb.y1, 22);
  });
  test("geom: elementAABB grows for a 45°-rotated square", () => {
    const bb = elementAABB({ cxMm: 0, cyMm: 0, wMm: 10, hMm: 10, rotationDeg: 45 });
    const half = Math.SQRT2 * 5; // corner distance
    assertClose(bb.x1, half, 1e-4); assertClose(bb.x0, -half, 1e-4);
  });
  test("geom: aabbUnion covers all inputs; null for empty", () => {
    assert(aabbUnion([]) === null, "empty -> null");
    const u = aabbUnion([{x0:0,y0:0,x1:2,y1:2}, {x0:3,y0:-1,x1:4,y1:1}]);
    assertClose(u.x0, 0); assertClose(u.x1, 4); assertClose(u.y0, -1); assertClose(u.y1, 2);
  });
  test("geom: aabbsOverlap true when touching-overlapping, false when apart", () => {
    assert(aabbsOverlap({x0:0,y0:0,x1:2,y1:2}, {x0:1,y0:1,x1:3,y1:3}) === true, "overlap");
    assert(aabbsOverlap({x0:0,y0:0,x1:1,y1:1}, {x0:2,y0:2,x1:3,y1:3}) === false, "apart");
  });
})();
