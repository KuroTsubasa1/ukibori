# Ukibori Phase A — Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add STL export, a live dimensions readout, preset save/restore, and a stamp mode to Ukibori, on top of a `buildParts()` refactor that becomes the shared geometry source for all later phases.

**Architecture:** Extract the existing `exportModel` geometry-building into a pure `buildParts()` that returns `{parts, stats}`; `.3mf`, the new STL export, and (later) the 3D preview all consume it. Stamp mode and presets are wired through `app.js`; presets live in a new `js/presets.js`. STL serialization lives in `js/geometry.js` beside `build3MF`.

**Tech Stack:** Vanilla JS (no build, no framework), browser `localStorage`, Playwright MCP `browser_evaluate` for verification against `window`-exposed functions.

## Global Constraints

- No build step, no framework, no external runtime dependency in Phase A — vanilla JS only, loaded directly from `index.html`.
- All processing stays in the browser; no network, no upload.
- UI copy is German, matching existing strings (e.g. `setStatus` messages, labels).
- Expose new pure functions on `window` for `browser_evaluate` verification, matching the existing pattern at the bottom of `app.js`.
- The existing B/W → `.3mf`, PNG export, circle crop, and transparency behavior must not regress.
- Verification runs against a local server: `python3 -m http.server 8000` in the repo root, Playwright navigates to `http://localhost:8000/`.

### Shared test helper (used by several tasks)

Several tasks load a synthetic image instead of a file. This snippet (run inside `browser_evaluate`) puts a 4×4 image — left half black, right half white — into the pipeline and renders it:

```js
function loadSynthetic() {
  const w = 4, h = 4, id = new ImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = x < 2 ? 0 : 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
  }
  window.originalData = id;
  // mirror the load-completion side effects buildFields/exportData depend on:
  window.els.circleEnable.checked = false;
  window.render();
}
```

---

### Task 1: Extract `buildParts()` from `exportModel`

Behavior-preserving refactor. `buildParts()` becomes the single source of geometry for `.3mf`, STL, and the future 3D preview.

**Files:**
- Modify: `js/app.js:295-331` (the `exportModel` function and its `window.exportModel` export)

**Interfaces:**
- Consumes: `buildFields`, `fieldFacets`, `orientOutward`, `hexToRgb`, `els`, `mode`, `processedData` (all existing).
- Produces:
  - `buildParts() -> { parts: Array<{name: string, color: [number,number,number], facets: Array}>, stats: { tris: number } }`. Returns `{ parts: [], stats: { tris: 0 } }` when there is no model (no image, or `mode !== 'bw'`).
  - `exportModel()` unchanged externally (still downloads `modell.3mf`).
  - Both exposed on `window`.

- [ ] **Step 1: Write the failing test**

Start the server (`python3 -m http.server 8000`), navigate to `http://localhost:8000/`, then `browser_evaluate`:

```js
() => {
  function loadSynthetic() {
    const w = 4, h = 4, id = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, v = x < 2 ? 0 : 255;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    window.originalData = id; window.els.circleEnable.checked = false; window.render();
  }
  if (typeof window.buildParts !== 'function') throw new Error('buildParts not defined');
  loadSynthetic();
  window.els.thickBlack.value = 3; window.els.thickWhite.value = 3;
  const { parts, stats } = window.buildParts();
  const names = parts.map(p => p.name);
  if (!names.includes('schwarz') || !names.includes('weiss')) throw new Error('expected schwarz+weiss, got ' + names.join(','));
  if (!(stats.tris > 0)) throw new Error('expected triangles');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `buildParts not defined`.

- [ ] **Step 3: Write minimal implementation**

In `js/app.js`, replace the body of `exportModel` (lines ~295-331) with a split:

```js
// Builds the colored parts for the current B/W result. Shared by .3mf, STL,
// and the 3D preview so preview == print. Returns empty parts when there is
// nothing to build (no image, or not in B/W mode).
function buildParts() {
  if (!processedData || mode !== 'bw') return { parts: [], stats: { tris: 0 } };
  const maxDim = Number(els.modelRes.value);
  const { cols, rows, pitch, fBase, fBlack, fWhite, fRing } = buildFields(maxDim);
  const tol = Number(els.modelSmooth.value) * pitch; // slider is in cells
  const baseT = Number(els.baseThick.value);
  const bodyColor = hexToRgb(els.bodyColor.value);
  const facets = (f, thick, z0) => orientOutward(fieldFacets(f, cols, rows, pitch, thick, tol, z0));
  const parts = [];
  const baseF = facets(fBase, baseT, 0);
  if (baseF.length) parts.push({ name: 'grundplatte', color: bodyColor, facets: baseF });
  const blackF = facets(fBlack, Number(els.thickBlack.value), baseT);
  if (blackF.length) parts.push({ name: 'schwarz', color: [0, 0, 0], facets: blackF });
  const whiteF = facets(fWhite, Number(els.thickWhite.value), baseT);
  if (whiteF.length) parts.push({ name: 'weiss', color: [255, 255, 255], facets: whiteF });
  if (fRing) {
    const randColor = els.circleEnable.checked ? hexToRgb(els.circleColor.value) : bodyColor;
    const ringF = facets(fRing, Number(els.ringThick.value), baseT);
    if (ringF.length) parts.push({ name: 'rand', color: randColor, facets: ringF });
  }
  const tris = parts.reduce((s, p) => s + p.facets.length, 0);
  return { parts, stats: { tris } };
}
window.buildParts = buildParts;

