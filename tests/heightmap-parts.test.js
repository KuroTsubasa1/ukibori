"use strict";
(function () {
  function signedVol(f){let v=0;for(const t of f){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return v;}
  function zbounds(f){let mn=Infinity,mx=-Infinity;for(const t of f)for(const p of t){if(p[2]<mn)mn=p[2];if(p[2]>mx)mx=p[2];}return{mn,mx};}
  async function halfImg(leftHex,rightHex,w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle=leftHex;cx.fillRect(0,0,w/2,h);cx.fillStyle=rightHex;cx.fillRect(w/2,0,w/2,h);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});return img;}

  test("heightmap: brightness drives height (black floor, white full relief)", async () => {
    const img = await halfImg("#000000", "#ffffff", 16, 16);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.thicknessMm=3; v1.layerHeightMm=0.2; v1.resolution=120;
    v1.elements=[ makeImageElement({src:"a", color:"#888888", cxMm:20,cyMm:20,wMm:40,hMm:40}) ];
    const v2 = migrateProject(v1);
    v2.elements[0].depth.mode = "heightmap"; v2.elements[0].depth.heightMm = 1.0; v2.elements[0].depth.baseFloorMm = 0.2;
    v2.elements[0]._img = img;
    const parts = buildHeightmapParts(v2);
    assert(parts.length >= 2, "floor + at least one relief slab");
    assert(parts.every(p => signedVol(p.facets) > 0), "every slab watertight");
    assert(parts.every(p => p.color[0] === 0x88), "all slabs use el.color (#888888)");
    const all = parts.reduce((a, p) => a.concat(p.facets), []);
    const zb = zbounds(all);
    assertClose(zb.mn, 3, 1e-6, "relief bottom at base top (thicknessMm)");
    assertClose(zb.mx, 4, 1e-6, "brightest (white) reaches thicknessMm + heightMm");
  });

  test("heightmap: no heightmap elements -> []", async () => {
    const v1 = defaultBookmark(); v1.resolution=80;
    const v2 = migrateProject(v1); // empty
    assertEqual(buildHeightmapParts(v2).length, 0, "empty -> no parts");
  });
})();
