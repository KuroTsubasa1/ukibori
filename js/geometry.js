"use strict";

// ======================================================================
// 3D model generation: contour tracing -> simplify -> earcut -> extrude.
// ======================================================================

// --- earcut (MIT, Mapbox), O(n^2) variant: triangulates a polygon w/ holes ---
function earcut(data, holeIndices, dim) {
  dim = dim || 2;
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  let outerNode = ec_linkedList(data, 0, outerLen, dim, true);
  const triangles = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;
  if (hasHoles) outerNode = ec_eliminateHoles(data, holeIndices, outerNode, dim);
  ec_earcutLinked(outerNode, triangles, dim);
  return triangles;
}
function ec_linkedList(data, start, end, dim, clockwise) {
  let i, last;
  if (clockwise === (ec_signedArea(data, start, end, dim) > 0)) {
    for (i = start; i < end; i += dim) last = ec_insertNode(i, data[i], data[i + 1], last);
  } else {
    for (i = end - dim; i >= start; i -= dim) last = ec_insertNode(i, data[i], data[i + 1], last);
  }
  if (last && ec_equals(last, last.next)) { ec_removeNode(last); last = last.next; }
  return last;
}
function ec_filterPoints(start, end) {
  if (!start) return start;
  if (!end) end = start;
  let p = start, again;
  do {
    again = false;
    if (!p.steiner && (ec_equals(p, p.next) || ec_area(p.prev, p, p.next) === 0)) {
      ec_removeNode(p); p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else { p = p.next; }
  } while (again || p !== end);
  return end;
}
function ec_earcutLinked(ear, triangles, dim, pass) {
  if (!ear) return;
  let stop = ear, prev, next;
  while (ear.prev !== ear.next) {
    prev = ear.prev; next = ear.next;
    if (ec_isEar(ear)) {
      triangles.push(prev.i / dim, ear.i / dim, next.i / dim);
      ec_removeNode(ear);
      ear = next.next; stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) ec_earcutLinked(ec_filterPoints(ear), triangles, dim, 1);
      else if (pass === 1) { ear = ec_cureLocalIntersections(ec_filterPoints(ear), triangles, dim); ec_earcutLinked(ear, triangles, dim, 2); }
      else if (pass === 2) ec_splitEarcut(ear, triangles, dim);
      break;
    }
  }
}
function ec_isEar(ear) {
  const a = ear.prev, b = ear, c = ear.next;
  if (ec_area(a, b, c) >= 0) return false;
  let p = ear.next.next;
  while (p !== ear.prev) {
    if (ec_pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && ec_area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}
function ec_cureLocalIntersections(start, triangles, dim) {
  let p = start;
  do {
    const a = p.prev, b = p.next.next;
    if (!ec_equals(a, b) && ec_intersects(a, p, p.next, b) && ec_locallyInside(a, b) && ec_locallyInside(b, a)) {
      triangles.push(a.i / dim, p.i / dim, b.i / dim);
      ec_removeNode(p); ec_removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return ec_filterPoints(p);
}
function ec_splitEarcut(start, triangles, dim) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && ec_isValidDiagonal(a, b)) {
        let c = ec_splitPolygon(a, b);
        a = ec_filterPoints(a, a.next);
        c = ec_filterPoints(c, c.next);
        ec_earcutLinked(a, triangles, dim);
        ec_earcutLinked(c, triangles, dim);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}
function ec_eliminateHoles(data, holeIndices, outerNode, dim) {
  const queue = [];
  let i, len, start, end, list;
  for (i = 0, len = holeIndices.length; i < len; i++) {
    start = holeIndices[i] * dim;
    end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    list = ec_linkedList(data, start, end, dim, false);
    if (list === list.next) list.steiner = true;
    queue.push(ec_getLeftmost(list));
  }
  queue.sort((a, b) => a.x - b.x);
  for (i = 0; i < queue.length; i++) outerNode = ec_eliminateHole(queue[i], outerNode);
  return outerNode;
}
function ec_eliminateHole(hole, outerNode) {
  const bridge = ec_findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;
  const bridgeReverse = ec_splitPolygon(bridge, hole);
  ec_filterPoints(bridgeReverse, bridgeReverse.next);
  return ec_filterPoints(bridge, bridge.next);
}
function ec_findHoleBridge(hole, outerNode) {
  let p = outerNode, qx = -Infinity, m;
  const hx = hole.x, hy = hole.y;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m) return null;
  const stop = m, mx = m.x, my = m.y;
  let tanMin = Infinity, tan;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x &&
        ec_pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      tan = Math.abs(hy - p.y) / (hx - p.x);
      if (ec_locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && ec_sectorContains(m, p)))))) {
        m = p; tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}
