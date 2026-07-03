"use strict";
// AMS shared filament palette (doc.amsPalette): ordered layer colors shared by the whole print.
// Model layer only here — engine consumption + UI are separate.
(function () {
  test("defaultDoc has an empty amsPalette; round-trips", () => {
    const d = defaultDoc();
    assert(Array.isArray(d.amsPalette) && d.amsPalette.length === 0, "amsPalette defaults to []");
    d.amsPalette = ["#1A1A1A", "#E0E0E0"];
    const rt = deserializeProject(serializeProject(d));
    assertEqual(JSON.stringify(rt.amsPalette), JSON.stringify(["#1A1A1A", "#E0E0E0"]), "amsPalette round-trips");
  });

  test("migrateProject backfills amsPalette on older v2 docs", () => {
    const d = defaultDoc(); delete d.amsPalette;
    const m = migrateProject(d);
    assert(Array.isArray(m.amsPalette) && m.amsPalette.length === 0, "backfilled to []");
  });

  test("migrateProject normalizes an existing amsPalette (lowercase → UPPERCASE, drops invalid)", () => {
    const d = defaultDoc(); d.amsPalette = ["#abcdef", "bad", "#123456", "#ABCDEF"];
    const m = migrateProject(d);
    assertEqual(JSON.stringify(m.amsPalette), JSON.stringify(["#ABCDEF", "#123456"]), "uppercased, invalid dropped, deduped");
    // a non-array amsPalette is coerced to []
    const d2 = defaultDoc(); d2.amsPalette = "oops";
    assertEqual(JSON.stringify(migrateProject(d2).amsPalette), "[]", "non-array → []");
  });

  test("seedAmsPalette: dedups, normalizes to UPPERCASE, orders darkest→lightest", () => {
    const d = defaultDoc();
    window.seedAmsPalette(d, ["#e0e0e0", "1a1a1a", "#888888", "#E0E0E0"]);
    assertEqual(JSON.stringify(d.amsPalette), JSON.stringify(["#1A1A1A", "#888888", "#E0E0E0"]),
      "sorted dark→light, deduped, uppercased, '#' added");
  });

  test("seedAmsPalette is a no-op when already seeded (preserves user order)", () => {
    const d = defaultDoc();
    d.amsPalette = ["#E0E0E0", "#1A1A1A"]; // user put light first
    window.seedAmsPalette(d, ["#000000", "#ffffff"]);
    assertEqual(JSON.stringify(d.amsPalette), JSON.stringify(["#E0E0E0", "#1A1A1A"]), "existing palette untouched");
  });

  test("addAmsColor / removeAmsColor normalize + dedup", () => {
    const d = defaultDoc();
    window.addAmsColor(d, "#abc123"); window.addAmsColor(d, "#ABC123"); // same, deduped
    window.addAmsColor(d, "def456");
    assertEqual(JSON.stringify(d.amsPalette), JSON.stringify(["#ABC123", "#DEF456"]), "added, normalized, deduped");
    window.removeAmsColor(d, "#abc123");
    assertEqual(JSON.stringify(d.amsPalette), JSON.stringify(["#DEF456"]), "removed (case-insensitive)");
  });

  test("setAmsPalette replaces with a validated/deduped/normalized order (drag-reorder)", () => {
    const d = defaultDoc();
    window.setAmsPalette(d, ["#111111", "#222222", "#111111", "bad", "#333333"]);
    assertEqual(JSON.stringify(d.amsPalette), JSON.stringify(["#111111", "#222222", "#333333"]), "invalid dropped, deduped, order kept");
  });

  test("nearestAmsColor picks the closest palette hex", () => {
    const pal = ["#000000", "#FF0000", "#00FF00", "#0000FF"];
    assertEqual(window.nearestAmsColor(pal, 250, 10, 10), "#FF0000", "reddish → red");
    assertEqual(window.nearestAmsColor(pal, 10, 10, 10), "#000000", "dark → black");
    assertEqual(window.nearestAmsColor([], 1, 2, 3), null, "empty palette → null");
  });
})();
