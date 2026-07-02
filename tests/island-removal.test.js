"use strict";
// T6 – Inseln entfernen: island-removal tests (TDD).
// RED phase: (a) speck-removal assertion fails before engine implementation.
// GREEN phase: all pass after model/engine/display wiring.
//
// Design note: we use a square body (50×50mm) with resolution=100 so the engine
// raster grid is exactly 100×100 cells — matching the 100×100 source canvas.
// drawImage is then a pixel-perfect copy, so small specks survive the rasterization
// and can be reliably detected in the mask.
(function () {
  // ---- helpers ----

  // Build a minimal v2 doc with a single image element backed by a synthetic _img.
  // The body is 50×50mm (square) at resolution=100 → 100×100 grid, pitch=0.5mm.
  function makeImageDoc(imgCanvas, depthOverrides) {
    const d = defaultDoc();
    d.body.widthMm = 50; d.body.heightMm = 50;
    d.body.thicknessMm = 3; d.body.layerHeightMm = 0.2;
    d.body.baseColor = "#000000";
    d.body.shape = "rect";
    d.body.cornerRadiusMm = 0;
    d.mount = { type: "none", xMm: 25, yMm: 25, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    d.resolution = 100;
    const el = makeElementV2("image", {
      cxMm: 25, cyMm: 25, wMm: 50, hMm: 50,
      color: "#ffffff",
      depth: Object.assign(defaultDepth(), {
        mode: "solid", direction: "engraved", heightMm: 1.0,
        threshold: 128, invert: false, minIsland: 0,
      }, depthOverrides || {}),
    });
    el._img = imgCanvas;
    el.src = "data:image/png;base64,fake";
    d.elements.push(el);
    return d;
  }

  // Create an HTMLCanvasElement (100×100 px) with:
  //   – A large black-filled square (cols 0–79, rows 0–99)
  //   – A 3×3 isolated black speck at (85, 10) in the white area
  // Background: white. The speck is separated from the large square by a gap of 5px.
  function makeSolidTestCanvas() {
    const cv = document.createElement("canvas");
    cv.width = 100; cv.height = 100;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 100, 100); // white background
    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 80, 100);  // large black square (8000 px)
    ctx.fillStyle = "#000000"; ctx.fillRect(85, 10, 3, 3);   // 3×3 black speck (9 px)
    return cv;
  }

  // Create a canvas (100×100) with 3 colors where the 3rd color (green) has a
  // large 20×30 presence (to survive palette sampling) plus the main detection
  // area. The colorLayers island test uses numColors=3 to force 3 palette entries.
  //   – Red: left third (cols 0–32)
  //   – Blue: middle (cols 33–66)
  //   – Green: right third (cols 67–99) — large region → definitely in palette
  //
  // We test island removal by removing a *blue* island (3×3) embedded in the green region.
  // Wait — that's complicated. Instead: use a simpler approach where we test that the
  // island count of a specific palette color changes. We use numColors=3 to guarantee
  // exactly red/green/blue in the palette (equal thirds). Then place a 3×3 blue patch
  // inside the green region (at col 75, row 10). At minIsland=0 that blue patch should
  // be present in the mask; at minIsland=15 it should be gone (merged into green).
  function makeColorTestCanvas() {
    const cv = document.createElement("canvas");
    cv.width = 100; cv.height = 100;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, 34, 100);    // red: cols 0–33
    ctx.fillStyle = "#0000ff"; ctx.fillRect(34, 0, 33, 100);   // blue: cols 34–66
    ctx.fillStyle = "#00ff00"; ctx.fillRect(67, 0, 33, 100);   // green: cols 67–99
    // 3×3 blue speck embedded in the green region (cols 75–77, rows 10–12)
    ctx.fillStyle = "#0000ff"; ctx.fillRect(75, 10, 3, 3);
    return cv;
  }

  // --- (d) Model tests ---

  test("model: defaultDepth().minIsland === 0", () => {
    assertEqual(defaultDepth().minIsland, 0, "defaultDepth minIsland must be 0");
  });

  test("model: makeElementV2 depth has minIsland 0 by default", () => {
    const el = makeElementV2("image", {});
    assertEqual(el.depth.minIsland, 0, "makeElementV2 depth.minIsland defaults to 0");
  });

  test("model: migrateProject fills minIsland=0 on elements", () => {
    const v1 = defaultBookmark();
    v1.elements.push(makeImageElement({ src: "data:x", colorMode: "solid" }));
    const migrated = migrateProject(v1);
    assertEqual(migrated.elements[0].depth.minIsland, 0, "migrated element must have minIsland=0");
  });

  test("model: serialize/deserialize round-trips minIsland", () => {
    const d = defaultDoc();
    const el = makeElementV2("image", { src: "data:x" });
    el.depth.minIsland = 42;
    el._img = null;
    d.elements.push(el);
    const json = serializeProject(d);
    const loaded = deserializeProject(json);
    assertEqual(loaded.elements[0].depth.minIsland, 42, "minIsland round-trips through JSON");
  });

  // --- (b) Parity test: minIsland=0 output is byte-identical to no-field case ---

  test("engine parity: minIsland=0 gives byte-identical facets as no field at all", () => {
    // Two docs: one with explicit minIsland=0, one with the field absent.
    const cv = makeSolidTestCanvas();
    const docWith = makeImageDoc(cv, { minIsland: 0 });
    const docWithout = makeImageDoc(cv, {});
    delete docWithout.elements[0].depth.minIsland; // remove the field entirely

    const partsWithField = buildParts(docWith);
    const partsNoField = buildParts(docWithout);

    // Same number of parts.
    assertEqual(partsWithField.length, partsNoField.length, "same part count");
    // Byte-identical facets in each part (deep compare, not just counts —
    // review finding: count equality alone could mask a vertex-level drift).
    for (let i = 0; i < partsWithField.length; i++) {
      assertEqual(
        JSON.stringify(partsWithField[i].facets),
        JSON.stringify(partsNoField[i].facets),
        "part " + i + " byte-identical facets"
      );
    }
  });

  // --- (a) Solid island removal (engine) ---
  // We call __renderElementV2ForTest to inspect mask/r/g/b directly without buildParts.

  test("engine solid: speck cells appear in mask when minIsland=0", () => {
    // The 3×3 speck at (85,10) in a 100×100 image maps to cells (85,10)-(87,12)
    // in the 100×100 grid (1:1 since body=50×50mm, resolution=100, pitch=0.5mm,
    // element fills the full plate).
    const cv = makeSolidTestCanvas();
    const d = makeImageDoc(cv, { minIsland: 0 });
    const { cols, rows } = gridForBody(d.body, d.resolution);
    const { mask } = __renderElementV2ForTest(d.elements[0], d, cols, rows, null);
    const speckCount = countSpeckCells(mask, cols, rows);
    assert(speckCount > 0, "speck should contribute mask cells when minIsland=0 (got " + speckCount + ")");
  });

  // Count mask cells in the speck region: cols 83–89, rows 8–14
  // (slightly generous bbox around the 3×3 speck at 85,10 to account for 1px subpixel blur).
  function countSpeckCells(mask, cols, rows) {
    let count = 0;
    for (let r = 8; r <= 14; r++) {
      for (let c = 83; c <= 89; c++) {
        if (c < cols && r < rows && mask[r * cols + c]) count++;
      }
    }
    return count;
  }

  test("engine solid: speck removed when minIsland large enough", () => {
    // The 3×3 speck is 9 image pixels. Since the grid is 100×100 and the image is
    // 100×100 (1:1 mapping), cellsPerImagePixel = (50mm / 0.5mm/cell) / 100px = 1.0
    // so minSizeCells = round(minIsland * 1.0) = minIsland. Setting minIsland=15
    // removes the 9-cell speck but leaves the 8000-cell large square intact.
    const cv = makeSolidTestCanvas();
    const d = makeImageDoc(cv, { minIsland: 15 });
    const { cols, rows } = gridForBody(d.body, d.resolution);
    const { mask } = __renderElementV2ForTest(d.elements[0], d, cols, rows, null);
    const speckCountAfter = countSpeckCells(mask, cols, rows);
    assert(speckCountAfter === 0, "speck cells should be gone when minIsland=15 (got " + speckCountAfter + ")");
  });

  test("engine solid: large black square survives island removal", () => {
    const cv = makeSolidTestCanvas();
    const d = makeImageDoc(cv, { minIsland: 15 });
    const { cols, rows } = gridForBody(d.body, d.resolution);
    const { mask } = __renderElementV2ForTest(d.elements[0], d, cols, rows, null);
    // Big square: cols 0–79, rows 0–99. Count any cell in that region.
    let bigCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 78; c++) {
        if (mask[r * cols + c]) bigCount++;
      }
    }
    assert(bigCount > 0, "large square should still have mask cells after island removal (got " + bigCount + ")");
  });

  // --- (c) colorLayers island removal (engine) ---
  // Canvas: red (cols 0–33), blue (cols 34–66), green (cols 67–99), plus a 3×3 blue
  // speck inside the green region at (75,10). numColors=3 forces exactly red/blue/green.
  // The blue speck (9 cells) should appear at minIsland=0 and be absent at minIsland=15.

  function makeColorDocFor(minIsland) {
    const cv = makeColorTestCanvas();
    const overrides = {
      mode: "colorLayers", direction: "engraved", minIsland,
      reduce: { method: "palette", numColors: 3, levels: 4, remap: {}, order: [] },
    };
    return makeImageDoc(cv, overrides);
  }

  // Count cells in the speck region (cols 73–79, rows 8–14) whose color is blue
  // (b > 100, r < 50, g < 50).
  function countBlueSpeckCells(mask, r2, g2, b2, cols) {
    let count = 0;
    for (let row = 8; row <= 14; row++) {
      for (let col = 73; col <= 79; col++) {
        const i = row * cols + col;
        if (mask[i] && b2[i] > 100 && r2[i] < 50 && g2[i] < 50) count++;
      }
    }
    return count;
  }

  test("engine colorLayers: blue speck present in green region when minIsland=0", () => {
    const d = makeColorDocFor(0);
    const { cols, rows } = gridForBody(d.body, d.resolution);
    const { mask, r, g, b } = __renderElementV2ForTest(d.elements[0], d, cols, rows, null);
    const speckCount = countBlueSpeckCells(mask, r, g, b, cols);
    assert(speckCount > 0, "blue speck should be present when minIsland=0 (got " + speckCount + ")");
  });

  test("engine colorLayers: tiny island removed when minIsland set high enough", () => {
    // 3×3 blue speck = 9 cells; minIsland=15 removes it (merged into neighboring green).
    const d = makeColorDocFor(15);
    const { cols, rows } = gridForBody(d.body, d.resolution);
    const { mask, r, g, b } = __renderElementV2ForTest(d.elements[0], d, cols, rows, null);
    const speckCount = countBlueSpeckCells(mask, r, g, b, cols);
    assert(speckCount === 0, "blue speck should be removed when minIsland=15 (got " + speckCount + ")");
  });

  // --- Helper accessor ---
  // __renderElementV2 is IIFE-private in build-parts.js. We use the test-only
  // window.__renderElementV2ForTest shim exported from that file.
  function __renderElementV2ForTest(el, d, cols, rows, grid) {
    return window.__renderElementV2ForTest(el, d, cols, rows, grid);
  }
})();