function ec_sectorContains(m, p) { return ec_area(m.prev, m, p.prev) < 0 && ec_area(p.next, m, m.next) < 0; }
function ec_getLeftmost(start) {
  let p = start, leftmost = start;
  do { if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p; p = p.next; } while (p !== start);
  return leftmost;
}
function ec_pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
         (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
         (bx - px) * (cy - py) >= (cx - px) * (by - py);
}
function ec_isValidDiagonal(a, b) {
  return a.next.i !== b.i && a.prev.i !== b.i && !ec_intersectsPolygon(a, b) &&
    ((ec_locallyInside(a, b) && ec_locallyInside(b, a) && ec_middleInside(a, b) &&
      (ec_area(a.prev, a, b.prev) || ec_area(a, b.prev, b))) ||
     (ec_equals(a, b) && ec_area(a.prev, a, a.next) > 0 && ec_area(b.prev, b, b.next) > 0));
}
function ec_area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
function ec_equals(p1, p2) { return p1.x === p2.x && p1.y === p2.y; }
function ec_intersects(p1, q1, p2, q2) {
  const o1 = ec_sign(ec_area(p1, q1, p2)), o2 = ec_sign(ec_area(p1, q1, q2)),
        o3 = ec_sign(ec_area(p2, q2, p1)), o4 = ec_sign(ec_area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && ec_onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && ec_onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && ec_onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && ec_onSegment(p2, q1, q2)) return true;
  return false;
}
function ec_onSegment(p, q, r) { return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y); }
function ec_sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
function ec_intersectsPolygon(a, b) {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && ec_intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}
function ec_locallyInside(a, b) {
  return ec_area(a.prev, a, a.next) < 0 ?
    ec_area(a, b, a.next) >= 0 && ec_area(a, a.prev, b) >= 0 :
    ec_area(a, b, a.prev) < 0 || ec_area(a, a.next, b) < 0;
}
function ec_middleInside(a, b) {
  let p = a, inside = false;
  const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do {
    if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}
function ec_splitPolygon(a, b) {
  const a2 = ec_newNode(a.i, a.x, a.y), b2 = ec_newNode(b.i, b.x, b.y), an = a.next, bp = b.prev;
  a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp;
  return b2;
}
function ec_insertNode(i, x, y, last) {
  const p = ec_newNode(i, x, y);
  if (!last) { p.prev = p; p.next = p; }
  else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
  return p;
}
function ec_removeNode(p) { p.next.prev = p.prev; p.prev.next = p.next; }
function ec_newNode(i, x, y) { return { i, x, y, prev: null, next: null, steiner: false }; }
function ec_signedArea(data, start, end, dim) {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; }
  return sum;
}

// Triangulate one component (outer ring + holes), each an array of [x,y].
// Returns an array of triangles [[x,y],[x,y],[x,y]].
function triangulateComponent(outer, holes) {
  const data = [], holeIndices = [];
  for (const p of outer) data.push(p[0], p[1]);
  for (const h of holes) { holeIndices.push(data.length / 2); for (const p of h) data.push(p[0], p[1]); }
  const idx = earcut(data, holeIndices, 2);
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    tris.push([[data[a * 2], data[a * 2 + 1]], [data[b * 2], data[b * 2 + 1]], [data[c * 2], data[c * 2 + 1]]]);
  }
  return tris;
}

