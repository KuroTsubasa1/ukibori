"use strict";
// T7: Rand-Rahmen (raised ring frame for rect/circle) + Bündig (flush colorLayers).
(function () {
  // ---- helpers (local to this IIFE; mirror build-parts-entry.test.js patterns) ----
  function zbounds(f) { let mn = Infinity, mx = -Infinity; for (const t of f) for (const p of t) { if (p[2] < mn) mn = p[2]; if (p[2] > mx) mx = p[2]; } return { mn, mx }; }
  function eachVertex(facets, fn) { for (const t of facets) for (const p of t) fn(p); }
  async function solidImg(hex, w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.fillStyle = hex; cx.fillRect(0, 0, w, h);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  // Half-left red, half-right blue (2 exact colors for colorLayers).
  async function twoColorImg(w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#ff0000"; cx.fillRect(0, 0, w / 2, h);
    cx.fillStyle = "#0000ff"; cx.fillRect(w / 2, 0, w / 2, h);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  // Square rect doc (square => export y = H - docY exactly; no anisotropic distortion).
  function sqDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 50;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
    d.resolution = 128;
    d.mount = { type: "none", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    return d;
  }
  function setFrame(d, widthMm, heightMm, color) {
    d.body.frame = { widthMm: widthMm, heightMm: heightMm, color: color };
    return d;
  }
  const partsJson = (parts) => JSON.stringify(parts.map(p => ({ name: p.name, color: p.color, facets: p.facets })));

  // ---- (a) rect + frame -> "rand" part, color, z-range, hole respected ----
  test("frame: rect doc emits 'rand' part with frame color and z in [T, T+heightMm]", () => {
    const d = setFrame(sqDoc(), 3, 2, "#00ff00");
    const parts = buildParts(d);
    const rand = parts.filter(p => p.name === "rand");
    assertEqual(rand.length, 1, "exactly one 'rand' part");
    assertEqual(JSON.stringify(rand[0].color), JSON.stringify([0, 255, 0]), "rand uses frame.color");
    const zb = zbounds(rand[0].facets);
    assertClose(zb.mn, 3, 1e-6, "rand bottom at thicknessMm");
    assertClose(zb.mx, 5, 1e-6, "rand top at thicknessMm + frame.heightMm");
  });

  test("frame: band respects the mount hole (no rand facets inside hole radius)", () => {
    const d = setFrame(sqDoc(), 3, 2, "#00ff00");
    d.mount = { type: "hole", xMm: 25, yMm: 2, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    const parts = buildParts(d);
    const rand = parts.find(p => p.name === "rand");
    assert(!!rand, "rand part exists with hole overlapping the band");
    // Export coords: x = docX, y = H - docY (square plate). Hole center -> (25, 48).
    const pitch = 50 / 128, hx = 25, hy = 50 - 2, holeR = 2.5;
    let minDist = Infinity;
    eachVertex(rand.facets, (p) => {
      const dd = Math.hypot(p[0] - hx, p[1] - hy);
      if (dd < minDist) minDist = dd;
    });
    assert(minDist >= holeR - 2 * pitch, "no rand vertex well inside the hole (minDist=" + minDist.toFixed(3) + ")");
  });

  // ---- (b) ring wins: raised element fully inside the band is swallowed ----
  test("frame: ring wins — raised element fully inside the band emits no erhaben part", async () => {
    const img = await solidImg("#ff0000", 8, 8);
    const mk = (frameW) => {
      const d = setFrame(sqDoc(), frameW, 2, "#00ff00");
      const el = makeElementV2("image", { src: "a", cxMm: 3, cyMm: 25, wMm: 4, hMm: 20 });
      el.depth.direction = "raised"; el.depth.mode = "solid"; el.depth.heightMm = 2;
      el.color = "#ff0000"; el._img = img;
      d.elements = [el];
      return d;
    };
    const withFrame = buildParts(mk(6));
    assert(!withFrame.some(p => p.name.indexOf("erhaben") === 0), "no erhaben part when element lies inside the band");
    assert(withFrame.some(p => p.name === "rand"), "rand part present");
    const noFrame = buildParts(mk(0));
    assert(noFrame.some(p => p.name.indexOf("erhaben") === 0), "erhaben part present when frame is off");
  });

  // ---- (b2) heightMm=0 must turn the frame FULLY off (review finding: a band
  // with no rand part would silently swallow content) ----
  test("frame: heightMm=0 with widthMm>0 is fully off — content kept, no rand, parity", async () => {
    const img = await solidImg("#ff0000", 8, 8);
    const mk = (frameW, frameH) => {
      const d = frameW === null ? sqDoc() : setFrame(sqDoc(), frameW, frameH, "#00ff00");
      if (frameW === null) delete d.body.frame;
      const el = makeElementV2("image", { src: "a", cxMm: 3, cyMm: 25, wMm: 4, hMm: 20 });
      el.depth.direction = "raised"; el.depth.mode = "solid"; el.depth.heightMm = 2;
      el.color = "#ff0000"; el._img = img;
      d.elements = [el];
      return d;
    };
    const zeroH = buildParts(mk(6, 0));      // width 6, height 0 -> frame OFF
    assert(zeroH.some(p => p.name.indexOf("erhaben") === 0), "content survives (not swallowed by a rand-less band)");
    assert(!zeroH.some(p => p.name === "rand"), "no rand part at heightMm=0");
    assertEqual(partsJson(zeroH), partsJson(buildParts(mk(null))), "byte-identical to no-frame doc");
  });

  // ---- (c) parity: widthMm=0 === no frame field; free body ignores frame ----
  test("frame: parity — widthMm=0 deep-equals a doc without any frame field", async () => {
    const img = await solidImg("#ff0000", 8, 8);
    const mk = () => {
      const d = sqDoc();
      const el = makeElementV2("image", { src: "a", cxMm: 25, cyMm: 25, wMm: 20, hMm: 20 });
      el.depth.direction = "raised"; el.depth.mode = "solid"; el.depth.heightMm = 2;
      el.color = "#ff0000"; el._img = img;
      d.elements = [el];
      return d;
    };
    const a = setFrame(mk(), 0, 2, "#00ff00");
    const b = mk(); delete b.body.frame;
    assertEqual(partsJson(buildParts(a)), partsJson(buildParts(b)), "byte-identical parts");
  });

  test("frame: free body ignores the frame entirely (no rand, content unchanged)", async () => {
    const img = await solidImg("#ff0000", 8, 8);
    const mk = () => {
      const d = sqDoc();
      d.body.shape = "free"; d.body.borderMm = 2;
      const el = makeElementV2("image", { src: "a", cxMm: 25, cyMm: 25, wMm: 20, hMm: 20 });
      el.depth.direction = "raised"; el.depth.mode = "solid"; el.depth.heightMm = 2;
      el.color = "#ff0000"; el._img = img;
      d.elements = [el];
      return d;
    };
    const a = setFrame(mk(), 5, 2, "#00ff00");
    const partsA = buildParts(a);
    assert(!partsA.some(p => p.name === "rand"), "no rand part for free bodies");
    const b = mk(); delete b.body.frame;
    assertEqual(partsJson(partsA), partsJson(buildParts(b)), "free-body content unchanged by frame");
  });

  // ---- (d) circle plate + frame -> rand within circle radius ----
  test("frame: circle plate emits rand with all xy within the circle radius", () => {
    const d = sqDoc();
    d.body.shape = "circle"; d.body.widthMm = 60; d.body.heightMm = 60;
    d.resolution = 128;
    setFrame(d, 4, 2, "#00ff00");
    const parts = buildParts(d);
    const rand = parts.find(p => p.name === "rand");
    assert(!!rand, "rand part exists for circle plate");
    // Square 60x60 -> export center (30, 30), R = 30.
    const pitch = 60 / 128;
    let maxDist = 0;
    eachVertex(rand.facets, (p) => {
      const dd = Math.hypot(p[0] - 30, p[1] - 30);
      if (dd > maxDist) maxDist = dd;
    });
    assert(maxDist <= 30 + 2 * pitch, "rand stays within circle radius (maxDist=" + maxDist.toFixed(3) + ")");
  });

  // ---- (e) colorLayerStyle for raised colorLayers (T14) ----
  // style: "stepped" | "flush" | "bands" | "absent" (no style, no flush).
  async function flushDoc(style) {
    const img = await twoColorImg(16, 16);
    const d = sqDoc();
    d.body.layerHeightMm = 0.2; d.colorStepLayers = 2; // step = 0.4
    const el = makeElementV2("image", { src: "a", cxMm: 25, cyMm: 25, wMm: 20, hMm: 20 });
    el.depth.direction = "raised"; el.depth.mode = "colorLayers";
    el.depth.reduce = { method: "palette", numColors: 2, levels: 4, remap: {}, order: [] };
    el._img = img;
    delete el.depth.flush;
    if (style === "absent") delete el.depth.colorLayerStyle;
    else el.depth.colorLayerStyle = style;
    d.elements = [el];
    return d;
  }

  test("style stepped — two colorLayers prisms get DIFFERENT stacked heights", async () => {
    const parts = buildParts(await flushDoc("stepped"));
    const pr = parts.filter(p => p.name.indexOf("erhaben") === 0);
    assertEqual(pr.length, 2, "two raised color prisms");
    const tops = pr.map(p => zbounds(p.facets).mx).sort((x, y) => x - y);
    assertClose(tops[0], 3.4, 1e-6, "rank-0 color at T + step");
    assertClose(tops[1], 3.8, 1e-6, "rank-1 color at T + 2*step");
  });

  test("style flush (Eine Fläche) — both colors span [T, T+step] (one flat surface, RESTORED)", async () => {
    // T14: flush is now the RESTORED same-height mode (all colors one height), NOT bands.
    const parts = buildParts(await flushDoc("flush"));
    const pr = parts.filter(p => p.name.indexOf("erhaben") === 0);
    assertEqual(pr.length, 2, "two erhaben prisms (side by side)");
    for (const p of pr) {
      const zb = zbounds(p.facets);
      assertClose(zb.mn, 3, 1e-6, "flush prism bottom at T");
      assertClose(zb.mx, 3.4, 1e-6, "flush prism top at T + step (same height)");
    }
    assert(!parts.some(p => p.name.indexOf("farbschicht") === 0), "flush emits no farbschicht bands");
  });

  test("style bands (AMS) — two colors yield two stacked height bands (dark bottom, light top)", async () => {
    const parts = buildParts(await flushDoc("bands"));
    const pr = parts.filter(p => p.name.indexOf("farbschicht") === 0);
    assertEqual(pr.length, 2, "two farbschicht band parts");
    const zbs = pr.map(p => zbounds(p.facets)).sort((a, b) => a.mn - b.mn);
    assertClose(zbs[0].mn, 3, 1e-6, "band 1 bottom at T");
    assertClose(zbs[0].mx, 3.4, 1e-6, "band 1 top at T + step");
    assertClose(zbs[1].mn, 3.4, 1e-6, "band 2 bottom at T + step");
    assertClose(zbs[1].mx, 3.8, 1e-6, "band 2 top at T + 2*step");
  });

  test("style parity — style absent deep-equals colorLayerStyle:'stepped'", async () => {
    const a = buildParts(await flushDoc("stepped"));
    const b = buildParts(await flushDoc("absent"));
    assertEqual(partsJson(a), partsJson(b), "byte-identical parts");
  });

  // ---- (f) model: defaults, migrate fill, serialization round-trip ----
  test("model: defaultDoc has frame default; defaultDepth has colorLayerStyle:'stepped' (flush kept false)", () => {
    const d = defaultDoc();
    assertEqual(JSON.stringify(d.body.frame), JSON.stringify({ widthMm: 0, heightMm: 2, color: "#000000" }), "body.frame default");
    assertEqual(defaultDepth("image").colorLayerStyle, "stepped", "defaultDepth().colorLayerStyle is 'stepped'");
    assertEqual(defaultDepth("image").flush, false, "defaultDepth().flush kept for back-compat (false)");
  });

  test("model: migrateProject fills frame + colorLayerStyle for v1 and for v2 docs missing them", () => {
    // v1 -> v2
    const v1 = defaultBookmark();
    v1.elements = [makeImageElement({ src: "a" })];
    const m1 = migrateProject(v1);
    assertEqual(JSON.stringify(m1.body.frame), JSON.stringify({ widthMm: 0, heightMm: 2, color: "#000000" }), "v1 migration fills body.frame");
    assertEqual(m1.elements[0].depth.colorLayerStyle, "stepped", "v1 migration fills depth.colorLayerStyle (stepped)");
    // v2 without the new fields
    const v2 = defaultDoc();
    delete v2.body.frame;
    const el = makeElementV2("text");
    delete el.depth.flush; delete el.depth.colorLayerStyle;
    v2.elements = [el];
    const m2 = migrateProject(v2);
    assertEqual(JSON.stringify(m2.body.frame), JSON.stringify({ widthMm: 0, heightMm: 2, color: "#000000" }), "v2 fill of body.frame");
    assertEqual(m2.elements[0].depth.colorLayerStyle, "stepped", "v2 fill of depth.colorLayerStyle (stepped)");
  });

  test("model: frame + colorLayerStyle survive serialize/deserialize round-trip", () => {
    const d = defaultDoc();
    d.body.frame = { widthMm: 3.5, heightMm: 1.6, color: "#123456" };
    const el = makeElementV2("text");
    el.depth.colorLayerStyle = "bands";
    d.elements = [el];
    const rt = deserializeProject(serializeProject(d));
    assertEqual(JSON.stringify(rt.body.frame), JSON.stringify({ widthMm: 3.5, heightMm: 1.6, color: "#123456" }), "frame round-trips");
    assertEqual(rt.elements[0].depth.colorLayerStyle, "bands", "colorLayerStyle round-trips");
  });
})();
