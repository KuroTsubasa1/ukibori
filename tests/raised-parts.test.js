"use strict";
(function () {
  function signedVol(f){let v=0;for(const t of f){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return v;}
  function zbounds(f){let mn=Infinity,mx=-Infinity;for(const t of f)for(const p of t){if(p[2]<mn)mn=p[2];if(p[2]>mx)mx=p[2];}return{mn,mx};}
  async function solidImg(hex,w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle=hex;cx.fillRect(0,0,w,h);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});return img;}

  test("raised: solid element extrudes a prism above the base top", async () => {
    const img = await solidImg("#00ff00", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.thicknessMm=3; v1.resolution=200;
    v1.elements=[ makeImageElement({src:"a", colorMode:"solid", color:"#00ff00", cxMm:20,cyMm:20,wMm:20,hMm:20}) ];
    const v2 = migrateProject(v1);
    v2.elements[0].depth.direction = "raised"; v2.elements[0].depth.heightMm = 2; v2.elements[0].depth.threshold = 256; v2.elements[0]._img = img;
    const parts = buildRaisedParts(v2);
    assertEqual(parts.length, 1, "one raised prism");
    assert(parts[0].name.indexOf("erhaben") === 0, "raised part name");
    assertEqual(parts[0].color[1], 255, "green prism");
    assert(signedVol(parts[0].facets) > 0, "watertight (positive volume)");
    const zb = zbounds(parts[0].facets);
    assertClose(zb.mn, 3, 1e-6, "prism bottom at base top (thicknessMm)");
    assertClose(zb.mx, 5, 1e-6, "prism top at thicknessMm + heightMm");
  });

  test("raised: engraved elements are ignored", async () => {
    const img = await solidImg("#00ff00", 8, 8);
    const v1 = defaultBookmark(); v1.resolution=120;
    v1.elements=[ makeImageElement({src:"a", colorMode:"solid", color:"#00ff00", cxMm:25,cyMm:75,wMm:20,hMm:20}) ];
    const v2 = migrateProject(v1);  // direction defaults to 'engraved'
    v2.elements[0]._img = img;
    assertEqual(buildRaisedParts(v2).length, 0, "engraved element -> no raised parts");
  });
})();
