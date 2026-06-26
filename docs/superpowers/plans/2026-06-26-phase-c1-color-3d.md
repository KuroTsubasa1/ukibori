# Ukibori Phase C1 — Color-Mode 3D Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a 3D relief in color mode — one colored object per reduced palette color — to both `.3mf` and STL, with a choice of uniform height or brightness→height.

**Architecture:** Mirror the B/W field pipeline for color. A new `buildColorFields()` extracts the distinct palette colors from `processedData` and builds an anti-aliased coverage field per color (full-res mask → downsample → `coverage−128`), intersected with the same alpha/circle/frame fields `buildFields` uses, so contours stay sub-pixel smooth. `buildParts()` gains a color branch producing one `{name,color,facets}` per color; the existing `.3mf`/STL exporters consume it unchanged. The 3D accordion is un-gated for color mode with color-specific height controls.

**Tech Stack:** Vanilla JS (classic `<script>` tags, no build), reuses `fieldFacets`/`marchingSquaresLoops`/`orientOutward` from geometry.js, Playwright MCP `browser_evaluate` for verification.

## Global Constraints

- No build step, no framework, no new runtime dependency.
- All processing in-browser; no network.
- New functions exposed on `window` for `browser_evaluate` verification.
- UI copy is German.
- The existing B/W 3D export (`buildParts` bw branch, `.3mf`, STL), PNG export, circle/frame crop, transparency (`keepAlpha`), stamp mode, and all prior phases must not regress.
- `buildParts()` stays the single geometry source for `.3mf`, STL, and (later) the 3D preview — both modes return `{ parts: [{name,color:[r,g,b],facets}], stats:{tris} }`.
- Verification: serve the repo root on **port 8001** (`python3 -m http.server 8001` from `/Users/lasseharm/Dev/ukibori`; 8000 is taken by another project). Navigate to `http://localhost:8001/?nocache=<n>` (vary `n` after edits). After load/init changes, check `browser_console_messages` clean.

### Shared test helper (color mode, 2-color image)

Used by several tasks (run inside `browser_evaluate`): switch to color mode and load a synthetic image with two solid colors (left red, right blue).

```js
function loadTwoColor() {
  window.setMode('color');
  const w = 16, h = 8, id = new ImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, left = x < w / 2;
    id.data[i] = left ? 220 : 20; id.data[i+1] = 20; id.data[i+2] = left ? 20 : 220; id.data[i+3] = 255;
  }
  window.els.keepAlpha.checked = false;
  window.els.circleEnable.checked = false;
  window.adoptImageData(id, 'twocolor');
}
```

---

### Task 1: `buildColorFields()` — per-color coverage fields

**Files:**
- Modify: `js/app.js` (add `buildColorFields`, expose on `window`)

**Interfaces:**
- Consumes: `processedData`, `processedCanvas`, `circle`, `els`, `stampActive` (existing).
- Produces: `buildColorFields(maxDim) -> { cols, rows, pitch, colorFields: Array<{color:[r,g,b], field:(c,r)=>number}>, fBase:(c,r)=>number, fRing:(c,r)=>number|null }`. Each `field` is >0 inside that color's region (sub-pixel coverage), intersected with alpha + circle/frame interior. Distinct colors are taken from `processedData`, most-frequent first, capped at 32.

- [ ] **Step 1: Write the failing test**

Serve on 8001, navigate, `browser_evaluate`:

