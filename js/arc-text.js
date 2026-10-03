"use strict";
// Arc text (Bogentext): lay the glyphs of a single line out along a circular
// arc. Pure layout math plus one canvas draw helper shared by the 2D workbench
// (editor.js drawElement) and the 3D rasterizer (build-parts.js __drawElement),
// so preview and print stay identical.

// advances: per-glyph advance widths (px). arcDeg: total arc angle; >0 arches
// up (circle center below the text), <0 arches down. fontPx pads the bounds by
// half a glyph so the layout box roughly covers the ink.
// Returns {glyphs:[{x,y,rot}], width, height} with the glyph cloud centered on
// the origin (like straight text with textAlign=center/textBaseline=middle),
// or null when the layout degenerates to straight text (no arc / no advance).
function arcTextPositions(advances, arcDeg, fontPx) {
  const total = advances.reduce(function (a, b) { return a + b; }, 0);
  const alpha = Math.min(Math.abs(arcDeg || 0), 350) * Math.PI / 180;
  if (!(total > 0) || alpha < 1e-3) return null;
  const up = arcDeg > 0;
  const R = total / alpha;
  const pts = [];
  let d = 0;
  for (let i = 0; i < advances.length; i++) {
    const phi = (d + advances[i] / 2 - total / 2) / R; // signed angle from arc middle
    // Glyph "up" points away from the circle center when arching up, toward it
    // when arching down — both read left to right and stay upright.
    pts.push({
      x: R * Math.sin(phi),
      y: up ? -R * Math.cos(phi) : R * Math.cos(phi),
      rot: up ? phi : -phi,
    });
    d += advances[i];
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const half = (fontPx || 0) / 2;
  pts.forEach(function (p) {
    x0 = Math.min(x0, p.x - half); x1 = Math.max(x1, p.x + half);
    y0 = Math.min(y0, p.y - half); y1 = Math.max(y1, p.y + half);
  });
  const bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
  return {
    glyphs: pts.map(function (p) { return { x: p.x - bx, y: p.y - by, rot: p.rot }; }),
    width: x1 - x0, height: y1 - y0,
  };
}

// Draws text along an arc, centered on the current origin. The caller must
// have set the same ctx state straight text uses (font, fillStyle,
// textAlign=center, textBaseline=middle); falls back to plain fillText when
// the arc degenerates.
function drawArcText(ctx, text, arcDeg, fontPx) {
  const chars = Array.from(text); // code points — keeps umlauts/emoji intact
  const advances = chars.map(function (ch) { return ctx.measureText(ch).width; });
  const layout = arcTextPositions(advances, arcDeg, fontPx);
  if (!layout) { ctx.fillText(text, 0, 0); return; }
  for (let i = 0; i < chars.length; i++) {
    const g = layout.glyphs[i];
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
}

window.arcTextPositions = arcTextPositions;
window.drawArcText = drawArcText;
