"use strict";
(function () {
  const mk = (id, cx, cy) => ({ id, cxMm: cx, cyMm: cy, wMm: 4, hMm: 4, rotationDeg: 0 });
  test("align: left snaps every element's left edge to the group's left", () => {
    const u = alignElements([mk("a", 10, 0), mk("b", 20, 5)], "left");
    // group x0 = 8 (a's left). Each element half-width 2 -> center x = 10.
    assertClose(u[0].cxMm, 10); assertClose(u[1].cxMm, 10);
  });
  test("align: centerV aligns vertical centers to the group's mid-y", () => {
    const u = alignElements([mk("a", 0, 0), mk("b", 0, 10)], "centerV");
    assertClose(u[0].cyMm, 5); assertClose(u[1].cyMm, 5);
  });
  test("distribute: h gives equal gaps, ends fixed", () => {
    const u = distributeElements([mk("a", 0, 0), mk("b", 3, 0), mk("c", 20, 0)], "h");
    // ends a(0) and c(20) fixed; total width 3*4=12; free space 18-(-2)=16... gap-based:
    // spans: a[-2,2] c[18,22]; inner b width 4; gap = ((18-2) - 4)/2 = 6 -> b span [8,12] -> center 10
    assertClose(u[1].cxMm, 10);
  });
})();
