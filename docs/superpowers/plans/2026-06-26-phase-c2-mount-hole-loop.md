# Ukibori Phase C2 — Mounting Hole / Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users carve a mounting hole through the relief (any position + diameter), and optionally add a reinforcing ring "Öse" around it — working in both B/W and color modes.

**Architecture:** A new "Befestigung" accordion (type Kein/Loch/Öse, diameter, ring width). A `mount` position lives in image coordinates (like `circle`). The carve is applied INSIDE `buildFields`/`buildColorFields` (where the grid↔image mapping is known): every part field is intersected with `dist(cell,hole)−holeR` so the hole is removed; for Öse an annulus `fBoss` field is returned, which `buildParts`/`buildColorParts` extrude as a body-colored ring. Placement is via a draggable marker on the relief preview.

**Tech Stack:** Vanilla JS (classic `<script>` tags, no build), reuses `fieldFacets`/`orientOutward`, Playwright MCP `browser_evaluate` for verification.

## Global Constraints

- No build step, no framework, no new runtime dependency.
- All processing in-browser; no network.
- New functions/state exposed on `window` for `browser_evaluate` verification.
- UI copy is German.
- Applies in **relief mode** (both B/W and color). Must not affect bookmark (Lesezeichen) mode, and must not regress existing relief features (circle crop, frame, stamp, transparency, color/bw 3D, the export dialog).
- `buildParts()`/`buildColorParts()` keep returning `{ parts:[{name,color,facets}], stats:{tris} }`.
- Verification: serve repo root on **port 8001** (`python3 -m http.server 8001`); navigate `http://localhost:8001/?nocache=<n>` (vary after edits); after load/init changes check `browser_console_messages` clean. Bust cache via the navigate URL, NEVER by editing committed `<script>`/`<link>` tags.

### Shared test helper (relief mode, full-frame synthetic image)

```js
function loadReliefImage() {
  if (window.setAppMode) window.setAppMode('relief'); // ensure relief mode if bookmark merged
  window.setMode('bw');
  const w = 40, h = 40, id = new ImageData(w, h);
  for (let i = 0; i < id.data.length; i += 4) { id.data[i]=id.data[i+1]=id.data[i+2]=0; id.data[i+3]=255; } // all black
  window.els.keepAlpha.checked = false; window.els.circleEnable.checked = false;
  window.adoptImageData(id, 'relieftest');
}
```
(`setAppMode` exists only after the bookmark merge; the guard makes the test robust either way.)

---

### Task 1: Befestigung controls + hole carve + Öse boss geometry

**Files:**
- Modify: `index.html` (new "Befestigung" accordion after the "Kreis zuschneiden" accordion)
- Modify: `js/app.js` (`mount` state, `mountActive`, els entries, listeners, default in `adoptImageData`, carve in `buildFields`/`buildColorFields`, boss part in `buildParts`/`buildColorParts`)

**Interfaces:**
- Produces: `mount = {x,y}` (image coords); `mountActive() -> boolean`; `buildFields`/`buildColorFields` now also return `fBoss:(c,r)=>number|null` and carve all their part fields when a hole is active; `buildParts`/`buildColorParts` emit an `oese` part from `fBoss`.

- [ ] **Step 1: Write the failing test**

Serve on 8001, navigate, `browser_evaluate`:

