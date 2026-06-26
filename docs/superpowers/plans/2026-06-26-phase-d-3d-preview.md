# Ukibori Phase D — Live 3D Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rotatable, zoomable 3D preview of the relief — rendering the exact `buildParts()` output so what you see is what prints — toggled from the relief preview area.

**Architecture:** Vendor three.js (UMD `THREE` global) locally, lazy-loaded on first 3D toggle. A new `js/preview3d.js` (IIFE) converts `buildParts()` parts into a `THREE.Scene` (one colored mesh per part), frames a camera to the bounding box, and renders into a canvas with a small hand-written orbit control (drag-rotate, wheel-zoom). A 2D⇄3D toggle in the relief preview swaps the existing `#output` canvas for the 3D canvas; the scene rebuilds (debounced) when a geometry-affecting control changes while 3D is active.

**Tech Stack:** Vanilla JS (classic `<script>` tags), vendored three.js r148 (MIT, UMD global), Playwright MCP `browser_evaluate` for verification.

## Global Constraints

- No build step, no framework. New vendored dependency permitted: `vendor/three.min.js` (three.js r0.148.0, MIT, UMD — exposes global `THREE`, no ES-module/import needed). Loaded locally — no CDN at runtime; lazy-loaded (not on initial page load).
- r148 is chosen deliberately: it is UMD (fits classic scripts) and does NOT emit the r150+ deprecation `console.warn` — so console stays clean.
- All in-browser; no network at runtime.
- New functions exposed on `window` (or `window.preview3d`) for `browser_evaluate` verification.
- UI copy is German.
- Applies to RELIEF mode only. Must not affect bookmark (Lesezeichen) mode and must not regress any existing relief feature (2D preview, circle/mount drag, export dialog, B/W + color 3D, stamp, transparency).
- Preview renders the SAME `buildParts()` array the exporter uses (preview == print).
- Verification: serve repo root on **port 8001** (`python3 -m http.server 8001`); navigate `http://localhost:8001/?nocache=<n>` (vary after edits); bust cache via the navigate URL only, NEVER by editing committed `<script>`/`<link>` tags. Check `browser_console_messages` clean after load/init changes.

### Sample parts (for GL-free tests)

A minimal parts array (two triangles, one red part) for tests that don't need a real image:

```js
const SAMPLE_PARTS = [{ name: 'p0', color: [200, 30, 30], facets: [
  [[0,0,0],[10,0,0],[0,10,2]],
  [[10,0,0],[10,10,2],[0,10,2]],
] }];
```

---

### Task 1: Vendor three.js + lazy loader + smoke test

**Files:**
- Create (downloaded): `vendor/three.min.js`
- Create: `js/preview3d.js` (initially just the loader; expanded in Task 2/3)
- Modify: `index.html` (load `js/preview3d.js` after `js/presets.js`)

**Interfaces:**
- Produces: `window.preview3d.loadThree() -> Promise<void>` — lazy-injects `vendor/three.min.js` once; resolves when `window.THREE` is available; rejects with a German error if it can't load.