// Builds the model from buildParts() and downloads it as a .3mf.
function exportModel() {
  const { parts, stats } = buildParts();
  if (!parts.length) {
    setStatus('Kein 3D-Modell: keine passenden Flächen gefunden.', true);
    return;
  }
  const blob = build3MF(parts);
  const a = document.createElement('a');
  a.download = 'modell.3mf';
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`3D-Modell (.3mf) exportiert: ${parts.length} Teile, ${stats.tris} Dreiecke.`, false);
}
window.exportModel = exportModel;
```

- [ ] **Step 4: Run test to verify it passes**

Re-run the Step 1 `browser_evaluate` (reload the page first). Expected: returns `'ok'`.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "refactor: extract buildParts() as shared geometry source"
```

---

### Task 2: Binary STL export

**Files:**
- Modify: `js/geometry.js` (add `facetsToBinarySTL` near `build3MF`, ~line 488; add `window.facetsToBinarySTL`)
- Modify: `js/app.js` (add `els.stlExport`, an export handler, and `window` export)
- Modify: `index.html` (add the STL button next to the `.3mf` button, ~line 185)

**Interfaces:**
- Consumes: `buildParts()` (Task 1).
- Produces: `facetsToBinarySTL(facets) -> Uint8Array` (binary STL bytes for a flat list of `[[x,y,z],[x,y,z],[x,y,z]]` triangles, computed per-facet normals).

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  if (typeof window.facetsToBinarySTL !== 'function') throw new Error('facetsToBinarySTL not defined');
  const facets = [
    [[0,0,0],[1,0,0],[0,1,0]],
    [[0,0,1],[0,1,1],[1,0,1]],
  ];
  const buf = window.facetsToBinarySTL(facets);
  if (!(buf instanceof Uint8Array)) throw new Error('expected Uint8Array');
  if (buf.length !== 84 + 50 * 2) throw new Error('wrong length ' + buf.length);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(80, true);
  if (count !== 2) throw new Error('triangle count ' + count);
  // first vertex of first facet at offset 84 + 12 (after the normal)
  const x = dv.getFloat32(84 + 12, true);
  if (x !== 0) throw new Error('vertex x ' + x);
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `facetsToBinarySTL not defined`.

- [ ] **Step 3: Write minimal implementation**

In `js/geometry.js`, add after `build3MF`:

```js
// Serialize a flat list of triangle facets ([[x,y,z]x3]) to binary STL bytes.
// STL is colorless: callers union all parts' facets. Normals are computed
// per facet (right-hand rule); slicers tolerate/recompute them anyway.
function facetsToBinarySTL(facets) {
  const buf = new ArrayBuffer(84 + 50 * facets.length);
  const dv = new DataView(buf);
  dv.setUint32(80, facets.length, true);
  let o = 84;
  for (const f of facets) {
    const [a, b, c] = f;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of f) {
      dv.setFloat32(o, v[0], true); dv.setFloat32(o + 4, v[1], true); dv.setFloat32(o + 8, v[2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}
window.facetsToBinarySTL = facetsToBinarySTL;
```

In `index.html`, after the `.3mf` export button block (~line 185-187), add:

```html
              <div class="field">
                <button id="stlExport" class="btn" disabled>3D-Modell (.stl)</button>
                <span class="hint">Geometrie ohne Farben · universell für jeden Slicer</span>
              </div>
```

