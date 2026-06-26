"use strict";
// Live 3D preview of the relief. three.js is vendored (UMD global THREE) and
// lazy-loaded on first use so it doesn't burden initial page load. IIFE; the
// public surface lives on window.preview3d.
(function () {
  const api = {};
  let threePromise = null;

  api.loadThree = function () {
    if (window.THREE) return Promise.resolve();
    if (threePromise) return threePromise;
    threePromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/three.min.js';
      s.onload = () => res();
      s.onerror = () => { threePromise = null; rej(new Error('3D-Bibliothek (three.js) konnte nicht geladen werden.')); };
      document.head.appendChild(s);
    });
    return threePromise;
  };

  window.preview3d = api;
})();
