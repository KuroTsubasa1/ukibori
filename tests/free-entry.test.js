"use strict";
(function () {
  function signedVol(f){let v=0;for(const t of f){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return v;}
  function bbox(f){let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;for(const t of f)for(const p of t){if(p[0]<mnx)mnx=p[0];if(p[0]>mxx)mxx=p[0];if(p[1]<mny)mny=p[1];if(p[1]>mxy)mxy=p[1];}return{mnx,mny,mxx,mxy};}
  async function solidImg(hex,w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle=hex;cx.fillRect(0,0,w,h);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});return img;}

  test("entry (free): plate is the dilated silhouette, not the full canvas", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.resolution=120;
    v1.elements=[ makeImageElement({src:"a", color:"#ffffff", cxMm:20,cyMm:20,wMm:10,hMm:10, depthLayers:2}) ];
    const doc = migrateProject(v1);
    doc.body.shape = "free"; doc.body.borderMm = 3; doc.elements[0]._img = img;
    doc.mount = { type:"none", xMm:20, yMm:10, diameterMm:5, ringThicknessMm:0, ringHeightMm:2, marginMm:8 };
    const parts = buildParts(doc);
    assert(parts.length >= 1, "has parts");
    assert(parts.every(p => Math.abs(signedVol(p.facets)) > 0), "all parts watertight");
    const bb = bbox(parts.reduce((a, p) => a.concat(p.facets), []));
    const wx = bb.mxx - bb.mnx, wy = bb.mxy - bb.mny;
    assert(wx < 25 && wy < 25, "plate ~ content(10) + 2x3mm border, NOT the full 40mm canvas");
    assert(wx > 12 && wy > 12, "plate includes the content plus its margin");
  });

  test("entry (free): plate follows the silhouette even when it exceeds the workpiece size", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=20; v1.heightMm=20; v1.resolution=180;  // small body box
    // 30mm element centered at (10,10) — spans mm [-5,25], larger than the 20mm body
    v1.elements=[ makeImageElement({src:"a", color:"#ffffff", cxMm:10,cyMm:10,wMm:30,hMm:30}) ];
    const doc = migrateProject(v1);
    doc.body.shape = "free"; doc.body.borderMm = 2; doc.elements[0]._img = img;
    doc.mount = { type:"none", xMm:10, yMm:5, diameterMm:5, ringThicknessMm:0, ringHeightMm:2, marginMm:8 };
    const parts = buildParts(doc);
    assert(parts.length >= 1, "has parts");
    const bb = bbox(parts.reduce((a, p) => a.concat(p.facets), []));
    const wx = bb.mxx - bb.mnx, wy = bb.mxy - bb.mny;
    // silhouette 30 + 2x2mm border = ~34mm; must NOT be clipped to the 20mm workpiece
    assert(wx > 30 && wy > 30, "free plate spans the full silhouette+border, not the 20mm box (got " + wx.toFixed(1) + "x" + wy.toFixed(1) + ")");
  });

  test("entry (free): Bogentext bow expands the plate beyond the straight-text box", () => {
    function plateH(arcDeg) {
      const d = window.defaultDoc();
      d.body.shape = "free"; d.body.borderMm = 2; d.resolution = 220;
      d.mount = { type:"none", xMm:40, yMm:10, diameterMm:5, ringThicknessMm:0, ringHeightMm:2, marginMm:8 };
      const el = window.makeElementV2("text", { text:"UKIBORI SCHAUKASTEN", cxMm:40, cyMm:40, wMm:70, hMm:12 });
      el.arcDeg = arcDeg; el.depth.direction = "raised";
      d.elements = [el];
      const gp = buildParts(d).filter(p => /grundplatte/.test(p.name)).reduce((a, p) => a.concat(p.facets), []);
      let mny = Infinity, mxy = -Infinity;
      for (const t of gp) for (const p of t) { if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]; }
      return mxy - mny;
    }
    const straight = plateH(0), arc = plateH(300);
    // Before the ink-aware domain, the 300° arc was clipped to the nominal 12mm box like
    // straight text; now the bow is captured, so the arc plate is clearly taller.
    assert(arc > straight + 8, "arc bow not clipped (arc " + arc.toFixed(1) + "mm vs straight " + straight.toFixed(1) + "mm)");
  });

  test("entry: rect body still equals buildEngravedParts for a pure-engraved doc (unchanged)", async () => {
    const img = await solidImg("#101010", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=80; v1.resolution=180;
    v1.elements=[ makeImageElement({src:"a", colorMode:"solid", color:"#ff0000", cxMm:20,cyMm:40,wMm:20,hMm:20, depthLayers:2}) ];
    const dA = migrateProject(v1); dA.elements[0]._img = img;
    const dB = migrateProject(v1); dB.elements[0]._img = img;
    const eng = buildEngravedParts(dA), got = buildParts(dB);
    assertEqual(got.length, eng.length, "rect buildParts unchanged vs buildEngravedParts");
  });
})();
