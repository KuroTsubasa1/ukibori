"use strict";
(function () {
  // Local signed-volume + bbox helpers (don't depend on a possibly-unexported global).
  function signedVol(facets) {
    let v = 0;
    for (const t of facets) {
      const [a, b, c] = t;
      v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
    }
    return v;
  }
  function bbox(facets) {
    let mnx=Infinity,mny=Infinity,mnz=Infinity,mxx=-Infinity,mxy=-Infinity,mxz=-Infinity;
    for (const t of facets) for (const p of t) {
      if (p[0]<mnx) mnx=p[0]; if (p[0]>mxx) mxx=p[0];
      if (p[1]<mny) mny=p[1]; if (p[1]>mxy) mxy=p[1];
      if (p[2]<mnz) mnz=p[2]; if (p[2]>mxz) mxz=p[2];
    }
    return { mnx, mny, mnz, mxx, mxy, mxz };
  }
  function rectDoc(mount) {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 150;
    d.body.cornerRadiusMm = 4; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
    d.resolution = 256;
    if (mount) d.mount = Object.assign({}, d.mount, mount);
    else d.mount = { type: "none", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, marginMm: 8 };
    return d;
  }

  test("gridForBody: longest side = resolution, aspect preserved", () => {
    const g = gridForBody({ widthMm: 50, heightMm: 150 }, 300);
    assertEqual(g.rows, 300, "tall body -> rows = resolution");
    assertEqual(g.cols, 100, "cols = round(300*50/150)");
    assertClose(g.pitch, 0.5, 1e-9, "pitch = widthMm/cols = 50/100");
  });

  test("buildBaseParts: solid rect base is watertight and within bounds", () => {
    const parts = buildBaseParts(rectDoc(null));
    assertEqual(parts.length, 1, "one base part");
    assertEqual(parts[0].name, "grundplatte", "base name");
    assert(parts[0].facets.length > 0, "base has facets");
    assert(signedVol(parts[0].facets) > 0, "outward-oriented (positive volume)");
    const bb = bbox(parts[0].facets);
    assertClose(bb.mnz, 0, 1e-6, "base bottom at z=0");
    assertClose(bb.mxz, 3, 1e-6, "base top at z=thicknessMm");
    assert(bb.mnx >= -0.6 && bb.mxx <= 50.6, "x within body width (+/- ~1 cell)");
    assert(bb.mny >= -0.6 && bb.mxy <= 150.6, "y within body height (+/- ~1 cell)");
  });

  test("buildBaseParts: mount hole adds interior geometry (more triangles)", () => {
    const solid = buildBaseParts(rectDoc(null))[0].facets.length;
    const holed = buildBaseParts(rectDoc({ type: "hole", xMm: 25, yMm: 10.5, diameterMm: 5 }))[0].facets.length;
    assert(holed > solid, "carving a hole increases the triangle count");
  });

  test("buildBaseParts: circle body produces a watertight base", () => {
    const d = defaultDoc();
    d.body.shape = "circle"; d.body.widthMm = 40; d.body.heightMm = 40;
    d.body.thicknessMm = 2; d.resolution = 256;
    d.mount = { type: "none", xMm: 20, yMm: 20, diameterMm: 5, ringThicknessMm: 0, marginMm: 8 };
    const parts = buildBaseParts(d);
    assertEqual(parts.length, 1, "one base part");
    assert(signedVol(parts[0].facets) > 0, "circle base outward-oriented");
    const bb = bbox(parts[0].facets);
    assertClose(bb.mxz, 2, 1e-6, "circle base top at thicknessMm");
  });
})();
