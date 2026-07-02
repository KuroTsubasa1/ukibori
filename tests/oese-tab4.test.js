"use strict";
// T4 gap tests: washer union fires for EVERY loop doc, not only when domain expands.
// Two repro cases:
//   (a) FREE body 50×150, loop beside the silhouette (inside body box, outside plate)
//   (b) CIRCLE plate on 50×150 body, loop at circle top (inside box, outside plate)
// Both should produce a tab (base ≠ mount-none / plain-hole) with correct footprint
// sign at the tab ring, and the base must be edge-manifold.
//
// The existing "loop-inside==hole" parity tests in oese-nonprop.test.js and
// mount-ring.test.js must keep passing (washer union is a no-op when fully inside).
(function () {
  // ---- shared helpers ----
  function isEdgeManifold(facets) {
    const snap = (p) => p[0].toFixed(3) + "," + p[1].toFixed(3) + "," + p[2].toFixed(3);
    const edges = new Map();
    for (const t of facets) {
      for (let e = 0; e < 3; e++) {
        const a = snap(t[e]), b = snap(t[(e + 1) % 3]);
        const ek = a < b ? a + "|" + b : b + "|" + a;
        edges.set(ek, (edges.get(ek) || 0) + 1);
      }
    }
    for (const c of edges.values()) if (c !== 2) return false;
    return true;
  }

  async function solidImg(hex, w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.fillStyle = hex; cx.fillRect(0, 0, w, h);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }

  // -----------------------------------------------------------------------
  // (a) FREE body repro:
  //     50×150 free body, borderMm=2, res=256, one 20mm solid element at cy=75.
  //     Loop at (25, 60): outerR=3+2=5, washer at y ∈ [55,65] — element spans cy±10=[65,85].
  //     Washer is beside the silhouette (no overlap) but inside the body box.
  //     docDomain => unexpanded (washer inside box), so the BUG path skips the union.
  //
  //     Expected after fix:
  //       base facets ≠ mount-none base (tab adds geometry)
  //       footprint at tab ring (25, 56.5) > 0
  //       footprint at hole center (25, 60) < 0
  //       base is edge-manifold
  // -----------------------------------------------------------------------
  test("T4(a): free body, loop beside silhouette (inside box) → tab builds (loop ≠ mount-none)", async () => {
    const img = await solidImg("#ffffff", 8, 8);

    function freeDoc(mountType) {
      const v1 = defaultBookmark();
      v1.widthMm = 50; v1.heightMm = 150; v1.resolution = 256;
      // Element at cy=75, height=20 → spans y=[65,85]
      v1.elements = [ makeImageElement({ src: "a", color: "#ffffff",
        cxMm: 25, cyMm: 75, wMm: 20, hMm: 20 }) ];
      const doc = migrateProject(v1);
      doc.body.shape = "free"; doc.body.borderMm = 2;
      doc.elements[0]._img = img;
      // Loop at (25, 60): outerR=5 → washer y∈[55,65]; element top is at 65 — just beside
      doc.mount = { type: mountType, xMm: 25, yMm: 60, diameterMm: 6,
        ringThicknessMm: 2, ringHeightMm: 2, marginMm: 7 };
      return doc;
    }

    const loopParts = buildParts(freeDoc("loop"));
    const noneParts = buildParts(freeDoc("none"));
    const loopBase = loopParts.find(p => p.name === "grundplatte");
    const noneBase = noneParts.find(p => p.name === "grundplatte");
    assert(loopBase && noneBase, "T4(a): both docs produce a base part");

    // The loop doc must produce MORE facets than the mount-none doc (tab adds geometry).
    assert(loopBase.facets.length !== noneBase.facets.length,
      "T4(a): loop base facets ≠ mount-none base facets (tab must add geometry)");
  });

  test("T4(a): free body, loop beside silhouette → footprint > 0 on tab ring, < 0 at hole center", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark();
    v1.widthMm = 50; v1.heightMm = 150; v1.resolution = 256;
    v1.elements = [ makeImageElement({ src: "a", color: "#ffffff",
      cxMm: 25, cyMm: 75, wMm: 20, hMm: 20 }) ];
    const doc = migrateProject(v1);
    doc.body.shape = "free"; doc.body.borderMm = 2;
    doc.elements[0]._img = img;
    doc.mount = { type: "loop", xMm: 25, yMm: 60, diameterMm: 6,
      ringThicknessMm: 2, ringHeightMm: 2, marginMm: 7 };

    const { grid, footprint } = docGridAndFootprint(doc);
    // freeFootprintField indexes dt[] with integer cell coords, so round to nearest cell.
    const mmToC = (x) => Math.round((x - grid.x0) / grid.pitch - 0.5);
    const mmToR = (y) => Math.round((y - grid.y0) / grid.pitch - 0.5);

    // Tab ring midpoint: between innerR=3 and outerR=5, directly above hole center.
    // Point (25, 56.5): 3.5mm above hole center, inside the washer ring (3 < 3.5 < 5)
    const ringC = mmToC(25), ringR = mmToR(56.5);
    assert(footprint(ringC, ringR) > 0,
      "T4(a): footprint > 0 at tab ring (25, 56.5) — washer ring must be solid");

    // Hole center (25, 60) must be cut out
    const holeC = mmToC(25), holeR = mmToR(60);
    assert(footprint(holeC, holeR) < 0,
      "T4(a): footprint < 0 at hole center (25, 60) — hole must be cut");
  });

  test("T4(a): free body, loop beside silhouette → base is edge-manifold", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark();
    v1.widthMm = 50; v1.heightMm = 150; v1.resolution = 256;
    v1.elements = [ makeImageElement({ src: "a", color: "#ffffff",
      cxMm: 25, cyMm: 75, wMm: 20, hMm: 20 }) ];
    const doc = migrateProject(v1);
    doc.body.shape = "free"; doc.body.borderMm = 2;
    doc.elements[0]._img = img;
    doc.mount = { type: "loop", xMm: 25, yMm: 60, diameterMm: 6,
      ringThicknessMm: 2, ringHeightMm: 2, marginMm: 7 };

    const parts = buildParts(doc);
    const base = parts.find(p => p.name === "grundplatte");
    assert(base && base.facets.length > 0, "T4(a): has a base part");
    assert(isEdgeManifold(base.facets), "T4(a): base is edge-manifold after 0.001mm snap");
  });

  // -----------------------------------------------------------------------
  // (b) CIRCLE plate repro:
  //     50×150 circle body (bodyR = min(25,75) = 25, center=(25,75)).
  //     Loop at (25, 50): bodySdfMm(25,50)= 25 - hypot(0,25) = 25-25 = 0 (ON the circle edge).
  //     outerR=3+2=5 → washer y∈[45,55]. Washer sits outside the circle plate
  //     but inside the body box — domain stays unexpanded.
  //
  //     Expected after fix:
  //       base facets ≠ plain-hole base (tab adds geometry above y=50)
  //       footprint at ring point (25, 46.5) > 0  [inside washer, outside circle]
  //       base is edge-manifold
  // -----------------------------------------------------------------------
  test("T4(b): circle plate, loop at circle top (inside box) → tab builds (loop ≠ hole)", () => {
    function circleDoc(mountType) {
      const d = defaultDoc();
      d.body.shape = "circle"; d.body.widthMm = 50; d.body.heightMm = 150;
      d.body.thicknessMm = 3; d.body.baseColor = "#334455";
      d.resolution = 256;
      // Loop at (25, 50): circle center=(25,75), bodyR=25; bodySdfMm(25,50)=25-25=0 (on edge)
      d.mount = { type: mountType, xMm: 25, yMm: 50, diameterMm: 6,
        ringThicknessMm: 2, ringHeightMm: 2, marginMm: 7 };
      return d;
    }

    const loopParts = buildParts(circleDoc("loop"));
    const holeParts = buildParts(circleDoc("hole"));
    const loopBase = loopParts.find(p => p.name === "grundplatte");
    const holeBase = holeParts.find(p => p.name === "grundplatte");
    assert(loopBase && holeBase, "T4(b): both docs produce a base part");

    assert(loopBase.facets.length !== holeBase.facets.length,
      "T4(b): loop base facets ≠ plain-hole base facets (tab must add geometry)");
  });

  test("T4(b): circle plate, loop at top → footprint > 0 on ring above circle edge, < 0 at hole center", () => {
    const d = defaultDoc();
    d.body.shape = "circle"; d.body.widthMm = 50; d.body.heightMm = 150;
    d.body.thicknessMm = 3; d.body.baseColor = "#334455"; d.resolution = 256;
    d.mount = { type: "loop", xMm: 25, yMm: 50, diameterMm: 6,
      ringThicknessMm: 2, ringHeightMm: 2, marginMm: 7 };

    const { grid, footprint } = docGridAndFootprint(d);
    const mmToC = (x) => (x - grid.x0) / grid.pitch - 0.5;
    const mmToR = (y) => (y - grid.y0) / grid.pitch - 0.5;

    // Tab ring midpoint: (25, 46.5) — 3.5mm above hole center, inside washer (3<3.5<5),
    // outside the circle plate (bodySdfMm(25,46.5) = 25 - hypot(0,28.5) = 25-28.5 = -3.5 < 0)
    const ringC = mmToC(25), ringR = mmToR(46.5);
    assert(footprint(ringC, ringR) > 0,
      "T4(b): footprint > 0 on tab ring (25, 46.5) above circle top");

    // Hole center (25, 50) must be cut
    const holeC = mmToC(25), holeRr = mmToR(50);
    assert(footprint(holeC, holeRr) < 0,
      "T4(b): footprint < 0 at hole center (25, 50)");
  });

  test("T4(b): circle plate, loop at top → base is edge-manifold", () => {
    const d = defaultDoc();
    d.body.shape = "circle"; d.body.widthMm = 50; d.body.heightMm = 150;
    d.body.thicknessMm = 3; d.body.baseColor = "#334455"; d.resolution = 256;
    d.mount = { type: "loop", xMm: 25, yMm: 50, diameterMm: 6,
      ringThicknessMm: 2, ringHeightMm: 2, marginMm: 7 };

    const parts = buildParts(d);
    const base = parts.find(p => p.name === "grundplatte");
    assert(base && base.facets.length > 0, "T4(b): has a base part");
    assert(isEdgeManifold(base.facets), "T4(b): base is edge-manifold");
  });
})();
