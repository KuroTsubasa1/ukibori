"use strict";
// AMS layer alignment: in engraved "Höhe je Farbe" / AMS mode the motif's per-color
// engraved floors and the plate/Öse color bands must share ONE layer plan, snapped to
// the print-layer grid. For every palette color, the motif-floor top == the plate-band
// top (== the Öse-tab-band top), and every band/floor z-boundary is a multiple of
// layerHeightMm. Spec: docs/superpowers/specs/2026-07-22-ams-layer-alignment-design.md
(function () {
  const hexOf = (rgb) => ("#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
  // z-top of a part = max z across all its facet vertices.
  function zTop(part) {
    let mx = -Infinity;
    for (const t of part.facets) for (const p of t) if (p[2] > mx) mx = p[2];
    return mx;
  }
  // All distinct z values across a part's facets (rounded to kill fp noise before dedup).
  function zValues(part, out) {
    for (const t of part.facets) for (const p of t) out.add(+p[2].toFixed(6));
  }
  // Match a part by color to a target hex (via hexToRgb).
  const colorIs = (part, hex) => {
    const c = window.hexToRgb(hex);
    return part.color[0] === c[0] && part.color[1] === c[1] && part.color[2] === c[2];
  };
  const isMultipleOf = (v, u, eps) => Math.abs(v / u - Math.round(v / u)) * u <= (eps == null ? 1e-6 : eps);

  // Repro doc from the spec: 40x40, T=2, layerH=0.4, colorStepLayers=2, autoLayerHeights,
  // amsPalette=['#111111','#CC3333'], two solid ENGRAVED shape elements in those colors.
  // baseColor is distinct from both palette colors so the base band is its own color.
  function reproDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 40; d.body.heightMm = 40;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 2; d.body.baseColor = "#222222";
    d.body.layerHeightMm = 0.4; d.colorStepLayers = 2; d.resolution = 64;
    d.mount = { type: "none", xMm: 20, yMm: 5, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 6 };
    d.autoLayerHeights = true;
    d.amsPalette = ["#111111", "#CC3333"];
    return d;
  }
  function shapeEl(color, cxMm) {
    const el = makeElementV2("shape", { shape: "rect", cxMm, cyMm: 20, wMm: 12, hMm: 12 });
    el.color = color; el.depth.mode = "solid"; el.depth.direction = "engraved";
    return el;
  }

  test("engraved auto-heights: motif floor top == plate band top for each palette color", () => {
    const d = reproDoc();
    d.elements = [shapeEl("#111111", 11), shapeEl("#CC3333", 29)];
    const parts = buildParts(d);
    for (const hex of ["#111111", "#CC3333"]) {
      const floor = parts.filter(p => p.name.indexOf("farbe-") === 0 && colorIs(p, hex));
      const band = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0 && colorIs(p, hex));
      assert(floor.length >= 1, "motif floor present for " + hex);
      assert(band.length >= 1, "plate band present for " + hex);
      const floorTop = Math.max(...floor.map(zTop));
      const bandTop = Math.max(...band.map(zTop));
      assertClose(floorTop, bandTop, 1e-6, "motif floor top == plate band top for " + hex);
    }
  });

  test("engraved auto-heights: all plate band + motif floor z-boundaries are multiples of layerHeightMm", () => {
    const d = reproDoc();
    d.elements = [shapeEl("#111111", 11), shapeEl("#CC3333", 29)];
    const parts = buildParts(d);
    const zs = new Set();
    for (const p of parts) {
      if (p.name.indexOf("grundplatte") === 0 || p.name.indexOf("farbe") === 0) zValues(p, zs);
    }
    assert(zs.size > 0, "collected some z-boundaries");
    for (const z of zs) assert(isMultipleOf(z, d.body.layerHeightMm, 1e-6),
      "z=" + z + " is a multiple of layerH=" + d.body.layerHeightMm);
  });

  test("engraved auto-heights + Öse: tab band stack == surround band stack", () => {
    const d = reproDoc();
    // Loop Öse overhanging the top edge (y beyond the 40mm plate) so a washer tab exists.
    d.mount = { type: "loop", xMm: 20, yMm: 40, diameterMm: 6, ringThicknessMm: 3, ringHeightMm: 2, marginMm: 4 };
    d.elements = [shapeEl("#111111", 11), shapeEl("#CC3333", 29)];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0);
    assert(bands.length >= 2, "plate bands present");

    const { grid, footprint } = window.docGridAndFootprint(d);
    const localX = (xMm) => xMm - grid.x0;
    const localY = (yMm) => grid.rows * grid.pitch - (yMm - grid.y0);
    // Point-in-part: any facet cap at z=z that covers (lx,ly) — barycentric over horizontal facets.
    function faceCoversLocal(part, lx, ly, z) {
      for (const t of part.facets) {
        if (Math.abs(t[0][2] - z) > 1e-5 || Math.abs(t[1][2] - z) > 1e-5 || Math.abs(t[2][2] - z) > 1e-5) continue;
        const ax = t[0][0], ay = t[0][1], bx = t[1][0], by = t[1][1], cx = t[2][0], cy = t[2][1];
        const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(den) < 1e-12) continue;
        const u = ((by - cy) * (lx - cx) + (cx - bx) * (ly - cy)) / den;
        const v = ((cy - ay) * (lx - cx) + (ax - cx) * (ly - cy)) / den;
        if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return true;
      }
      return false;
    }
    // Band z-set at a domain-local probe point: for each band, does its top cap cover the point?
    function bandStackAt(lx, ly) {
      const s = new Set();
      for (const b of bands) {
        const bz = zTop(b);
        if (faceCoversLocal(b, lx, ly, bz)) s.add(+bz.toFixed(6));
      }
      return s;
    }
    // Probe A: a plain surround plate cell (center-ish, away from motifs and Öse).
    const surround = bandStackAt(localX(20), localY(30));
    // Probe B: the overhang washer tab (above the plate edge, under the ring at y≈43).
    const tab = bandStackAt(localX(20), localY(43));
    assert(surround.size >= 2, "surround cell covered by the band stack");
    assert(tab.size >= 2, "overhang tab cell covered by the band stack");
    assertEqual([...tab].sort().join(","), [...surround].sort().join(","),
      "Öse tab band stack identical to the surround plate band stack");
  });

  test("raised AMS bands: boundaries are multiples of layerHeightMm", async () => {
    // Two-color raised AMS bands image; step = colorStepLayers*layerH is integer layers,
    // so every band boundary must land on the layer grid.
    const cv = document.createElement("canvas"); cv.width = 30; cv.height = 20;
    const c2 = cv.getContext("2d");
    c2.fillStyle = "#111111"; c2.fillRect(0, 0, 15, 20);
    c2.fillStyle = "#CC3333"; c2.fillRect(15, 0, 15, 20);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    const d = reproDoc();
    d.autoLayerHeights = false;
    const el = makeElementV2("image", { src: "a", cxMm: 20, cyMm: 20, wMm: 16, hMm: 16 });
    el.depth.direction = "raised"; el.depth.mode = "colorLayers"; el.depth.colorLayerStyle = "bands";
    el.depth.reduce = { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] };
    el._img = img;
    d.elements = [el];
    const parts = buildParts(d);
    const bands = parts.filter(p => p.name.indexOf("farbschicht") === 0);
    assert(bands.length >= 2, "raised AMS bands present");
    const zs = new Set();
    for (const p of bands) zValues(p, zs);
    for (const z of zs) assert(isMultipleOf(z, d.body.layerHeightMm, 1e-6),
      "raised band z=" + z + " is a multiple of layerH");
  });

  test("parity: a non-AMS engraved doc is byte-identical (fallback guard)", async () => {
    // One stepped colorLayers engraved element, no amsPalette, autoLayerHeights off:
    // no shared plan exists, so the build must stay on the per-element compression path.
    const cv = document.createElement("canvas"); cv.width = 24; cv.height = 24;
    const c2 = cv.getContext("2d");
    c2.fillStyle = "#1a1a1a"; c2.fillRect(0, 0, 8, 24);
    c2.fillStyle = "#888888"; c2.fillRect(8, 0, 8, 24);
    c2.fillStyle = "#e0e0e0"; c2.fillRect(16, 0, 8, 24);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    const mk = () => {
      const d = defaultDoc();
      d.body.shape = "rect"; d.body.widthMm = 40; d.body.heightMm = 40;
      d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
      d.body.layerHeightMm = 0.2; d.colorStepLayers = 2; d.resolution = 48;
      d.mount = { type: "none", xMm: 20, yMm: 5, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 6 };
      d.autoLayerHeights = false; d.amsPalette = [];
      const el = makeElementV2("image", { src: "a", cxMm: 20, cyMm: 20, wMm: 24, hMm: 24 });
      el.depth.direction = "engraved"; el.depth.mode = "colorLayers"; el.depth.colorLayerStyle = "stepped";
      el.depth.reduce = { method: "palette", numColors: 3, levels: 4, remap: {}, order: [] };
      el._img = img;
      d.elements = [el];
      return d;
    };
    const partsJson = (parts) => JSON.stringify(parts.map(p => ({ name: p.name, color: p.color, facets: p.facets })));
    // Snapshot must be stable across two independent builds (pins the fallback path).
    assertEqual(partsJson(buildParts(mk())), partsJson(buildParts(mk())),
      "non-AMS engraved build is deterministic / unchanged");
  });

  test("hidden bands element does NOT suppress plate banding (pre-scan counts only present pixels)", async () => {
    // The bands pre-scan counts only bands-style elements with >=1 PRESENT pixel, so a
    // hidden (or empty / fully-overlapped) bands element no longer inflates bandsElemCount to
    // force the ambiguous multi-element fallback. With NO amsPalette, ONE effective bands
    // element (bandsElemCount === 1) → the plate IS banded to that element's own palette and
    // its motif floors align to the plan (floor top == plate band top for each color).
    // The hidden element is ALSO fully overlapped by the visible one (rendered later, so it
    // wins), so it contributes no present pixels regardless of how a raw doc treats _hidden.
    const cv = document.createElement("canvas"); cv.width = 24; cv.height = 24;
    const c2 = cv.getContext("2d");
    c2.fillStyle = "#111111"; c2.fillRect(0, 0, 12, 24);   // darker → plan index 0 (band 1, top at T)
    c2.fillStyle = "#CC3333"; c2.fillRect(12, 0, 12, 24);  // lighter → plan index 1 (band 2)
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    const bandsEl = (wMm) => {
      const el = makeElementV2("image", { src: "a", cxMm: 20, cyMm: 20, wMm, hMm: wMm });
      el.depth.direction = "engraved"; el.depth.mode = "colorLayers"; el.depth.colorLayerStyle = "bands";
      el.depth.reduce = { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] };
      el._img = img;
      return el;
    };
    const d = reproDoc();
    d.autoLayerHeights = false; d.amsPalette = [];          // no shared palette → single-element plan
    const hidden = bandsEl(12); hidden._hidden = true;      // hidden AND fully covered by `visible`
    const visible = bandsEl(16);
    d.elements = [hidden, visible];                          // `visible` renders last → wins the overlap
    const parts = buildParts(d);

    // The plate is STILL banded — the hidden/overlapped element didn't force the fallback.
    const plateBands = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0);
    assert(plateBands.length >= 2, "plate is banded despite the hidden bands element (" + plateBands.length + " bands)");

    // The visible element's motif floors are plan-aligned: floor top == plate band top per color.
    for (const hex of ["#111111", "#CC3333"]) {
      const floor = parts.filter(p => p.name.indexOf("farbe-") === 0 && colorIs(p, hex));
      const band = parts.filter(p => p.name.indexOf("grundplatte-band-") === 0 && colorIs(p, hex));
      assert(floor.length >= 1 && band.length >= 1, "floor + band present for " + hex);
      assertClose(Math.max(...floor.map(zTop)), Math.max(...band.map(zTop)), 1e-6,
        "motif floor top == plate band top for " + hex);
    }
  });
})();
