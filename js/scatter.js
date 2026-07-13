"use strict";
// Pure seeded scatter. No DOM. Depends on geom-util (elementAABB, aabbsOverlap).
function makeRng(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function scatterCopies(source, region, params, seed) {
  var rng = makeRng(seed);
  var count = params.count, avoid = !!params.avoidOverlap;
  var maxAttempts = Math.max(count * 25, 200);
  var rw = region.x1 - region.x0, rh = region.y1 - region.y0;
  var out = [], placed = [], attempts = 0;
  while (out.length < count && attempts < maxAttempts) {
    attempts++;
    var k = params.scaleMin + rng() * (params.scaleMax - params.scaleMin);
    var cand = {
      cxMm: region.x0 + rng() * rw,
      cyMm: region.y0 + rng() * rh,
      wMm: source.wMm * k, hMm: source.hMm * k,
      rotationDeg: Math.round(params.rotMin + rng() * (params.rotMax - params.rotMin)),
    };
    if (avoid) {
      var box = elementAABB(cand);
      var clash = false;
      for (var i = 0; i < placed.length; i++) { if (aabbsOverlap(box, placed[i])) { clash = true; break; } }
      if (clash) continue;
      placed.push(box);
    }
    out.push(cand);
  }
  return out;
}
window.makeRng = makeRng;
window.scatterCopies = scatterCopies;