- [ ] **Step 1: Download three.js into vendor/**

```bash
mkdir -p vendor
curl -fsSL -o vendor/three.min.js "https://cdn.jsdelivr.net/npm/three@0.148.0/build/three.min.js"
head -c 120 vendor/three.min.js   # expect the three.js Copyright banner; r148 emits NO deprecation warning
wc -c vendor/three.min.js          # expect ~608313 bytes
```
If blocked, STOP and report BLOCKED with the exact command.

- [ ] **Step 2: Create js/preview3d.js with the loader**

```js
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
```

In `index.html`, add after `js/presets.js`:

```html
<script src="js/preview3d.js"></script>
```

- [ ] **Step 3: Smoke test**

Serve on 8001, navigate `http://localhost:8001/?nocache=1`, `browser_evaluate` (async):

```js
async () => {
  if (!window.preview3d || typeof window.preview3d.loadThree !== 'function') throw new Error('preview3d.loadThree missing');
  await window.preview3d.loadThree();
  if (!window.THREE || !THREE.REVISION) throw new Error('THREE global not available');
  // CPU-side objects must construct (no WebGL context needed)
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
  new THREE.Box3().setFromObject(s);
  return 'ok r' + THREE.REVISION;
}
```

Expected: returns `'ok r148'`. Check `browser_console_messages` is CLEAN (r148 must NOT emit a deprecation warning — if it does, you have the wrong version; re-download r0.148.0).

- [ ] **Step 4: Commit**

```bash
git add vendor/three.min.js js/preview3d.js index.html
git commit -m "build: vendor three.js (r148, UMD) + lazy loader for 3D preview"
```

---

### Task 2: Scene builder (GL-free) + orbit math

**Files:**
- Modify: `js/preview3d.js`

**Interfaces:**
- Consumes: `THREE` (loaded), parts array `[{name,color:[r,g,b],facets}]`.
- Produces (on `window.preview3d`):
  - `facetsToPositions(facets) -> Float32Array` — flat triangle positions, length `facets.length*9`.
  - `buildPreviewScene(parts) -> { scene, meshCount, center:[x,y,z], size:[x,y,z] }` — a `THREE.Scene` with one mesh per non-empty part (colored), plus ambient + directional light; `center`/`size` from the model bounding box. (No `WebGLRenderer` — pure scene graph, testable without a GL context.)
  - `orbitCamera(camera, center, radius, theta, phi)` — positions `camera` on a z-up sphere around `center` and points it at `center` (used by Task 3's orbit).

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload; async):

```js
async () => {
  await window.preview3d.loadThree();
  const P = window.preview3d;
  if (typeof P.facetsToPositions !== 'function' || typeof P.buildPreviewScene !== 'function' || typeof P.orbitCamera !== 'function')
    throw new Error('Task 2 functions missing');
  const SAMPLE_PARTS = [{ name: 'p0', color: [200,30,30], facets: [
    [[0,0,0],[10,0,0],[0,10,2]], [[10,0,0],[10,10,2],[0,10,2]] ] }];
  const pos = P.facetsToPositions(SAMPLE_PARTS[0].facets);
  if (pos.length !== 2 * 9) throw new Error('positions length ' + pos.length);
  if (pos[3] !== 10) throw new Error('second vertex x should be 10, got ' + pos[3]);
  const built = P.buildPreviewScene(SAMPLE_PARTS);
  if (built.meshCount !== 1) throw new Error('meshCount ' + built.meshCount);
  if (!(built.size[0] > 0 && built.size[1] > 0)) throw new Error('bad bbox size ' + built.size);
  if (!isFinite(built.center[0])) throw new Error('bad center');
  // orbit: camera ends up at finite position, not at the center
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  P.orbitCamera(cam, new THREE.Vector3(0,0,0), 50, 0.6, 1.0);
  if (!isFinite(cam.position.x) || cam.position.length() < 1) throw new Error('orbit camera not placed');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `Task 2 functions missing`.

- [ ] **Step 3: Write minimal implementation**

In `js/preview3d.js`, inside the IIFE (before `window.preview3d = api;`), add:

```js
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
    box.getCenter(c); box.getSize(s);
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
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Console clean.

- [ ] **Step 5: Commit**

```bash
git add js/preview3d.js
git commit -m "feat: 3D preview scene builder (parts -> THREE scene) + orbit math"
```

---

### Task 3: 2D⇄3D toggle, renderer, orbit interaction

**Files:**
- Modify: `index.html` (a 2D/3D toggle + a 3D canvas in `#preview`)
- Modify: `styles.css` (3D canvas sizing)
- Modify: `js/preview3d.js` (renderer, render loop, orbit pointer/wheel, `show`/`hide`/`rebuild`)
- Modify: `js/app.js` (toggle wiring; debounced rebuild on geometry-control change; hide on mode/bookmark switch)

**Interfaces:**
- Consumes: `buildParts()` (global), `preview3d.loadThree`/`buildPreviewScene`/`orbitCamera`.
- Produces (on `window.preview3d`): `show(canvas, getParts) -> Promise<void>` (lazy-loads three, builds scene from `getParts()`, starts render loop + orbit on `canvas`), `hide()` (stops loop), `rebuild()` (re-reads `getParts()` and rebuilds the scene), `isActive() -> boolean`.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload; async). Uses a synthetic image so `buildParts()` returns geometry:

```js
async () => {
  if (!document.getElementById('view3dBtn')) throw new Error('#view3dBtn missing');
  if (!document.getElementById('preview3dCanvas')) throw new Error('#preview3dCanvas missing');
  // load a synthetic relief image
  window.setMode('bw');
  const w = 24, h = 24, id = new ImageData(w, h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){ const i=(y*w+x)*4; const v=(x<w/2)?0:255; id.data[i]=id.data[i+1]=id.data[i+2]=v; id.data[i+3]=255; }
  window.els.keepAlpha.checked=false; window.els.circleEnable.checked=false;
  window.adoptImageData(id, 't');
  window.els.thickBlack.value=3; window.els.thickWhite.value=3;
  // toggle to 3D
  document.getElementById('view3dBtn').click();
  await new Promise(r=>setTimeout(r,300));
  if (!window.preview3d.isActive()) throw new Error('3D not active after toggle');
  const cv = document.getElementById('preview3dCanvas');
  if (cv.hidden) throw new Error('3D canvas still hidden');
  // back to 2D
  document.getElementById('view2dBtn').click();
  await new Promise(r=>setTimeout(r,50));
  if (window.preview3d.isActive()) throw new Error('still active after 2D toggle');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `#view3dBtn missing`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, inside `#preview` (the relief preview `<section>`), add a view toggle and the 3D canvas alongside `#output`:

```html
      <div class="view-toggle seg-group seg-sm" role="tablist" aria-label="Ansicht">
        <button type="button" id="view2dBtn" class="seg seg-active">2D</button>
        <button type="button" id="view3dBtn" class="seg">3D</button>
      </div>
      <canvas id="preview3dCanvas" hidden></canvas>
```

In `styles.css` (append): 
```css
#preview3dCanvas { width: 100%; height: 100%; min-height: 360px; display: block; border-radius: 12px; touch-action: none; }
.view-toggle { position: absolute; top: 12px; right: 12px; z-index: 2; }
.preview { position: relative; }
```

In `js/preview3d.js`, inside the IIFE add the renderer/loop/orbit + show/hide/rebuild:

```js
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
  }

  api.show = async function (canvas, getParts) {
    await api.loadThree();
    canvasEl = canvas; getPartsFn = getParts; active = true;
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
      attachOrbit(canvas);
    }
    canvas.hidden = false;
    resize();
    const parts = (getParts() || {}).parts || [];
    current = api.buildPreviewScene(parts);
    fitCamera(current);
    loop();
  };
  api.hide = function () { active = false; if (raf) cancelAnimationFrame(raf); raf = 0; if (canvasEl) canvasEl.hidden = true; };
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
```

In `js/app.js`:
- Add to `els`: `view2dBtn`, `view3dBtn`, `preview3dCanvas` (via getElementById).
- Add the toggle + rebuild wiring (near the other relief wiring):

```js
function showView3d() {
  els.view2dBtn.classList.remove('seg-active'); els.view3dBtn.classList.add('seg-active');
  els.output.hidden = true;
  preview3d.show(els.preview3dCanvas, () => (processedData ? buildParts() : { parts: [] }))
    .catch(e => { setStatus(e.message || '3D-Vorschau nicht verfügbar.', true); showView2d(); });
}
function showView2d() {
  els.view3dBtn.classList.remove('seg-active'); els.view2dBtn.classList.add('seg-active');
  if (window.preview3d) preview3d.hide();
  els.output.hidden = false;
  paint();
}
window.showView3d = showView3d; window.showView2d = showView2d;
els.view3dBtn.addEventListener('click', showView3d);
els.view2dBtn.addEventListener('click', showView2d);

// Rebuild the 3D scene (debounced) when a geometry-affecting control changes while 3D is shown.
let rebuild3dT = null;
function maybeRebuild3d() {
  if (!window.preview3d || !preview3d.isActive()) return;
  clearTimeout(rebuild3dT); rebuild3dT = setTimeout(() => preview3d.rebuild(), 150);
}
document.addEventListener('input', maybeRebuild3d);
```

- Ensure switching to bookmark mode or reloading an image hides 3D: in the relief render path, after `render()` (or in `adoptImageData`), if 3D is active call `preview3d.rebuild()`. And bookmark's `setAppMode(true)` should hide 3D — add a guard: in `showView3d`/`maybeRebuild3d` we already no-op when not active; to be safe, when `setMode`/source changes occur, `maybeRebuild3d()` covers it via the global `input` listener. For app-mode switch to bookmark, call `showView2d()` if leaving relief — wire this minimally:

```js
if (els.appModeBookmark) els.appModeBookmark.addEventListener('click', () => { if (window.preview3d) preview3d.hide(); });
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Check `browser_console_messages` clean. Then `browser_take_screenshot` of the 3D view (load an image, click 3D) to VISUALLY confirm a shaded relief renders; note it in the report. (If headless WebGL is unavailable the renderer may warn — capture the exact message; a software-GL context is expected to work in Playwright Chromium.)

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css js/preview3d.js js/app.js
git commit -m "feat: 2D/3D preview toggle with rotatable three.js view"
```

---

## Self-Review

**Spec coverage (Phase D — feature #1 live 3D preview):**
- Vendored three.js, lazy-loaded, offline → Task 1 ✓
- Renders exact `buildParts()` output (preview == print), one colored mesh per part → Task 2 `buildPreviewScene` + Task 3 `show`/`rebuild` ✓
- 2D⇄3D toggle in the relief preview → Task 3 ✓
- Orbit (drag-rotate, wheel-zoom) → Task 2 `orbitCamera` + Task 3 `attachOrbit` ✓
- Debounced rebuild on control change; works for B/W and color (both go through `buildParts`) → Task 3 ✓

**Placeholder scan:** No TBD/TODO; complete code each step. ✓

**Type consistency:**
- `facetsToPositions(facets)->Float32Array`, `buildPreviewScene(parts)->{scene,meshCount,center,size}`, `orbitCamera(camera,center,radius,theta,phi)` — produced Task 2, consumed Task 3. ✓
- `preview3d.show(canvas,getParts)`/`hide()`/`rebuild()`/`isActive()` — produced Task 3, consumed by app.js wiring. `getParts()` returns `buildParts()`'s `{parts}` shape. ✓
- `loadThree()->Promise` — Task 1, consumed Task 2/3. ✓

**No regression:** three.js loads only on first 3D toggle (not initial page load). The 3D canvas is hidden by default; `#output` (2D) is the default view. `preview3d` is an IIFE exposing only `window.preview3d` — no scope collision. Bookmark mode hides 3D. The global `input` listener only acts when `preview3d.isActive()`. ✓

**Known risk:** headless WebGL — `WebGLRenderer` needs a GL context; Playwright Chromium provides software GL, so it should work, but the structural assertions (Task 3 toggles + `isActive` + canvas visibility; Task 2 scene graph) don't depend on pixels. Visual correctness is confirmed via a screenshot in Task 3 Step 4. If a GL context cannot be created in the test env, the `show()` catch surfaces a German status and reverts to 2D (graceful), and that path should be noted in the report.
