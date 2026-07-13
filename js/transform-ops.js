"use strict";
// Pure multiselect/group transform math. Each function takes an array of "start"
// snapshots {id,cxMm,cyMm,wMm,hMm,rotationDeg} and returns updated snapshots.
function selectionBBox(elements) {
  return aabbUnion((elements || []).map(elementAABB));
}
function applyMove(starts, dxMm, dyMm) {
  return (starts || []).map(function (s) {
    return { id: s.id, cxMm: s.cxMm + dxMm, cyMm: s.cyMm + dyMm, wMm: s.wMm, hMm: s.hMm, rotationDeg: s.rotationDeg };
  });
}
function applyScale(starts, pivot, k) {
  return (starts || []).map(function (s) {
    return {
      id: s.id,
      cxMm: pivot.x + (s.cxMm - pivot.x) * k,
      cyMm: pivot.y + (s.cyMm - pivot.y) * k,
      wMm: Math.max(2, s.wMm * k), hMm: Math.max(2, s.hMm * k),
      rotationDeg: s.rotationDeg,
    };
  });
}
function applyRotate(starts, center, thetaDeg) {
  const a = thetaDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return (starts || []).map(function (s) {
    const dx = s.cxMm - center.x, dy = s.cyMm - center.y;
    return {
      id: s.id,
      cxMm: center.x + dx * ca - dy * sa,
      cyMm: center.y + dx * sa + dy * ca,
      wMm: s.wMm, hMm: s.hMm,
      rotationDeg: s.rotationDeg + thetaDeg,
    };
  });
}
window.selectionBBox = selectionBBox;
window.applyMove = applyMove;
window.applyScale = applyScale;
window.applyRotate = applyRotate;
