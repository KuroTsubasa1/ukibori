# Ukibori Phase B1 — Text + QR Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users generate a relief from typed text or a QR code, not just an uploaded image — both feeding the existing processing pipeline.

**Architecture:** Add input-source tabs (Bild · Text · QR) at the dropzone. A new `js/sources.js` rasterizes text and QR codes to `ImageData`. A behavior-preserving `adoptImageData()` refactor extracts the post-load setup from `loadFile` so text/QR/image all share one entry point. QR uses a vendored MIT library (`vendor/qrcode.js`, qrcode-generator by Kazuhiko Arase).

**Tech Stack:** Vanilla JS (classic `<script>` tags, no build), one vendored MIT QR library, Playwright MCP `browser_evaluate` for verification against `window`-exposed functions.

## Global Constraints

- No build step, no framework. **One** new vendored runtime dependency is permitted this phase: `vendor/qrcode.js` (qrcode-generator v1.4.4, MIT). It must be vendored locally (no CDN at runtime) so the app stays fully offline.
- All processing stays in the browser; no network at runtime, no upload.
- New JS files use classic `<script>` tags that share one global scope. A new file must NOT redeclare a top-level `const` that already exists in another file (e.g. `els`). Wrap module bodies in an IIFE and expose public functions via `window.*` (see how `js/presets.js` does it).
- New pure functions are exposed on `window` for `browser_evaluate` verification.
- UI copy is German, matching existing strings.
- The existing image-upload path (`loadFile`), B/W and color processing, circle crop, transparency, and all Phase A features must not regress.
- Verification runs against a local server: `python3 -m http.server 8000` in the repo root; Playwright navigates to `http://localhost:8000/`. After a code change, RELOAD the page before re-running a test. After any task touching load/init, check `browser_console_messages` for a clean load.

---

### Task 1: Vendor the QR library

**Files:**
- Create: `vendor/qrcode.js` (downloaded)
- Modify: `index.html` (add the `<script>` tag before `js/sources.js`/`js/app.js`)

**Interfaces:**
- Produces: a global `window.qrcode(typeNumber, ecLevel)` factory. Usage: `const qr = qrcode(type, 'M'); qr.addData(text); qr.make(); qr.getModuleCount(); qr.isDark(row, col)`.

