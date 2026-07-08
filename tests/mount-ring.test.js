"use strict";
(function () {
  // ---- helpers ----
  function signedVol(facets) {
    let v = 0;
    for (const t of facets) { const [a,b,c]=t;
      v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6; }
    return v;
  }
  function bbox(facets) {
    let mnx=Infinity,mny=Infinity,mnz=Infinity,mxx=-Infinity,mxy=-Infinity,mxz=-Infinity;
    for (const t of facets) for (const p of t) {
      if(p[0]<mnx)mnx=p[0]; if(p[0]>mxx)mxx=p[0];
      if(p[1]<mny)mny=p[1]; if(p[1]>mxy)mxy=p[1];
      if(p[2]<mnz)mnz=p[2]; if(p[2]>mxz)mxz=p[2];
    }
    return {mnx,mny,mnz,mxx,mxy,mxz};
  }
  function isEdgeManifold(facets) {
    const key=(p)=>p[0].toFixed(3)+","+p[1].toFixed(3)+","+p[2].toFixed(3);
    const edges=new Map();
    for(const t of facets){for(let e=0;e<3;e++){const a=key(t[e]),b=key(t[(e+1)%3]);const ek=a<b?a+"|"+b:b+"|"+a;edges.set(ek,(edges.get(ek)||0)+1);}}
    for(const c of edges.values())if(c!==2)return false;
    return true;
  }

  // A 40×80mm rect doc with Öse at the top edge center, overhanging upward.
  // yMm=0 => hole center ON the top edge, washer (r=3+2.5=5.5mm) extends 5.5mm above.
  function overhangeDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 40; d.body.heightMm = 80;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#334455";
    d.resolution = 240;
    d.mount = { type:"loop", xMm:20, yMm:0, diameterMm:6, ringThicknessMm:2.5, ringHeightMm:2, marginMm:7 };
    return d;
  }

  // A doc with the Öse fully inside the body (yMm=10, outerR=5.5 — well inside 80mm tall plate).
  function insideDoc() {
    const d = overhangeDoc();
    d.mount.yMm = 20;  // fully inside
    return d;
  }

  // Same body/mount as insideDoc() but type='hole' — for deep-equal parity test.
  function holeDoc() {
    const d = insideDoc();
    d.mount.type = "hole";
    return d;
  }

  // (a) Loop overhanging top → buildParts base is larger than a no-loop base
  // (the tab adds geometry beyond the plate body dimensions in 3D/grid space).
  // We compare via facet bbox: with a tab the y-extent must exceed the plate height.
  test("oese tab: overhanging loop → base facets extend past plate body bounds", () => {
    const parts = buildParts(overhangeDoc());
    const base = parts.find(p => p.name === "grundplatte");
    assert(base && base.facets.length > 0, "has a base part");
    const bb = bbox(base.facets);

    // Compare against a no-loop version of the same body
    const noLoopDoc = overhangeDoc(); noLoopDoc.mount.type = "none";
    const noParts = buildParts(noLoopDoc);
    const noBase = noParts.find(p => p.name === "grundplatte");
    const noBb = bbox(noBase.facets);

    // The tab adds geometry: y-range of the loop base must be strictly larger
    assert(bb.mxy > noBb.mxy + 0.5 || bb.mny < noBb.mny - 0.5,
      "base bbox is larger with overhanging tab than without (tab geometry added to base)");
  });

  // (b) docGridAndFootprint: hole center < 0, tab ring > 0, far outside < 0
  test("oese tab: docGridAndFootprint footprint signs at key points", () => {
    const doc = overhangeDoc();
    const { grid, footprint } = docGridAndFootprint(doc);
    const m = doc.mount;
    const outerR = m.diameterMm / 2 + m.ringThicknessMm; // 3+2.5=5.5
    const holeR = m.diameterMm / 2; // 3

    // Convert mm coordinates to cell coords using the expanded grid
    // Cell c corresponds to x = grid.x0 + (c+0.5)*grid.pitch  =>  c = (x - grid.x0)/pitch - 0.5
    const mmToC = (x) => (x - grid.x0) / grid.pitch - 0.5;
    const mmToR = (y) => (y - grid.y0) / grid.pitch - 0.5;

    // hole center: (20, 0) — should be negative (inside hole = outside plate)
    const holeCc = mmToC(m.xMm), holeCr = mmToR(m.yMm);
    assert(footprint(holeCc, holeCr) < 0, "footprint < 0 at hole center");

    // tab ring: midpoint between innerR and outerR, directly above the hole center
    // Point at (20, -(holeR + outerR)/2) — yMm = -4.25 (on the tab ring, above edge)
    const ringY = -(holeR + outerR) / 2;   // ~ -4.25mm (above plate top)
    const ringCr = mmToR(ringY);
    assert(footprint(holeCc, ringCr) > 0, "footprint > 0 on the tab ring (between innerR and outerR above top edge)");

    // far outside: (20, -(outerR + 5)) — well beyond the washer
    const farCr = mmToR(-(outerR + 5));
    assert(footprint(holeCc, farCr) < 0, "footprint < 0 far outside the washer");
  });

  // (c) manifold: base facets of overhanging-tab doc are edge-manifold
  test("oese tab: base part is a closed 2-manifold after 0.001mm vertex snap", () => {
    const parts = buildParts(overhangeDoc());
    const base = parts.find(p => p.name === "grundplatte");
    assert(base && base.facets.length > 0, "has a base part");
    assert(isEdgeManifold(base.facets), "base slab + tab is edge-manifold");
  });

  // (d) loop fully inside → base facets deep-equal a plain-hole doc
  test("oese tab: loop fully inside → base equals plain-hole base (parity)", () => {
    const loopParts = buildParts(insideDoc());
    const holeParts = buildParts(holeDoc());
    const loopBase = loopParts.find(p => p.name === "grundplatte");
    const holeBase = holeParts.find(p => p.name === "grundplatte");
    assert(loopBase && holeBase, "both have a base part");
    // Deep-equal via JSON (facets are float arrays — check count + stringify)
    assertEqual(loopBase.facets.length, holeBase.facets.length, "same facet count");
    assertEqual(JSON.stringify(loopBase.facets), JSON.stringify(holeBase.facets), "byte-identical base facets for inside-loop == hole");
  });

  // (e) no "oese" part emitted anywhere
  test("oese tab: no part named 'oese' in buildParts output", () => {
    const parts = buildParts(overhangeDoc());
    const oeseP = parts.find(p => p.name === "oese");
    assert(!oeseP, "no oese part (rim removed)");
  });

  // (f) raised-element relative alignment with and without overhanging loop.
  // All parts share one grid, so z-heights must be identical. The raised element
  // must sit at thicknessMm (bottom) and thicknessMm+heightMm (top) in both cases.
  test("oese tab: raised element z-alignment unchanged with overhanging loop (shared grid)", async () => {
    function raisedDoc(withLoop) {
      const d = defaultDoc();
      d.body.shape = "rect"; d.body.widthMm = 40; d.body.heightMm = 80;
      d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#334455";
      d.resolution = 120;
      d.autoLayerHeights = false; // pins classic manual depth.heightMm behavior
      d.mount = withLoop
        ? { type:"loop", xMm:20, yMm:0, diameterMm:6, ringThicknessMm:2.5, ringHeightMm:2, marginMm:7 }
        : { type:"none", xMm:20, yMm:0, diameterMm:6, ringThicknessMm:2.5, ringHeightMm:2, marginMm:7 };
      d.elements = [{
        id: 1, type:"text", text:"A", color:"#ff0000",
        cxMm:20, cyMm:40, wMm:10, hMm:10, rotationDeg:0,
        depth:{ direction:"raised", heightMm:2, mode:"solid" }
      }];
      return d;
    }

    const withParts  = buildParts(raisedDoc(true));
    const withoutParts = buildParts(raisedDoc(false));

    const withRaised    = withParts.find(p => p.name && p.name.indexOf("erhaben") === 0);
    const withoutRaised = withoutParts.find(p => p.name && p.name.indexOf("erhaben") === 0);

    // Both configs must produce a raised element
    assert(withRaised && withoutRaised, "both configs produce a raised element");

    function zbounds(facets) {
      let mn=Infinity,mx=-Infinity;
      for(const t of facets)for(const p of t){if(p[2]<mn)mn=p[2];if(p[2]>mx)mx=p[2];}
      return {mn,mx};
    }

    const zbWith    = zbounds(withRaised.facets);
    const zbWithout = zbounds(withoutRaised.facets);

    // z-bounds must be identical: shared grid means all parts use the same z mapping
    assertClose(zbWith.mn, zbWithout.mn, 1e-4, "raised element z-bottom identical with/without overhang");
    assertClose(zbWith.mx, zbWithout.mx, 1e-4, "raised element z-top identical with/without overhang");

    // Both sit at thicknessMm bottom
    assertClose(zbWith.mn, 3, 1e-3, "raised element sits on base top (thicknessMm=3)");
    assertClose(zbWith.mx, 5, 1e-3, "raised element top at thicknessMm + heightMm (3+2=5)");
  });

  // Additional: buildMountRingParts returns [] for loop (no rim)
  test("oese tab: buildMountRingParts returns empty for loop type (rim removed)", () => {
    const d = overhangeDoc();
    const parts = buildMountRingParts(d);
    assertEqual(parts.length, 0, "buildMountRingParts returns [] for loop");
  });

  // Additional: degenerate loop (ringThicknessMm=0) → same as plain hole (no expansion)
  test("oese tab: degenerate loop (ringThicknessMm=0) behaves as hole (no expansion)", () => {
    const degLoop = overhangeDoc();
    degLoop.mount.ringThicknessMm = 0;
    const hd = overhangeDoc();
    hd.mount.type = "hole"; hd.mount.yMm = 0;

    const degParts = buildParts(degLoop);
    const holeParts = buildParts(hd);
    const degBase = degParts.find(p => p.name === "grundplatte");
    const holeBase = holeParts.find(p => p.name === "grundplatte");
    assert(degBase && holeBase, "both produce a base");
    assertEqual(JSON.stringify(degBase.facets), JSON.stringify(holeBase.facets), "degenerate loop == hole (byte-identical base)");
  });
})();
