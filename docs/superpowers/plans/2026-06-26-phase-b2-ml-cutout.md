# Ukibori Phase B2 — ML Background Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Hintergrund entfernen" that runs a local ML segmentation model (u2netp) entirely in the browser to cut out the subject, feeding the existing transparency pipeline.

**Architecture:** Vendor onnxruntime-web (single-threaded SIMD, no COOP/COEP) + the u2netp ONNX model locally. A new `js/bg-removal.js` lazy-loads the runtime on first use, runs inference (resize→normalize→infer→min-max matte→resize→alpha), and returns a transparent `ImageData`. The UI wraps it so failure (missing assets, inference error) degrades to a clear German status, never a crash.

**Tech Stack:** Vanilla JS (classic `<script>` tags, no build), vendored onnxruntime-web 1.16.3 (MIT) + u2netp.onnx, Playwright MCP `browser_evaluate` for verification.

## Global Constraints

- No build step, no framework. New vendored runtime assets are permitted this phase (the project already accepted the "vendored, offline" identity): `vendor/ort.min.js`, `vendor/ort-wasm-simd.wasm`, `vendor/ort-wasm.wasm`, `vendor/u2netp.onnx`. All loaded locally — **no CDN at runtime**, the app stays fully offline once vendored.
- Inference runs single-threaded (`ort.env.wasm.numThreads = 1`) with SIMD, so NO cross-origin-isolation (COOP/COEP) headers are required.
- All processing stays in the browser; no upload. The model runs locally; images never leave the device.
- New JS files use classic `<script>` tags sharing one global scope — wrap module bodies in an IIFE and expose via `window.*`; never redeclare a top-level `const` that exists elsewhere (e.g. `els`). See `js/presets.js`/`js/sources.js`.
- **Graceful degradation is a hard requirement:** if the runtime or model fails to load, or inference throws, the user sees a clear German status message (`setStatus(..., true)`); the app never crashes or fails silently.
- UI copy is German.
- The existing image/text/QR input, processing, transparency (`keepAlpha`), and all prior features must not regress.
- Verification runs against a local server. NOTE: port 8000 may be occupied by another project in this environment — serve the Ukibori repo root on **port 8001**: `python3 -m http.server 8001` from `/Users/lasseharm/Dev/ukibori`. Navigate to `http://localhost:8001/?nocache=<n>` (vary `n` to bust Playwright's cache after edits). After any task touching load/init, check `browser_console_messages` for a clean load.
- ML `browser_evaluate` tests are async (return a Promise) and may take several seconds (model load + first inference on wasm). That is expected.

### Reference: u2netp inference contract (used by Tasks 1 & 2)

- Input: NCHW Float32 tensor `[1, 3, 320, 320]`. Preprocessing (matches the `rembg` reference): resize to 320×320, divide all RGB by the image's max pixel value, then per-channel normalize with `mean=[0.485,0.456,0.406]`, `std=[0.229,0.224,0.225]`, laid out as 3 planes (R,G,B).
- Use `session.inputNames[0]` / `session.outputNames[0]` (do NOT hardcode tensor names — they vary).
- Output: `[1, 1, 320, 320]` saliency matte. Postprocess: min-max normalize to [0,1] → 320×320 grayscale → resize to original dims (canvas bilinear) → use as the alpha channel over a copy of the source pixels.
- Runtime config before `InferenceSession.create`: `ort.env.wasm.wasmPaths = 'vendor/'`, `ort.env.wasm.numThreads = 1`, `ort.env.wasm.simd = true`.

---

### Task 1: Vendor the ONNX runtime + model, smoke-test inference

**Files:**
- Create (downloaded): `vendor/ort.min.js`, `vendor/ort-wasm-simd.wasm`, `vendor/ort-wasm.wasm`, `vendor/u2netp.onnx`

**Interfaces:**
- Produces: vendored assets reachable at `vendor/…`; a proven offline inference path (load `ort.min.js`, create a session from `vendor/u2netp.onnx`, run an input, get a `[1,1,320,320]` output).

- [ ] **Step 1: Download the assets into vendor/**

```bash
mkdir -p vendor
curl -fsSL -o vendor/ort.min.js          "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort.min.js"
curl -fsSL -o vendor/ort-wasm-simd.wasm  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort-wasm-simd.wasm"
curl -fsSL -o vendor/ort-wasm.wasm       "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort-wasm.wasm"
curl -fsSL -o vendor/u2netp.onnx         "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
ls -la vendor/   # expect ort.min.js ~570KB, ort-wasm-simd.wasm ~10.9MB, ort-wasm.wasm ~9.9MB, u2netp.onnx ~4.57MB
```

If any download is blocked in this environment, STOP and report BLOCKED with the exact failing command so the user can run it. Do NOT fabricate any binary.

- [ ] **Step 2: Write the smoke test**

Serve the repo root on 8001 (`python3 -m http.server 8001`), navigate to `http://localhost:8001/?nocache=1`, `browser_evaluate` (async — allow it time):

```js
async () => {
  if (!window.ort) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/ort.min.js';
      s.onload = res; s.onerror = () => rej(new Error('ort.min.js konnte nicht geladen werden'));
      document.head.appendChild(s);
    });
  }
  ort.env.wasm.wasmPaths = 'vendor/';
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  const sess = await ort.InferenceSession.create('vendor/u2netp.onnx', { executionProviders: ['wasm'] });
  const input = new Float32Array(1 * 3 * 320 * 320); // zeros — shape check only
  const feeds = {};
  feeds[sess.inputNames[0]] = new ort.Tensor('float32', input, [1, 3, 320, 320]);
  const r = await sess.run(feeds);
  const out = r[sess.outputNames[0]];
  if (!out || out.dims.length !== 4 || out.dims[2] !== 320 || out.dims[3] !== 320)
    throw new Error('unexpected output dims ' + JSON.stringify(out && out.dims));
  return 'ok';
}
```

- [ ] **Step 3: Run the smoke test**

Expected: returns `'ok'` (the full offline load→create→run path works). Check `browser_console_messages`: a benign ort warning is acceptable, but no errors. If the wasm fails to load, confirm `ort.env.wasm.wasmPaths` resolves to the served `vendor/` directory and that `ort-wasm-simd.wasm` is present there.

- [ ] **Step 4: Commit**

```bash
git add vendor/ort.min.js vendor/ort-wasm-simd.wasm vendor/ort-wasm.wasm vendor/u2netp.onnx
git commit -m "build: vendor onnxruntime-web + u2netp model for ML cutout"
```

(Note: this commit is large, ~16MB of binaries — expected and intentional for offline ML.)

---

### Task 2: `js/bg-removal.js` — removeBackground()

**Files:**
- Create: `js/bg-removal.js`
- Modify: `index.html` (load `js/bg-removal.js` after `js/sources.js`, before `js/app.js`)

**Interfaces:**
- Consumes: vendored assets (Task 1).
- Produces (on `window`):
  - `removeBackground(imageData) -> Promise<ImageData>` — same dimensions as input, with the matte applied as the alpha channel (subject opaque, background transparent). Rejects with a German `Error` if the runtime/model can't load or inference fails.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload; async, allow several seconds):

```js
async () => {
  if (typeof window.removeBackground !== 'function') throw new Error('removeBackground not defined');
  // A bright square on a dark background — a clear, high-salience subject.
  const W = 160, H = 160, id = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const inside = x > 40 && x < 120 && y > 40 && y < 120;
    id.data[i] = inside ? 240 : 12; id.data[i+1] = inside ? 240 : 12; id.data[i+2] = inside ? 240 : 12; id.data[i+3] = 255;
  }
  const out = await window.removeBackground(id);
  if (!(out instanceof ImageData) || out.width !== W || out.height !== H) throw new Error('bad output dims');
  let amin = 255, amax = 0;
  for (let i = 3; i < out.data.length; i += 4) { const a = out.data[i]; if (a < amin) amin = a; if (a > amax) amax = a; }
  if (amax - amin < 20) throw new Error('matte is ~uniform (amin=' + amin + ', amax=' + amax + ') — model not segmenting');
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `removeBackground not defined`.

- [ ] **Step 3: Write minimal implementation**

Create `js/bg-removal.js`:

```js
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
```

In `index.html`, add the script tag after `js/sources.js` and before `js/app.js`:

```html
<script src="js/bg-removal.js"></script>
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload with a fresh `?nocache=`). Expected: `'ok'`. Check `browser_console_messages` clean (benign ort warnings OK, no errors).

- [ ] **Step 5: Commit**

```bash
git add js/bg-removal.js index.html
git commit -m "feat: local ML background removal (u2netp via onnxruntime-web)"
```

---

### Task 3: "Hintergrund entfernen" button + apply wiring

**Files:**
- Modify: `index.html` (button in the Conversion accordion, near the `keepAlpha` toggle)
- Modify: `js/app.js` (els entry, click handler, busy state)

**Interfaces:**
- Consumes: `removeBackground` (Task 2), `originalData`, `adoptImageData` or `render` + `els.keepAlpha`.
- Produces: a click handler that runs `removeBackground(originalData)`, on success replaces `originalData` with the cutout, enables `keepAlpha`, and re-renders; on failure shows a German error status. While running it shows a "läuft…" status and disables the button.

- [ ] **Step 1: Write the failing test**

`browser_evaluate` (after reload). This test stubs `window.removeBackground` to avoid a slow real inference and to exercise BOTH the success and the graceful-failure UI paths:

```js
async () => {
  const btn = document.getElementById('bgRemove');
  if (!btn) throw new Error('#bgRemove button missing');
  // seed a source image
  const W = 8, H = 8, id = new ImageData(W, H);
  for (let i = 0; i < id.data.length; i += 4) { id.data[i]=id.data[i+1]=id.data[i+2]=128; id.data[i+3]=255; }
  window.adoptImageData(id, 'seed');

  // success path: stub returns a transparent-ish image
  const orig = window.removeBackground;
  window.removeBackground = async (imageData) => {
    const r = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    for (let i = 3; i < r.data.length; i += 4) r.data[i] = 0; // fully transparent
    return r;
  };
  btn.click();
  await new Promise(r => setTimeout(r, 50));
  if (!window.els.keepAlpha.checked) throw new Error('keepAlpha should be enabled after cutout');

  // failure path: stub rejects -> error status shown, no throw escapes
  window.removeBackground = async () => { throw new Error('Testfehler'); };
  btn.click();
  await new Promise(r => setTimeout(r, 50));
  if (!window.els.status.classList.contains('error')) throw new Error('error status not shown on failure');

  window.removeBackground = orig;
  return 'ok';
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: throws `#bgRemove button missing`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, add the button just after the `keepAlpha` field block in the Conversion accordion (it applies in both modes):

```html
              <div class="field">
                <button id="bgRemove" type="button" class="btn" disabled>Hintergrund entfernen (KI)</button>
                <span class="hint">Lokales KI-Modell · erste Nutzung lädt das Modell (~5 MB)</span>
              </div>
```

In `js/app.js`:
- Add to the `els` object: `bgRemove: document.getElementById('bgRemove'),`
- Add `els.bgRemove` to the `enableControls` disable-list array.
- Add the handler near the other input wiring:

```js
els.bgRemove.addEventListener('click', async () => {
  if (!originalData) return;
  els.bgRemove.disabled = true;
  setStatus('KI-Freistellung läuft… (Modell wird ggf. geladen)', false);
  try {
    const cut = await removeBackground(originalData);
    originalData = cut;
    els.keepAlpha.checked = true;
    document.body.classList.add('alpha');
    setStatus(`Hintergrund entfernt: ${cut.width}×${cut.height}px`, false);
    render();
  } catch (e) {
    setStatus(e.message || 'KI-Freistellung nicht verfügbar.', true);
  } finally {
    els.bgRemove.disabled = false;
  }
});
```

(Note: `els.keepAlpha` change normally toggles `body.alpha` and re-renders; here we set both directly and call `render()` once. Setting `originalData` then `render()` reprocesses with transparency kept.)

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1 `browser_evaluate` (reload). Expected: `'ok'`. Check `browser_console_messages` clean.

Optional manual confirmation (real inference, not automated): load a photo, click the button, confirm after a few seconds the background becomes transparent in the preview.

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: 'Hintergrund entfernen' button with busy + graceful-failure states"
```

---

## Self-Review

**Spec coverage (Phase B2 — feature #10 ML background removal):**
- Vendor onnxruntime-web + u2netp locally, offline → Task 1 ✓
- `removeBackground(imageData)` lazy-loads runtime, resize→normalize→infer→matte→alpha → Task 2 ✓
- Graceful degradation (missing assets / inference error → German status, no crash) → Task 2 (German Errors) + Task 3 (try/catch → setStatus error) ✓
- Button + busy spinner/status, feeds existing `keepAlpha` transparency path → Task 3 ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:**
- `removeBackground(imageData) -> Promise<ImageData>` — produced Task 2, consumed Task 3 (and stubbed in Task 3's test). ✓
- Runtime config (`ort.env.wasm.wasmPaths='vendor/'`, `numThreads=1`, `simd=true`) and `session.inputNames[0]`/`outputNames[0]` usage consistent between Task 1 smoke test and Task 2. ✓
- Input tensor `[1,3,320,320]`, output `[1,1,320,320]` consistent across Tasks 1–2 and the Reference block. ✓

**Classic-script scope:** `bg-removal.js` is an IIFE exposing only `window.removeBackground`; no top-level `const` collision. ort is loaded dynamically (not a static tag) so it doesn't add a global until first use. ✓

**Offline integrity:** all four assets vendored; runtime config points `wasmPaths` at `vendor/`; no CDN reference at runtime. ✓

**No regression:** Task 3 only adds a button + handler; existing `keepAlpha` semantics preserved (handler sets the same `body.alpha` class + checked state the normal toggle would). Input image/text/QR paths untouched. ✓

**Known risk flagged:** the matte-quality test (Task 2 Step 1) asserts only that the matte is non-uniform (amax-amin ≥ 20), not segmentation accuracy — appropriate for an automated test; true quality is confirmed by the optional manual photo check in Task 3.