// Perpendicular distance from p to the line through a,b.
function ptLineDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
// Douglas-Peucker on an open polyline (endpoints fixed). tol in same units.
function dpSimplify(pts, tol) {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = ptLineDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > tol) { keep[idx] = 1; stack.push([s, idx]); stack.push([idx, e]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
function polyArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return s / 2; // >0 = CCW in y-up
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1])) &&
        (pt[0] < (poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0])) inside = !inside;
  }
  return inside;
}

// One pass of Chaikin corner-cutting on a closed polygon: each edge is replaced
// by points at 1/4 and 3/4 of its length, rounding sharp corners; endpoints wrap.
function chaikinClosed(pts) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}
window.chaikinClosed = chaikinClosed;

// Bilinear sample of a scalar field stored row-major (cols x rows); clamps to edge.
function bilinearField(F, cols, rows, x, y) {
  x = Math.max(0, Math.min(cols - 1, x)); y = Math.max(0, Math.min(rows - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, v = (c, r) => F[r * cols + c];
  return v(x0, y0) * (1 - fx) * (1 - fy) + v(x1, y0) * fx * (1 - fy)
       + v(x0, y1) * (1 - fx) * fy + v(x1, y1) * fx * fy;
}

// Sub-pixel contour of a continuous signed field f(c,r) (>0 inside) via marching
// squares with linear edge interpolation. Returns closed loops in sample
// coordinates, oriented with the inside on the left. The grid is padded with
// "outside" so regions touching the border close along it. This yields smooth,
// sub-pixel-accurate boundaries instead of an axis-aligned binary staircase.
function marchingSquaresLoops(f, cols, rows) {
  const OUT = -1e15;
  const F = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) F[r * cols + c] = f(c, r);
  const val = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows) ? OUT : F[r * cols + c];
  const cross = new Map();           // edge id -> [x,y]
  const links = new Map();           // edge id -> [connected edge ids]
  const link = (a, b) => { (links.get(a) || links.set(a, []).get(a)).push(b);
                           (links.get(b) || links.set(b, []).get(b)).push(a); };
  const getH = (c, r) => { const a = val(c, r), b = val(c + 1, r); return [c + a / (a - b), r]; };
  const getV = (c, r) => { const a = val(c, r), b = val(c, r + 1); return [c, r + a / (a - b)]; };
  const inside = (v) => v > 0;
  for (let r = -1; r < rows; r++) for (let c = -1; c < cols; c++) {
    const tl = val(c, r), tr = val(c + 1, r), br = val(c + 1, r + 1), bl = val(c, r + 1);
    let idx = (inside(tl) ? 1 : 0) | (inside(tr) ? 2 : 0) | (inside(br) ? 4 : 0) | (inside(bl) ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = 'h_' + c + '_' + r, R = 'v_' + (c + 1) + '_' + r, B = 'h_' + c + '_' + (r + 1), L = 'v_' + c + '_' + r;
    const seg = (e1, p1, e2, p2) => { cross.set(e1, p1); cross.set(e2, p2); link(e1, e2); };
    const pT = T, pR = R, pB = B, pL = L;
    const PT = () => getH(c, r), PR = () => getV(c + 1, r), PB = () => getH(c, r + 1), PL = () => getV(c, r);
    switch (idx) {
      case 1: case 14: seg(pL, PL(), pT, PT()); break;
      case 2: case 13: seg(pT, PT(), pR, PR()); break;
      case 3: case 12: seg(pL, PL(), pR, PR()); break;
      case 4: case 11: seg(pR, PR(), pB, PB()); break;
      case 6: case 9:  seg(pT, PT(), pB, PB()); break;
      case 7: case 8:  seg(pL, PL(), pB, PB()); break;
      case 5: if (inside((tl + tr + br + bl) / 4)) { seg(pL, PL(), pT, PT()); seg(pR, PR(), pB, PB()); }
              else { seg(pT, PT(), pR, PR()); seg(pL, PL(), pB, PB()); } break;
      case 10: if (inside((tl + tr + br + bl) / 4)) { seg(pT, PT(), pR, PR()); seg(pL, PL(), pB, PB()); }
               else { seg(pL, PL(), pT, PT()); seg(pR, PR(), pB, PB()); } break;
    }
  }
  // Stitch segments into loops by walking the connectivity graph (degree ~2).
  const used = new Set(), loops = [];
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop = []; let prev = null, cur = start;
    while (cur != null && !used.has(cur)) {
      used.add(cur); loop.push(cross.get(cur));
      let nxt = null;
      for (const n of links.get(cur)) if (n !== prev && !used.has(n)) { nxt = n; break; }
      prev = cur; cur = nxt;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  // Orient each loop so the inside (F>0) lies to its left (sample space, y-down).
  for (const lp of loops) {
    const a = lp[0], b = lp[1];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    let nx = ty, ny = -tx; const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
    const fv = bilinearField(F, cols, rows, (a[0] + b[0]) / 2 + nx * 0.3, (a[1] + b[1]) / 2 + ny * 0.3);
    if (!(fv > 0)) lp.reverse();
  }
  return loops;
}
window.marchingSquaresLoops = marchingSquaresLoops;

// Extrude already-prepared closed mm loops (outers CCW / holes CW) from z0 to
// z0+thickness: top + bottom caps (triangulated with holes) and side walls.
function extrudeLoops(loops, thickness, z0 = 0) {
  if (thickness <= 0 || !loops.length) return [];
  const outers = [], holes = [];
  for (const l of loops) (polyArea(l) > 0 ? outers : holes).push(l);
  const comps = outers.map(o => ({ outer: o, holes: [] }));
  for (const h of holes) {
    let best = -1, bestArea = Infinity;
    for (let i = 0; i < comps.length; i++) {
      if (pointInPoly(h[0], comps[i].outer)) { const a = Math.abs(polyArea(comps[i].outer)); if (a < bestArea) { bestArea = a; best = i; } }
    }
    if (best >= 0) comps[best].holes.push(h);
  }
  const facets = [], zTop = z0 + thickness, zBot = z0;
  for (const comp of comps) {
    for (const t of triangulateComponent(comp.outer, comp.holes)) {
      facets.push([[t[0][0], t[0][1], zTop], [t[1][0], t[1][1], zTop], [t[2][0], t[2][1], zTop]]); // top
      facets.push([[t[0][0], t[0][1], zBot], [t[2][0], t[2][1], zBot], [t[1][0], t[1][1], zBot]]); // bottom
    }
    for (const ring of [comp.outer, ...comp.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
        const a = [p1[0], p1[1], zBot], b = [p2[0], p2[1], zBot], c = [p2[0], p2[1], zTop], dd = [p1[0], p1[1], zTop];
        facets.push([a, b, c]); facets.push([a, c, dd]);
      }
    }
  }
  return facets;
}
window.extrudeLoops = extrudeLoops;

// Sub-pixel part: contour a continuous signed field (already smooth), apply the
// smoothing slider as a light extra rounding (0 = sharpest sub-pixel, higher =
// rounder), convert to mm (y-flip so outers come out CCW), decimate, then extrude.
// smoothTol is the slider value in mm (= cells * pitch).
function fieldFacets(f, cols, rows, pitch, thickness, smoothTol, z0 = 0) {
  if (thickness <= 0) return [];
  const iters = Math.max(0, Math.round(smoothTol / pitch)); // slider in cells -> Chaikin passes
  const loops = marchingSquaresLoops(f, cols, rows)
    .map(lp => { let p = lp; for (let i = 0; i < iters; i++) p = chaikinClosed(p); return p; })
    .map(lp => lp.map(([c, r]) => [c * pitch, (rows - 1 - r) * pitch]))
    .map(lp => dpSimplify(lp, Math.max(0.3 * pitch, smoothTol)))
    .filter(l => l.length >= 3);
  return extrudeLoops(loops, thickness, z0);
}
window.fieldFacets = fieldFacets;

function signedVolume(facets) {
  let v = 0;
  for (const f of facets) {
    const [a, b, c] = f;
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}
// Ensure outward-facing normals: flip all facets if the enclosed volume is negative.
function orientOutward(facets) {
  if (signedVolume(facets) < 0) for (const f of facets) { const t = f[1]; f[1] = f[2]; f[2] = t; }
  return facets;
}
// Convert independent triangle facets into an indexed mesh (shared vertices).
function facetsToIndexedMesh(facets) {
  const map = new Map(), vertices = [], triangles = [];
  const idx = v => {
    const k = v[0].toFixed(4) + '_' + v[1].toFixed(4) + '_' + v[2].toFixed(4);
    let i = map.get(k);
    if (i === undefined) { i = vertices.length; map.set(k, i); vertices.push(v); }
    return i;
  };
  for (const f of facets) triangles.push([idx(f[0]), idx(f[1]), idx(f[2])]);
  return { vertices, triangles };
}

// --- Minimal ZIP (STORE, no compression) for the 3MF/OPC container ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.bytes), size = f.bytes.length;
    const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true);
    dv.setUint16(26, name.length, true);
    lh.set(name, 30);
    parts.push(lh, f.bytes);
    const cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += lh.length + size;
  }
  let cdSize = 0; for (const c of central) cdSize += c.length;
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  let total = 0; for (const a of all) total += a.length;
  const buf = new Uint8Array(total); let p = 0;
  for (const a of all) { buf.set(a, p); p += a.length; }
  return buf;
}

