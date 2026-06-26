"use strict";
(function () {
  test("model: defaults match spec", () => {
    const d = defaultBookmark();
    assertEqual(d.widthMm, 50, "width");
    assertEqual(d.heightMm, 150, "height");
    assertEqual(d.cornerRadiusMm, 4, "corner");
    assertEqual(d.thicknessMm, 3, "thickness");
    assertEqual(d.layerHeightMm, 0.2, "layerHeight");
    assertEqual(d.hole.diameterMm, 5, "hole d");
    assertEqual(d.hole.marginTopMm, 8, "hole margin");
    assertEqual(d.baseColor, "#000000", "baseColor");
    assertEqual(d.elements.length, 0, "no elements");
  });
  test("model: ids are unique", () => {
    const a = makeTextElement({}), b = makeTextElement({});
    assert(a.id !== b.id, "ids differ");
  });
  test("model: image element has reduce defaults + _img slot", () => {
    const e = makeImageElement({ src: "x" });
    assertEqual(e.type, "image", "type");
    assertEqual(e.colorMode, "solid", "default solid");
    assertEqual(e.reduce.method, "palette", "reduce method");
    assert("_img" in e && e._img === null, "_img slot present and null");
  });
  test("model: serialize strips _img and roundtrips", () => {
    const d = defaultBookmark();
    d.elements.push(makeImageElement({ src: "data:abc" }));
    d.elements[0]._img = { fake: true };
    const json = serializeProject(d);
    assert(json.indexOf("_img") === -1, "_img not serialized");
    const back = deserializeProject(json);
    assertEqual(back.elements[0].src, "data:abc", "src roundtrips");
    assert(back.elements[0]._img === null, "_img restored to null");
    assertEqual(back.widthMm, 50, "doc fields roundtrip");
  });
})();
