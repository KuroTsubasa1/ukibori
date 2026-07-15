"use strict";
// Pure 2D-workbench viewport math (zoom & pan). No DOM.
// The workbench view is defined by {scale (px/mm), viewX0/viewY0 (mm origin),
// marginPx}; canvas px = marginPx + (mm - view origin) * scale.

// Anchored zoom: returns the new view origin so the mm point under the cursor
// (canvas-buffer px) stays under the cursor across a scale change.
function zoomAnchoredOrigin(origin, cursorPx, cursorPy, scaleOld, scaleNew, marginPx) {
  const mmx = (cursorPx - marginPx) / scaleOld + origin.x0;
  const mmy = (cursorPy - marginPx) / scaleOld + origin.y0;
  return {
    x0: mmx - (cursorPx - marginPx) / scaleNew,
    y0: mmy - (cursorPy - marginPx) / scaleNew,
  };
}

// Clamp a view origin so the visible mm window stays on the domain. When the
// window is larger than the domain on an axis, the domain is centered instead.
function clampViewOrigin(origin, domain, visWmm, visHmm) {
  const one = (v, lo, hi) => hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
  return {
    x0: one(origin.x0, domain.x0, domain.x0 + domain.wMm - visWmm),
    y0: one(origin.y0, domain.y0, domain.y0 + domain.hMm - visHmm),
  };
}

window.zoomAnchoredOrigin = zoomAnchoredOrigin;
window.clampViewOrigin = clampViewOrigin;