```js
() => {
  function loadTwoColor() {
    window.setMode('color');
    const w = 16, h = 8, id = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, left = x < w / 2;
      id.data[i] = left ? 220 : 20; id.data[i+1] = 20; id.data[i+2] = left ? 20 : 220; id.data[i+3] = 255;
    }
    window.els.keepAlpha.checked = false; window.els.circleEnable.checked = false;
    window.adoptImageData(id, 'twocolor');
  }
  if (typeof window.buildColorFields !== 'function') throw new Error('buildColorFields not defined');
  loadTwoColor();
  const { cols, rows, colorFields } = window.buildColorFields(64);
  if (colorFields.length !== 2) throw new Error('expected 2 colors, got ' + colorFields.length);
  const leftCell = [Math.floor(cols * 0.25), Math.floor(rows / 2)];
  const rightCell = [Math.floor(cols * 0.75), Math.floor(rows / 2)];
  // exactly one field positive on the left, the other positive on the right
  const lpos = colorFields.map(cf => cf.field(leftCell[0], leftCell[1]) > 0);
  const rpos = colorFields.map(cf => cf.field(rightCell[0], rightCell[1]) > 0);
  if (lpos.filter(Boolean).length !== 1) throw new Error('left cell not covered by exactly one color');
  if (rpos.filter(Boolean).length !== 1) throw new Error('right cell not covered by exactly one color');
  if (lpos[0] === rpos[0]) throw new Error('left and right covered by the SAME color — not disjoint');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `buildColorFields not defined`.

- [ ] **Step 3: Write minimal implementation**

In `js/app.js`, add after `buildFields` (and `window.buildColorFields = buildColorFields;`):

```js
// Color-mode analogue of buildFields: one anti-aliased coverage field per
// distinct palette color in processedData, intersected with the same
// alpha/circle/frame fields. Reuses the mask→downsample→coverage−128 trick so
// per-color contours are sub-pixel smooth (not a per-pixel staircase).
function buildColorFields(maxDim) {
  const enabled = els.circleEnable.checked;
  const keepAlpha = els.keepAlpha.checked;
  let sx, sy, sw, sh;
  if (enabled) { const r = circle.r; sx = circle.cx - r; sy = circle.cy - r; sw = 2 * r; sh = 2 * r; }
  else { sx = 0; sy = 0; sw = processedCanvas.width; sh = processedCanvas.height; }
  let cols, rows;
  if (sw >= sh) { cols = Math.max(2, Math.min(maxDim, Math.round(sw))); rows = Math.max(2, Math.round(cols * sh / sw)); }
  else { rows = Math.max(2, Math.min(maxDim, Math.round(sh))); cols = Math.max(2, Math.round(rows * sw / sh)); }

  // Distinct opaque colors, most-frequent first, capped at 32.
  const pd = processedData.data;
  const counts = new Map();
  for (let i = 0; i < pd.length; i += 4) {
    if (keepAlpha && pd[i + 3] < 128) continue;
    const key = (pd[i] << 16) | (pd[i + 1] << 8) | pd[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32)
    .map(([key]) => [(key >> 16) & 255, (key >> 8) & 255, key & 255]);

  // Per-color coverage: full-res white-where-matching mask, downsampled to grid.
  const fullW = processedData.width, fullH = processedData.height;
  const coverageOf = (color) => {
    const mask = new Uint8ClampedArray(pd.length);
    for (let i = 0; i < pd.length; i += 4) {
      const on = pd[i] === color[0] && pd[i + 1] === color[1] && pd[i + 2] === color[2]
        && (!keepAlpha || pd[i + 3] >= 128);
      mask[i] = mask[i + 1] = mask[i + 2] = on ? 255 : 0; mask[i + 3] = 255;
    }
    const full = document.createElement('canvas'); full.width = fullW; full.height = fullH;
    full.getContext('2d').putImageData(new ImageData(mask, fullW, fullH), 0, 0);
    const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(full, sx, sy, sw, sh, 0, 0, cols, rows);
    const d = cx.getImageData(0, 0, cols, rows).data;
    const cov = new Float64Array(cols * rows);
    for (let i = 0; i < cov.length; i++) cov[i] = d[i * 4];
    return cov;
  };

  // Alpha field (coverage) when keeping transparency.
  let alpha = null;
  if (keepAlpha) {
    const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(processedCanvas, sx, sy, sw, sh, 0, 0, cols, rows);
    const ad = cx.getImageData(0, 0, cols, rows).data;
    alpha = new Float64Array(cols * rows);
    for (let i = 0; i < alpha.length; i++) alpha[i] = ad[i * 4 + 3];
  }

  const ix = (c, r) => r * cols + c;
  const mirrorRow = (arr) => {
    for (let r = 0; r < rows; r++) { const b = r * cols; for (let c = 0; c < cols >> 1; c++) { const t = arr[b + c]; arr[b + c] = arr[b + cols - 1 - c]; arr[b + cols - 1 - c] = t; } }
  };
  if (stampActive() && alpha) mirrorRow(alpha);
  const coverage = colors.map(c => { const cov = coverageOf(c); if (stampActive()) mirrorRow(cov); return cov; });

  const BIG = 1e9;
  const ccx = cols / 2, ccy = rows / 2, cr = Math.min(cols, rows) / 2;
  const ringCells = (enabled && Number(els.circleThickness.value) > 0 && Number(els.ringThick.value) > 0)
    ? Number(els.circleThickness.value) * (cols / sw) : 0;
  const frameCells = (!enabled && Number(els.frameWidth.value) > 0 && Number(els.ringThick.value) > 0)
    ? Number(els.frameWidth.value) * (cols / sw) : 0;
  const innerR = cr - ringCells;
  const dist = (c, r) => Math.hypot(c + 0.5 - ccx, r + 0.5 - ccy);
  const edge = (c, r) => Math.min(c, r, cols - 1 - c, rows - 1 - r);
  const fAlpha = (c, r) => keepAlpha ? (alpha[ix(c, r)] - 128) : BIG;
  const fCircle = (c, r) => enabled ? (cr - dist(c, r)) : BIG;
  const fInner = (c, r) => enabled ? (innerR - dist(c, r)) : (frameCells > 0 ? (edge(c, r) - frameCells) : BIG);
  const fBase = (c, r) => Math.min(fAlpha(c, r), fCircle(c, r));
  let fRing = null;
  if (ringCells > 0) fRing = (c, r) => Math.min(dist(c, r) - innerR, cr - dist(c, r), fAlpha(c, r));
  else if (frameCells > 0) fRing = (c, r) => Math.min(frameCells - edge(c, r), fAlpha(c, r));

  const colorFields = colors.map((c, k) => ({
    color: c,
    field: (cc, rr) => Math.min(coverage[k][ix(cc, rr)] - 128, fAlpha(cc, rr), fInner(cc, rr)),
  }));
  return { cols, rows, pitch: Number(els.modelWidth.value) / cols, colorFields, fBase, fRing };
}
window.buildColorFields = buildColorFields;
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Console clean.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: buildColorFields() — per-color coverage fields for color 3D"
```

---

### Task 2: Color `buildParts` branch + uniform height + UI un-gate

**Files:**
- Modify: `js/app.js` (`buildParts` color branch via `buildColorParts`; `computeDimensions` color branch; `els` entries; control visibility)
- Modify: `index.html` (un-gate the 3D accordion; mark thickBlack/thickWhite `.mode-bw`; add `.mode-color` height controls)

**Interfaces:**
- Consumes: `buildColorFields` (Task 1), `fieldFacets`, `orientOutward`, `hexToRgb`.
- Produces: `buildParts()` returns colored parts in color mode (one `farbeN` part per palette color at a uniform relief height from `els.colorRelief`), plus base/ring. `computeDimensions` returns correct `{w,h,t}` in color mode.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  function loadTwoColor() {
    window.setMode('color');
    const w = 16, h = 8, id = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, left = x < w / 2;
      id.data[i] = left ? 220 : 20; id.data[i+1] = 20; id.data[i+2] = left ? 20 : 220; id.data[i+3] = 255;
    }
    window.els.keepAlpha.checked = false; window.els.circleEnable.checked = false;
    window.adoptImageData(id, 'twocolor');
  }
  if (!document.getElementById('colorRelief')) throw new Error('#colorRelief control missing');
  loadTwoColor();
  window.els.baseThick.value = 0;
  window.els.colorRelief.value = 3;
  const { parts, stats } = window.buildParts();
  const colorParts = parts.filter(p => p.name.startsWith('farbe'));
  if (colorParts.length !== 2) throw new Error('expected 2 color parts, got ' + colorParts.length);
  if (!(stats.tris > 0)) throw new Error('no triangles');
  // uniform height: every color part's top z ≈ 3 (baseThick 0)
  const topZ = p => Math.max(...p.facets.flatMap(f => f.map(v => v[2])));
  for (const p of colorParts) if (Math.abs(topZ(p) - 3) > 0.01) throw new Error('part ' + p.name + ' top z ' + topZ(p));
  const d = window.computeDimensions();
  if (Math.abs(d.t - 3) > 0.01) throw new Error('dims t ' + d.t);
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `#colorRelief control missing`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`:
- Change the 3D accordion opening tag from `<details class="acc mode-bw">` to `<details class="acc">` (so it shows in both modes).
- Wrap the two B/W thickness fields (`thickBlack`, `thickWhite`) so each carries `mode-bw`: change their `<div class="field">` to `<div class="field mode-bw">`.
- Add a color-mode relief-height field inside the accordion body, right after the `thickWhite` field:

```html
              <div class="field mode-color" hidden>
                <div class="field-head"><label for="colorRelief">Relief-Höhe (mm)</label><span id="colorReliefVal" class="badge">3.0</span></div>
                <input id="colorRelief" type="range" min="0" max="10" value="3" step="0.2" disabled>
              </div>
```

In `js/app.js`:
- Add to `els`: `colorRelief: document.getElementById('colorRelief'), colorReliefVal: document.getElementById('colorReliefVal'),`
- Add `els.colorRelief` to the `enableControls` disable-list array.
- Add the slider listener (near the other 3D listeners):

```js
els.colorRelief.addEventListener('input', () => { els.colorReliefVal.textContent = Number(els.colorRelief.value).toFixed(1); updateDims(); });
```

- Replace the `buildParts` guard and add a color branch. Change the top of `buildParts`:

```js
function buildParts() {
  if (!processedData) return { parts: [], stats: { tris: 0 } };
  if (mode !== 'bw') return buildColorParts();
  // ... existing B/W body unchanged ...
```

- Add `buildColorParts` after `buildParts`:

```js
// Color-mode parts: one object per palette color at a uniform relief height,
// on a shared base, plus the ring/frame. Consumed by .3mf and STL like the B/W
// parts. (Brightness→height is added in a later task.)
function buildColorParts() {
  const maxDim = Number(els.modelRes.value);
  const { cols, rows, pitch, colorFields, fBase, fRing } = buildColorFields(maxDim);
  const tol = Number(els.modelSmooth.value) * pitch;
  const baseT = Number(els.baseThick.value);
  const bodyColor = hexToRgb(els.bodyColor.value);
  const facets = (f, thick, z0) => orientOutward(fieldFacets(f, cols, rows, pitch, thick, tol, z0));
  const parts = [];
  const baseF = facets(fBase, baseT, 0);
  if (baseF.length) parts.push({ name: 'grundplatte', color: bodyColor, facets: baseF });
  const reliefH = Number(els.colorRelief.value);
  colorFields.forEach((cf, k) => {
    if (reliefH <= 0) return;
    const ff = facets(cf.field, reliefH, baseT);
    if (ff.length) parts.push({ name: 'farbe' + k, color: cf.color, facets: ff });
  });
  if (fRing) {
    const randColor = els.circleEnable.checked ? hexToRgb(els.circleColor.value) : bodyColor;
    const ringF = facets(fRing, Number(els.ringThick.value), baseT);
    if (ringF.length) parts.push({ name: 'rand', color: randColor, facets: ringF });
  }
  const tris = parts.reduce((s, p) => s + p.facets.length, 0);
  return { parts, stats: { tris } };
}
window.buildColorParts = buildColorParts;
```

- Make `computeDimensions` mode-aware. Replace its `const t = ...` block:

```js
  const reliefMax = mode === 'bw'
    ? Math.max(Number(els.thickBlack.value), Number(els.thickWhite.value))
    : Number(els.colorRelief.value);
  const t = Number(els.baseThick.value) + Math.max(
    reliefMax,
    (els.circleEnable.checked || Number(els.frameWidth.value) > 0) ? Number(els.ringThick.value) : 0
  );
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Also manually confirm switching to color mode now shows the 3D-Modell accordion with the "Relief-Höhe" slider (B/W thickness sliders hidden), and `.3mf`/STL buttons present. Console clean.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: color-mode 3D export (uniform height, per-color objects)"
```

---

### Task 3: Brightness → height mode

**Files:**
- Modify: `index.html` (height-mode toggle + max-height + direction controls, `.mode-color`)
- Modify: `js/app.js` (`els` entries; `buildColorParts` per-color thickness; `computeDimensions`; visibility)

**Interfaces:**
- Consumes: `buildColorParts` (Task 2).
- Produces: a `colorHeightMode()` helper returning `'uniform' | 'brightness'`; in brightness mode each color's thickness = `colorMaxH × (darkTall ? 1−lum/255 : lum/255)` where `lum` is the color's luminance.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  function loadTwoColor() {
    window.setMode('color');
    const w = 16, h = 8, id = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, left = x < w / 2;
      // left = near-white (light), right = near-black (dark)
      const v = left ? 230 : 25; id.data[i] = v; id.data[i+1] = v; id.data[i+2] = v; id.data[i+3] = 255;
    }
    window.els.keepAlpha.checked = false; window.els.circleEnable.checked = false;
    window.adoptImageData(id, 'lightdark');
  }
  for (const id of ['colorHeightUniform','colorHeightBrightness','colorMaxH','colorDarkTall'])
    if (!document.getElementById(id)) throw new Error('missing #' + id);
  loadTwoColor();
  window.els.baseThick.value = 0;
  document.getElementById('colorHeightBrightness').click(); // brightness mode
  window.els.colorMaxH.value = 6;
  window.els.colorDarkTall.checked = true; // darker = taller
  const topZ = p => Math.max(...p.facets.flatMap(f => f.map(v => v[2])));
  const lum = c => 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const parts = window.buildParts().parts.filter(p => p.name.startsWith('farbe') && p.facets.length);
  if (parts.length !== 2) throw new Error('expected 2 color parts');
  // find the part whose color is darker; with darkTall it must be TALLER
  parts.sort((a, b) => lum(a.color) - lum(b.color)); // [darker, lighter]
  if (!(topZ(parts[0]) > topZ(parts[1]) + 0.1)) throw new Error('darkTall: darker should be taller (' + topZ(parts[0]) + ' vs ' + topZ(parts[1]) + ')');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `missing #colorHeightUniform`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, add inside the 3D accordion body, right before the `colorRelief` field, a height-mode selector; and after `colorRelief`, the brightness controls:

