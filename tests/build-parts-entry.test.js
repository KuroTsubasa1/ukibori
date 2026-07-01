"use strict";
(function () {
  function signedVol(f){let v=0;for(const t of f){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return v;}
  function zbounds(f){let mn=Infinity,mx=-Infinity;for(const t of f)for(const p of t){if(p[2]<mn)mn=p[2];if(p[2]>mx)mx=p[2];}return{mn,mx};}
  const totalVol = (parts) => parts.reduce((s,p)=>s+Math.abs(signedVol(p.facets)),0);
  async function solidImg(hex,w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle=hex;cx.fillRect(0,0,w,h);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});return img;}

  test("entry: pure-engraved doc matches buildEngravedParts (parity extends to buildParts)", async () => {
    const img = await solidImg("#101010", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=80; v1.resolution=200;
    v1.elements=[ makeImageElement({src:"a", colorMode:"solid", color:"#ff0000", cxMm:20,cyMm:40,wMm:24,hMm:24, depthLayers:2}) ];
    v1.elements[0]._img = img;
    // give both the same decoded image:
    const d2 = migrateProject(v1); d2.elements[0]._img = img;
    const engImg = buildEngravedParts(d2);
    const dP = migrateProject(v1); dP.elements[0]._img = img;
    const got = buildParts(dP);
    assertEqual(got.length, engImg.length, "same part count as buildEngravedParts");
    assertClose(totalVol(got), totalVol(engImg), Math.max(1e-6, totalVol(engImg)*1e-3), "same total volume");
    assert(got.every(p => Math.abs(signedVol(p.facets)) > 0), "all parts watertight");
  });

  test("entry: mixed engraved + raised -> raised prism sits on a full-thickness base", async () => {
    const img = await solidImg("#101010", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=60; v1.heightMm=60; v1.thicknessMm=3; v1.resolution=200;
    v1.elements=[
      makeImageElement({src:"e", colorMode:"solid", color:"#ff0000", cxMm:18,cyMm:30,wMm:16,hMm:16, depthLayers:2}),
      makeImageElement({src:"r", colorMode:"solid", color:"#00ff00", cxMm:42,cyMm:30,wMm:16,hMm:16, depthLayers:2}),
    ];
    const doc = migrateProject(v1);
    doc.elements[0]._img = img; // engraved (default)
    doc.elements[1]._img = img; doc.elements[1].depth.direction = "raised"; doc.elements[1].depth.heightMm = 2;
    const parts = buildParts(doc);
    assert(parts.some(p => p.name.indexOf("erhaben") === 0), "has a raised prism");
    assert(parts.some(p => p.name.indexOf("farbe") === 0 || p.name === "grundplatte"), "has base/engraved parts");
    assert(parts.every(p => Math.abs(signedVol(p.facets)) > 0), "all parts watertight");
    const prism = parts.find(p => p.name.indexOf("erhaben") === 0);
    assertClose(zbounds(prism.facets).mn, 3, 1e-6, "raised prism bottom sits on the full base top (thicknessMm)");
    assertClose(zbounds(prism.facets).mx, 5, 1e-6, "raised prism top at thicknessMm + heightMm");
  });

  test("entry: empty doc -> base only", () => {
    const v1 = defaultBookmark(); v1.resolution=120;
    const parts = buildParts(migrateProject(v1));
    assert(parts.length >= 1, "at least the base");
    assert(parts.every(p => p.name === "grundplatte"), "only base parts for an empty doc");
  });
})();
