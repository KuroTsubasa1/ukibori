"use strict";
(function () {
  const els = [
    { id: "a", cxMm: 5,  cyMm: 5,  wMm: 4, hMm: 4, rotationDeg: 0 },
    { id: "b", cxMm: 20, cyMm: 20, wMm: 4, hMm: 4, rotationDeg: 0 },
    { id: "c", cxMm: 5,  cyMm: 20, wMm: 4, hMm: 4, rotationDeg: 0, _hidden: true },
  ];
  test("marquee: selects elements whose AABB intersects the rect", () => {
    const hit = marqueeHits(els, { x0: 0, y0: 0, x1: 10, y1: 10 });
    assertEqual(hit.length, 1); assertEqual(hit[0], "a");
  });
  test("marquee: skips hidden elements", () => {
    const hit = marqueeHits(els, { x0: 0, y0: 15, x1: 10, y1: 25 });
    assertEqual(hit.length, 0, "c is hidden");
  });
  test("marquee: a wide rect grabs multiple", () => {
    const hit = marqueeHits(els, { x0: 0, y0: 0, x1: 30, y1: 30 });
    assertEqual(hit.length, 2); // a and b (c hidden)
  });
})();
