"use strict";
(function () {
  async function solidImg(hex,w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle=hex;cx.fillRect(0,0,w,h);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});return img;}

  test("freeFootprint: plate = silhouette dilated by borderMm (offset margin)", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.resolution=100;
    // a 10x10mm opaque element centered on the 40x40 canvas -> mm [15,25]
    v1.elements=[ makeImageElement({src:"a", color:"#ffffff", cxMm:20,cyMm:20,wMm:10,hMm:10}) ];
    const v2 = migrateProject(v1); v2.body.shape = "free"; v2.body.borderMm = 3; v2.elements[0]._img = img;
    v2.mount = { type:"none", xMm:20, yMm:10, diameterMm:5, ringThicknessMm:0, ringHeightMm:2, marginMm:8 };
    const { cols, rows, pitch } = gridForBody(v2.body, v2.resolution); // 100x100, pitch=0.4
    const f = freeFootprintField(v2, cols, rows, pitch);
    // cell centers: mm x = (c+0.5)*pitch
    assert(f(50, 50) > 0, "element center is inside the plate");
    assert(f(65, 49) > 0, "~1.2mm outside the element edge is within the 3mm margin");
    assert(f(78, 49) < 0, "~6mm beyond the element is outside the plate");
  });

  test("freeFootprint: borderMm 0 keeps the silhouette itself as the plate", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.resolution=100;
    v1.elements=[ makeImageElement({src:"a", color:"#ffffff", cxMm:20,cyMm:20,wMm:10,hMm:10}) ];
    const v2 = migrateProject(v1); v2.body.shape = "free"; v2.body.borderMm = 0; v2.elements[0]._img = img;
    v2.mount = { type:"none", xMm:20, yMm:10, diameterMm:5, ringThicknessMm:0, ringHeightMm:2, marginMm:8 };
    const { cols, rows, pitch } = gridForBody(v2.body, v2.resolution);
    const f = freeFootprintField(v2, cols, rows, pitch);
    // With border 0 the plate collapses to exactly the silhouette — it must NOT vanish.
    assert(f(50, 50) > 0, "silhouette center is still plate at border 0");
    assert(f(78, 49) < 0, "well outside the silhouette is not plate");
  });

  test("freeFootprint: mount hole is cut from the free plate", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.resolution=100;
    v1.elements=[ makeImageElement({src:"a", color:"#ffffff", cxMm:20,cyMm:20,wMm:30,hMm:30}) ];
    const v2 = migrateProject(v1); v2.body.shape = "free"; v2.body.borderMm = 2; v2.elements[0]._img = img;
    v2.mount = { type:"hole", xMm:20, yMm:20, diameterMm:6, ringThicknessMm:0, ringHeightMm:2, marginMm:8 };
    const { cols, rows, pitch } = gridForBody(v2.body, v2.resolution);
    const f = freeFootprintField(v2, cols, rows, pitch);
    assert(f(50, 50) < 0, "hole center (20,20mm) is cut out of the plate");
  });
})();