In `js/app.js`:
- Add to the `els` object: `stlExport: document.getElementById('stlExport'),`
- Add `els.stlExport` to the `enableControls` disable list array.
- Add the handler near `els.modelExport.addEventListener` (~line 518):

```js
function exportSTL() {
  const { parts, stats } = buildParts();
  if (!parts.length) {
    setStatus('Kein 3D-Modell: keine passenden Flächen gefunden.', true);
    return;
  }
  const all = [];
  for (const p of parts) for (const f of p.facets) all.push(f);
  const blob = new Blob([facetsToBinarySTL(all)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.download = 'modell.stl';
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`3D-Modell (.stl) exportiert: ${stats.tris} Dreiecke.`, false);
}
window.exportSTL = exportSTL;
els.stlExport.addEventListener('click', exportSTL);
```

- [ ] **Step 4: Run test to verify it passes**

Re-run the Step 1 `browser_evaluate` (reload). Expected: `'ok'`.

- [ ] **Step 5: Commit**

```bash
git add js/geometry.js js/app.js index.html
git commit -m "feat: binary STL export"
```

---

### Task 3: Live dimensions readout

**Files:**
- Modify: `index.html` (add a readout element in the 3D-Modell accordion, after the export buttons)
- Modify: `js/app.js` (add `els.dims`, `computeDimensions`, `updateDims`, call it on relevant input + after render)

**Interfaces:**
- Consumes: `buildFields` (for aspect), `els`, `processedData`.
- Produces: `computeDimensions() -> { w: number, h: number, t: number } | null` (mm; `null` when no image). `updateDims()` writes the formatted string into `#dims`.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  function loadSynthetic() {
    const w = 4, h = 4, id = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, v = x < 2 ? 0 : 255;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    window.originalData = id; window.els.circleEnable.checked = false; window.render();
  }
  if (typeof window.computeDimensions !== 'function') throw new Error('computeDimensions not defined');
  loadSynthetic();
  window.els.modelWidth.value = 80;
  window.els.baseThick.value = 2;
  window.els.thickBlack.value = 3;
  window.els.thickWhite.value = 1;
  const d = window.computeDimensions();
  if (Math.abs(d.w - 80) > 0.01) throw new Error('w ' + d.w);
  if (Math.abs(d.h - 80) > 0.5) throw new Error('h ' + d.h); // 4x4 square -> ~square
  if (Math.abs(d.t - 5) > 0.01) throw new Error('t ' + d.t); // base 2 + max(3,1)
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `computeDimensions not defined`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, inside the `3D-Modell` accordion after the STL button field, add:

```html
              <div class="field">
                <p id="dims" class="status">—</p>
              </div>
```

In `js/app.js`:
- Add to `els`: `dims: document.getElementById('dims'),`
- Add the functions (near `buildParts`):

```js
// Final physical dimensions in mm: width from the slider, height from the
// model grid aspect, total thickness = base + tallest relief layer.
function computeDimensions() {
  if (!processedData) return null;
  const { cols, rows } = buildFields(Number(els.modelRes.value));
  const w = Number(els.modelWidth.value);
  const h = w * (rows / cols);
  const t = Number(els.baseThick.value) + Math.max(
    Number(els.thickBlack.value), Number(els.thickWhite.value),
    (els.circleEnable.checked || Number(els.frameWidth.value) > 0) ? Number(els.ringThick.value) : 0
  );
  return { w, h, t };
}
window.computeDimensions = computeDimensions;

function updateDims() {
  const d = computeDimensions();
  els.dims.textContent = d ? `${d.w.toFixed(0)} × ${d.h.toFixed(0)} × ${d.t.toFixed(1)} mm` : '—';
}
window.updateDims = updateDims;
```

- Call `updateDims()` at the end of `paint()` (so it refreshes after every render), and add `updateDims` to the `input` listeners for `modelWidth`, `thickBlack`, `thickWhite`, `ringThick`, `baseThick`, `frameWidth`, `modelRes`, `circleSize`, and the `circleEnable` change handler. Example for `modelWidth`:

```js
els.modelWidth.addEventListener('input', () => { els.modelWidthVal.textContent = els.modelWidth.value; updateDims(); });
```