```html
              <div class="field mode-color" hidden>
                <div class="field-head"><label>Höhenmodus</label></div>
                <div class="seg-group seg-sm" role="tablist" aria-label="Höhenmodus">
                  <button type="button" id="colorHeightUniform" class="seg seg-active">Gleichmäßig</button>
                  <button type="button" id="colorHeightBrightness" class="seg">Helligkeit → Höhe</button>
                </div>
              </div>
```

And after the existing `colorRelief` field:

```html
              <div class="field mode-color color-brightness" hidden>
                <div class="field-head"><label for="colorMaxH">Max. Höhe (mm)</label><span id="colorMaxHVal" class="badge">6.0</span></div>
                <input id="colorMaxH" type="range" min="0" max="12" value="6" step="0.2" disabled>
              </div>
              <div class="field mode-color color-brightness" hidden>
                <label class="toggle"><input id="colorDarkTall" type="checkbox" checked disabled> Dunkle Farben höher</label>
              </div>
```

In `js/app.js`:
- Add to `els`: `colorHeightUniform`, `colorHeightBrightness`, `colorMaxH`, `colorMaxHVal`, `colorDarkTall` (via `document.getElementById`).
- Add `els.colorMaxH` and `els.colorDarkTall` to the `enableControls` disable-list array.
- Add a module variable + helper near the top-level state:

