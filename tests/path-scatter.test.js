"use strict";
// Streuen entlang Pfad: even arc-length resampling + copies along the path.
(function () {
  const SRC = { wMm: 10, hMm: 6 };
  const PARAMS = { count: 3, rotMin: 0, rotMax: 0, scaleMin: 1, scaleMax: 1, alignToPath: true };

  test("path-scatter: straight line resamples evenly with 0° tangent", () => {
    const spots = pathResample([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);
    assertEqual(spots.length, 5);
    [0, 2.5, 5, 7.5, 10].forEach((x, i) => {
      assertClose(spots[i].x, x, 1e-9, "x " + i);
      assertClose(spots[i].y, 0, 1e-9, "y " + i);
      assertClose(spots[i].tangentDeg, 0, 1e-9, "tangent " + i);
    });
  });

  test("path-scatter: L-shaped path spans both segments, endpoints included", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const spots = pathResample(pts, 3);
    assertClose(spots[0].x, 0, 1e-9); assertClose(spots[0].y, 0, 1e-9);
    assertClose(spots[1].x, 10, 1e-9); assertClose(spots[1].y, 0, 1e-9);
    assertClose(spots[2].x, 10, 1e-9); assertClose(spots[2].y, 10, 1e-9);
    assertClose(spots[0].tangentDeg, 0, 1e-9, "first segment tangent");
    assertClose(spots[2].tangentDeg, 90, 1e-9, "second segment tangent");
  });

  test("path-scatter: count 1 sits at the path middle", () => {
    const spots = pathResample([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1);
    assertEqual(spots.length, 1);
    assertClose(spots[0].x, 10, 1e-9);
    assertClose(spots[0].y, 0, 1e-9);
  });

  test("path-scatter: degenerate paths give no spots", () => {
    assertEqual(pathResample([], 5).length, 0);
    assertEqual(pathResample([{ x: 3, y: 3 }], 5).length, 0);
    assertEqual(pathResample([{ x: 3, y: 3 }, { x: 3, y: 3 }], 5).length, 0);
  });

  test("path-scatter: copies align to the tangent when asked", () => {
    const t = scatterAlongPath(SRC, [{ x: 0, y: 0 }, { x: 0, y: 20 }], PARAMS, 7);
    assertEqual(t.length, 3);
    t.forEach((c, i) => {
      assertEqual(c.rotationDeg, 90, "aligned to vertical path " + i);
      assertClose(c.wMm, 10, 1e-9); assertClose(c.hMm, 6, 1e-9);
    });
    const plain = scatterAlongPath(SRC, [{ x: 0, y: 0 }, { x: 0, y: 20 }],
      Object.assign({}, PARAMS, { alignToPath: false }), 7);
    plain.forEach(c => assertEqual(c.rotationDeg, 0, "no tangent without align"));
  });

  test("path-scatter: same seed -> identical layout; scale jitter in range", () => {
    const params = Object.assign({}, PARAMS, { count: 6, scaleMin: 0.5, scaleMax: 1.5 });
    const path = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }];
    const a = scatterAlongPath(SRC, path, params, 11);
    const b = scatterAlongPath(SRC, path, params, 11);
    assertEqual(a.length, 6);
    for (let i = 0; i < a.length; i++) {
      assertClose(a[i].cxMm, b[i].cxMm, 0); assertClose(a[i].rotationDeg, b[i].rotationDeg, 0);
      const k = a[i].wMm / SRC.wMm;
      assert(k >= 0.5 - 1e-9 && k <= 1.5 + 1e-9, "scale in range");
      assertClose(a[i].hMm / SRC.hMm, k, 1e-9, "uniform scale");
    }
  });
})();