```js
() => {
  function loadReliefImage() {
    if (window.setAppMode) window.setAppMode('relief');
    window.setMode('bw');
    const w = 40, h = 40, id = new ImageData(w, h);
    for (let i = 0; i < id.data.length; i += 4) { id.data[i]=id.data[i+1]=id.data[i+2]=0; id.data[i+3]=255; }
    window.els.keepAlpha.checked = false; window.els.circleEnable.checked = false;
    window.adoptImageData(id, 'relieftest');
  }
  if (!document.getElementById('mountType')) throw new Error('#mountType control missing');
  if (typeof window.mountActive !== 'function') throw new Error('mountActive not defined');
  loadReliefImage();
  // place hole at center, diameter big enough to span several cells
  window.mount.x = 20; window.mount.y = 20;
  window.els.mountDia.value = 10;
  // Loch: fBase must be carved (negative) at the hole center, positive far away
  window.els.mountType.value = 'loch';
  let F = window.buildFields(40);
  const cc = [Math.round(F.cols/2), Math.round(F.rows/2)];
  if (!(F.fBase(cc[0], cc[1]) < 0)) throw new Error('Loch: center not carved: ' + F.fBase(cc[0], cc[1]));
  if (!(F.fBase(2, 2) > 0)) throw new Error('Loch: corner should be solid');
  if (F.fBoss) throw new Error('Loch should not produce a boss');
  // Öse: boss field present; positive on the ring, negative at the hole center and far out
  window.els.mountType.value = 'oese';
  window.els.mountBoss.value = 4;
  F = window.buildFields(40);
  if (!F.fBoss) throw new Error('Öse should produce fBoss');
  if (!(F.fBoss(cc[0], cc[1]) < 0)) throw new Error('boss should be hollow at center');
  const parts = window.buildParts().parts;
  if (!parts.some(p => p.name === 'oese' && p.facets.length)) throw new Error('no oese part');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `#mountType control missing`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, add a new accordion right after the "Kreis zuschneiden" `</details>`:

```html
        <details class="acc">
          <summary>Befestigung</summary>
          <div class="acc-body">
            <div class="fields">
              <div class="field">
                <div class="field-head"><label>Typ</label></div>
                <div class="seg-group seg-sm" role="tablist" aria-label="Befestigung">
                  <button type="button" id="mountKein" class="seg seg-active">Kein</button>
                  <button type="button" id="mountLoch" class="seg">Loch</button>
                  <button type="button" id="mountOese" class="seg">Öse</button>
                </div>
                <input id="mountType" type="hidden" value="kein">
                <span class="hint">Im Bild ziehen, um die Position zu setzen</span>
              </div>
              <div class="field mount-on" hidden>
                <div class="field-head"><label for="mountDia">Lochdurchmesser (mm)</label><span id="mountDiaVal" class="badge">5.0</span></div>
                <input id="mountDia" type="range" min="1" max="30" value="5" step="0.5" disabled>
              </div>
              <div class="field mount-oese" hidden>
                <div class="field-head"><label for="mountBoss">Ringbreite (mm)</label><span id="mountBossVal" class="badge">3.0</span></div>
                <input id="mountBoss" type="range" min="0.5" max="15" value="3" step="0.5" disabled>
              </div>
            </div>
          </div>
        </details>
```

In `js/app.js`:
- Add to the `els` object: `mountKein`, `mountLoch`, `mountOese`, `mountType`, `mountDia`, `mountDiaVal`, `mountBoss`, `mountBossVal` (via `document.getElementById`).
- Add `els.mountDia`, `els.mountBoss` to the `enableControls` disable-list array.
- Near the `circle` state declaration, add:

```js
const mount = { x: 0, y: 0 }; // mounting hole/loop center, in image coordinates
function mountActive() { return els.mountType && els.mountType.value !== 'kein'; }
window.mount = mount;
window.mountActive = mountActive;
```

- In `adoptImageData`, after the circle defaults are set, initialize the mount to top-center:

```js
  mount.x = originalData.width / 2;
  mount.y = originalData.height * 0.15;
```

- Wire the type segments + sliders (near the other 3D/relief listeners):

```js
function setMountType(t) {
  els.mountType.value = t;
  els.mountKein.classList.toggle('seg-active', t === 'kein');
  els.mountLoch.classList.toggle('seg-active', t === 'loch');
  els.mountOese.classList.toggle('seg-active', t === 'oese');
  document.querySelectorAll('.mount-on').forEach(e => { e.hidden = t === 'kein'; });
  document.querySelectorAll('.mount-oese').forEach(e => { e.hidden = t !== 'oese'; });
  updateCircleCursor();
  paint();
}
window.setMountType = setMountType;
els.mountKein.addEventListener('click', () => setMountType('kein'));
els.mountLoch.addEventListener('click', () => setMountType('loch'));
els.mountOese.addEventListener('click', () => setMountType('oese'));
els.mountDia.addEventListener('input', () => { els.mountDiaVal.textContent = Number(els.mountDia.value).toFixed(1); paint(); });
els.mountBoss.addEventListener('input', () => { els.mountBossVal.textContent = Number(els.mountBoss.value).toFixed(1); paint(); });
```

