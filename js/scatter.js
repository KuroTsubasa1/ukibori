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
// Resample a polyline (mm points [{x,y}]) to `count` spots at even arc length,
// endpoints included (count 1 = the path middle). Returns [{x, y, tangentDeg}]
// or [] when the path is degenerate (fewer than 2 distinct points).
function pathResample(points, count) {
  var pts = (points || []).filter(function (p, i, a) {
    return i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-9;
  });
  if (pts.length < 2 || !(count >= 1)) return [];
  var cum = [0];
  for (var i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  var L = cum[cum.length - 1];
  if (!(L > 0)) return [];
  var out = [];
  for (var n = 0; n < count; n++) {
    var s = count === 1 ? L / 2 : L * n / (count - 1);
    var seg = 0;
    while (seg < pts.length - 2 && s > cum[seg + 1]) seg++;
    var segLen = cum[seg + 1] - cum[seg];
    var f = segLen > 0 ? (s - cum[seg]) / segLen : 0;
    var dx = pts[seg + 1].x - pts[seg].x, dy = pts[seg + 1].y - pts[seg].y;
    out.push({
      x: pts[seg].x + dx * f,
      y: pts[seg].y + dy * f,
      tangentDeg: Math.atan2(dy, dx) * 180 / Math.PI,
    });
  }
  return out;
}

// Copies of `source` ({wMm,hMm}) along a drawn path at even spacing. params:
// {count, rotMin, rotMax, scaleMin, scaleMax, alignToPath}. rotMin/rotMax act
// as jitter ON TOP of the tangent when alignToPath is set. Same transform
// shape as scatterCopies, deterministic per seed.
function scatterAlongPath(source, points, params, seed) {
  var rng = makeRng(seed);
  var spots = pathResample(points, params.count);
  return spots.map(function (p) {
    var k = params.scaleMin + rng() * (params.scaleMax - params.scaleMin);
    var jitter = params.rotMin + rng() * (params.rotMax - params.rotMin);
    var base = params.alignToPath ? p.tangentDeg : 0;
    return {
      cxMm: p.x, cyMm: p.y,
      wMm: source.wMm * k, hMm: source.hMm * k,
      rotationDeg: Math.round(base + jitter),
    };
  });
}

window.makeRng = makeRng;
window.scatterCopies = scatterCopies;
window.pathResample = pathResample;
window.scatterAlongPath = scatterAlongPath;
