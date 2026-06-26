"use strict";
// Local ML background removal via u2netp (onnxruntime-web). Everything runs in
// the browser; the runtime + model are lazy-loaded on first use so they don't
// burden initial page load. Wrapped in an IIFE; only window.removeBackground is
// exposed. Any load/inference failure throws a German Error for the UI to show.
(function () {
  const SIZE = 320;
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  let sessionPromise = null;

  function loadOrt() {
    if (window.ort) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/ort.min.js';
      s.onload = () => res();
      s.onerror = () => rej(new Error('KI-Laufzeit (ort.min.js) konnte nicht geladen werden.'));
      document.head.appendChild(s);
    });
  }

  function getSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = loadOrt().then(() => {
      window.ort.env.wasm.wasmPaths = 'vendor/';
      window.ort.env.wasm.numThreads = 1;
      window.ort.env.wasm.simd = true;
      return window.ort.InferenceSession.create('vendor/u2netp.onnx', { executionProviders: ['wasm'] });
    }).catch((e) => {
      sessionPromise = null; // allow a later retry
      throw new Error('KI-Modell konnte nicht geladen werden (Modell/Laufzeit fehlt?).');
    });
    return sessionPromise;
  }

  // source ImageData -> Float32 NCHW [1,3,320,320] (rembg-style normalization)
  function preprocess(imageData) {
    const src = document.createElement('canvas');
    src.width = imageData.width; src.height = imageData.height;
    src.getContext('2d').putImageData(imageData, 0, 0);
    const cv = document.createElement('canvas'); cv.width = SIZE; cv.height = SIZE;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, SIZE, SIZE);
    const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
    let mx = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > mx) mx = d[i]; if (d[i+1] > mx) mx = d[i+1]; if (d[i+2] > mx) mx = d[i+2]; }
    if (mx === 0) mx = 1;
    const plane = SIZE * SIZE;
    const out = new Float32Array(3 * plane);
    for (let p = 0, j = 0; p < plane; p++, j += 4) {
      out[p]           = (d[j] / mx     - MEAN[0]) / STD[0];
      out[plane + p]   = (d[j+1] / mx   - MEAN[1]) / STD[1];
      out[2*plane + p] = (d[j+2] / mx   - MEAN[2]) / STD[2];
    }
    return out;
  }

  // matte tensor [.,.,320,320] -> alpha applied over a copy of the source pixels
  function applyMatte(matteData, imageData) {
    const N = SIZE * SIZE;
    let mn = Infinity, mxv = -Infinity;
    for (let i = 0; i < N; i++) { const v = matteData[i]; if (v < mn) mn = v; if (v > mxv) mxv = v; }
    const range = (mxv - mn) || 1;
    const m = document.createElement('canvas'); m.width = SIZE; m.height = SIZE;
    const mctx = m.getContext('2d');
    const gid = mctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < N; i++) {
      const a = Math.round(((matteData[i] - mn) / range) * 255);
      gid.data[i*4] = gid.data[i*4+1] = gid.data[i*4+2] = a; gid.data[i*4+3] = 255;
    }
    mctx.putImageData(gid, 0, 0);
    const r = document.createElement('canvas'); r.width = imageData.width; r.height = imageData.height;
    const rctx = r.getContext('2d', { willReadFrequently: true });
    rctx.drawImage(m, 0, 0, imageData.width, imageData.height);
    const matte = rctx.getImageData(0, 0, imageData.width, imageData.height).data;
    const result = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    for (let i = 0; i < result.data.length; i += 4) result.data[i + 3] = matte[i];
    return result;
  }

  async function removeBackground(imageData) {
    const sess = await getSession();
    const input = preprocess(imageData);
    const feeds = {};
    feeds[sess.inputNames[0]] = new window.ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
    const results = await sess.run(feeds);
    const out = results[sess.outputNames[0]];
    if (!out || !out.data) throw new Error('KI-Freistellung fehlgeschlagen.');
    return applyMatte(out.data, imageData);
  }
  window.removeBackground = removeBackground;
})();