- In `buildFields`, AFTER `fBase`/`fBlack`/`fWhite`/`fRing` are defined and the stamp swap is applied, and BEFORE `return result`, carve the hole and build the boss. Replace the final `const result = {...}; if (stampActive()) {...} return result;` tail with:

```js
  let fBlack2 = fBlack, fWhite2 = fWhite, fBase2 = fBase, fRing2 = fRing, fBoss = null;
  if (mountActive()) {
    const holeCol = (mount.x - sx) / sw * cols, holeRow = (mount.y - sy) / sh * rows;
    const pitchMm = Number(els.modelWidth.value) / cols;
    const holeRc = (Number(els.mountDia.value) / 2) / pitchMm;
    const distH = (c, r) => Math.hypot(c + 0.5 - holeCol, r + 0.5 - holeRow);
    const dOut = (c, r) => distH(c, r) - holeRc; // >0 outside the hole
    const carve = (f) => f ? (c, r) => Math.min(f(c, r), dOut(c, r)) : null;
    fBase2 = carve(fBase); fBlack2 = carve(fBlack); fWhite2 = carve(fWhite); fRing2 = carve(fRing);
    if (els.mountType.value === 'oese') {
      const bossRc = holeRc + Number(els.mountBoss.value) / pitchMm;
      fBoss = (c, r) => Math.min(dOut(c, r), bossRc - distH(c, r), fAlpha(c, r));
    }
  }
  const result = { cols, rows, pitch: Number(els.modelWidth.value) / cols, fBase: fBase2, fBlack: fBlack2, fWhite: fWhite2, fRing: fRing2, fBoss };
  if (stampActive()) { const tmp = result.fBlack; result.fBlack = result.fWhite; result.fWhite = tmp; }
  return result;
```

(Note: the existing stamp swap stays AFTER this; it swaps the already-carved black/white fields, which is correct.)

- In `buildColorFields`, similarly carve before returning. After `colorFields` is built and `fBase`/`fRing` defined, replace the `return { cols, rows, pitch, colorFields, fBase, fRing };` with:

```js
  let fBase2 = fBase, fRing2 = fRing, colorFields2 = colorFields, fBoss = null;
  if (mountActive()) {
    const holeCol = (mount.x - sx) / sw * cols, holeRow = (mount.y - sy) / sh * rows;
    const pitchMm = Number(els.modelWidth.value) / cols;
    const holeRc = (Number(els.mountDia.value) / 2) / pitchMm;
    const distH = (c, r) => Math.hypot(c + 0.5 - holeCol, r + 0.5 - holeRow);
    const dOut = (c, r) => distH(c, r) - holeRc;
    const carve = (f) => f ? (c, r) => Math.min(f(c, r), dOut(c, r)) : null;
    fBase2 = carve(fBase); fRing2 = carve(fRing);
    colorFields2 = colorFields.map(cf => ({ color: cf.color, field: carve(cf.field) }));
    if (els.mountType.value === 'oese') {
      const bossRc = holeRc + Number(els.mountBoss.value) / pitchMm;
      fBoss = (c, r) => Math.min(dOut(c, r), bossRc - distH(c, r), fAlpha(c, r));
    }
  }
  return { cols, rows, pitch: Number(els.modelWidth.value) / cols, colorFields: colorFields2, fBase: fBase2, fRing: fRing2, fBoss };
```

- In `buildParts` (B/W), destructure `fBoss` and emit a part. After the ring block, before computing `tris`:

```js
  if (fBoss) {
    const bossH = Math.max(Number(els.thickBlack.value), Number(els.thickWhite.value)) || baseT;
    const bossF = facets(fBoss, bossH, baseT);
    if (bossF.length) parts.push({ name: 'oese', color: bodyColor, facets: bossF });
  }
```
(Add `fBoss` to the destructuring `const { cols, rows, pitch, fBase, fBlack, fWhite, fRing, fBoss } = buildFields(maxDim);`.)

