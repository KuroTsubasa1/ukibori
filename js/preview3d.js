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
    scene.background = new THREE.Color(0xcccccc); // P1: lighter grey for better model contrast.
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

  let renderer = null, camera = null, current = null, raf = 0, active = false;
  let getPartsFn = null, canvasEl = null;
  const orbit = { theta: 0.9, phi: 1.0, radius: 100, center: null }; // center set in fitCamera (after THREE loads)

  function renderOnce() {
    if (renderer && current) renderer.render(current.scene, camera);
  }
  function loop() { if (!active) return; renderOnce(); raf = requestAnimationFrame(loop); }

  function fitCamera(built) {
    const c = new THREE.Vector3(built.center[0], built.center[1], built.center[2]);
    const maxDim = Math.max(built.size[0], built.size[1], built.size[2]) || 50;
    orbit.center = c; orbit.radius = maxDim * 2.2;
    api.orbitCamera(camera, c, orbit.radius, orbit.theta, orbit.phi);
  }

  api.rebuild = function () {
    if (!active || !getPartsFn) return;
    const parts = (getPartsFn() || {}).parts || [];
    current = api.buildPreviewScene(parts);
    if (!orbit.center) fitCamera(current); else api.orbitCamera(camera, orbit.center, orbit.radius, orbit.theta, orbit.phi);
    renderOnce();
  };

  function resize() {
    if (!renderer || !canvasEl) return;
    const w = canvasEl.clientWidth || 480, h = canvasEl.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderOnce();
  }

  api.show = async function (canvas, getParts) {
    canvasEl = canvas; getPartsFn = getParts; active = true;
    await api.loadThree();
    if (!active) { canvas.hidden = true; return; }
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
      attachOrbit(canvas);
    }
    canvas.hidden = false;
    resize();
    window.addEventListener('resize', resize);
    const parts = (getParts() || {}).parts || [];
    current = api.buildPreviewScene(parts);
    fitCamera(current);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    loop();
  };
  api.hide = function () { active = false; if (raf) cancelAnimationFrame(raf); raf = 0; window.removeEventListener('resize', resize); if (canvasEl) canvasEl.hidden = true; };
  api.isActive = function () { return active; };

  function attachOrbit(canvas) {
    let dragging = false, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging || !orbit.center) return;
      orbit.theta -= (e.clientX - lx) * 0.01; orbit.phi -= (e.clientY - ly) * 0.01;
      orbit.phi = Math.max(0.05, Math.min(Math.PI - 0.05, orbit.phi));
      lx = e.clientX; ly = e.clientY;
      api.orbitCamera(camera, orbit.center, orbit.radius, orbit.theta, orbit.phi); renderOnce();
    });
    const end = () => { dragging = false; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); if (!orbit.center) return;
      orbit.radius = Math.max(1, orbit.radius * (e.deltaY < 0 ? 0.92 : 1.08));
      api.orbitCamera(camera, orbit.center, orbit.radius, orbit.theta, orbit.phi); renderOnce();
    }, { passive: false });
  }

  window.preview3d = api;
})();
