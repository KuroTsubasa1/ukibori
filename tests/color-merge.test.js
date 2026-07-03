"use strict";
// Color merge (Farbe zusammenführen): fold one palette color into another so both print at
// the SAME color/height — flattens noisy images. Stored as reduce.merges {fromNat: toNat};
// the engine resolves merges → root before applying remap, so merged pixels collapse into one
// region/layer and follow the target's later recolor. UI lives in editor.js (Playwright-tested).
(function () {
  function hexOf(rgb) { return ("#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase(); }
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
  function sqDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 60; d.body.heightMm = 60;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
    d.body.layerHeightMm = 0.2; d.colorStepLayers = 2; d.resolution = 64;
    d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    return d;
  }
  function makeEl(img, direction, style) {
    const el = makeElementV2("image", { src: "a", cxMm: 30, cyMm: 30, wMm: 40, hMm: 40 });
    el.depth.direction = direction; el.depth.mode = "colorLayers";
    el.depth.reduce = { method: "palette", numColors: 3, levels: 4, remap: {}, order: [] };
    el.depth.colorLayerStyle = style; el._img = img;
    return el;
  }

  // ---------------- model helpers ----------------
  test("mergeReduceColors: records merges[from]=to (uppercased) and PRESERVES reduce.order", () => {
    const reduce = { method: "palette", numColors: 3, levels: 4, remap: {}, order: ["#AAAAAA", "#BBBBBB", "#CCCCCC"] };
    window.mergeReduceColors(reduce, "#aaaaaa", "#bbbbbb");
    assertEqual(reduce.merges["#AAAAAA"], "#BBBBBB", "merge recorded uppercased");
    assertEqual(reduce.order.indexOf("#AAAAAA"), 0, "from kept at its original order position (rank restored on unmerge)");
  });

  test("merge→unmerge restores the color's original order position", () => {
    const reduce = { remap: {}, order: ["#AAAAAA", "#BBBBBB", "#CCCCCC"], merges: {} };
    window.mergeReduceColors(reduce, "#AAAAAA", "#CCCCCC");
    window.unmergeReduceColor(reduce, "#AAAAAA");
    assertEqual(reduce.order[0], "#AAAAAA", "color returns to rank 0 after unmerge");
  });

  test("pruneReduceMerges drops entries whose from/to left the palette", () => {
    const reduce = { merges: { "#AAAAAA": "#BBBBBB", "#CCCCCC": "#DDDDDD" } };
    window.pruneReduceMerges(reduce, ["#AAAAAA", "#BBBBBB"]); // #CCCCCC & #DDDDDD no longer in palette
    assertEqual(reduce.merges["#AAAAAA"], "#BBBBBB", "valid merge kept");
    assert(reduce.merges["#CCCCCC"] == null, "stale merge (target gone) dropped");
  });

  test("mergeReduceColors: chain redirect follows to new root; cycle is ignored", () => {
    const reduce = { remap: {}, order: [], merges: {} };
    window.mergeReduceColors(reduce, "#C00000", "#A00000"); // C→A
    window.mergeReduceColors(reduce, "#A00000", "#B00000"); // A→B ⇒ C must follow to B
    assertEqual(reduce.merges["#A00000"], "#B00000", "A→B");
    assertEqual(reduce.merges["#C00000"], "#B00000", "C redirected to B (chain)");
    window.mergeReduceColors(reduce, "#B00000", "#C00000"); // root(C)=B===from ⇒ cycle, ignore
    assert(reduce.merges["#B00000"] == null, "no self-cycle recorded for B");
  });

  test("unmergeReduceColor removes the entry", () => {
    const reduce = { merges: { "#AAAAAA": "#BBBBBB" } };
    window.unmergeReduceColor(reduce, "#aaaaaa");
    assert(reduce.merges["#AAAAAA"] == null, "unmerged");
  });

  test("resolveMergeRoots flattens chains to roots", () => {
    const roots = window.resolveMergeRoots({ "#C00000": "#A00000", "#A00000": "#B00000" });
    assertEqual(roots["#C00000"], "#B00000", "C→B");
    assertEqual(roots["#A00000"], "#B00000", "A→B");
  });

  test("reduce.merges round-trips through serialize/deserialize", () => {
    const d = defaultDoc();
    const el = makeElementV2("image", { src: "a" });
    el.depth.mode = "colorLayers";
    window.mergeReduceColors(el.depth.reduce, "#AAAAAA", "#BBBBBB");
    d.elements = [el];
    const rt = deserializeProject(serializeProject(d));
    assertEqual(rt.elements[0].depth.reduce.merges["#AAAAAA"], "#BBBBBB", "merges round-trips");
  });

  // ---------------- engine collapse ----------------
  test("merge collapses two colors into one region/height (engraved stepped: 3→2 floors)", async () => {
    const img = await threeColorImg(24, 24);
    const before = buildParts((() => { const d = sqDoc(); d.elements = [makeEl(img, "engraved", "stepped")]; return d; })())
      .filter(p => p.name.indexOf("farbe-") === 0);
    assertEqual(before.length, 3, "3 floors before merge");
    const hexes = before.map(p => hexOf(p.color));
    const d = sqDoc(); const el = makeEl(img, "engraved", "stepped");
    window.mergeReduceColors(el.depth.reduce, hexes[0], hexes[1]); // fold color 0 into color 1
    d.elements = [el];
    const after = buildParts(d).filter(p => p.name.indexOf("farbe-") === 0);
    assertEqual(after.length, 2, "2 floors after merge (colors collapsed)");
    const afterHexes = after.map(p => hexOf(p.color));
    assert(afterHexes.indexOf(hexes[0]) === -1, "the merged-away color no longer appears");
    assert(afterHexes.indexOf(hexes[1]) !== -1, "the target color remains");
  });

  test("merge composes with AMS bands: fewer inlay floors AND fewer base bands (3→2)", async () => {
    const img = await threeColorImg(24, 24);
    const before = buildParts((() => { const d = sqDoc(); d.elements = [makeEl(img, "engraved", "bands")]; return d; })())
      .filter(p => p.name.indexOf("farbe-") === 0);
    const hexes = before.map(p => hexOf(p.color));
    const d = sqDoc(); const el = makeEl(img, "engraved", "bands");
    window.mergeReduceColors(el.depth.reduce, hexes[0], hexes[1]);
    d.elements = [el];
    const parts = buildParts(d);
    assertEqual(parts.filter(p => p.name.indexOf("farbe-") === 0).length, 2, "2 inlay floors after merge");
    assertEqual(parts.filter(p => p.name.indexOf("grundplatte-band") === 0).length, 2, "2 base bands after merge");
  });

  test("parity: empty merges leaves geometry byte-identical", async () => {
    const img = await threeColorImg(24, 24);
    const a = sqDoc(); a.elements = [makeEl(img, "engraved", "stepped")];
    const b = sqDoc(); const el = makeEl(img, "engraved", "stepped"); el.depth.reduce.merges = {}; b.elements = [el];
    const j = (parts) => JSON.stringify(parts.map(p => ({ name: p.name, color: p.color, facets: p.facets })));
    assertEqual(j(buildParts(a)), j(buildParts(b)), "empty merges is a no-op");
  });
})();
