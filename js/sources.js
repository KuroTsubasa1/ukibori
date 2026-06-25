"use strict";
// Alternate input sources: rasterize typed text or a QR code to an ImageData
// that flows through the same pipeline as an uploaded image. Wrapped in an
// IIFE so its helpers don't collide in the shared classic-script scope.
(function () {
  // Render typed text as black-on-white ImageData. Multi-line via "\n".
  function renderText({ text, fontSize = 80, bold = true }) {
    const lines = String(text == null ? '' : text).split('\n');
    if (!lines.some(l => l.trim().length)) throw new Error('Kein Text.');
    const pad = Math.round(fontSize * 0.4);
    const lineH = Math.round(fontSize * 1.3);
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const font = `${bold ? 'bold ' : ''}${fontSize}px Arial, sans-serif`;
    ctx.font = font;
    let maxW = 1;
    for (const l of lines) maxW = Math.max(maxW, Math.ceil(ctx.measureText(l).width));
    cv.width = maxW + pad * 2;
    cv.height = lineH * lines.length + pad * 2;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    c2.fillStyle = '#fff';
    c2.fillRect(0, 0, cv.width, cv.height);
    c2.fillStyle = '#000';
    c2.font = font;
    c2.textBaseline = 'top';
    lines.forEach((l, i) => c2.fillText(l, pad, pad + i * lineH));
    return c2.getImageData(0, 0, cv.width, cv.height);
  }
  window.renderText = renderText;

  // Build the smallest QR that fits `text` at the given EC level.
  function makeQr(text, ecLevel) {
    for (let type = 1; type <= 40; type++) {
      try {
        const qr = window.qrcode(type, ecLevel);
        qr.addData(text);
        qr.make();
        return qr;
      } catch (e) { /* too long for this version — try the next */ }
    }
    throw new Error('QR: Text zu lang.');
  }

  function qrToImageData({ text, ecLevel = 'M', scale = 8, quiet = 4 }) {
    if (!String(text == null ? '' : text).length) throw new Error('Kein Text.');
    const qr = makeQr(String(text), ecLevel);
    const n = qr.getModuleCount();
    const dim = (n + quiet * 2) * scale;
    const cv = document.createElement('canvas');
    cv.width = dim; cv.height = dim;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
    return ctx.getImageData(0, 0, dim, dim);
  }
  window.qrToImageData = qrToImageData;
})();
