"use strict";
(function () {
  const starts = [
    { id: "a", cxMm: 0,  cyMm: 0, wMm: 4, hMm: 4, rotationDeg: 0 },
    { id: "b", cxMm: 10, cyMm: 0, wMm: 4, hMm: 4, rotationDeg: 0 },
  ];
  test("transform: selectionBBox unions members", () => {
    const bb = selectionBBox(starts);
    assertClose(bb.x0, -2); assertClose(bb.x1, 12); assertClose(bb.y0, -2); assertClose(bb.y1, 2);
  });
  test("transform: applyMove shifts every center", () => {
    const u = applyMove(starts, 5, -3);
    assertClose(u[0].cxMm, 5); assertClose(u[0].cyMm, -3);
    assertClose(u[1].cxMm, 15); assertClose(u[1].cyMm, -3);
  });
  test("transform: applyScale is uniform about a pivot", () => {
    const u = applyScale(starts, { x: 0, y: 0 }, 2);
    assertClose(u[0].cxMm, 0);  assertClose(u[0].wMm, 8);
    assertClose(u[1].cxMm, 20); assertClose(u[1].hMm, 8);
  });
  test("transform: applyRotate rotates centers and accumulates rotationDeg", () => {
    const u = applyRotate(starts, { x: 0, y: 0 }, 90);
    // b at (10,0) rotates 90° CCW-in-math about origin -> (0,10) in this y-down space it's (0,10) via [x' = x cos - y sin, y' = x sin + y cos]
    assertClose(u[1].cxMm, 0, 1e-4); assertClose(u[1].cyMm, 10, 1e-4);
    assertEqual(u[1].rotationDeg, 90);
  });
})();
