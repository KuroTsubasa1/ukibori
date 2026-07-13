"use strict";
// Eingebettetes Beispiel-Projekt (die Ukibori-Münze): Parität mit
// examples/ukibori-coin.json, Deserialisierung, und Engine-Sanity in beide
// Tiefen-Richtungen.
(function () {
  function exampleDoc() {
    return migrateProject(deserializeProject(JSON.stringify(window.EXAMPLE_PROJECT)));
  }

  test("example: window.EXAMPLE_PROJECT ist vorhanden und deserialisiert", () => {
    assert(window.EXAMPLE_PROJECT, "EXAMPLE_PROJECT fehlt (js/example-project.js nicht geladen?)");
    const d = exampleDoc();
    assertEqual(d.body.shape, "circle", "Plattenform");
    assertEqual(d.body.widthMm, 90, "Breite");
    assertEqual(d.body.heightMm, 90, "Höhe");
    assertEqual(d.body.frame.widthMm, 3, "Rahmenbreite");
    assertEqual(d.elements.length, 5, "Elementanzahl");
  });

  test("example: die fünf Münz-Elemente stimmen", () => {
    const els = exampleDoc().elements;
    const kanji = els[0], wordmark = els[1], bar = els[2], dotL = els[3], dotR = els[4];
    assertEqual(kanji.type, "text");
    assertEqual(kanji.text, "浮彫");
    assertEqual(kanji.color, "#c73e3a", "Kanji-Farbe (Zinnober)");
    assertEqual(kanji.fontWeight, "bold", "Kanji fett");
    assertEqual(wordmark.type, "text");
    assertEqual(wordmark.text, "ukibori");
    assertEqual(bar.type, "shape");
    assertEqual(bar.shape, "rect");
    for (const dot of [dotL, dotR]) {
      assertEqual(dot.type, "shape");
      assertEqual(dot.shape, "circle");
      assertEqual(dot.wMm, 4);
    }
    // Symmetrisch um die Plattenmitte (45) auf der Trennlinien-Höhe.
    assertEqual(dotL.cxMm + dotR.cxMm, 90, "Punkte flankieren mittig");
    assertEqual(dotL.cyMm, dotR.cyMm, "Punkte auf gleicher Höhe");
  });

  test("example: neue Elemente kollidieren nicht mit geladenen IDs", () => {
    const d = exampleDoc();
    const ids = new Set(d.elements.map((e) => e.id));
    assertEqual(ids.size, d.elements.length, "Beispiel-IDs selbst eindeutig");
    // deserializeProject muss den ID-Zähler über geladene IDs hinwegheben:
    // ein frisches Element direkt nach dem Laden darf keine Beispiel-ID prägen.
    const fresh = makeElementV2("text", {});
    assert(!ids.has(fresh.id),
      "frische ID " + fresh.id + " kollidiert mit geladenem Element");
  });

  test("example: inaktive Befestigung sitzt in der Plattenmitte", () => {
    const d = exampleDoc();
    assertEqual(d.mount.type, "none");
    assertEqual(d.mount.xMm, d.body.widthMm / 2, "mount.xMm = Breite/2");
  });

  test("example: identisch mit examples/ukibori-coin.json", async () => {
    const res = await fetch("../examples/ukibori-coin.json");
    assert(res.ok, "examples/ukibori-coin.json nicht ladbar: " + res.status);
    const file = await res.json();
    assertEqual(
      JSON.stringify(window.EXAMPLE_PROJECT),
      JSON.stringify(file),
      "js/example-project.js und examples/ukibori-coin.json sind auseinandergelaufen"
    );
  });

  test("example: erhaben baut Grundplatte, Auto-Farbschichten und Rand", () => {
    const parts = buildParts(exampleDoc());
    const names = parts.map((p) => p.name);
    assert(names.some((n) => n.startsWith("grundplatte")), "grundplatte fehlt: " + names);
    assert(names.some((n) => n.startsWith("farbschicht-auto-")), "Auto-Ebenen fehlen: " + names);
    assert(names.includes("rand"), "Rahmen fehlt: " + names);
    parts.forEach((p) => assert(p.facets.length > 0, p.name + " ohne Facetten"));
  });

  test("example: vertieft graviert — Platte bandet, Motive als farbe-Böden", () => {
    const d = exampleDoc();
    d.elements.forEach((el) => { el.depth.direction = "engraved"; });
    const parts = buildParts(d);
    const names = parts.map((p) => p.name);
    assert(names.some((n) => n.startsWith("grundplatte")), "Grundplatte fehlt: " + names);
    assert(names.some((n) => n.startsWith("farbe-")), "Gravur-Böden fehlen: " + names);
    parts.forEach((p) => assert(p.facets.length > 0, p.name + " ohne Facetten"));
  });
}());
