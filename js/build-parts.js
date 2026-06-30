"use strict";
// Unified geometry engine (additive; nothing calls it yet — the UI switches over
// in a later phase). Turns a v2 doc into 3D parts [{name, color:[r,g,b], facets}],
// reusing the shared primitives (shapeFootprintField, traceMaskToFacets,
// extrudeLoops, orientOutward, hexToRgb) via window globals.
(function () {
  // Aspect-preserving raster grid for a v2 body: longest side = resolution.
  // pitch = widthMm / cols (mm per cell). Mirrors the bookmark __gridFor logic.
  function gridForBody(body, resolution) {
    const res = Math.max(8, Math.round(resolution));
    let cols, rows;
    if (body.widthMm >= body.heightMm) {
      cols = res; rows = Math.max(2, Math.round(res * body.heightMm / body.widthMm));
    } else {
      rows = res; cols = Math.max(2, Math.round(res * body.widthMm / body.heightMm));
    }
    return { cols, rows, pitch: body.widthMm / cols };
  }

  // Base plate: the body footprint (with the mount hole cut) extruded from z=0 to
  // body.thicknessMm, colored body.baseColor. The loop's raised ring is built
  // separately (later task).
  function buildBaseParts(doc) {
    const body = doc.body, mount = doc.mount;
    const { cols, rows, pitch } = gridForBody(body, doc.resolution);
    const field = window.shapeFootprintField(cols, rows, body, mount);
    const inside = (c, r) => field(c, r) > 0;
    const facets = window.orientOutward(
      window.traceMaskToFacets(inside, cols, rows, pitch, body.thicknessMm, 0)
    );
    if (!facets.length) return [];
    return [{ name: "grundplatte", color: window.hexToRgb(body.baseColor), facets }];
  }

  window.gridForBody = gridForBody;
  window.buildBaseParts = buildBaseParts;
})();