(Apply the same `updateDims()` addition to each of the listed listeners.)

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: live dimensions readout (mm)"
```

---

### Task 4: Presets + localStorage memory

**Files:**
- Create: `js/presets.js`
- Modify: `index.html` (load `presets.js` before `app.js`; add preset `<select>` + Save/Delete buttons in the sidebar head, ~line 32-37)
- Modify: `js/app.js` (call `restoreLastState()` after controls are enabled in `loadFile`; persist on change; wire preset UI)

**Interfaces:**
- Consumes: `els` (read/write control values).
- Produces (in `presets.js`, all on `window`):
  - `PRESET_CONTROLS` — array of control ids to persist.
  - `captureState() -> Object` (id → value/checked).
  - `applyState(state) -> void` (writes values, dispatches `input`/`change` so the UI updates).
  - `saveLastState()`, `restoreLastState() -> boolean`.
  - `listPresets() -> Object`, `savePreset(name)`, `loadPreset(name) -> boolean`, `deletePreset(name)`, `seedBuiltinPresets()`.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  for (const fn of ['captureState','applyState','savePreset','loadPreset','listPresets'])
    if (typeof window[fn] !== 'function') throw new Error(fn + ' not defined');
  window.els.modelWidth.value = 123;
  window.els.baseThick.value = 4;
  const snap = window.captureState();
  window.els.modelWidth.value = 50;
  window.applyState(snap);
  if (Number(window.els.modelWidth.value) !== 123) throw new Error('round-trip failed: ' + window.els.modelWidth.value);
  window.savePreset('__test__');
  window.els.modelWidth.value = 10;
  if (!window.loadPreset('__test__')) throw new Error('loadPreset returned false');
  if (Number(window.els.modelWidth.value) !== 123) throw new Error('preset load failed');
  window.deletePreset('__test__');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `captureState not defined`.

- [ ] **Step 3: Write minimal implementation**

Create `js/presets.js`:

```js
"use strict";
// Persists control state to localStorage and manages named presets. Operates
// purely through the shared `els` map from app.js.

const PRESET_CONTROLS = [
  'keepAlpha', 'thresh', 'island', 'invert', 'numColors', 'levels',
  'colorIsland', 'smooth', 'circleEnable', 'circleSize', 'circleThickness',
  'circleColor', 'modelWidth', 'thickBlack', 'thickWhite', 'ringThick',
  'frameWidth', 'baseThick', 'bodyColor', 'modelRes', 'modelSmooth',
];

function captureState() {
  const s = {};
  for (const id of PRESET_CONTROLS) {
    const el = els[id];
    if (!el) continue;
    s[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return s;
}
window.captureState = captureState;

function applyState(state) {
  for (const id of PRESET_CONTROLS) {
    const el = els[id];
    if (!el || !(id in state)) continue;
    if (el.type === 'checkbox') el.checked = !!state[id];
    else el.value = state[id];
    el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
  }
}
window.applyState = applyState;

const LAST_KEY = 'ukibori:last', PRESETS_KEY = 'ukibori:presets';

function saveLastState() {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(captureState())); } catch (e) {}
}
window.saveLastState = saveLastState;

function restoreLastState() {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return false;
    applyState(JSON.parse(raw));
    return true;
  } catch (e) { return false; }
}
window.restoreLastState = restoreLastState;

function listPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}'); } catch (e) { return {}; }
}
window.listPresets = listPresets;

function savePreset(name) {
  const all = listPresets();
  all[name] = captureState();
  localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
}
window.savePreset = savePreset;

function loadPreset(name) {
  const all = listPresets();
  if (!all[name]) return false;
  applyState(all[name]);
  return true;
}
window.loadPreset = loadPreset;

function deletePreset(name) {
  const all = listPresets();
  delete all[name];
  localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
}
window.deletePreset = deletePreset;

// Built-in presets seeded once if no presets exist yet.
const BUILTIN_PRESETS = {
  'Untersetzer': { circleEnable: true, circleThickness: 12, ringThick: 4, baseThick: 2, thickBlack: 2.5, thickWhite: 2.5 },
  'Schild': { circleEnable: false, frameWidth: 40, ringThick: 4, baseThick: 2, thickBlack: 3, thickWhite: 3 },
  'Magnet': { circleEnable: false, frameWidth: 0, ringThick: 0, baseThick: 0, thickBlack: 2, thickWhite: 2 },
};