- In `buildColorParts`, likewise destructure `fBoss` and emit the boss using the color relief height:

```js
  if (fBoss) {
    const bossH = (colorHeightMode() === 'brightness' ? Number(els.colorMaxH.value) : Number(els.colorRelief.value)) || baseT;
    const bossF = facets(fBoss, bossH, baseT);
    if (bossF.length) parts.push({ name: 'oese', color: bodyColor, facets: bossF });
  }
```
(Add `fBoss` to its `buildColorFields` destructuring.)

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Console clean. Manually confirm the Befestigung accordion appears in relief mode (both B/W and color) with Kein/Loch/Öse + sliders.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: mounting hole (Loch) + reinforced ring (Öse), both modes"
```

---

### Task 2: Draggable position marker on the preview

**Files:**
- Modify: `js/app.js` (`paint` draws the marker; pointer handlers move the mount; `updateCircleCursor` cursor hint)

**Interfaces:**
- Consumes: `mount`, `mountActive`, `circleFrame`, the existing pointer infra.
- Produces: dragging on the preview while a mount type is active moves `mount` (image coords); `paint` renders a marker (hole outline + center cross) at the mount position.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  function loadReliefImage() {
    if (window.setAppMode) window.setAppMode('relief');
    window.setMode('bw');
    const w = 40, h = 40, id = new ImageData(w, h);
    for (let i = 0; i < id.data.length; i += 4) { id.data[i]=id.data[i+1]=id.data[i+2]=0; id.data[i+3]=255; }
    window.els.keepAlpha.checked = false; window.els.circleEnable.checked = false;
    window.adoptImageData(id, 'relieftest');
  }
  loadReliefImage();
  window.setMountType('loch');
  const out = window.els.output;
  const rect = out.getBoundingClientRect();
  const before = { x: window.mount.x, y: window.mount.y };
  // pointerdown near top-left of the canvas, then move toward center
  out.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 5, clientY: rect.top + 5, bubbles: true, pointerId: 1 }));
  out.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * 0.5, clientY: rect.top + rect.height * 0.5, bubbles: true, pointerId: 1 }));
  out.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + rect.width * 0.5, clientY: rect.top + rect.height * 0.5, bubbles: true, pointerId: 1 }));
  if (window.mount.x === before.x && window.mount.y === before.y) throw new Error('mount did not move on drag');
  // moved roughly toward image center (20,20) from the initial top area
  if (!(window.mount.x > 5)) throw new Error('mount.x not updated sensibly: ' + window.mount.x);
  window.setMountType('kein');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `mount did not move on drag` (pointer handling ignores the mount tool).

- [ ] **Step 3: Write minimal implementation**

In `js/app.js`:

- Add a drag-target variable near the existing `let dragging = false, lastX, lastY;`:

```js
let dragTarget = null; // 'circle' | 'mount'
```

- Add a helper to convert a pointer event to image coordinates:

```js
function pointerToImage(e) {
  const rect = els.output.getBoundingClientRect();
  const scale = els.output.width / rect.width; // frame px per client px (== image units)
  const f = circleFrame();
  return { x: (e.clientX - rect.left) * scale + f.x0, y: (e.clientY - rect.top) * scale + f.y0 };
}
```

- Replace the `pointerdown` handler so the mount tool takes priority when active:

```js
els.output.addEventListener('pointerdown', e => {
  if (!processedData) return;
  if (mountActive()) {
    dragTarget = 'mount';
    const p = pointerToImage(e);
    mount.x = Math.max(0, Math.min(processedData.width, p.x));
    mount.y = Math.max(0, Math.min(processedData.height, p.y));
    els.output.setPointerCapture(e.pointerId);
    e.preventDefault();
    paint();
    return;
  }
  if (!els.circleEnable.checked) return;
  dragTarget = 'circle';
  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  els.output.setPointerCapture(e.pointerId);
  els.output.style.cursor = 'grabbing';
  e.preventDefault();
});
```

- Replace the `pointermove` handler to branch on `dragTarget`:

```js
els.output.addEventListener('pointermove', e => {
  if (dragTarget === 'mount') {
    const p = pointerToImage(e);
    mount.x = Math.max(0, Math.min(processedData.width, p.x));
    mount.y = Math.max(0, Math.min(processedData.height, p.y));
    paint();
    return;
  }
  if (!dragging) return;
  const rect = els.output.getBoundingClientRect();
  const scale = els.output.width / rect.width;
  circle.cx = Math.max(0, Math.min(processedData.width, circle.cx + (e.clientX - lastX) * scale));
  circle.cy = Math.max(0, Math.min(processedData.height, circle.cy + (e.clientY - lastY) * scale));
  lastX = e.clientX; lastY = e.clientY;
  paint();
});
```

- Update `endDrag` to clear the target:

```js
function endDrag() {
  if (!dragging && dragTarget !== 'mount') return;
  dragging = false;
  dragTarget = null;
  updateCircleCursor();
}
```

- In `updateCircleCursor`, show a crosshair when the mount tool is active:

```js
function updateCircleCursor() {
  els.output.style.cursor = mountActive() ? 'crosshair' : (els.circleEnable.checked ? 'grab' : 'default');
}
```

- In `paint`, after the circle overlay block and before `els.preview.classList.add('ready')`, draw the mount marker:

```js
  if (mountActive()) {
    const mx = mount.x - f.x0, my = mount.y - f.y0;
    const pitchMm = Number(els.modelWidth.value) / Math.max(1, processedData.width); // approx px→mm for preview ring
    const rPx = (Number(els.mountDia.value) / 2) / pitchMm;
    ctx.save();
    ctx.strokeStyle = '#e0245e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, Math.max(3, rPx), 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx - 6, my); ctx.lineTo(mx + 6, my); ctx.moveTo(mx, my - 6); ctx.lineTo(mx, my + 6); ctx.stroke();
    ctx.restore();
  }