```js
let colorHeight = 'uniform'; // 'uniform' | 'brightness'
function colorHeightMode() { return colorHeight; }
window.colorHeightMode = colorHeightMode;
```

- Wire the toggle + controls (near the other 3D listeners):

```js
function setColorHeight(m) {
  colorHeight = m;
  els.colorHeightUniform.classList.toggle('seg-active', m === 'uniform');
  els.colorHeightBrightness.classList.toggle('seg-active', m === 'brightness');
  document.querySelectorAll('.color-brightness').forEach(e => { e.hidden = m !== 'brightness'; });
  // the uniform relief slider is only relevant in uniform mode
  els.colorRelief.closest('.field').hidden = (m === 'brightness') || mode !== 'color';
  updateDims();
}
window.setColorHeight = setColorHeight;
els.colorHeightUniform.addEventListener('click', () => setColorHeight('uniform'));
els.colorHeightBrightness.addEventListener('click', () => setColorHeight('brightness'));
els.colorMaxH.addEventListener('input', () => { els.colorMaxHVal.textContent = Number(els.colorMaxH.value).toFixed(1); updateDims(); });
els.colorDarkTall.addEventListener('change', () => {});
```

- In `buildColorParts`, replace the uniform `forEach` body with a per-color thickness that honors the mode:

