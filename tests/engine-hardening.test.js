"use strict";
(function () {
  function signedVol(f){let v=0;for(const t of f){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return v;}
  function maxZ(f){let m=-Infinity;for(const t of f)for(const p of t)if(p[2]>m)m=p[2];return m;}
  function minZ(f){let m=Infinity;for(const t of f)for(const p of t)if(p[2]<m)m=p[2];return m;}
  // Jitter-robust edge-manifold check: snap vertices to 0.001mm (>> the tracer's
  // sub-micron jitter) so coincident vertices merge, then require every undirected
  // edge to be shared by exactly 2 triangles (a closed 2-manifold solid).
  function isEdgeManifold(facets){
    const key=(p)=>p[0].toFixed(3)+","+p[1].toFixed(3)+","+p[2].toFixed(3);
    const edges=new Map();
    for(const t of facets){for(let e=0;e<3;e++){const a=key(t[e]),b=key(t[(e+1)%3]);const ek=a<b?a+"|"+b:b+"|"+a;edges.set(ek,(edges.get(ek)||0)+1);}}
    for(const c of edges.values())if(c!==2)return false;
    return true;
  }
  async function halfImg(l,r,w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle=l;cx.fillRect(0,0,w/2,h);cx.fillStyle=r;cx.fillRect(w/2,0,w/2,h);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});return img;}

  test("manifold: empty rect base is a closed 2-manifold (every edge shared by exactly 2 tris)", () => {
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=80; v1.resolution=160;
    const parts = buildParts(migrateProject(v1));
    const base = parts.find(p => p.name === "grundplatte");
    assert(base && base.facets.length > 0, "has a base slab");
    assert(isEdgeManifold(base.facets), "base slab is edge-manifold");
  });

  test("raised colorLayers: two colors -> two prisms at distinct rank-based heights", async () => {
    const img = await halfImg("#ff0000", "#0000ff", 16, 16);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.thicknessMm=3; v1.layerHeightMm=0.2; v1.colorStepLayers=2; v1.resolution=140;
    v1.elements=[ makeImageElement({src:"a", colorMode:"reduce", cxMm:20,cyMm:20,wMm:24,hMm:24, depthLayers:2}) ];
    const v2 = migrateProject(v1);          // colorMode reduce -> depth.mode colorLayers
    v2.elements[0].depth.direction = "raised"; v2.elements[0].depth.reduce.numColors = 2; v2.elements[0]._img = img;
    const parts = buildRaisedParts(v2);
    assert(parts.length === 2, "one raised prism per palette color");
    assert(parts.every(p => signedVol(p.facets) > 0), "watertight");
    assert(parts.every(p => Math.abs(minZ(p.facets) - 3) < 1e-6), "both sit on the base top (thicknessMm=3)");
    const heights = new Set(parts.map(p => Math.round(maxZ(p.facets) * 1000)));
    assertEqual(heights.size, 2, "the two colors get distinct rank-based heights");
  });

  test("free body: empty silhouette -> empty parts (no plate without content)", () => {
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.resolution=120;
    const v2 = migrateProject(v1); v2.body.shape = "free"; v2.body.borderMm = 3; // no elements
    assertEqual(buildParts(v2).length, 0, "free doc with no content yields no plate");
  });
})();
