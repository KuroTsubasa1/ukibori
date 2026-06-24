"use strict";
(function () {
  const p = { widthMm: 50, heightMm: 150, cornerRadiusMm: 4, hole: { diameterMm: 5, marginTopMm: 8 } };
  const cols = 50, rows = 150; // 1 cell per mm → easy mm math

  test("sdf: center of body is inside (>0)", () => {
    const f = roundedRectHoleField(cols, rows, p);
    assert(f(25, 75) > 0, "center should be inside");
  });
  test("sdf: hole center is outside (<0)", () => {
    const f = roundedRectHoleField(cols, rows, p);
    // hole center mm = (25, 8+2.5=10.5) -> cell (24.5,10) approx
    assert(f(25, 10) < 0, "hole center should be excluded");
  });
  test("sdf: far outside the body is outside (<0)", () => {
    const f = roundedRectHoleField(cols, rows, p);
    assert(f(60, 75) < 0, "right of body should be outside");
  });
  test("sdf: rounded corner is cut (corner pixel outside)", () => {
    const f = roundedRectHoleField(cols, rows, p);
    // extreme top-left cell, well within the 4mm corner radius -> outside
    assert(f(0, 0) < 0, "sharp corner should be rounded away");
  });
})();
