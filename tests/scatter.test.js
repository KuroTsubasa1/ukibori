"use strict";
(function () {
  const source = { wMm: 6, hMm: 6 };
  const region = { x0: 0, y0: 0, x1: 40, y1: 40 };
  const params = { count: 8, rotMin: 0, rotMax: 90, scaleMin: 0.5, scaleMax: 1.5, avoidOverlap: false };

  test("scatter: makeRng is deterministic for a seed", () => {
    const r1 = makeRng(42), r2 = makeRng(42);
    assertClose(r1(), r2(), 0);
    assertClose(r1(), r2(), 0);
  });
  test("scatter: same seed -> identical layout", () => {
    const a = scatterCopies(source, region, params, 7);
    const b = scatterCopies(source, region, params, 7);
    assertEqual(a.length, b.length);
    for (let i = 0; i < a.length; i++) { assertClose(a[i].cxMm, b[i].cxMm, 0); assertClose(a[i].rotationDeg, b[i].rotationDeg, 0); }
  });
  test("scatter: places exactly count and stays in region (overlaps allowed)", () => {
    const out = scatterCopies(source, region, params, 3);
    assertEqual(out.length, 8);
    out.forEach(c => {
      assert(c.cxMm >= region.x0 && c.cxMm <= region.x1, "cx in region");
      assert(c.cyMm >= region.y0 && c.cyMm <= region.y1, "cy in region");
      assert(c.rotationDeg >= 0 && c.rotationDeg <= 90, "rot in range");
      const k = c.wMm / source.wMm; assert(k >= 0.5 - 1e-9 && k <= 1.5 + 1e-9, "scale in range");
    });
  });
  test("scatter: avoid-overlaps yields non-overlapping boxes (<= count)", () => {
    const out = scatterCopies(source, region, Object.assign({}, params, { avoidOverlap: true, count: 6 }), 11);
    assert(out.length <= 6, "at most count");
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      assert(!aabbsOverlap(elementAABB(out[i]), elementAABB(out[j])), "no overlap " + i + "," + j);
    }
  });
})();
