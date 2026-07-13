"use strict";
// Grouping is an editor overlay: buildParts must produce byte-identical output
// whether or not elements are grouped (the engine reads flat doc.elements).
(function () {
  function baseDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 50; d.body.thicknessMm = 2;
    d.body.baseColor = "#ffffff"; d.resolution = 160; d.autoLayerHeights = false;
    d.mount = { type: "none", xMm: 25, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    const a = makeElementV2("shape", { shape: "rect", cxMm: 18, cyMm: 20, wMm: 12, hMm: 8, color: "#000000" });
    const b = makeElementV2("shape", { shape: "circle", cxMm: 34, cyMm: 30, wMm: 10, hMm: 10, color: "#000000" });
    a.depth.direction = "raised"; b.depth.direction = "raised";
    a.id = "a"; b.id = "b"; d.elements = [a, b];
    return d;
  }
  function sig(parts) {
    return parts.map(p => p.name + ":" + p.facets.length).join("|");
  }
  test("groups: buildParts output is identical grouped vs ungrouped", () => {
    const flat = baseDoc();
    const grouped = baseDoc();
    groupElements(grouped, ["a", "b"]);
    assert(grouped.groups.length === 1, "grouped has a group");
    assertEqual(sig(buildParts(grouped)), sig(buildParts(flat)));
  });
})();
