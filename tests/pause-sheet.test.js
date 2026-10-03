"use strict";
// Pausen-Spickzettel: swap schedule derived from part z-bands.
(function () {
  // Minimal part: one triangle spanning [z0, z1] is enough — the sheet only
  // reads vertex z and part color.
  function part(hex, z0, z1) {
    const c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    return { name: "t", color: c, facets: [[[0, 0, z0], [1, 0, z0], [0, 1, z1]]] };
  }

  test("pause-sheet: single color -> start entry only, no mixed", () => {
    const s = buildPauseSheet([part("#FFFFFF", 0, 3)], 0.2);
    assertEqual(s.swaps.length, 1);
    assertEqual(s.swaps[0].color, "#FFFFFF");
    assertEqual(s.swaps[0].layer, 1);
    assertEqual(s.mixed.length, 0);
    assertClose(s.totalHeightMm, 3, 1e-9);
    assertEqual(s.layers, 15);
  });

  test("pause-sheet: stacked colors give exact pause layers", () => {
    const s = buildPauseSheet([
      part("#FFFFFF", 0, 3),      // base
      part("#FF0000", 3, 3.4),    // band 1
      part("#0000FF", 3.4, 4.2),  // band 2
    ], 0.2);
    assertEqual(s.swaps.length, 3);
    assertEqual(s.swaps[0].color, "#FFFFFF");
    assertEqual(s.swaps[1].color, "#FF0000");
    assertEqual(s.swaps[1].layer, 16, "pause before layer 16 at z=3.0/0.2");
    assertClose(s.swaps[1].zMm, 3, 1e-9);
    assert(!s.swaps[1].offGrid, "on-grid boundary");
    assertEqual(s.swaps[2].color, "#0000FF");
    assertEqual(s.swaps[2].layer, 18);
    assertEqual(s.mixed.length, 0);
  });

  test("pause-sheet: same color across parts merges (no phantom swap)", () => {
    const s = buildPauseSheet([
      part("#FFFFFF", 0, 2), part("#FFFFFF", 2, 3), part("#FF0000", 3, 3.4),
    ], 0.2);
    assertEqual(s.swaps.length, 2);
    assertEqual(s.swaps[1].layer, 16);
  });

  test("pause-sheet: overlapping colors are flagged as mixed, not swapped", () => {
    const s = buildPauseSheet([
      part("#FFFFFF", 0, 3),
      part("#FF0000", 2.5, 3), // raised element sharing z with the plate top
    ], 0.2);
    assertEqual(s.mixed.length, 1);
    assertClose(s.mixed[0].z0, 2.5, 1e-6);
    assertClose(s.mixed[0].z1, 3, 1e-6);
    assertEqual(s.mixed[0].colors.length, 2);
    // no swap entry invented inside the mixed zone
    assertEqual(s.swaps.length, 1);
  });

  test("pause-sheet: off-grid boundary is marked", () => {
    const s = buildPauseSheet([part("#FFFFFF", 0, 2.5), part("#FF0000", 2.5, 3)], 0.2);
    assertEqual(s.swaps.length, 2);
    assert(s.swaps[1].offGrid, "2.5mm is not a multiple of 0.2");
  });

  test("pause-sheet: format mentions layers, colors and warnings", () => {
    const s = buildPauseSheet([
      part("#FFFFFF", 0, 3), part("#FF0000", 3, 3.4), part("#00FF00", 1, 2),
    ], 0.2);
    const txt = formatPauseSheet(s, { name: "muenze", layerHeightMm: 0.2 });
    assert(txt.indexOf("muenze") !== -1, "project name");
    assert(txt.indexOf("Pause VOR Schicht 16") !== -1, "pause line");
    assert(txt.indexOf("#FF0000") !== -1, "target color");
    assert(txt.indexOf("ACHTUNG") !== -1, "mixed warning present");
    assert(txt.indexOf("0,20 mm") !== -1, "German decimal comma");
  });

  test("pause-sheet: empty parts -> empty sheet", () => {
    const s = buildPauseSheet([], 0.2);
    assertEqual(s.swaps.length, 0);
    assertEqual(s.layers, 0);
  });
})();