```

(The preview ring radius is approximate — it uses the image-width pitch for a visual cue; the exported hole uses the exact model pitch in `buildFields`. That's fine for a placement guide.)

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Console clean. Manually confirm: with Loch/Öse active, dragging on the preview moves a pink ring marker; with Kein, circle drag still works.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: draggable marker to position the mounting hole/loop"
```

---

## Self-Review

**Spec coverage (Phase C2 — feature #4 mounting hole/loop):**
- Befestigung accordion (Kein/Loch/Öse + diameter + ring width) → Task 1 ✓
- Hole carved through base+relief+ring, both B/W and color → Task 1 (`carve` in both builders) ✓
- Öse reinforced ring (boss) as its own body-colored part → Task 1 (`fBoss`) ✓
- Draggable marker placement on the preview → Task 2 ✓
- Default position top-center → Task 1 (`adoptImageData`) ✓

(True protruding eyelet beyond the footprint was explicitly deferred — Öse is the in-footprint reinforced ring.)

**Placeholder scan:** No TBD/TODO; complete code in every step. ✓

**Type consistency:**
- `buildFields`/`buildColorFields` now also return `fBoss:(c,r)=>number|null`; consumed by `buildParts`/`buildColorParts`. The added `fBoss` is destructured in both. ✓
- `mount = {x,y}` image coords; `mountActive()`; `pointerToImage(e)->{x,y}` — produced + consumed in Task 2. ✓
- `carve(f)` preserves the `(c,r)=>number` field contract fed to `fieldFacets`. ✓

**No regression:** when `mountActive()` is false, `buildFields`/`buildColorFields` return the original fields (carve block skipped, `fBoss=null`), so B/W and color export are unchanged. Pointer handler falls through to circle-drag when no mount tool is active. Stamp swap still applied after carve. Bookmark mode untouched (mount tool only acts in relief preview). ✓

**Known limitation:** the preview marker ring radius is an approximation (image-width pitch) for visual placement; the exported hole uses the exact model pitch. A hole placed in a transparent region (keepAlpha) is intersected with `fAlpha` for the boss but the carve removes material regardless — acceptable.
