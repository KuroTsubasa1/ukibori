"use strict";
// Pure selection helpers. No DOM.
function marqueeHits(elements, rect) {
  const out = [];
  for (let i = 0; i < (elements || []).length; i++) {
    const el = elements[i];
    if (el._hidden) continue;
    if (aabbsOverlap(elementAABB(el), rect)) out.push(el.id);
  }
  return out;
}
window.marqueeHits = marqueeHits;
