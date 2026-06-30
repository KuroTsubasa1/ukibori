"use strict";
(function () {
  // sx=sy=1 (cols=widthMm, rows=heightMm) so mm (x,y) = (c+0.5, r+0.5).
  test("footprint: rect interior > 0, exterior < 0", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const f = shapeFootprintField(50, 150, body, { type: "none" });
    assertClose(f(24.5, 74.5), 25, 1e-6, "deep center = min half-extent (25mm)");
    assert(f(-0.4, -0.4) < 0, "rounded corner cuts mm(0.1,0.1) outside");
    assert(f(-5, 74.5) < 0, "left of body is outside");
  });

  test("footprint: circle inside vs outside", () => {
    const body = { shape: "circle", widthMm: 40, heightMm: 40, cornerRadiusMm: 0 };
    const f = shapeFootprintField(40, 40, body, { type: "none" });
    assertClose(f(19.5, 19.5), 20, 1e-6, "center = radius (20mm)");
    assert(f(1.5, 1.5) < 0, "corner mm(2,2) is outside the inscribed circle");
  });

  test("footprint: mount hole carves the disk", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const mount = { type: "hole", xMm: 25, yMm: 10.5, diameterMm: 5 };
    const f = shapeFootprintField(50, 150, body, mount);
    assertClose(f(24.5, 10), -2.5, 1e-6, "hole center is inside the hole (negative)");
    assertClose(f(24.5, 74.5), 25, 1e-6, "far from hole = full body depth");
  });

  test("footprint: loop cuts the same through-hole as hole", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const loop = { type: "loop", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 2 };
    const f = shapeFootprintField(50, 150, body, loop);
    assertClose(f(24.5, 10), -2.5, 1e-6, "loop also carves the hole");
  });

  test("footprint: mount none leaves the body solid where a hole would be", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const f = shapeFootprintField(50, 150, body, { type: "none" });
    assert(f(24.5, 10) > 0, "no hole -> still inside the body");
  });

  test("footprint: mount null behaves like type none", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const f = shapeFootprintField(50, 150, body, null);
    assertClose(f(24.5, 74.5), 25, 1e-6, "null mount -> full body depth (== type none)");
    assert(f(24.5, 10) > 0, "null mount -> no hole carved");
  });
})();