function seedBuiltinPresets() {
  if (Object.keys(listPresets()).length) return;
  const all = {};
  for (const [name, partial] of Object.entries(BUILTIN_PRESETS)) {
    const base = captureState();
    all[name] = Object.assign(base, partial);
  }
  localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
}
window.seedBuiltinPresets = seedBuiltinPresets;
```

In `index.html`:
- Load the module before `app.js` (presets.js uses `els`, which is defined at the top of `app.js` — so it must load *after* `app.js` defines `els`... **but** `els` is a `const` in `app.js` not on `window`). To avoid load-order coupling, `app.js` already exposes `window.els`. Change `presets.js` to read `els` from `window` by adding `const els = window.els;` at the top **after** `app.js` runs. Therefore load order is `image-ops.js`, `geometry.js`, `app.js`, **then** `presets.js`. Update the script tags (add after the `app.js` tag):

```html
<script src="js/presets.js"></script>
```

  And change the first lines of `presets.js` to:

```js
"use strict";
const els = window.els;
```

- Add the preset UI inside `.sidebar-head` (after the mode `seg-group`):

```html
        <div class="preset-row">
          <select id="presetSelect" class="preset-select" aria-label="Vorlage"></select>
          <button type="button" id="presetSave" class="btn btn-sm">Speichern</button>
          <button type="button" id="presetDelete" class="btn btn-sm">Löschen</button>
        </div>
```

In `js/app.js`, near the bottom (after the existing event wiring), add:

```js
// --- presets / persistence -------------------------------------------------
function refreshPresetSelect() {
  const sel = document.getElementById('presetSelect');
  if (!sel) return;
  const names = Object.keys(listPresets());
  sel.innerHTML = '<option value="">Vorlage…</option>' +
    names.map(n => `<option value="${n}">${n}</option>`).join('');
}
function initPresets() {
  seedBuiltinPresets();
  refreshPresetSelect();
  const sel = document.getElementById('presetSelect');
  sel.addEventListener('change', () => { if (sel.value && loadPreset(sel.value)) render(); });
  document.getElementById('presetSave').addEventListener('click', () => {
    const name = prompt('Vorlagenname:');
    if (name) { savePreset(name); refreshPresetSelect(); }
  });
  document.getElementById('presetDelete').addEventListener('click', () => {
    if (sel.value) { deletePreset(sel.value); refreshPresetSelect(); }
  });
  // Persist on any control change (debounced).
  let t = null;
  document.addEventListener('input', () => { clearTimeout(t); t = setTimeout(saveLastState, 300); });
  document.addEventListener('change', () => { clearTimeout(t); t = setTimeout(saveLastState, 300); });
}
```

  Because `initPresets` calls functions from `presets.js` (loaded *after* `app.js`), invoke it from `presets.js`'s end instead. Add to the bottom of `presets.js`:

```js
if (window.initPresets) window.initPresets();
```

  and in `app.js` add `window.initPresets = initPresets;` after defining it.

- In `loadFile`'s `img.onload`, after `enableControls(true);`, add `restoreLastState();` so a returning user gets their last settings (the synthetic-load test path doesn't exercise this).

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`.

- [ ] **Step 5: Commit**

```bash
git add js/presets.js js/app.js index.html
git commit -m "feat: presets + localStorage memory"
```

---

### Task 5: Stamp mode (mirror + invert)

A stamp must print right-reading, so the exported geometry is mirrored horizontally and the relief inverted (design raised). The preview shows the mirrored result so what you see is what prints.

**Files:**
- Modify: `index.html` (add the `Stempel-Modus` toggle in the Conversion accordion `actions`, ~line 106-109)
- Modify: `js/app.js` (add `els.stampMode`, mirror in `paint`/`exportData`, mirror + swap black/white in `buildFields`)

**Interfaces:**
- Consumes: `els`, existing `buildFields` internals.
- Produces: a `stampActive()` helper; `buildFields` honors stamp by mirroring the sampled `gray`/`alpha` grids horizontally and swapping the `fBlack`/`fWhite` field roles.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  function loadSynthetic() {
    const w = 4, h = 4, id = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, v = x < 2 ? 0 : 255;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    window.originalData = id; window.els.circleEnable.checked = false; window.render();
  }
  const stamp = document.getElementById('stampMode');
  if (!stamp) throw new Error('stampMode toggle missing');
  loadSynthetic();
  window.els.thickBlack.value = 3; window.els.thickWhite.value = 0;
  // Off: black (left half) has facets, the "schwarz" part exists.
  stamp.checked = false; stamp.dispatchEvent(new Event('change', { bubbles: true }));
  const off = window.buildParts().parts.find(p => p.name === 'schwarz');
  if (!off || !off.facets.length) throw new Error('expected schwarz facets when stamp off');
  // On: black/white roles swap, so with thickWhite=0 the formerly-white region
  // now carries the black thickness -> still produces schwarz facets but mirrored.
  stamp.checked = true; stamp.dispatchEvent(new Event('change', { bubbles: true }));
  const on = window.buildParts().parts.find(p => p.name === 'schwarz');
  if (!on || !on.facets.length) throw new Error('expected schwarz facets when stamp on');
  // The mirrored centroid X must differ from the un-mirrored one.
  const cx = ps => { let s = 0, n = 0; for (const f of ps.facets) for (const v of f) { s += v[0]; n++; } return s / n; };
  if (Math.abs(cx(off) - cx(on)) < 1e-6) throw new Error('stamp did not mirror geometry');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `stampMode toggle missing`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, in the Conversion accordion `actions` block (~line 106), add a toggle that applies in both modes:

