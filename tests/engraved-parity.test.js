"use strict";
(function () {
  function signedVol(facets) {
    let v = 0;
    for (const t of facets) { const [a,b,c]=t;
      v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6; }
    return v;
  }
  const totalVol = (parts) => parts.reduce((s,p)=>s+Math.abs(signedVol(p.facets)),0);
  async function solidImg(hex, w, h) {
    const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
    const cx=cv.getContext("2d"); cx.fillStyle=hex; cx.fillRect(0,0,w,h);
    const img=new Image(); await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});
    return img;
  }

  test("engraved parity: solid element — buildEngravedParts(migrated) == buildBookmarkParts(v1)", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark();
    v1.widthMm = 40; v1.heightMm = 80; v1.resolution = 220; v1.baseColor = "#000000";
    const e = makeImageElement({ src:"a", colorMode:"solid", color:"#ff0000", cxMm:20, cyMm:40, wMm:24, hMm:24, depthLayers:2 });
    v1.elements = [e]; e._img = img;
    const ref = buildBookmarkParts(v1);          // v1 reference
    const v2 = migrateProject(v1); v2.elements[0]._img = img;
    const got = buildEngravedParts(v2);          // unified v2
    assertEqual(got.length, ref.length, "same number of parts");
    const eps = Math.max(1e-6, totalVol(ref) * 1e-3);
    assertClose(totalVol(got), totalVol(ref), eps, "total |volume| matches v1 within 0.1%");
    assert(got.every(p => Math.abs(signedVol(p.facets)) > 0), "every part has positive volume (watertight)");
  });

  test("engraved parity: empty doc — base only, matches v1", async () => {
    const v1 = defaultBookmark(); v1.widthMm = 30; v1.heightMm = 30; v1.resolution = 160; v1.baseColor = "#202020";
    const ref = buildBookmarkParts(v1);
    const got = buildEngravedParts(migrateProject(v1));
    assertEqual(got.length, ref.length, "same part count (base only)");
    const eps = Math.max(1e-6, totalVol(ref) * 1e-3);
    assertClose(totalVol(got), totalVol(ref), eps, "base volume matches v1");
  });
})();
