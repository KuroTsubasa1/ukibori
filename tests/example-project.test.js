"use strict";
// Embedded example project (the Ukibori coin): parity with
// examples/ukibori-coin.json, deserialization, and engine sanity in both
// depth directions.
(function () {
  function exampleDoc() {
    return migrateProject(deserializeProject(JSON.stringify(window.EXAMPLE_PROJECT)));
  }

  test("example: window.EXAMPLE_PROJECT exists and deserializes", () => {
    assert(window.EXAMPLE_PROJECT, "EXAMPLE_PROJECT missing (js/example-project.js not loaded?)");
    const d = exampleDoc();
    assertEqual(d.body.shape, "circle", "plate shape");
    assertEqual(d.body.widthMm, 90, "width");
    assertEqual(d.body.heightMm, 90, "height");
    assertEqual(d.body.frame.widthMm, 3, "frame width");
    assertEqual(d.elements.length, 5, "element count");
  });

  test("example: the five coin elements are intact", () => {
    const els = exampleDoc().elements;
    const kanji = els[0], wordmark = els[1], bar = els[2], dotL = els[3], dotR = els[4];
    assertEqual(kanji.type, "text");
    assertEqual(kanji.text, "浮彫");
    assertEqual(kanji.color, "#c73e3a", "kanji color (vermillion)");
    assertEqual(kanji.fontWeight, "bold", "kanji bold");
    assertEqual(wordmark.type, "text");
    assertEqual(wordmark.text, "ukibori");
    assertEqual(bar.type, "shape");
    assertEqual(bar.shape, "rect");
    for (const dot of [dotL, dotR]) {
      assertEqual(dot.type, "shape");
      assertEqual(dot.shape, "circle");
      assertEqual(dot.wMm, 4);
    }
    // Symmetric about the plate center (45) at the divider's height.
    assertEqual(dotL.cxMm + dotR.cxMm, 90, "dots flank the center");
    assertEqual(dotL.cyMm, dotR.cyMm, "dots on the same height");
  });

  test("example: fresh elements never collide with loaded ids", () => {
    const d = exampleDoc();
    const ids = new Set(d.elements.map((e) => e.id));
    assertEqual(ids.size, d.elements.length, "example ids unique among themselves");
    // deserializeProject must lift the id counter past loaded ids: a fresh
    // element created right after loading must not mint an example id.
    const fresh = makeElementV2("text", {});
    assert(!ids.has(fresh.id),
      "fresh id " + fresh.id + " collides with a loaded element");
  });

  test("example: inactive mount sits at the plate center", () => {
    const d = exampleDoc();
    assertEqual(d.mount.type, "none");
    assertEqual(d.mount.xMm, d.body.widthMm / 2, "mount.xMm = width/2");
  });

  test("example: identical to examples/ukibori-coin.json", async () => {
    const res = await fetch("../examples/ukibori-coin.json");
    assert(res.ok, "examples/ukibori-coin.json not loadable: " + res.status);
    const file = await res.json();
    assertEqual(
      JSON.stringify(window.EXAMPLE_PROJECT),
      JSON.stringify(file),
      "js/example-project.js and examples/ukibori-coin.json have drifted apart"
    );
  });

  test("example: raised build yields grundplatte, auto color layers, and rand", () => {
    const parts = buildParts(exampleDoc());
    const names = parts.map((p) => p.name);
    assert(names.some((n) => n.startsWith("grundplatte")), "grundplatte missing: " + names);
    assert(names.some((n) => n.startsWith("farbschicht-auto-")), "auto layers missing: " + names);
    assert(names.includes("rand"), "frame ring missing: " + names);
    parts.forEach((p) => assert(p.facets.length > 0, p.name + " has no facets"));
  });

  test("example: engraved build bands the plate, motifs become farbe- floors", () => {
    const d = exampleDoc();
    d.elements.forEach((el) => { el.depth.direction = "engraved"; });
    const parts = buildParts(d);
    const names = parts.map((p) => p.name);
    assert(names.some((n) => n.startsWith("grundplatte")), "grundplatte missing: " + names);
    assert(names.some((n) => n.startsWith("farbe-")), "engraved floors missing: " + names);
    parts.forEach((p) => assert(p.facets.length > 0, p.name + " has no facets"));
  });
}());