// Analytic signed field (>0 inside the rounded-rect body AND outside the hole),
// in cell units, for a cols×rows grid spanning widthMm×heightMm. Cell centers
// map to mm via (c+0.5)/(cols/widthMm), (r+0.5)/(rows/heightMm); r=0 is the top.
// The hole is horizontally centered, its center marginTopMm+radius from the top.
function roundedRectHoleField(cols, rows, p) {
  const sx = cols / p.widthMm, sy = rows / p.heightMm; // cells per mm
  const s = (sx + sy) / 2;                              // ~uniform scale for radii
  const hw = p.widthMm / 2, hh = p.heightMm / 2;
  const rr = Math.min(p.cornerRadiusMm, hw, hh);
  const holeR = p.hole.diameterMm / 2;
  const holeCx = p.widthMm / 2, holeCy = p.hole.marginTopMm + holeR;
  return (c, r) => {
    const x = (c + 0.5) / sx, y = (r + 0.5) / sy;       // mm, origin top-left
    // rounded-rect SDF (centered): >0 outside, <0 inside
    const qx = Math.abs(x - hw) - (hw - rr), qy = Math.abs(y - hh) - (hh - rr);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    const bodyInside = -outside;                         // >0 inside body, mm
    const holeOutside = Math.hypot(x - holeCx, y - holeCy) - holeR; // >0 outside hole, mm
    return Math.min(bodyInside, holeOutside) * s;        // mm -> cells
  };
}
window.roundedRectHoleField = roundedRectHoleField;