```js
  const brightness = colorHeightMode() === 'brightness';
  const reliefH = Number(els.colorRelief.value);
  const maxH = Number(els.colorMaxH.value);
  const darkTall = els.colorDarkTall.checked;
  colorFields.forEach((cf, k) => {
    let thick = reliefH;
    if (brightness) {
      const lum = 0.299 * cf.color[0] + 0.587 * cf.color[1] + 0.114 * cf.color[2];
      thick = maxH * (darkTall ? (1 - lum / 255) : (lum / 255));
    }
    if (thick <= 0) return;
    const ff = facets(cf.field, thick, baseT);
    if (ff.length) parts.push({ name: 'farbe' + k, color: cf.color, facets: ff });
  });
```

(Remove the old uniform-only `reliefH` declaration/loop that Task 2 added — this block replaces it.)

- In `computeDimensions`, make the color relief max honor the mode:

```js
  const reliefMax = mode === 'bw'
    ? Math.max(Number(els.thickBlack.value), Number(els.thickWhite.value))
    : (colorHeightMode() === 'brightness' ? Number(els.colorMaxH.value) : Number(els.colorRelief.value));
```

- Ensure the brightness sub-controls start hidden in uniform mode: call `setColorHeight('uniform')` once after the listeners are wired (and `updateControlVisibility` already hides `.mode-color` in B/W).

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Manually confirm: in color mode, the "Höhenmodus" toggle swaps between the Relief-Höhe slider (uniform) and the Max.-Höhe + "Dunkle Farben höher" controls (brightness). Console clean.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: brightness→height mode for color 3D"
```

---

## Self-Review

**Spec coverage (Phase C1 — feature #9 color-mode 3D, both height modes):**
- Per-color coverage fields → Task 1 `buildColorFields` ✓
- One colored object per palette color, `.3mf` + STL → Task 2 (`buildColorParts` consumed by existing exporters) ✓
- Uniform height → Task 2 ✓
- Brightness→height with dark/light-tall direction → Task 3 ✓
- 3D panel enabled in color mode, color-specific controls → Task 2 (un-gate) + Task 3 (height controls) ✓
- Dimensions readout correct in color mode → Task 2 + Task 3 `computeDimensions` ✓

(Mounting hole/loop #4 is Phase C2 — separate plan.)

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:**
- `buildColorFields(maxDim) -> {cols,rows,pitch,colorFields:[{color,field}],fBase,fRing}` — produced Task 1, consumed Task 2/3 `buildColorParts`. ✓
- `buildParts() -> {parts,stats:{tris}}` shape identical in both modes — consumed by `exportModel`/`exportSTL` unchanged. ✓
- `colorHeightMode() -> 'uniform'|'brightness'` — produced + consumed Task 3 (`buildColorParts`, `computeDimensions`). ✓
- Field functions `(c,r)=>number`, fed to `fieldFacets(f,cols,rows,pitch,thickness,tol,z0)` — same contract as B/W. ✓

**No regression:** `buildParts` B/W branch is unchanged (only the guard and an added `if (mode!=='bw') return buildColorParts()`); thickBlack/thickWhite gated `.mode-bw`; color controls gated `.mode-color`; `computeDimensions` B/W path preserved via the `mode==='bw'` branch. Stamp mirroring applied to color coverage + alpha consistently with B/W. ✓

**Known limitation:** at a 3-color junction a cell may have all coverages <128 → a tiny gap (same class of artifact as the B/W gray=128 split). Acceptable for v1; the base plate underneath covers the footprint.