```html
            <label class="toggle"><input id="stampMode" type="checkbox" disabled> Stempel-Modus (gespiegelt, erhaben)</label>
```

In `js/app.js`:
- Add to `els`: `stampMode: document.getElementById('stampMode'),`
- Add `els.stampMode` to the `enableControls` disable array.
- Add a helper near `buildFields`:

```js
function stampActive() { return els.stampMode && els.stampMode.checked; }
window.stampActive = stampActive;
```

- In `buildFields`, after the `gray` (and `alpha`) arrays are filled (after line ~268), mirror them horizontally when stamping:

```js
  if (stampActive()) {
    const mirrorRow = (arr) => {
      for (let r = 0; r < rows; r++) {
        const base = r * cols;
        for (let c = 0; c < cols >> 1; c++) {
          const t = arr[base + c]; arr[base + c] = arr[base + cols - 1 - c]; arr[base + cols - 1 - c] = t;
        }
      }
    };
    mirrorRow(gray);
    if (alpha) mirrorRow(alpha);
  }
```

- In the same `buildFields`, swap the returned black/white fields when stamping, so the design (black) is raised relative to background. Change the final `return`:

```js
  const result = { cols, rows, pitch: Number(els.modelWidth.value) / cols, fBase, fBlack, fWhite, fRing };
  if (stampActive()) { const tmp = result.fBlack; result.fBlack = result.fWhite; result.fWhite = tmp; }
  return result;
```

- Mirror the on-screen preview and PNG export so they match. In `paint()`, wrap the `ctx.drawImage(processedCanvas, -f.x0, -f.y0);` call:

```js
  if (stampActive()) { ctx.save(); ctx.translate(f.fw, 0); ctx.scale(-1, 1); ctx.drawImage(processedCanvas, f.x0, -f.y0); ctx.restore(); }
  else ctx.drawImage(processedCanvas, -f.x0, -f.y0);
```

  (Note the sign flip on `f.x0` inside the mirrored branch.) In `exportData()`, wrap the `ctx.drawImage(processedCanvas, -x0, -y0);` the same way:

```js
  if (stampActive()) { ctx.save(); ctx.translate(fw, 0); ctx.scale(-1, 1); ctx.drawImage(processedCanvas, x0, -y0); ctx.restore(); }
  else ctx.drawImage(processedCanvas, -x0, -y0);
```

- Wire the toggle to re-render:

```js
els.stampMode.addEventListener('change', render);
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: stamp mode (mirror + raised relief)"
```

---

## Self-Review

**Spec coverage (Phase A scope):**
- #2 STL export → Task 2 ✓
- #8 Dimensions readout → Task 3 ✓
- #7 Presets + memory → Task 4 ✓
- #6 Stamp mode → Task 5 ✓
- `buildParts()` refactor (foundation for STL/preview) → Task 1 ✓

(Phases B/C/D — text/QR, ML cutout, color-3D, hole/loop, 3D preview — are out of scope for this plan and get their own plans.)

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:**
- `buildParts()` returns `{parts, stats:{tris}}` — consumed identically by `exportModel` (Task 1), `exportSTL` (Task 2), `computeDimensions` uses `buildFields` directly (Task 3). ✓
- `facetsToBinarySTL(facets) -> Uint8Array` — produced Task 2, consumed by `exportSTL` (wrapped in `Blob`). ✓
- Preset functions (`captureState`/`applyState`/`savePreset`/`loadPreset`/`deletePreset`/`listPresets`) named consistently across `presets.js` and `app.js` wiring. ✓
- `stampActive()` defined once, consumed in `buildFields`/`paint`/`exportData`. ✓

**Load-order note:** `presets.js` loads after `app.js` and reads `window.els`; `initPresets` is defined in `app.js` and invoked from the tail of `presets.js`. Verified consistent in Task 4.
