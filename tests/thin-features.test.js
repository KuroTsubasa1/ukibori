"use strict";
// Dünne-Stellen-Prüfung: window.thinFeatureMask flags printed regions narrower
// than the nozzle via morphological opening (chamfer-DT erode + dilate-back).
(function () {
  // 100x100px canvas on a 25x25mm element (0.25 mm/px): one WIDE bar (5 mm)
  // and one HAIRLINE bar (0.25 mm), transparent elsewhere.
  async function barsImg(withHairline) {
    const cv = document.createElement("canvas"); cv.width = 100; cv.height = 100;
    const cx = cv.getContext("2d"); cx.fillStyle = "#000000";
    cx.fillRect(10, 0, 20, 100);                    // wide bar: 2.5..7.5mm (5mm)
    if (withHairline) cx.fillRect(60, 0, 1, 100);   // hairline: 0.25mm (< 0.4)
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  function thinDoc(img) {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 50;
    d.body.cornerRadiusMm = 0; d.body.thicknessMm = 3; d.body.baseColor = "#ffffff";
    d.resolution = 256;
    d.mount = { type: "none", xMm: 25, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    const el = makeElementV2("image", { src: "a", cxMm: 25, cyMm: 25, wMm: 25, hMm: 25 });
    el.depth.direction = "raised"; el._img = img;
    d.elements = [el];
    return d;
  }

  test("thin features: 0.25mm hairline is flagged, 5mm bar interior is clean", async () => {
    const res = thinFeatureMask(thinDoc(await barsImg(true)), 0.4);
    assert(res.count > 0, "hairline produces flagged cells");
    // hairline at element-x 15mm → absolute 12.5+15 = 27.5mm → col ≈ 27.5/pitch
    const hc = Math.round(27.5 / res.pitch), midRow = Math.round(25 / res.pitch);
    let hairHit = 0;
    for (let c = hc - 3; c <= hc + 3; c++) for (let r = midRow - 8; r <= midRow + 8; r++) {
      if (res.thin[r * res.cols + c]) hairHit++;
    }
    assert(hairHit > 0, "flags sit on the hairline");
    // wide-bar interior at absolute 17.5mm center must be clean
    const wc = Math.round(17.5 / res.pitch);
    assert(res.thin[midRow * res.cols + wc] === 0, "5mm bar interior not flagged");
    assert(res.areaMm2 > 1 && res.areaMm2 < 15, "flagged area ≈ the hairline (got " + res.areaMm2.toFixed(2) + " mm²)");
  });

  test("thin features: doc with only wide geometry stays (almost) clean", async () => {
    const res = thinFeatureMask(thinDoc(await barsImg(false)), 0.4);
    // Opening rounds sharp corners — a few corner cells may flag; nothing more.
    assert(res.areaMm2 < 1, "no substantial thin area on a 5mm bar (got " + res.areaMm2.toFixed(2) + " mm²)");
  });
})();
