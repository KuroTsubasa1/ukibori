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

  api.facetsToPositions = function (facets) {
    const pos = new Float32Array(facets.length * 9);
    let o = 0;
    for (const f of facets) for (const v of f) { pos[o++] = v[0]; pos[o++] = v[1]; pos[o++] = v[2]; }
    return pos;
  };

  api.buildPreviewScene = function (parts) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16161a);
    let meshCount = 0;
    for (const part of parts) {
      if (!part.facets || !part.facets.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(api.facetsToPositions(part.facets), 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color[0] / 255, part.color[1] / 255, part.color[2] / 255),
        roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
      });
      scene.add(new THREE.Mesh(geo, mat));
      meshCount++;
    }
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(0.4, -0.7, 1.0);
    scene.add(dir);
    const box = new THREE.Box3().setFromObject(scene);
    const c = new THREE.Vector3(), s = new THREE.Vector3();
    if (box.isEmpty()) { c.set(0, 0, 0); s.set(0, 0, 0); }
    else { box.getCenter(c); box.getSize(s); }
    return { scene, meshCount, center: [c.x, c.y, c.z], size: [s.x, s.y, s.z] };
  };

  // Place camera on a z-up sphere around `center` (z = relief height = up).
  api.orbitCamera = function (camera, center, radius, theta, phi) {
    const sp = Math.max(0.05, Math.min(Math.PI - 0.05, phi));
    camera.up.set(0, 0, 1);
    camera.position.set(
      center.x + radius * Math.sin(sp) * Math.cos(theta),
      center.y + radius * Math.sin(sp) * Math.sin(theta),
      center.z + radius * Math.cos(sp)
    );
    camera.lookAt(center.x, center.y, center.z);
  };

  window.preview3d = api;
})();
