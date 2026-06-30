"use strict";
(function () {
  // Deterministic, font-free fixture: a solid-color image decoded from an in-test
  // canvas data URL (no external files, no text rendering).
  async function solidImg(hex, w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.fillStyle = hex; cx.fillRect(0, 0, w, h);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  // Build a v2 doc (via migration) with one solid image element centered on a 40x40 plate.
  function v2DocWithCenteredImage() {
    const v1 = defaultBookmark();
    v1.widthMm = 40; v1.heightMm = 40; v1.baseColor = "#000000"; v1.resolution = 40;
    v1.elements = [ makeImageElement({ src: "x", colorMode: "solid", color: "#ff0000",
                                       cxMm: 20, cyMm: 20, wMm: 20, hMm: 20 }) ];
    return migrateProject(v1); // -> v2 doc, element gets .depth{mode:'solid',...}
  }

  test("composeDesignV2: solid image overlays base with correct owner/color", async () => {
    const doc = v2DocWithCenteredImage();
    doc.elements[0]._img = await solidImg("#ff0000", 8, 8);
    const { cols, rows } = gridForBody(doc.body, doc.resolution); // 40x40, sx=sy=1
    const comp = composeDesignV2(doc, cols, rows);
    assertEqual(comp.r.length, cols * rows, "arrays sized cols*rows");
    const ix = (c, r) => r * cols + c;
    const ci = ix(20, 20);                 // mm(20.5,20.5) inside the 10..30 element box
    assertEqual(comp.owner[ci], 0, "center owned by element 0");
    assertEqual(comp.isBase[ci], 0, "center is not base");
    assertEqual(comp.r[ci], 255, "center R=255"); assertEqual(comp.g[ci], 0, "center G=0"); assertEqual(comp.b[ci], 0, "center B=0");
    const bi = ix(2, 2);                    // mm(2.5,2.5) outside the element -> base
    assertEqual(comp.isBase[bi], 1, "corner is base");
    assertEqual(comp.owner[bi], -1, "corner owner = -1");
    assertEqual(comp.r[bi], 0, "corner = base color (#000000)");
  });

  test("composeDesignV2: empty doc is all base", async () => {
    const v1 = defaultBookmark(); v1.widthMm = 30; v1.heightMm = 30; v1.baseColor = "#123456"; v1.resolution = 30;
    const doc = migrateProject(v1);
    const { cols, rows } = gridForBody(doc.body, doc.resolution);
    const comp = composeDesignV2(doc, cols, rows);
    let allBase = true; for (let i = 0; i < cols * rows; i++) if (comp.isBase[i] !== 1) allBase = false;
    assert(allBase, "no elements -> every pixel is base");
    assertEqual(comp.owner[0], -1, "owner -1 everywhere");
  });
})();
