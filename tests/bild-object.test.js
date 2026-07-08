"use strict";
// Bild (plate-free image object): body.shape === "image" → the printed object is the defining
// image element's rectangular bounds (border ignored, no plate). Reuses the free build path.
(function () {
  function xyBox(f){let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const t of f)for(const p of t){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}return{w:x1-x0,h:y1-y0};}
  async function whiteImg(w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle="#fff";cx.fillRect(0,0,w,h);const img=new Image();await new Promise((r,j)=>{img.onload=r;img.onerror=j;img.src=cv.toDataURL("image/png");});return img;}
  function bildDoc(el){const d=defaultDoc();d.autoLayerHeights=false;/* classic manual heights */d.body.shape="image";d.body.thicknessMm=3;d.body.baseColor="#101010";d.body.layerHeightMm=0.2;d.resolution=64;d.mount={type:"none",xMm:0,yMm:0,diameterMm:5,ringThicknessMm:0,ringHeightMm:2,marginMm:8};d.elements=[el];return d;}

  test("shape 'image' base footprint matches the image element's wMm×hMm rectangle", async () => {
    const img = await whiteImg(40, 30);
    const el = makeElementV2("image", { src:"a", cxMm:20, cyMm:15, wMm:40, hMm:30 });
    el.depth.direction="raised"; el.depth.mode="solid"; el._img=img;
    const base = buildParts(bildDoc(el)).filter(p => p.name.indexOf("grundplatte") === 0);
    assert(base.length >= 1, "has a base part");
    const box = xyBox(base.flatMap(p=>p.facets));
    assertClose(box.w, 40, 1.5, "base width ≈ image wMm");
    assertClose(box.h, 30, 1.5, "base height ≈ image hMm");
  });

  test("shape 'image' ignores body.borderMm (no dilation)", async () => {
    const img = await whiteImg(40, 30);
    const el = makeElementV2("image", { src:"a", cxMm:20, cyMm:15, wMm:40, hMm:30 });
    el.depth.direction="raised"; el.depth.mode="solid"; el._img=img;
    const d = bildDoc(el); d.body.borderMm = 10; // must have no effect
    const box = xyBox(buildParts(d).filter(p => p.name.indexOf("grundplatte") === 0).flatMap(p=>p.facets));
    assert(box.w < 44 && box.h < 34, "border did not dilate the object (w=" + box.w.toFixed(1) + " h=" + box.h.toFixed(1) + ")");
  });

  test("shape 'image' uses the first VISIBLE image element (hidden defining element is skipped)", async () => {
    const img = await whiteImg(40, 30);
    const elA = makeElementV2("image", { src:"a", cxMm:20, cyMm:15, wMm:40, hMm:30 }); elA._img=img; elA._hidden=true;
    const elB = makeElementV2("image", { src:"b", cxMm:60, cyMm:60, wMm:16, hMm:12 }); elB._img=img; elB.depth.direction="raised"; elB.depth.mode="solid";
    const d = defaultDoc(); d.body.shape="image"; d.body.thicknessMm=3; d.body.layerHeightMm=0.2; d.resolution=64;
    d.mount={type:"none",xMm:0,yMm:0,diameterMm:5,ringThicknessMm:0,ringHeightMm:2,marginMm:8};
    d.elements=[elA, elB];
    const box = xyBox(buildParts(d).filter(p => p.name.indexOf("grundplatte") === 0).flatMap(p=>p.facets));
    // Object must match the VISIBLE element elB (16×12), not the hidden elA (40×30).
    assertClose(box.w, 16, 1.5, "base tracks the visible element width, not the hidden one");
    assertClose(box.h, 12, 1.5, "base tracks the visible element height");
  });

  test("shape 'image' footprint ignores the mount (no hole cut into the object rectangle)", async () => {
    const img = await whiteImg(40, 30);
    const el = makeElementV2("image", { src:"a", cxMm:20, cyMm:15, wMm:40, hMm:30 });
    el.depth.direction="raised"; el.depth.mode="solid"; el._img=img;
    const d = bildDoc(el);
    d.mount = { type:"hole", xMm:20, yMm:15, diameterMm:8, ringThicknessMm:0, ringHeightMm:2, marginMm:8 };
    const base = buildParts(d).filter(p => p.name.indexOf("grundplatte") === 0);
    const box = xyBox(base.flatMap(p=>p.facets));
    assertClose(box.w, 40, 1.5, "still a full-width rectangle (mount ignored for Bild)");
    assertClose(box.h, 30, 1.5, "still a full-height rectangle (mount ignored for Bild)");
  });

  test("shape 'image' base is watertight and the relief builds on top", async () => {
    const img = await whiteImg(40, 30);
    const el = makeElementV2("image", { src:"a", cxMm:20, cyMm:15, wMm:40, hMm:30 });
    el.depth.direction="raised"; el.depth.mode="solid"; el.depth.heightMm=1.2; el._img=img;
    const parts = buildParts(bildDoc(el));
    assert(parts.some(p=>p.name.indexOf("grundplatte")===0), "base present");
    assert(parts.some(p=>p.name.indexOf("erhaben")===0), "raised relief present");
    for (const p of parts) { let v=0; for(const t of p.facets){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;} assert(Math.abs(v)>0, p.name+" has volume"); }
  });
})();
