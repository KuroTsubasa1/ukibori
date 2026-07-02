"use strict";
// T13: stacked height-band mode for raised colorLayers + depth.flush === true.
// Each color occupies its own z-range; ordered dark->light bottom->top.
(function () {
  function zbounds(f) { let mn = Infinity, mx = -Infinity; for (const t of f) for (const p of t) { if (p[2] < mn) mn = p[2]; if (p[2] > mx) mx = p[2]; } return { mn, mx }; }
  function signedVol(f) { let v = 0; for (const t of f) { const [a, b, c] = t; v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6; } return v; }
  function xyArea(f) {
    // Rough XY footprint area estimate: count distinct vertices rounded to pitch
    const seen = new Set();
    for (const t of f) for (const p of t) seen.add(Math.round(p[0]*100) + "," + Math.round(p[1]*100));
    return seen.size;
  }
  function luminance(hex) {
    const c = window.hexToRgb(hex);
    return 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  }

  // Three-color image: left third = dark (#1a1a1a), middle third = mid (#888888), right third = light (#e0e0e0).
  // Luminances: dark ~26.7, mid ~136.5, light ~224. Distinct -> rank 1=dark, 2=mid, 3=light.
  async function threeColorImg(w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#1a1a1a"; cx.fillRect(0, 0, Math.floor(w / 3), h);
    cx.fillStyle = "#888888"; cx.fillRect(Math.floor(w / 3), 0, Math.floor(w / 3), h);
    cx.fillStyle = "#e0e0e0"; cx.fillRect(Math.floor(w / 3) * 2, 0, w - Math.floor(w / 3) * 2, h);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }

  // Two-color image: left half red (#ff0000, lum~76.2), right half blue (#0000ff, lum~28.9).
  // blue is darker -> rank 1=blue (bottom), rank 2=red (top).
  async function twoColorImg(w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#ff0000"; cx.fillRect(0, 0, w / 2, h);
    cx.fillStyle = "#0000ff"; cx.fillRect(w / 2, 0, w / 2, h);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }

  function sqDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 60;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
    d.body.layerHeightMm = 0.2;
    d.colorStepLayers = 2; // step = 0.4 mm
    d.resolution = 64;
    d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    return d;
  }

  function makeFlushEl(img, numColors) {
    const el = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 40, hMm: 40 });
    el.depth.direction = "raised"; el.depth.mode = "colorLayers";
    el.depth.reduce = { method: "palette", numColors: numColors, levels: 4, remap: {}, order: [] };
    el.depth.colorLayerStyle = "bands"; // T14: bands mode (was depth.flush = true)
    el._img = img;
    return el;
  }

  // ---- (a) 3 bands, correct z-ranges ----
  test("height-bands (a): 3-color flush doc yields 3 farbschicht parts with stacked z-ranges", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc();
    d.elements = [makeFlushEl(img, 3)];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("farbschicht") === 0);
    assertEqual(bands.length, 3, "3 farbschicht parts for 3 colors");
    const T = 3, step = 0.4;
    const zbs = bands.map(p => zbounds(p.facets)).sort((a, b) => a.mn - b.mn);
    assertClose(zbs[0].mn, T,          1e-5, "band 1 bottom = T");
    assertClose(zbs[0].mx, T + step,   1e-5, "band 1 top = T+step");
    assertClose(zbs[1].mn, T + step,   1e-5, "band 2 bottom = T+step");
    assertClose(zbs[1].mx, T + 2*step, 1e-5, "band 2 top = T+2step");
    assertClose(zbs[2].mn, T + 2*step, 1e-5, "band 3 bottom = T+2step");
    assertClose(zbs[2].mx, T + 3*step, 1e-5, "band 3 top = T+3step");
  });

  // ---- (a2) dark->light ordering: band with lowest z = darkest color ----
  test("height-bands (a2): bottom band has the darkest color", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc();
    d.elements = [makeFlushEl(img, 3)];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("farbschicht") === 0);
    assertEqual(bands.length, 3, "3 farbschicht parts");
    const sorted = bands.slice().sort((a, b) => zbounds(a.facets).mn - zbounds(b.facets).mn);
    // Bottom band luminance must be <= middle band <= top band
    const lums = sorted.map(p => {
      const [r, g, b] = p.color;
      return 0.299*r + 0.587*g + 0.114*b;
    });
    assert(lums[0] <= lums[1], "bottom band luminance <= middle band (dark<=mid)");
    assert(lums[1] <= lums[2], "middle band luminance <= top band (mid<=light)");
  });

  // ---- (b) nested footprints: band1 area >= band2 area >= band3 area ----
  test("height-bands (b): each higher band has a smaller or equal XY footprint", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc();
    d.elements = [makeFlushEl(img, 3)];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("farbschicht") === 0);
    assertEqual(bands.length, 3, "3 farbschicht parts");
    const sorted = bands.slice().sort((a, b) => zbounds(a.facets).mn - zbounds(b.facets).mn);
    // Count cells at band's own z layer to estimate XY footprint size
    const areas = sorted.map(p => xyArea(p.facets));
    assert(areas[0] >= areas[1], "band1 XY area >= band2 (band1 is union of all ranks)");
    assert(areas[1] >= areas[2], "band2 XY area >= band3 (band2 is union of ranks 2+3)");
  });

  // ---- (c) one-color-per-layer: a z inside band 2 is covered only by band 2 part ----
  test("height-bands (c): a z inside band 2 range is covered only by band 2", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc();
    d.elements = [makeFlushEl(img, 3)];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("farbschicht") === 0);
    assertEqual(bands.length, 3, "3 farbschicht parts");
    // Sort by z-bottom
    const sorted = bands.slice().sort((a, b) => zbounds(a.facets).mn - zbounds(b.facets).mn);
    const T = 3, step = 0.4;
    const zProbe = T + step + step / 2; // middle of band 2 range
    // A band "spans" z if any top face vertex is above zProbe AND any bottom face vertex is below zProbe
    function spansZ(facets, z) {
      const zb = zbounds(facets);
      return zb.mn < z && zb.mx > z;
    }
    const covering = sorted.filter(p => spansZ(p.facets, zProbe));
    assertEqual(covering.length, 1, "exactly one band covers z=" + zProbe.toFixed(3));
    // Confirm it is band 2 (middle z range)
    const zb = zbounds(covering[0].facets);
    assertClose(zb.mn, T + step,   1e-5, "covering band starts at T+step (band 2)");
    assertClose(zb.mx, T + 2*step, 1e-5, "covering band ends at T+2*step (band 2)");
  });

  // ---- (d) manifold: each band part is watertight ----
  test("height-bands (d): each band part is watertight (positive signed volume)", async () => {
    const img = await threeColorImg(24, 24);
    const d = sqDoc();
    d.elements = [makeFlushEl(img, 3)];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("farbschicht") === 0);
    assertEqual(bands.length, 3, "3 farbschicht parts");
    for (const b of bands) {
      const vol = signedVol(b.facets);
      assert(vol > 0, "band " + b.name + " is watertight (vol=" + vol.toFixed(6) + ")");
    }
  });

  // ---- (e) parity: stepped style still produces stepped erhaben parts (unchanged) ----
  test("height-bands (e): stepped style produces 'erhaben' prisms at stepped heights (parity)", async () => {
    const img = await twoColorImg(16, 16);
    const d = sqDoc();
    const el = makeFlushEl(img, 2);
    el.depth.colorLayerStyle = "stepped";
    d.elements = [el];
    const parts = buildParts(d);
    const pr = parts.filter(p => p.name.indexOf("erhaben") === 0);
    assertEqual(pr.length, 2, "two erhaben prisms for flush=false");
    const tops = pr.map(p => zbounds(p.facets).mx).sort((a, b) => a - b);
    const T = 3, step = 0.4;
    assertClose(tops[0], T + step,   1e-5, "rank-0 prism top at T + step");
    assertClose(tops[1], T + 2*step, 1e-5, "rank-1 prism top at T + 2*step");
    // No farbschicht parts
    assert(!parts.some(p => p.name.indexOf("farbschicht") === 0), "no farbschicht parts when flush=false");
  });

  // ---- (e2) parity: solid raised element unchanged by flush logic ----
  test("height-bands (e2): solid raised element is unaffected (parity)", async () => {
    const img = await threeColorImg(24, 24);
    const mkSolid = (flush) => {
      const d = sqDoc();
      const el = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 40, hMm: 40 });
      el.depth.direction = "raised"; el.depth.mode = "solid"; el.depth.heightMm = 2;
      el.color = "#ff0000"; el.depth.flush = flush; el._img = img;
      d.elements = [el];
      return d;
    };
    const partsTrue  = buildParts(mkSolid(true));
    const partsFalse = buildParts(mkSolid(false));
    const js = p => JSON.stringify(p.map(x => ({ name: x.name, color: x.color, facets: x.facets })));
    assertEqual(js(partsTrue), js(partsFalse), "solid raised: flush=true vs false are byte-identical");
    assert(partsFalse.some(p => p.name.indexOf("erhaben") === 0), "solid raised still emits erhaben part");
  });
})();