- [ ] **Step 1: Download the library into vendor/**

```bash
mkdir -p vendor
curl -fsSL -o vendor/qrcode.js "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"
head -8 vendor/qrcode.js   # expect the "QR Code Generator for JavaScript / Copyright (c) 2009 Kazuhiko Arase" MIT header
wc -c vendor/qrcode.js     # expect ~56694 bytes
```

If the download is blocked in this environment, STOP and report BLOCKED with the exact `curl` command above so the controller/user can run it.

- [ ] **Step 2: Add the script tag**

In `index.html`, add as the FIRST script tag (before `js/image-ops.js`):

```html
<script src="vendor/qrcode.js"></script>
```

- [ ] **Step 3: Write the smoke test**

Start the server (`python3 -m http.server 8000`), navigate to `http://localhost:8000/`, `browser_evaluate`:

```js
() => {
  if (typeof window.qrcode !== 'function') throw new Error('window.qrcode not defined');
  const qr = window.qrcode(2, 'M');
  qr.addData('HELLO');
  qr.make();
  const n = qr.getModuleCount();
  if (!(n > 0)) throw new Error('module count ' + n);
  if (typeof qr.isDark(0, 0) !== 'boolean') throw new Error('isDark not boolean');
  return 'ok';
}
```

- [ ] **Step 4: Run the smoke test**

Expected: returns `'ok'`. Also check `browser_console_messages` shows a clean load.

- [ ] **Step 5: Commit**

```bash
git add vendor/qrcode.js index.html
git commit -m "build: vendor qrcode-generator (MIT) for QR input"
```

---

### Task 2: Extract `adoptImageData()` from `loadFile`

Behavior-preserving refactor so text/QR sources reuse the exact post-load setup.

**Files:**
- Modify: `js/app.js` (the `loadFile` function's `img.onload`, ~lines 384-424)

**Interfaces:**
- Consumes: `originalData` (module var), `enableControls`, `computeOtsuThreshold`, `setThreshold`, `circle`, `els`, `updateCircleCursor`, `setStatus`, `restoreLastState`, `render` (all existing).
- Produces: `adoptImageData(imageData, label)` — adopts an `ImageData` as the source and runs the full post-load setup (enable controls, Otsu threshold, default circle, restore last state, render). Exposed on `window`.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  if (typeof window.adoptImageData !== 'function') throw new Error('adoptImageData not defined');
  const w = 6, h = 4, id = new ImageData(w, h);
  for (let i = 0; i < id.data.length; i += 4) { id.data[i] = id.data[i+1] = id.data[i+2] = 0; id.data[i+3] = 255; }
  window.adoptImageData(id, 'Test 6×4');
  if (!window.originalData || window.originalData.width !== 6 || window.originalData.height !== 4) throw new Error('originalData not adopted');
  if (!document.body.classList.contains('has-image')) throw new Error('has-image not set');
  if (!(window.els.output.width > 0)) throw new Error('preview not rendered');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `adoptImageData not defined`.

- [ ] **Step 3: Write minimal implementation**

In `js/app.js`, add `adoptImageData` just before `loadFile`:

```js
// Adopts an ImageData as the working source (from a file, text, or QR) and
// runs the shared post-load setup. `label` is the status message to show.
function adoptImageData(imageData, label) {
  originalData = imageData;
  enableControls(true);
  document.body.classList.add('has-image');
  setThreshold(computeOtsuThreshold(originalData)); // start at the auto value
  // Default circle: largest centered circle that fits the image.
  const w = originalData.width, h = originalData.height;
  circle.cx = w / 2;
  circle.cy = h / 2;
  circle.r = Math.min(w, h) / 2;
  els.circleSize.min = 10;
  els.circleSize.max = Math.round(Math.hypot(w, h) / 2);
  els.circleSize.value = Math.round(circle.r);
  els.circleSizeVal.textContent = Math.round(circle.r);
  updateCircleCursor();
  setStatus(label, false);
  restoreLastState();
  render();
}
window.adoptImageData = adoptImageData;
```

Then replace `loadFile`'s `img.onload` body so it delegates to `adoptImageData`:

```js
  img.onload = () => {
    URL.revokeObjectURL(url);
    let data;
    try {
      offscreen.width = img.naturalWidth;
      offscreen.height = img.naturalHeight;
      offCtx.drawImage(img, 0, 0);
      data = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
    } catch (e) {
      setStatus('Bild ist zu groß zum Verarbeiten.', true);
      return;
    }
    adoptImageData(data, `Geladen: ${img.naturalWidth}×${img.naturalHeight}px`);
  };
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Then sanity-check the file path still works: load an image via the file input is hard to automate; instead verify `browser_console_messages` is clean and that `window.loadFile` still exists.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "refactor: extract adoptImageData() for alternate input sources"
```

---

### Task 3: `js/sources.js` — text and QR rasterizers

**Files:**
- Create: `js/sources.js`
- Modify: `index.html` (load `js/sources.js` after `vendor/qrcode.js`, before `js/app.js`)

**Interfaces:**
- Consumes: `window.qrcode` (Task 1).
- Produces (on `window`):
  - `renderText({ text, fontSize, bold }) -> ImageData` — black text on white, padded; multi-line via `\n`. Empty/whitespace text throws `Error('Kein Text.')`.
  - `qrToImageData({ text, ecLevel, scale, quiet }) -> ImageData` — black modules on white with a quiet-zone border. `ecLevel` one of `'L'|'M'|'Q'|'H'` (default `'M'`); `scale` px per module (default 8); `quiet` modules of margin (default 4). Empty text throws `Error('Kein Text.')`; text too long for any QR version throws `Error('QR: Text zu lang.')`.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  if (typeof window.renderText !== 'function') throw new Error('renderText not defined');
  if (typeof window.qrToImageData !== 'function') throw new Error('qrToImageData not defined');
  const t = window.renderText({ text: 'A', fontSize: 48, bold: true });
  if (!(t instanceof ImageData) || t.width < 1 || t.height < 1) throw new Error('renderText bad output');
  let black = 0, white = 0;
  for (let i = 0; i < t.data.length; i += 4) { if (t.data[i] < 50) black++; if (t.data[i] > 200) white++; }
  if (!(black > 0 && white > 0)) throw new Error('renderText: expected black glyph on white');

  const q = window.qrToImageData({ text: 'HELLO', ecLevel: 'M', scale: 4, quiet: 4 });
  if (!(q instanceof ImageData)) throw new Error('qr bad output');
  if (q.width !== q.height) throw new Error('qr not square');
  if (q.width % 4 !== 0) throw new Error('qr size not multiple of scale');
  if (q.data[0] > 200 === false) throw new Error('quiet zone (0,0) should be white');
  let qb = 0; for (let i = 0; i < q.data.length; i += 4) if (q.data[i] < 50) qb++;
  if (!(qb > 0)) throw new Error('qr: expected dark modules');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `renderText not defined`.

- [ ] **Step 3: Write minimal implementation**

Create `js/sources.js`:

```js
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
```

In `index.html`, add the script tag after `vendor/qrcode.js` and before `js/app.js`:

```html
<script src="js/sources.js"></script>
```

(Final order: `vendor/qrcode.js`, `js/image-ops.js`, `js/geometry.js`, `js/sources.js`, `js/app.js`, `js/presets.js`.)

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Check `browser_console_messages` clean.

- [ ] **Step 5: Commit**

```bash
git add js/sources.js index.html
git commit -m "feat: text + QR rasterizers (js/sources.js)"
```

---

### Task 4: Input-source tabs + apply wiring

**Files:**
- Modify: `index.html` (source tabs + text/QR panels around the dropzone, ~lines 20-28)
- Modify: `js/app.js` (els entries, tab switching, apply handlers)
- Modify: `styles.css` (minimal styling for the panels)

**Interfaces:**
- Consumes: `renderText`, `qrToImageData` (Task 3), `adoptImageData` (Task 2).
- Produces: `setSource(which)` where `which` is `'bild' | 'text' | 'qr'` — shows the matching input UI and marks the active tab. Exposed on `window`.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload):

```js
() => {
  for (const id of ['srcBild','srcText','srcQR','textPanel','qrPanel','textInput','textApply','qrInput','qrApply'])
    if (!document.getElementById(id)) throw new Error('missing #' + id);
  if (typeof window.setSource !== 'function') throw new Error('setSource not defined');
  // Text source
  window.setSource('text');
  if (document.getElementById('textPanel').hidden) throw new Error('text panel should show');
  document.getElementById('textInput').value = 'Hi';
  document.getElementById('textApply').click();
  if (!window.originalData || window.originalData.width < 1) throw new Error('text did not adopt');
  if (!document.body.classList.contains('has-image')) throw new Error('has-image not set after text');
  // QR source
  window.setSource('qr');
  if (document.getElementById('qrPanel').hidden) throw new Error('qr panel should show');
  document.getElementById('qrInput').value = 'https://example.com';
  document.getElementById('qrApply').click();
  const qw = window.originalData.width;
  if (!(qw > 0) || window.originalData.width !== window.originalData.height) throw new Error('qr did not adopt square image');
  // Back to Bild
  window.setSource('bild');
  if (document.getElementById('drop').hidden) throw new Error('dropzone should show for bild');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `missing #srcBild` (or similar).

- [ ] **Step 3: Write minimal implementation**

In `index.html`, replace the `<section id="drop" ...>...</section>` block (the dropzone) with the tabs + dropzone + panels. Keep the existing dropzone markup intact inside, just add the tabs before it and the two panels after it, all inside `<main>` before `.workspace`:

```html
  <div id="sourceTabs" class="seg-group source-tabs" role="tablist" aria-label="Quelle">
    <button type="button" id="srcBild" class="seg seg-active">Bild</button>
    <button type="button" id="srcText" class="seg">Text</button>
    <button type="button" id="srcQR" class="seg">QR</button>
  </div>

  <section id="drop" class="dropzone" tabindex="0">
    <div class="drop-full">
      <div class="drop-icon" aria-hidden="true">⬆</div>
      <p class="drop-title">Bild hierher ziehen</p>
      <p class="drop-sub">oder <span class="link">Datei auswählen</span></p>
    </div>
    <div class="drop-compact">↻ Anderes Bild laden — ziehen oder klicken</div>
    <input id="file" type="file" accept="image/*" hidden>
  </section>

  <section id="textPanel" class="source-panel" hidden>
    <textarea id="textInput" rows="2" placeholder="Text eingeben… (Zeilenumbruch erlaubt)"></textarea>
    <div class="source-row">
      <label class="toggle"><input id="textBold" type="checkbox" checked> Fett</label>
      <label class="source-size">Größe <input id="textSize" type="range" min="24" max="200" value="80"></label>
      <button id="textApply" type="button" class="btn btn-primary">Anwenden</button>
    </div>
  </section>

  <section id="qrPanel" class="source-panel" hidden>
    <input id="qrInput" type="text" placeholder="Text oder URL…">
    <div class="source-row">
      <label class="source-size">Fehlerkorrektur
        <select id="qrEc">
          <option value="L">L</option>
          <option value="M" selected>M</option>
          <option value="Q">Q</option>
          <option value="H">H</option>
        </select>
      </label>
      <button id="qrApply" type="button" class="btn btn-primary">Anwenden</button>
    </div>
  </section>
```

In `js/app.js`, add to the `els` object:

```js
  srcBild: document.getElementById('srcBild'),
  srcText: document.getElementById('srcText'),
  srcQR: document.getElementById('srcQR'),
  drop: document.getElementById('drop'), // (already present — do not duplicate)
  textPanel: document.getElementById('textPanel'),
  qrPanel: document.getElementById('qrPanel'),
  textInput: document.getElementById('textInput'),
  textBold: document.getElementById('textBold'),
  textSize: document.getElementById('textSize'),
  textApply: document.getElementById('textApply'),
  qrInput: document.getElementById('qrInput'),
  qrEc: document.getElementById('qrEc'),
  qrApply: document.getElementById('qrApply'),
```

(`els.drop` already exists at the top of the `els` object — do NOT add a second entry; the comment above is just a reminder.)

Add the source-switching + apply logic near the existing dropzone event wiring:

```js
// --- input source tabs ------------------------------------------------------
function setSource(which) {
  els.drop.hidden = which !== 'bild';
  els.textPanel.hidden = which !== 'text';
  els.qrPanel.hidden = which !== 'qr';
  els.srcBild.classList.toggle('seg-active', which === 'bild');
  els.srcText.classList.toggle('seg-active', which === 'text');
  els.srcQR.classList.toggle('seg-active', which === 'qr');
}
window.setSource = setSource;
els.srcBild.addEventListener('click', () => setSource('bild'));
els.srcText.addEventListener('click', () => setSource('text'));
els.srcQR.addEventListener('click', () => setSource('qr'));

els.textApply.addEventListener('click', () => {
  try {
    const data = renderText({
      text: els.textInput.value,
      fontSize: Number(els.textSize.value),
      bold: els.textBold.checked,
    });
    adoptImageData(data, `Text übernommen: ${data.width}×${data.height}px`);
  } catch (e) {
    setStatus(e.message || 'Text konnte nicht erzeugt werden.', true);
  }
});

els.qrApply.addEventListener('click', () => {
  try {
    const data = qrToImageData({ text: els.qrInput.value, ecLevel: els.qrEc.value });
    adoptImageData(data, `QR-Code übernommen: ${data.width}×${data.height}px`);
  } catch (e) {
    setStatus(e.message || 'QR-Code konnte nicht erzeugt werden.', true);
  }
});
```

In `styles.css`, add minimal styling (append at the end):

```css
.source-tabs { margin-bottom: 12px; }
.source-panel { display: flex; flex-direction: column; gap: 10px; padding: 16px;
  border: 1px solid var(--border, #2a2a32); border-radius: 12px; }
.source-panel textarea, .source-panel input[type="text"] { width: 100%; padding: 10px;
  border-radius: 8px; border: 1px solid var(--border, #2a2a32); background: transparent;
  color: inherit; font: inherit; resize: vertical; }
.source-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.source-size { display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Check `browser_console_messages` clean. Manually confirm (browser_snapshot or screenshot optional) the tabs toggle the three input UIs.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js styles.css
git commit -m "feat: input-source tabs (Bild/Text/QR) with apply wiring"
```

---

## Self-Review

**Spec coverage (Phase B1 scope — feature #5 Text + QR):**
- Input-source tabs Bild·Text·QR → Task 4 ✓
- Text rendered via canvas font → Task 3 `renderText` ✓
- QR via vendored encoder (decision: vendor MIT lib, EC level selectable default M) → Task 1 + Task 3 `qrToImageData` ✓
- Both rasterize to `originalData` and run the normal load path → Task 2 `adoptImageData` + Task 4 apply handlers ✓

(ML background removal #10 is Phase B2 — separate plan.)

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:**
- `adoptImageData(imageData, label)` — produced Task 2, consumed by Task 4 apply handlers and Task 2's own `loadFile`. ✓
- `renderText({text,fontSize,bold}) -> ImageData` / `qrToImageData({text,ecLevel,scale,quiet}) -> ImageData` — produced Task 3, consumed Task 4. ✓
- `window.qrcode(type, ec)` API (`addData`/`make`/`getModuleCount`/`isDark`) — produced Task 1, consumed Task 3 `makeQr`. ✓
- `setSource('bild'|'text'|'qr')` — produced + consumed Task 4. ✓

**Classic-script scope:** `sources.js` is wrapped in an IIFE and exposes only `window.renderText`/`window.qrToImageData`; no new top-level `const` collides. `vendor/qrcode.js` defines the global `qrcode`. Load order documented in Task 3. ✓

**No regression:** Task 2 is behavior-preserving for `loadFile`; the dropzone markup is preserved verbatim inside the new tabs structure; `els.drop` is reused, not reduplicated. ✓