// Build a 3MF package from parts [{name, color:[r,g,b], facets}] as a Blob.
// Each part becomes its own <object> (separate mesh) colored via a colorgroup.
function build3MF(parts) {
  const enc = new TextEncoder();
  let colors = '', objects = '', items = '';
  parts.forEach((part, i) => {
    const m = facetsToIndexedMesh(part.facets);
    const col = '#' + part.color.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase() + 'FF';
    colors += `   <m:color color="${col}" />\n`;
    let vs = '';
    for (const v of m.vertices) vs += `     <vertex x="${+v[0].toFixed(4)}" y="${+v[1].toFixed(4)}" z="${+v[2].toFixed(4)}" />\n`;
    let ts = '';
    for (const t of m.triangles) ts += `     <triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" />\n`;
    const id = i + 2;
    objects += `  <object id="${id}" name="${part.name}" type="model" pid="1" pindex="${i}">\n   <mesh>\n    <vertices>\n${vs}    </vertices>\n    <triangles>\n${ts}    </triangles>\n   </mesh>\n  </object>\n`;
    items += `  <item objectid="${id}" />\n`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
 <resources>
  <m:colorgroup id="1">
${colors}  </m:colorgroup>
${objects} </resources>
 <build>
${items} </build>
</model>
`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
`;
  const zip = zipStore([
    { name: '[Content_Types].xml', bytes: enc.encode(contentTypes) },
    { name: '_rels/.rels', bytes: enc.encode(rels) },
    { name: '3D/3dmodel.model', bytes: enc.encode(model) },
  ]);
  return new Blob([zip], { type: 'model/3mf' });
}
