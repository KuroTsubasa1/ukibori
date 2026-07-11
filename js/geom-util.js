"use strict";
// Pure rotated-rectangle geometry shared by selection, transform, align and scatter.
// No DOM. All coordinates in plate mm.
function rotatedCorners(el) {
  const cx = el.cxMm, cy = el.cyMm, hw = (el.wMm || 0) / 2, hh = (el.hMm || 0) / 2;
  const a = (el.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const out = [];
  const dd = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  for (let i = 0; i < 4; i++) {
    const dx = dd[i][0], dy = dd[i][1];
    out.push([cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]);
  }
  return out;
}
function elementAABB(el) {
  const c = rotatedCorners(el);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < c.length; i++) {
    if (c[i][0] < x0) x0 = c[i][0];
    if (c[i][0] > x1) x1 = c[i][0];
    if (c[i][1] < y0) y0 = c[i][1];
    if (c[i][1] > y1) y1 = c[i][1];
  }
  return { x0, y0, x1, y1 };
}
function aabbUnion(list) {
  if (!list || !list.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, y0, x1, y1 };
}
function aabbsOverlap(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}
window.rotatedCorners = rotatedCorners;
window.elementAABB = elementAABB;
window.aabbUnion = aabbUnion;
window.aabbsOverlap = aabbsOverlap;
