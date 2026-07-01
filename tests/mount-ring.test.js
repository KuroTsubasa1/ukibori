"use strict";
(function () {
  function signedVol(facets) {
    let v = 0;
    for (const t of facets) { const [a,b,c]=t;
      v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6; }
    return v;
  }
  function zbounds(facets){ let mn=Infinity,mx=-Infinity; for(const t of facets) for(const p of t){ if(p[2]<mn)mn=p[2]; if(p[2]>mx)mx=p[2]; } return {mn,mx}; }
  function loopDoc() {
    const d = defaultDoc();
    d.body.shape="rect"; d.body.widthMm=40; d.body.heightMm=120; d.body.thicknessMm=3; d.body.baseColor="#334455";
    d.resolution=240;
    d.mount = { type:"loop", xMm:20, yMm:10, diameterMm:6, ringThicknessMm:2.5, ringHeightMm:2, marginMm:7 };
    return d;
  }

  test("mount ring: loop produces one watertight annular Öse at the right z", () => {
    const parts = buildMountRingParts(loopDoc());
    assertEqual(parts.length, 1, "one ring part");
    assertEqual(parts[0].name, "oese", "named oese");
    assert(parts[0].facets.length > 0, "has facets");
    assert(signedVol(parts[0].facets) > 0, "watertight (positive volume)");
    const zb = zbounds(parts[0].facets);
    assertClose(zb.mn, 3, 1e-6, "ring bottom at base top (thicknessMm)");
    assertClose(zb.mx, 5, 1e-6, "ring top at thicknessMm + ringHeightMm");
  });

  test("mount ring: none/hole/zero-thickness produce no ring", () => {
    const none = loopDoc(); none.mount.type = "none";
    assertEqual(buildMountRingParts(none).length, 0, "type none -> no ring");
    const hole = loopDoc(); hole.mount.type = "hole";
    assertEqual(buildMountRingParts(hole).length, 0, "type hole -> no ring");
    const zero = loopDoc(); zero.mount.ringThicknessMm = 0;
    assertEqual(buildMountRingParts(zero).length, 0, "zero ring thickness -> no ring");
  });
})();
