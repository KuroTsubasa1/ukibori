"use strict";
// Pure align/distribute. Operate on rotated AABBs; return new centers only.
function alignElements(elements, edge) {
  const boxes = elements.map(function (el) { return { el: el, bb: elementAABB(el) }; });
  const g = aabbUnion(boxes.map(function (b) { return b.bb; }));
  const gcx = (g.x0 + g.x1) / 2, gcy = (g.y0 + g.y1) / 2;
  return boxes.map(function (b) {
    const bcx = (b.bb.x0 + b.bb.x1) / 2, bcy = (b.bb.y0 + b.bb.y1) / 2;
    let dx = 0, dy = 0;
    if (edge === "left") dx = g.x0 - b.bb.x0;
    else if (edge === "right") dx = g.x1 - b.bb.x1;
    else if (edge === "top") dy = g.y0 - b.bb.y0;
    else if (edge === "bottom") dy = g.y1 - b.bb.y1;
    else if (edge === "centerH") dx = gcx - bcx;
    else if (edge === "centerV") dy = gcy - bcy;
    return { id: b.el.id, cxMm: b.el.cxMm + dx, cyMm: b.el.cyMm + dy };
  });
}
function distributeElements(elements, axis) {
  const key = axis === "v" ? "y" : "x";
  const boxes = elements.map(function (el) {
    const bb = elementAABB(el);
    return { el: el, bb: bb, lo: bb[key + "0"], hi: bb[key + "1"], size: bb[key + "1"] - bb[key + "0"] };
  });
  boxes.sort(function (p, q) { return (p.lo + p.hi) / 2 - (q.lo + q.hi) / 2; });
  if (boxes.length < 3) return boxes.map(function (b) { return { id: b.el.id, cxMm: b.el.cxMm, cyMm: b.el.cyMm }; });
  const first = boxes[0], last = boxes[boxes.length - 1];
  let inner = 0; for (let i = 1; i < boxes.length - 1; i++) inner += boxes[i].size;
  const span = last.lo - first.hi;               // free run between the fixed ends
  const gap = (span - inner) / (boxes.length - 1);
  let cursor = first.hi + gap;
  const out = {};
  for (let i = 1; i < boxes.length - 1; i++) {
    const b = boxes[i];
    const newLo = cursor, delta = newLo - b.lo;
    out[b.el.id] = delta;
    cursor = newLo + b.size + gap;
  }
  return boxes.map(function (b) {
    const d = out[b.el.id] || 0;
    return {
      id: b.el.id,
      cxMm: b.el.cxMm + (axis === "v" ? 0 : d),
      cyMm: b.el.cyMm + (axis === "v" ? d : 0),
    };
  });
}
window.alignElements = alignElements;
window.distributeElements = distributeElements;
