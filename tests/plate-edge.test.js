"use strict";
// Zierkante: perimeter parameterization + edge decoration of the plate SDF.
(function () {
  function rectBody(props) {
    return Object.assign({ shape: "rect", widthMm: 60, heightMm: 40, cornerRadiusMm: 5 }, props);
  }

  test("perimeter: circle length, points and nearest round-trip", () => {
    const body = { shape: "circle", widthMm: 50, heightMm: 50 };
    const per = platePerimeterMm(body);
    assertClose(per.length, 2 * Math.PI * 25, 1e-9);
    const top = per.point(0);
    assertClose(top.x, 25, 1e-9); assertClose(top.y, 0, 1e-9);
    assertClose(top.nx, 0, 1e-9); assertClose(top.ny, -1, 1e-9);
    for (const t of [0, 10, 40, per.length - 3]) {
      const q = per.point(t);
      assertClose(per.nearest(q.x + q.nx * 2, q.y + q.ny * 2), t, 1e-6, "nearest(point+n) t=" + t);
    }
  });

  test("perimeter: rounded-rect length and segment walk", () => {
    const body = rectBody();
    const per = platePerimeterMm(body);
    const rr = 5;
    assertClose(per.length, 2 * (60 - 2 * rr) + 2 * (40 - 2 * rr) + 2 * Math.PI * rr, 1e-9);
    // top edge start / end
    let q = per.point(0);
    assertClose(q.x, rr, 1e-9); assertClose(q.y, 0, 1e-9); assertClose(q.ny, -1, 1e-9);
    // middle of the right edge
    q = per.point((60 - 2 * rr) + Math.PI * rr / 2 + (40 - 2 * rr) / 2);
    assertClose(q.x, 60, 1e-9); assertClose(q.y, 20, 1e-9); assertClose(q.nx, 1, 1e-9);
    // nearest round-trips along all segments (offset outward by 1mm)
    for (let i = 0; i < 16; i++) {
      const t = per.length * i / 16;
      const p = per.point(t);
      assertClose(per.nearest(p.x + p.nx, p.y + p.ny), t, 1e-6, "roundtrip t=" + t.toFixed(2));
    }
  });

  test("decorator: wave carves sizeMm at repeat starts, nothing mid-period", () => {
    const deco = plateEdgeDecorator({ style: "wave", sizeMm: 2, periodMm: 8 }, 80);
    // n = 10 repeats, p = 8
    assertClose(deco(0, 0), -2, 1e-9, "deepest at t=0");
    assertClose(deco(0, 4), 0, 1e-9, "nominal at half period");
    assertClose(deco(0, 80), -2, 1e-9, "seamless wrap at t=L");
  });

  test("decorator: teeth zigzag between 0 and sizeMm", () => {
    const deco = plateEdgeDecorator({ style: "teeth", sizeMm: 1.5, periodMm: 10 }, 100);
    assertClose(deco(0, 0), 0, 1e-9, "tooth tip at repeat start");
    assertClose(deco(0, 5), -1.5, 1e-9, "notch at half period");
  });

  test("decorator: perforation punches holes on the outline", () => {
    const deco = plateEdgeDecorator({ style: "perforation", sizeMm: 2, periodMm: 10 }, 100);
    assertClose(deco(0, 0), -1, 1e-9, "outline point at hole center is outside");
    assertClose(deco(0.5, 0), -0.5, 1e-6, "0.5mm inside hole center still outside");
    assertClose(deco(3, 0), 2, 1e-9, "3mm inside: hole rim 2mm away wins over plate sdf 3");
    assertClose(deco(0, 5), 0, 1e-9, "outline midway between holes untouched");
  });

  test("decorator: off/invalid configs return null", () => {
    assert(plateEdgeDecorator(null, 100) === null);
    assert(plateEdgeDecorator({ style: "none", sizeMm: 2, periodMm: 8 }, 100) === null);
    assert(plateEdgeDecorator({ style: "wave", sizeMm: 0, periodMm: 8 }, 100) === null);
    assert(plateEdgeDecorator({ style: "wave", sizeMm: 2, periodMm: 0 }, 100) === null);
  });

  test("bodySdfMm: edge 'none' stays byte-identical to the undecorated SDF", () => {
    const plain = bodySdfMm(rectBody());
    const none = bodySdfMm(rectBody({ edge: { style: "none", sizeMm: 2, periodMm: 8 } }));
    for (const [x, y] of [[0, 0], [30, 20], [59, 39], [30, 0.5], [-3, 20]]) {
      assertClose(none(x, y), plain(x, y), 0, `(${x},${y})`);
    }
  });

  test("bodySdfMm: wave edge carves the boundary inward", () => {
    const body = { shape: "circle", widthMm: 50, heightMm: 50, edge: { style: "wave", sizeMm: 2, periodMm: 8 } };
    const sdf = bodySdfMm(body);
    // top of the circle = t=0 = deepest carve: nominal boundary point is now ~2mm outside
    assertClose(sdf(25, 0), -2, 1e-6, "deepest carve at top");
    // 2mm inside at the top sits exactly on the decorated boundary
    assertClose(sdf(25, 2), 0, 1e-6, "carved boundary moved inward");
    // far inside is barely affected in sign
    assert(sdf(25, 25) > 0, "center stays inside");
  });

  test("buildParts: Zierkante changes the plate, free/image shapes ignore it", () => {
    function edgeDoc(style) {
      const d = defaultDoc();
      d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 40;
      d.body.cornerRadiusMm = 4; d.body.thicknessMm = 3; d.resolution = 96;
      d.autoLayerHeights = false;
      d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
      d.body.edge = { style: style, sizeMm: 2, periodMm: 8 };
      return d;
    }
    const plain = buildParts(edgeDoc("none"));
    const wave = buildParts(edgeDoc("wave"));
    const perf = buildParts(edgeDoc("perforation"));
    assert(plain.length > 0 && wave.length > 0 && perf.length > 0, "all variants build");
    assert(JSON.stringify(plain) !== JSON.stringify(wave), "wave changes geometry");
    assert(JSON.stringify(plain) !== JSON.stringify(perf), "perforation changes geometry");
    assert(JSON.stringify(wave) !== JSON.stringify(perf), "styles differ");
  });
})();
