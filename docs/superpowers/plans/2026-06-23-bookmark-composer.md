# Bookmark Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Lesezeichen" (bookmark) mode to Ukibori: a drag-and-drop canvas that composes multiple image and text elements onto a fixed-size rounded bookmark body and exports a multicolor `.3mf` (each color its own part).

**Architecture:** A new second mode in the existing single-page app. The bookmark *document* (body dimensions + ordered element list) lives in a pure model module. A pure export module rasterizes the composition, groups pixels by `(color, depth)`, intersects each group with an analytic rounded-rect/hole signed field, and extrudes via the existing `geometry.js` pipeline into `.3mf` parts. A DOM/canvas editor module renders the document, handles selection/move/scale/rotate, the layer list, the properties panel, project save/load, and export wiring. The existing "Bild → Relief" flow is untouched.

**Tech Stack:** Vanilla JS (no build, zero dependencies), HTML Canvas 2D, the browser FontFace API, existing `js/geometry.js` (marching squares, earcut, extrude, 3MF/zip) and `js/image-ops.js` (threshold, quantize, posterize, island cleanup, hexToRgb).

## Global Constraints

- **Zero dependencies, no build step.** Plain `<script src>` (non-module) globals only; everything runs from `file://` opening `index.html`. (Verbatim from spec: "zero-dependency promise".)
- **All scripts use `"use strict";`** as their first line, matching `js/app.js`, `js/geometry.js`, `js/image-ops.js`.
- **Do not modify the existing image→relief behavior.** New markup/CSS/JS is additive.
- **Geometry units:** field sampler functions take grid coords `(c, r)` (c in `[0,cols)`, r in `[0,rows)`, r=0 = top) and return a signed value, **>0 inside**, magnitude in **cell units**. `fieldFacets(f, cols, rows, pitch, thickness, smoothTol, z0)` maps loops to mm as `[c*pitch, (rows-1-r)*pitch]` and extrudes `z ∈ [z0, z0+thickness]`. (Verbatim convention from `js/geometry.js` and `js/app.js#buildFields`.)
- **UI language is German**, matching existing labels (e.g. "Schwarz / Weiß", "PNG herunterladen").
- **Defaults:** corner radius 4 mm, layer height 0.2 mm, total thickness 3 mm, hole ⌀5 mm 8 mm from top, base color `#000000`, export resolution 256, smoothing 0.5 cells.

**Deviation from spec (testability):** the spec named two new JS files (`bookmark-editor.js`, `bookmark-export.js`). This plan adds a third, `js/bookmark-model.js`, holding the pure document model + project serialize/deserialize so those can be unit-tested without the DOM. Image elements carry a runtime-only `_img` (decoded `HTMLImageElement`/canvas) that the editor populates and the export module reads, keeping the export pipeline synchronous and unit-testable.

---

## File Structure

- `js/bookmark-model.js` — **new, pure**: `defaultBookmark()`, `makeImageElement()`, `makeTextElement()`, `serializeProject()`, `deserializeProject()`, id counter.
- `js/bookmark-export.js` — **new**: `composeDesign()`, `buildBookmarkParts()`, `exportBookmark3MF()` (uses offscreen canvas + `geometry.js` + `image-ops.js`).
- `js/geometry.js` — **modify**: add `roundedRectHoleField(cols, rows, p)`.
- `js/bookmark-editor.js` — **new**: document state, canvas render, hit-testing, drag/scale/rotate, layer list, properties panel, add image/text, save/load, export wiring, mode switch.
- `index.html` — **modify**: top-level mode switch + bookmark workspace markup; load the 4 new scripts.
- `styles.css` — **modify**: bookmark editor styles.
- `tests/harness.js` — **new**: tiny assert/test collector.
- `tests/run.html` — **new**: loads all sources + test files, exposes `window.__results`.
- `tests/*.test.js` — **new**: per-module test files.

---

### Task 1: Test harness + rounded-rect/hole signed field

**Files:**
- Create: `tests/harness.js`
- Create: `tests/run.html`
- Create: `tests/geometry-sdf.test.js`
- Modify: `js/geometry.js` (append `roundedRectHoleField` + `window` export)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `test(name, fn)`, `assert(cond, msg)`, `assertEqual(actual, expected, msg)`, `assertClose(actual, expected, eps, msg)`, `window.__results = {pass, fail, failures[]}` (globals from `harness.js`).
  - `roundedRectHoleField(cols, rows, p) -> (c, r) => number`, where `p = {widthMm, heightMm, cornerRadiusMm, hole:{diameterMm, marginTopMm}}`. Returns a signed field in cell units, **>0 inside the body and outside the hole**. Cell centers map to mm as `xMm=(c+0.5)/(cols/widthMm)`, `yMm=(r+0.5)/(rows/heightMm)`, with `r=0` the top edge and the hole centered horizontally at `marginTopMm + diameterMm/2` from the top.

- [ ] **Step 1: Write the test harness**

Create `tests/harness.js`:

```javascript
"use strict";
window.__results = { pass: 0, fail: 0, failures: [] };
window.__pending = [];
function test(name, fn) {
  const run = async () => {
    try { await fn(); window.__results.pass++; }
    catch (e) { window.__results.fail++; window.__results.failures.push(name + ": " + (e && e.message || e)); }
  };
  window.__pending.push(run());
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg || "") + ` expected ${expected} got ${actual}`);
}
function assertClose(actual, expected, eps, msg) {
  const e = eps == null ? 1e-6 : eps;
  if (Math.abs(actual - expected) > e) throw new Error((msg || "") + ` expected ~${expected} got ${actual}`);
}
window.__ready = () => Promise.all(window.__pending).then(() => { window.__done = true; return window.__results; });
```

- [ ] **Step 2: Write the test runner page**

Create `tests/run.html`:

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Ukibori tests</title></head>
<body>
<pre id="out">running…</pre>
<script src="harness.js"></script>
<!-- sources under test -->
<script src="../js/image-ops.js"></script>
<script src="../js/geometry.js"></script>
<script src="../js/bookmark-model.js"></script>
<script src="../js/bookmark-export.js"></script>
<!-- tests -->
<script src="geometry-sdf.test.js"></script>
<script src="bookmark-model.test.js"></script>
<script src="bookmark-export.test.js"></script>
<script>
window.__ready().then(r => {
  document.getElementById("out").textContent =
    `pass: ${r.pass}  fail: ${r.fail}\n` + r.failures.map(f => "FAIL " + f).join("\n");
});
</script>
</body></html>
```

Note: `bookmark-model.js`, `bookmark-export.js`, `bookmark-model.test.js`, `bookmark-export.test.js` are created in later tasks. Until then the browser console will log 404s for the missing files; the present task's tests still run. That is expected.

- [ ] **Step 3: Write the failing test**

Create `tests/geometry-sdf.test.js`:

```javascript
"use strict";
(function () {
  const p = { widthMm: 50, heightMm: 150, cornerRadiusMm: 4, hole: { diameterMm: 5, marginTopMm: 8 } };
  const cols = 50, rows = 150; // 1 cell per mm → easy mm math

  test("sdf: center of body is inside (>0)", () => {
    const f = roundedRectHoleField(cols, rows, p);
    assert(f(25, 75) > 0, "center should be inside");
  });
  test("sdf: hole center is outside (<0)", () => {
    const f = roundedRectHoleField(cols, rows, p);
    // hole center mm = (25, 8+2.5=10.5) -> cell (24.5,10) approx
    assert(f(25, 10) < 0, "hole center should be excluded");
  });
  test("sdf: far outside the body is outside (<0)", () => {
    const f = roundedRectHoleField(cols, rows, p);
    assert(f(60, 75) < 0, "right of body should be outside");
  });
  test("sdf: rounded corner is cut (corner pixel outside)", () => {
    const f = roundedRectHoleField(cols, rows, p);
    // extreme top-left cell, well within the 4mm corner radius -> outside
    assert(f(0, 0) < 0, "sharp corner should be rounded away");
  });
})();
```

- [ ] **Step 4: Run test to verify it fails**

Using the Playwright MCP browser: `browser_navigate` to `file://<repo>/tests/run.html`, then `browser_evaluate` `() => window.__ready ? window.__ready() : null` (await), then read `#out` text or the returned object.
Expected: FAIL — failures include `roundedRectHoleField is not defined` for each test (function not yet added).

- [ ] **Step 5: Implement `roundedRectHoleField` in `js/geometry.js`**

Append before the final newline of `js/geometry.js`:

```javascript
// Analytic signed field (>0 inside the rounded-rect body AND outside the hole),
// in cell units, for a cols×rows grid spanning widthMm×heightMm. Cell centers
// map to mm via (c+0.5)/(cols/widthMm), (r+0.5)/(rows/heightMm); r=0 is the top.
// The hole is horizontally centered, its center marginTopMm+radius from the top.
function roundedRectHoleField(cols, rows, p) {
  const sx = cols / p.widthMm, sy = rows / p.heightMm; // cells per mm
  const s = (sx + sy) / 2;                              // ~uniform scale for radii
  const hw = p.widthMm / 2, hh = p.heightMm / 2;
  const rr = Math.min(p.cornerRadiusMm, hw, hh);
  const holeR = p.hole.diameterMm / 2;
  const holeCx = p.widthMm / 2, holeCy = p.hole.marginTopMm + holeR;
  return (c, r) => {
    const x = (c + 0.5) / sx, y = (r + 0.5) / sy;       // mm, origin top-left
    // rounded-rect SDF (centered): >0 outside, <0 inside
    const qx = Math.abs(x - hw) - (hw - rr), qy = Math.abs(y - hh) - (hh - rr);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    const bodyInside = -outside;                         // >0 inside body, mm
    const holeOutside = Math.hypot(x - holeCx, y - holeCy) - holeR; // >0 outside hole, mm
    return Math.min(bodyInside, holeOutside) * s;        // mm -> cells
  };
}
window.roundedRectHoleField = roundedRectHoleField;
```

- [ ] **Step 6: Run test to verify it passes**

Re-run `tests/run.html` via the Playwright MCP (navigate, await `window.__ready()`).
Expected: the four `sdf:` tests PASS (`#out` shows them passing; the 404s for not-yet-created files remain and are fine).

- [ ] **Step 7: Commit**

```bash
git add tests/harness.js tests/run.html tests/geometry-sdf.test.js js/geometry.js
git commit -m "feat(bookmark): rounded-rect/hole signed field + test harness"
```

---

### Task 2: Bookmark document model + project save/load

**Files:**
- Create: `js/bookmark-model.js`
- Create: `tests/bookmark-model.test.js`

**Interfaces:**
- Consumes: harness globals (Task 1).
- Produces (all on `window`):
  - `defaultBookmark() -> doc` with shape:
    ```
    { widthMm, heightMm, cornerRadiusMm, thicknessMm, layerHeightMm, smooth,
      resolution, baseColor, hole:{diameterMm, marginTopMm}, elements:[] }
    ```
  - `makeImageElement(props) -> el` and `makeTextElement(props) -> el`. Shared fields: `{id, type, cxMm, cyMm, wMm, hMm, rotationDeg, depthLayers, cutout, colorMode}`. Image adds `{src, color, threshold, invert, reduce:{method, numColors, levels}, _img:null}`. Text adds `{text, color, fontFamily, fontWeight}`. `id` is a unique increasing integer string.
  - `serializeProject(doc) -> string` — JSON; strips runtime `_img`.
  - `deserializeProject(text) -> doc` — parses; re-adds `_img:null` to image elements.

- [ ] **Step 1: Write the failing tests**

Create `tests/bookmark-model.test.js`:

```javascript
"use strict";
(function () {
  test("model: defaults match spec", () => {
    const d = defaultBookmark();
    assertEqual(d.widthMm, 50, "width");
    assertEqual(d.heightMm, 150, "height");
    assertEqual(d.cornerRadiusMm, 4, "corner");
    assertEqual(d.thicknessMm, 3, "thickness");
    assertEqual(d.layerHeightMm, 0.2, "layerHeight");
    assertEqual(d.hole.diameterMm, 5, "hole d");
    assertEqual(d.hole.marginTopMm, 8, "hole margin");
    assertEqual(d.baseColor, "#000000", "baseColor");
    assertEqual(d.elements.length, 0, "no elements");
  });
  test("model: ids are unique", () => {
    const a = makeTextElement({}), b = makeTextElement({});
    assert(a.id !== b.id, "ids differ");
  });
  test("model: image element has reduce defaults + _img slot", () => {
    const e = makeImageElement({ src: "x" });
    assertEqual(e.type, "image", "type");
    assertEqual(e.colorMode, "solid", "default solid");
    assertEqual(e.reduce.method, "palette", "reduce method");
    assert("_img" in e && e._img === null, "_img slot present and null");
  });
  test("model: serialize strips _img and roundtrips", () => {
    const d = defaultBookmark();
    d.elements.push(makeImageElement({ src: "data:abc" }));
    d.elements[0]._img = { fake: true };
    const json = serializeProject(d);
    assert(json.indexOf("_img") === -1, "_img not serialized");
    const back = deserializeProject(json);
    assertEqual(back.elements[0].src, "data:abc", "src roundtrips");
    assert(back.elements[0]._img === null, "_img restored to null");
    assertEqual(back.widthMm, 50, "doc fields roundtrip");
  });
})();
```

- [ ] **Step 2: Run tests to verify they fail**

Re-run `tests/run.html`.
Expected: FAIL — `defaultBookmark is not defined`, etc.

- [ ] **Step 3: Implement `js/bookmark-model.js`**

```javascript
"use strict";
// Pure bookmark document model + project (de)serialization. No DOM.

let __bmId = 0;
function __nextId() { __bmId += 1; return String(__bmId); }

function defaultBookmark() {
  return {
    widthMm: 50, heightMm: 150, cornerRadiusMm: 4,
    thicknessMm: 3, layerHeightMm: 0.2, smooth: 0.5,
    resolution: 256, baseColor: "#000000",
    hole: { diameterMm: 5, marginTopMm: 8 },
    elements: [],
  };
}

function __baseElement(type, props) {
  return Object.assign({
    id: __nextId(), type,
    cxMm: 25, cyMm: 75, wMm: 30, hMm: 30, rotationDeg: 0,
    depthLayers: 2, cutout: false, colorMode: "solid",
  }, props);
}

function makeImageElement(props) {
  const e = __baseElement("image", props);
  if (e.color == null) e.color = "#ffffff";
  if (e.threshold == null) e.threshold = 128;
  if (e.invert == null) e.invert = false;
  if (e.reduce == null) e.reduce = { method: "palette", numColors: 8, levels: 4 };
  if (e.src == null) e.src = "";
  e._img = null; // runtime-only decoded image; never serialized
  return e;
}

function makeTextElement(props) {
  const e = __baseElement("text", props);
  if (e.text == null) e.text = "Text";
  if (e.color == null) e.color = "#ffffff";
  if (e.fontFamily == null) e.fontFamily = "system-ui";
  if (e.fontWeight == null) e.fontWeight = "normal";
  e.colorMode = "solid"; // text is always solid
  return e;
}

function serializeProject(doc) {
  return JSON.stringify(doc, (k, v) => (k === "_img" ? undefined : v), 2);
}

function deserializeProject(text) {
  const doc = JSON.parse(text);
  for (const el of doc.elements || []) if (el.type === "image") el._img = null;
  return doc;
}

window.defaultBookmark = defaultBookmark;
window.makeImageElement = makeImageElement;
window.makeTextElement = makeTextElement;
window.serializeProject = serializeProject;
window.deserializeProject = deserializeProject;
```

- [ ] **Step 4: Run tests to verify they pass**

Re-run `tests/run.html`.
Expected: all `model:` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/bookmark-model.js tests/bookmark-model.test.js
git commit -m "feat(bookmark): document model + project serialize/deserialize"
```

---

### Task 3: Compose the design raster

**Files:**
- Create: `js/bookmark-export.js` (first function only)
- Create: `tests/bookmark-export.test.js`

**Interfaces:**
- Consumes: `defaultBookmark`, `makeImageElement`, `makeTextElement` (Task 2); `applyThreshold`, `quantizeMedianCut`, `posterize`, `hexToRgb` (existing `image-ops.js`).
- Produces (on `window`):
  - `composeDesign(doc, cols, rows) -> { r, g, b, depthMm, cutout, isBase }` where `r/g/b` are `Uint8ClampedArray(cols*rows)` of the front color per pixel, `depthMm` is `Float32Array(cols*rows)`, `cutout` is `Uint8Array` (1 where the owning element is a cutout), `isBase` is `Uint8Array` (1 where no element covers the pixel → base color/full thickness). Pixel index = `r*cols + c`. Elements are painted **top-of-list-last = on top** (last element in `doc.elements` wins), matching z-order where later = on top. Each image element must have a decoded `_img` (HTMLImageElement or canvas); elements with `_img == null` are skipped. Footprint/hole clipping is NOT applied here (done at the field stage).

Coordinate mapping for rendering an element: bookmark mm → grid px scale `sx = cols/widthMm`, `sy = rows/heightMm`. An element is drawn centered at `(cxMm*sx, cyMm*sy)`, rotated `rotationDeg`, into a box `wMm*sx × hMm*sy`.

- [ ] **Step 1: Write the failing tests**

Create `tests/bookmark-export.test.js`:

```javascript
"use strict";
(function () {
  // Build a 20×20 solid-red canvas to act as a decoded image.
  function redCanvas() {
    const cv = document.createElement("canvas"); cv.width = 20; cv.height = 20;
    const cx = cv.getContext("2d"); cx.fillStyle = "#ff0000"; cx.fillRect(0, 0, 20, 20);
    return cv;
  }

  test("compose: empty doc is all base", () => {
    const d = defaultBookmark();
    const out = composeDesign(d, 25, 75);
    let allBase = true;
    for (let i = 0; i < out.isBase.length; i++) if (!out.isBase[i]) allBase = false;
    assert(allBase, "every pixel should be base");
    assertClose(out.depthMm[0], d.thicknessMm, 1e-4, "base depth = thickness");
  });

  test("compose: a solid image paints its color over the center", () => {
    const d = defaultBookmark();
    const el = makeImageElement({ src: "x", colorMode: "solid", color: "#00ff00",
      cxMm: 25, cyMm: 75, wMm: 40, hMm: 40, depthLayers: 2, threshold: 200 });
    el._img = redCanvas(); // red, luminance ~76 < 200 -> below threshold -> part of silhouette
    d.elements.push(el);
    const cols = 50, rows = 150;
    const out = composeDesign(d, cols, rows);
    const idx = 75 * cols + 25; // center
    assertEqual(out.isBase[idx], 0, "center owned by element");
    assertEqual(out.g[idx], 255, "center is green (element color)");
    assertClose(out.depthMm[idx], 2 * d.layerHeightMm, 1e-4, "depth = layers*height");
  });

  test("compose: later element wins (z-order) and cutout flagged", () => {
    const d = defaultBookmark();
    const under = makeImageElement({ src: "x", color: "#0000ff", cxMm: 25, cyMm: 75,
      wMm: 40, hMm: 40, threshold: 200, cutout: false });
    under._img = redCanvas();
    const over = makeImageElement({ src: "x", color: "#ffffff", cxMm: 25, cyMm: 75,
      wMm: 40, hMm: 40, threshold: 200, cutout: true });
    over._img = redCanvas();
    d.elements.push(under, over);
    const cols = 50, rows = 150, idx = 75 * cols + 25;
    const out = composeDesign(d, cols, rows);
    assertEqual(out.r[idx], 255, "top element (white) wins R");
    assertEqual(out.g[idx], 255, "top element (white) wins G");
    assertEqual(out.cutout[idx], 1, "top element cutout flag set");
  });
})();
```

- [ ] **Step 2: Run tests to verify they fail**

Re-run `tests/run.html`.
Expected: FAIL — `composeDesign is not defined`.

- [ ] **Step 3: Implement `composeDesign` in `js/bookmark-export.js`**

```javascript
"use strict";
// Bookmark export: rasterize the composition, group by (color, depth), extrude
// via geometry.js into a multicolor .3mf. Reuses image-ops.js + geometry.js.

const __ALPHA_CUTOFF = 128;

// Render one element into an offscreen ImageData of size cols×rows. Returns
// { mask:Uint8Array, r,g,b:Uint8ClampedArray } — mask=1 where the element is
// opaque. For reduce-mode images r/g/b vary per pixel; otherwise they are the
// element's flat color where mask=1.
function __renderElement(el, doc, cols, rows) {
  const sx = cols / doc.widthMm, sy = rows / doc.heightMm;
  const cv = document.createElement("canvas"); cv.width = cols; cv.height = rows;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const w = el.wMm * sx, h = el.hMm * sy;
  ctx.save();
  ctx.translate(el.cxMm * sx, el.cyMm * sy);
  ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
  if (el.type === "text") {
    ctx.fillStyle = el.color;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // Fit font size to the box height; the editor sets hMm to the cap height.
    ctx.font = `${el.fontWeight} ${Math.max(1, Math.round(h))}px ${el.fontFamily}`;
    ctx.fillText(el.text, 0, 0);
  } else if (el._img) {
    ctx.drawImage(el._img, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
  const img = ctx.getImageData(0, 0, cols, rows);
  const d = img.data, n = cols * rows;
  const mask = new Uint8Array(n);
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);

  if (el.type === "image" && el.colorMode === "reduce" && el._img) {
    if (el.reduce.method === "palette") quantizeMedianCut(img, el.reduce.numColors);
    else posterize(img, el.reduce.levels);
    const q = img.data;
    for (let i = 0; i < n; i++) {
      if (d[i * 4 + 3] >= __ALPHA_CUTOFF) { mask[i] = 1; r[i] = q[i * 4]; g[i] = q[i * 4 + 1]; b[i] = q[i * 4 + 2]; }
    }
    return { mask, r, g, b };
  }

  // Solid: silhouette from alpha; for images also apply luminance threshold.
  const col = hexToRgb(el.color);
  for (let i = 0; i < n; i++) {
    let on = d[i * 4 + 3] >= __ALPHA_CUTOFF;
    if (on && el.type === "image") {
      const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      on = el.invert ? lum >= el.threshold : lum < el.threshold;
    }
    if (on) { mask[i] = 1; r[i] = col[0]; g[i] = col[1]; b[i] = col[2]; }
  }
  return { mask, r, g, b };
}

// Composite all elements (last = on top) into per-pixel front color/depth/flags.
function composeDesign(doc, cols, rows) {
  const n = cols * rows;
  const base = hexToRgb(doc.baseColor);
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
  const depthMm = new Float32Array(n), cutout = new Uint8Array(n), isBase = new Uint8Array(n);
  for (let i = 0; i < n; i++) { r[i] = base[0]; g[i] = base[1]; b[i] = base[2]; depthMm[i] = doc.thicknessMm; isBase[i] = 1; }
  for (const el of doc.elements) {
    if (el.type === "image" && !el._img) continue;
    const layer = __renderElement(el, doc, cols, rows);
    const d = (el.depthLayers || 0) * doc.layerHeightMm;
    for (let i = 0; i < n; i++) {
      if (!layer.mask[i]) continue;
      r[i] = layer.r[i]; g[i] = layer.g[i]; b[i] = layer.b[i];
      depthMm[i] = d; cutout[i] = el.cutout ? 1 : 0; isBase[i] = 0;
    }
  }
  return { r, g, b, depthMm, cutout, isBase };
}

window.composeDesign = composeDesign;
```

- [ ] **Step 4: Run tests to verify they pass**

Re-run `tests/run.html`.
Expected: all `compose:` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/bookmark-export.js tests/bookmark-export.test.js
git commit -m "feat(bookmark): compose design raster (z-order, color, depth, cutout)"
```

---

### Task 4: Build `.3mf` parts and export

**Files:**
- Modify: `js/bookmark-export.js` (append `buildBookmarkParts`, `exportBookmark3MF`)
- Modify: `tests/bookmark-export.test.js` (append parts tests)

**Interfaces:**
- Consumes: `composeDesign` (Task 3); `roundedRectHoleField` (Task 1); `fieldFacets`, `orientOutward`, `signedVolume`, `build3MF` (existing `geometry.js`).
- Produces (on `window`):
  - `buildBookmarkParts(doc) -> [{ name, color:[r,g,b], facets }]`. Computes grid from `doc.resolution` (longest side = resolution, aspect-correct), composes, groups, intersects every group field with `roundedRectHoleField`, extrudes front color slabs `z ∈ [T-d, T]` and base body slabs `z ∈ [0, T-d]` (and full `[0,T]` for background), merges all base-colored facets into one `grundplatte` part, returns parts with non-empty facet arrays only.
  - `exportBookmark3MF(doc) -> {parts, blob}` and triggers a browser download of `lesezeichen.3mf`.

Grouping key for color: `"#rrggbb"` hex (uppercase). A part's `color` is the parsed `[r,g,b]`. The base color is grouped under its own hex like any other; element regions whose color equals the base color naturally merge into the base part.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bookmark-export.test.js` (inside the IIFE, before the closing `})();`):

```javascript
  function redCanvas2() {
    const cv = document.createElement("canvas"); cv.width = 20; cv.height = 20;
    const cx = cv.getContext("2d"); cx.fillStyle = "#ff0000"; cx.fillRect(0, 0, 20, 20);
    return cv;
  }

  test("parts: empty doc yields a single base part", () => {
    const d = defaultBookmark(); d.resolution = 64;
    const parts = buildBookmarkParts(d);
    assertEqual(parts.length, 1, "one part");
    assertEqual(parts[0].name, "grundplatte", "base part name");
    assert(parts[0].facets.length > 0, "base has facets");
  });

  test("parts: a green element adds a second colored part with outward volume", () => {
    const d = defaultBookmark(); d.resolution = 64; d.baseColor = "#000000";
    const el = makeImageElement({ src: "x", color: "#00ff00", cxMm: 25, cyMm: 75,
      wMm: 40, hMm: 40, threshold: 200, depthLayers: 2, cutout: false });
    el._img = redCanvas2();
    d.elements.push(el);
    const parts = buildBookmarkParts(d);
    assert(parts.length >= 2, "base + green");
    const green = parts.find(p => p.color[0] === 0 && p.color[1] === 255 && p.color[2] === 0);
    assert(green, "green part exists");
    assert(signedVolume(green.facets) > 0, "green volume positive (outward)");
  });
})();
```

(The existing `})();` line stays as the IIFE close; insert the two tests just above it.)

- [ ] **Step 2: Run tests to verify they fail**

Re-run `tests/run.html`.
Expected: FAIL — `buildBookmarkParts is not defined`.

- [ ] **Step 3: Implement `buildBookmarkParts` + `exportBookmark3MF`**

Append to `js/bookmark-export.js`:

```javascript
// Aspect-correct grid: longest side = resolution.
function __gridFor(doc) {
  const res = Math.max(8, Math.round(doc.resolution));
  if (doc.widthMm >= doc.heightMm) {
    const cols = res; return { cols, rows: Math.max(2, Math.round(res * doc.heightMm / doc.widthMm)) };
  }
  const rows = res; return { rows, cols: Math.max(2, Math.round(res * doc.widthMm / doc.heightMm)) };
}

function __hex(r, g, b) {
  const h = x => x.toString(16).padStart(2, "0");
  return ("#" + h(r) + h(g) + h(b)).toUpperCase();
}

// Build a binary signed field (>0 inside) from a membership predicate, then
// intersect (min) with the body/hole field so every part shares one outline.
function __maskField(member, footprint, cols) {
  return (c, r) => Math.min(member(c, r) ? 1 : -1, footprint(c, r));
}

function buildBookmarkParts(doc) {
  const { cols, rows } = __gridFor(doc);
  const comp = composeDesign(doc, cols, rows);
  const footprint = roundedRectHoleField(cols, rows, doc);
  const pitch = doc.widthMm / cols;
  const smoothTol = (doc.smooth || 0) * pitch;
  const T = doc.thicknessMm;
  const baseHex = doc.baseColor.toUpperCase();
  const idx = (c, r) => r * cols + c;
  const facetsByColor = new Map(); // hex -> facets[]
  const push = (hex, facets) => {
    if (!facets.length) return;
    if (!facetsByColor.has(hex)) facetsByColor.set(hex, []);
    const acc = facetsByColor.get(hex); for (const f of facets) acc.push(f);
  };

  // 1) Front color slabs, grouped by (colorHex, depthMm).
  const groups = new Map(); // key "hex|depth" -> {hex, depth, set:Uint8Array}
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(c, r);
    if (comp.isBase[i]) continue;
    const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
    const depth = comp.depthMm[i];
    const key = hex + "|" + depth.toFixed(4);
    let grp = groups.get(key);
    if (!grp) { grp = { hex, depth, set: new Uint8Array(cols * rows) }; groups.set(key, grp); }
    grp.set[i] = 1;
  }
  for (const grp of groups.values()) {
    const f = __maskField((c, r) => grp.set[idx(c, r)] === 1, footprint, cols);
    const facets = orientOutward(fieldFacets(f, cols, rows, pitch, grp.depth, smoothTol, T - grp.depth));
    push(grp.hex, facets);
  }

  // 2) Base body behind non-cutout element pixels, grouped by depth; plus the
  //    full-thickness background.
  const behind = new Map(); // depthMm -> Uint8Array
  const bg = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(c, r);
    if (comp.isBase[i]) { bg[i] = 1; continue; }
    if (comp.cutout[i]) continue;            // recess: nothing behind
    const d = comp.depthMm[i];
    if (d >= T) continue;                     // element already full thickness
    let set = behind.get(d); if (!set) { set = new Uint8Array(cols * rows); behind.set(d, set); }
    set[i] = 1;
  }
  // background: full thickness
  {
    const f = __maskField((c, r) => bg[idx(c, r)] === 1, footprint, cols);
    push(baseHex, orientOutward(fieldFacets(f, cols, rows, pitch, T, smoothTol, 0)));
  }
  for (const [d, set] of behind) {
    const f = __maskField((c, r) => set[idx(c, r)] === 1, footprint, cols);
    push(baseHex, orientOutward(fieldFacets(f, cols, rows, pitch, T - d, smoothTol, 0)));
  }

  // 3) Assemble parts; base first and named "grundplatte".
  const parts = [];
  if (facetsByColor.has(baseHex)) {
    parts.push({ name: "grundplatte", color: hexToRgb(baseHex), facets: facetsByColor.get(baseHex) });
    facetsByColor.delete(baseHex);
  }
  let n = 1;
  for (const [hex, facets] of facetsByColor) parts.push({ name: "farbe-" + (n++), color: hexToRgb(hex), facets });
  return parts.filter(p => p.facets.length);
}

function exportBookmark3MF(doc) {
  const parts = buildBookmarkParts(doc);
  const blob = build3MF(parts);
  const a = document.createElement("a");
  a.download = "lesezeichen.3mf";
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
  return { parts, blob };
}

window.buildBookmarkParts = buildBookmarkParts;
window.exportBookmark3MF = exportBookmark3MF;
```

- [ ] **Step 4: Run tests to verify they pass**

Re-run `tests/run.html`.
Expected: all `parts:` tests PASS (plus all earlier tests still green).

- [ ] **Step 5: Commit**

```bash
git add js/bookmark-export.js tests/bookmark-export.test.js
git commit -m "feat(bookmark): build multicolor .3mf parts + export"
```

---

### Task 5: Mode switch + bookmark workspace markup & styles

**Files:**
- Modify: `index.html`
- Modify: `styles.css`

**Interfaces:**
- Consumes: nothing yet (wiring is Task 6–8).
- Produces: DOM structure the editor binds to. Required element ids:
  - Top mode switch: `#appModeRelief`, `#appModeBookmark` (buttons); body class `bookmark-mode` toggles which workspace shows.
  - Bookmark workspace root `#bmWorkspace` containing:
    - Buttons: `#bmAddImage`, `#bmAddText`, `#bmFile` (hidden file input, `accept="image/*"`), `#bmFontFile` (hidden, `accept=".ttf,.otf,font/*"`), `#bmExport`, `#bmSave`, `#bmLoad`, `#bmLoadFile` (hidden, `accept=".json"`).
    - Bookmark setting inputs: `#bmWidth`, `#bmHeight`, `#bmCorner`, `#bmThickness`, `#bmLayerHeight`, `#bmHoleD`, `#bmHoleMargin`, `#bmBaseColor` (color), `#bmResolution`, each with a `…Val` badge span where applicable.
    - `#bmLayers` (the layer list `<ul>`).
    - `#bmProps` (the selected-element properties container).
    - `#bmCanvas` (`<canvas>`), wrapped in `#bmPreview`.
    - `#bmStatus` (status line).

- [ ] **Step 1: Add the top-level mode switch**

In `index.html`, immediately after the opening `<main>` tag (line 19), insert:

```html
  <div class="app-mode seg-group" role="tablist" aria-label="App-Modus">
    <button type="button" id="appModeRelief" class="seg seg-active">Bild → Relief</button>
    <button type="button" id="appModeBookmark" class="seg">Lesezeichen</button>
  </div>
```

Wrap the existing relief UI so it can be hidden: change the existing `<section id="drop" …>` opening so that the dropzone and the `.workspace` div are both inside a new wrapper. Concretely, insert `<div id="reliefWorkspace">` right before `<section id="drop"` (line 20) and insert `</div>` right after the existing `.workspace` closing `</div>` (the one before `</main>`, line 202).

- [ ] **Step 2: Add the bookmark workspace markup**

In `index.html`, directly after the `</div>` that closes `#reliefWorkspace` (from Step 1) and before `</main>`, insert:

```html
  <div id="bmWorkspace" class="workspace" hidden>
    <aside class="sidebar">
      <div class="bm-actions">
        <button type="button" id="bmAddImage" class="btn">+ Bild</button>
        <button type="button" id="bmAddText" class="btn">+ Text</button>
      </div>
      <input id="bmFile" type="file" accept="image/*" hidden>
      <input id="bmFontFile" type="file" accept=".ttf,.otf,font/*" hidden>
      <input id="bmLoadFile" type="file" accept=".json,application/json" hidden>

      <details class="acc" open>
        <summary>Lesezeichen</summary>
        <div class="acc-body"><div class="fields">
          <div class="field"><div class="field-head"><label for="bmWidth">Breite (mm)</label><span id="bmWidthVal" class="badge">50</span></div>
            <input id="bmWidth" type="range" min="20" max="120" value="50" step="1"></div>
          <div class="field"><div class="field-head"><label for="bmHeight">Höhe (mm)</label><span id="bmHeightVal" class="badge">150</span></div>
            <input id="bmHeight" type="range" min="40" max="250" value="150" step="1"></div>
          <div class="field"><div class="field-head"><label for="bmCorner">Eckradius (mm)</label><span id="bmCornerVal" class="badge">4</span></div>
            <input id="bmCorner" type="range" min="0" max="25" value="4" step="0.5"></div>
          <div class="field"><div class="field-head"><label for="bmThickness">Dicke (mm)</label><span id="bmThicknessVal" class="badge">3.0</span></div>
            <input id="bmThickness" type="range" min="0.6" max="8" value="3" step="0.2"></div>
          <div class="field"><div class="field-head"><label for="bmLayerHeight">Schichthöhe (mm)</label><span id="bmLayerHeightVal" class="badge">0.20</span></div>
            <input id="bmLayerHeight" type="range" min="0.05" max="0.4" value="0.2" step="0.01"></div>
          <div class="field"><div class="field-head"><label for="bmHoleD">Loch ⌀ (mm)</label><span id="bmHoleDVal" class="badge">5</span></div>
            <input id="bmHoleD" type="range" min="0" max="15" value="5" step="0.5"></div>
          <div class="field"><div class="field-head"><label for="bmHoleMargin">Loch Abstand oben (mm)</label><span id="bmHoleMarginVal" class="badge">8</span></div>
            <input id="bmHoleMargin" type="range" min="2" max="30" value="8" step="0.5"></div>
          <div class="field"><div class="field-head"><label for="bmBaseColor">Grundfarbe</label></div>
            <input id="bmBaseColor" type="color" value="#000000"></div>
          <div class="field"><div class="field-head"><label for="bmResolution">Auflösung (px)</label><span id="bmResolutionVal" class="badge">256</span></div>
            <input id="bmResolution" type="range" min="64" max="512" value="256" step="16"></div>
        </div></div>
      </details>

      <details class="acc" open>
        <summary>Ebenen</summary>
        <div class="acc-body"><ul id="bmLayers" class="bm-layers"></ul></div>
      </details>

      <details class="acc" open>
        <summary>Element</summary>
        <div class="acc-body"><div id="bmProps" class="fields"><p class="hint">Kein Element ausgewählt.</p></div></div>
      </details>

      <div class="sidebar-footer">
        <button id="bmExport" class="btn btn-primary">3D-Modell (.3mf)</button>
        <div class="bm-actions">
          <button id="bmSave" class="btn">Projekt speichern</button>
          <button id="bmLoad" class="btn">Projekt laden</button>
        </div>
        <p id="bmStatus" class="status">Lesezeichen-Modus.</p>
      </div>
    </aside>

    <section id="bmPreview" class="preview">
      <canvas id="bmCanvas"></canvas>
    </section>
  </div>
```

- [ ] **Step 3: Load the new scripts**

In `index.html`, before the existing `<script src="js/app.js"></script>` (line 207), add:

```html
<script src="js/bookmark-model.js"></script>
<script src="js/bookmark-export.js"></script>
<script src="js/bookmark-editor.js"></script>
```

(`bookmark-editor.js` is created in Task 6; the 404 until then is harmless — relief mode still works.)

- [ ] **Step 4: Add styles**

Append to `styles.css`:

```css
/* ---- Bookmark composer ---- */
.app-mode { margin-bottom: 16px; }
body.bookmark-mode #reliefWorkspace { display: none; }
body:not(.bookmark-mode) #bmWorkspace { display: none; }
#bmWorkspace[hidden] { display: none; }
.bm-actions { display: flex; gap: 8px; margin-bottom: 10px; }
.bm-actions .btn { flex: 1; }
.bm-layers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.bm-layers li { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid #2a2a33;
  border-radius: 6px; cursor: pointer; font-size: 13px; }
.bm-layers li.sel { border-color: #6b4fb0; background: #6b4fb022; }
.bm-layers .sw { width: 12px; height: 12px; border-radius: 3px; border: 1px solid #0006; flex: none; }
.bm-layers .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-layers .lbtn { background: none; border: none; color: inherit; cursor: pointer; opacity: .7; padding: 0 2px; }
.bm-layers .lbtn:hover { opacity: 1; }
#bmCanvas { background: #15151b; border-radius: 8px; max-width: 100%; max-height: 100%; touch-action: none; }
#bmProps .field-head { margin-top: 6px; }
```

- [ ] **Step 5: Verify markup renders**

Using the Playwright MCP: `browser_navigate` to `file://<repo>/index.html`, then `browser_evaluate`:

```javascript
() => {
  document.getElementById('appModeBookmark').click();
  const ids = ['bmWorkspace','bmAddImage','bmAddText','bmCanvas','bmWidth','bmBaseColor','bmLayers','bmProps','bmExport','bmSave','bmLoad'];
  return ids.map(i => i + ':' + !!document.getElementById(i)).join(' ');
}
```

Expected: every id reports `:true`, and clicking `#appModeBookmark` shows `#bmWorkspace` (relief workspace hidden). Take a screenshot to confirm the bookmark sidebar + dark canvas render.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css
git commit -m "feat(bookmark): mode switch + bookmark workspace markup and styles"
```

---

### Task 6: Editor core — state, mode switch wiring, canvas render, settings, add elements

**Files:**
- Create: `js/bookmark-editor.js`

**Interfaces:**
- Consumes: model + export globals (Tasks 2–4); DOM ids (Task 5).
- Produces (on `window` for verification): `bmDoc` (getter), `bmRender()`, `bmSelect(id)`, `bmAddImageFromDataURL(dataURL)`, `bmState` (`{selectedId}`). Internal: `mm2px` scale fit to the preview, element decode into `_img`.

- [ ] **Step 1: Create `js/bookmark-editor.js` with state, render, mode switch, settings, add-element**

```javascript
"use strict";
// Bookmark composer editor: state, canvas rendering, selection/manipulation,
// layer list, properties, project save/load, and .3mf export wiring.

let doc = defaultBookmark();
const state = { selectedId: null, scale: 1, ox: 0, oy: 0 }; // scale = px per mm; ox/oy = canvas origin

const bm = {
  modeRelief: document.getElementById('appModeRelief'),
  modeBookmark: document.getElementById('appModeBookmark'),
  ws: document.getElementById('bmWorkspace'),
  canvas: document.getElementById('bmCanvas'),
  preview: document.getElementById('bmPreview'),
  addImage: document.getElementById('bmAddImage'),
  addText: document.getElementById('bmAddText'),
  file: document.getElementById('bmFile'),
  fontFile: document.getElementById('bmFontFile'),
  loadFile: document.getElementById('bmLoadFile'),
  layers: document.getElementById('bmLayers'),
  props: document.getElementById('bmProps'),
  status: document.getElementById('bmStatus'),
  exportBtn: document.getElementById('bmExport'),
  save: document.getElementById('bmSave'),
  load: document.getElementById('bmLoad'),
};

function bmStatus(msg, isErr) { bm.status.textContent = msg; bm.status.className = isErr ? 'status error' : 'status'; }
function selected() { return doc.elements.find(e => e.id === state.selectedId) || null; }

// ---- Mode switch ----
function setAppMode(bookmark) {
  document.body.classList.toggle('bookmark-mode', bookmark);
  bm.ws.hidden = !bookmark;
  bm.modeRelief.classList.toggle('seg-active', !bookmark);
  bm.modeBookmark.classList.toggle('seg-active', bookmark);
  if (bookmark) bmRender();
}
bm.modeRelief.addEventListener('click', () => setAppMode(false));
bm.modeBookmark.addEventListener('click', () => setAppMode(true));

// ---- Canvas fit + render ----
function fitScale() {
  const pad = 24;
  const availW = (bm.preview.clientWidth || 600) - pad;
  const availH = (bm.preview.clientHeight || 700) - pad;
  const s = Math.max(1, Math.min(availW / doc.widthMm, availH / doc.heightMm));
  state.scale = s;
  bm.canvas.width = Math.round(doc.widthMm * s);
  bm.canvas.height = Math.round(doc.heightMm * s);
}

function bodyPath(ctx, s) {
  const w = doc.widthMm * s, h = doc.heightMm * s, rr = Math.min(doc.cornerRadiusMm * s, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(rr, 0); ctx.arcTo(w, 0, w, h, rr); ctx.arcTo(w, h, 0, h, rr);
  ctx.arcTo(0, h, 0, 0, rr); ctx.arcTo(0, 0, w, 0, rr); ctx.closePath();
}

function drawElement(ctx, el, s) {
  ctx.save();
  ctx.translate(el.cxMm * s, el.cyMm * s);
  ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
  const w = el.wMm * s, h = el.hMm * s;
  if (el.type === 'text') {
    ctx.fillStyle = el.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${el.fontWeight} ${Math.max(1, Math.round(h))}px ${el.fontFamily}`;
    ctx.fillText(el.text, 0, 0);
  } else if (el._img) {
    ctx.drawImage(el._img, -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = '#444'; ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

function drawSelection(ctx, el, s) {
  ctx.save();
  ctx.translate(el.cxMm * s, el.cyMm * s);
  ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
  const w = el.wMm * s, h = el.hMm * s;
  ctx.strokeStyle = '#6b4fb0'; ctx.lineWidth = 1.5; ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#6b4fb0';
  for (const [hx, hy] of [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]) {
    ctx.beginPath(); ctx.rect(hx - 5, hy - 5, 10, 10); ctx.fill();
  }
  // rotate handle
  ctx.beginPath(); ctx.moveTo(0, -h/2); ctx.lineTo(0, -h/2 - 22); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -h/2 - 22, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function bmRender() {
  if (bm.ws.hidden) return;
  fitScale();
  const s = state.scale, ctx = bm.canvas.getContext('2d');
  ctx.clearRect(0, 0, bm.canvas.width, bm.canvas.height);
  // body
  bodyPath(ctx, s); ctx.fillStyle = doc.baseColor; ctx.fill();
  // hole (punch out)
  ctx.save(); bodyPath(ctx, s); ctx.clip();
  const hr = (doc.hole.diameterMm / 2) * s, hx = (doc.widthMm / 2) * s, hy = (doc.hole.marginTopMm + doc.hole.diameterMm / 2) * s;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // elements (back→front), clipped to body
  ctx.save(); bodyPath(ctx, s); ctx.clip();
  for (const el of doc.elements) drawElement(ctx, el, s);
  ctx.restore();
  // outline + selection
  bodyPath(ctx, s); ctx.strokeStyle = '#3a3a44'; ctx.lineWidth = 1; ctx.stroke();
  const sel = selected(); if (sel) drawSelection(ctx, sel, s);
  renderLayers(); renderProps();
}

// ---- Settings wiring ----
function bindRange(id, key, fmt) {
  const inp = document.getElementById(id), badge = document.getElementById(id + 'Val');
  inp.addEventListener('input', () => {
    const v = Number(inp.value);
    setDocValue(key, v);
    if (badge) badge.textContent = fmt ? fmt(v) : String(v);
    bmRender();
  });
}
function setDocValue(key, v) {
  if (key === 'hole.diameterMm') doc.hole.diameterMm = v;
  else if (key === 'hole.marginTopMm') doc.hole.marginTopMm = v;
  else doc[key] = v;
}
bindRange('bmWidth', 'widthMm');
bindRange('bmHeight', 'heightMm');
bindRange('bmCorner', 'cornerRadiusMm', v => String(v));
bindRange('bmThickness', 'thicknessMm', v => v.toFixed(1));
bindRange('bmLayerHeight', 'layerHeightMm', v => v.toFixed(2));
bindRange('bmHoleD', 'hole.diameterMm', v => String(v));
bindRange('bmHoleMargin', 'hole.marginTopMm', v => String(v));
bindRange('bmResolution', 'resolution');
document.getElementById('bmBaseColor').addEventListener('input', e => { doc.baseColor = e.target.value; bmRender(); });

// ---- Add elements ----
function bmAddImageFromDataURL(dataURL) {
  const el = makeImageElement({ src: dataURL });
  const img = new Image();
  img.onload = () => {
    const maxMm = Math.min(doc.widthMm * 0.8, doc.heightMm * 0.4);
    const ar = img.naturalWidth / img.naturalHeight || 1;
    el.wMm = ar >= 1 ? maxMm : maxMm * ar;
    el.hMm = ar >= 1 ? maxMm / ar : maxMm;
    el._img = img;
    bmRender();
  };
  img.src = dataURL;
  doc.elements.push(el);
  state.selectedId = el.id;
  bmRender();
}
bm.addImage.addEventListener('click', () => bm.file.click());
bm.file.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => bmAddImageFromDataURL(rd.result);
  rd.readAsDataURL(f);
  bm.file.value = '';
});
bm.addText.addEventListener('click', () => {
  const el = makeTextElement({ text: 'Text', wMm: doc.widthMm * 0.7, hMm: 10, cxMm: doc.widthMm / 2, cyMm: doc.heightMm / 2 });
  doc.elements.push(el); state.selectedId = el.id; bmRender();
});

// Stubs filled in Task 7.
function renderLayers() {}
function renderProps() {}
function bmSelect(id) { state.selectedId = id; bmRender(); }

window.addEventListener('resize', () => { if (!bm.ws.hidden) bmRender(); });

// Verification hooks.
Object.defineProperty(window, 'bmDoc', { get() { return doc; }, set(v) { doc = v; } });
window.bmRender = bmRender;
window.bmSelect = bmSelect;
window.bmAddImageFromDataURL = bmAddImageFromDataURL;
window.bmState = state;
```

- [ ] **Step 2: Verify render + add-text via the browser**

`browser_navigate` to `file://<repo>/index.html`, then `browser_evaluate`:

```javascript
() => {
  document.getElementById('appModeBookmark').click();
  document.getElementById('bmAddText').click();
  return { mode: document.body.classList.contains('bookmark-mode'),
           canvasW: document.getElementById('bmCanvas').width > 0,
           elements: window.bmDoc.elements.length,
           selected: window.bmState.selectedId !== null };
}
```

Expected: `{mode:true, canvasW:true, elements:1, selected:true}`. Screenshot: bookmark body with a hole and the word "Text" drawn, with a purple selection box.

- [ ] **Step 3: Commit**

```bash
git add js/bookmark-editor.js
git commit -m "feat(bookmark): editor core — render, mode switch, settings, add elements"
```

---

### Task 7: Selection, manipulation, layer list, properties panel

**Files:**
- Modify: `js/bookmark-editor.js` (replace the `renderLayers`/`renderProps` stubs; add pointer handlers; add custom-font loading)

**Interfaces:**
- Consumes: Task 6 state/render.
- Produces: pointer-driven move/scale/rotate on `#bmCanvas`; populated `#bmLayers` and `#bmProps`; `bmLoadFontFile(file)`; `window.bmHitTest(px, py) -> {id, handle}|null`.

- [ ] **Step 1: Replace the `renderLayers`/`renderProps` stubs and add manipulation**

In `js/bookmark-editor.js`, delete the three stub lines:

```javascript
function renderLayers() {}
function renderProps() {}
function bmSelect(id) { state.selectedId = id; bmRender(); }
```

and replace them with:

```javascript
function bmSelect(id) { state.selectedId = id; bmRender(); }

// ---- Layer list (top of list = top of z-order; doc.elements is back→front) ----
function renderLayers() {
  bm.layers.innerHTML = '';
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const el = doc.elements[i];
    const li = document.createElement('li');
    if (el.id === state.selectedId) li.classList.add('sel');
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = el.color || '#888';
    const name = document.createElement('span'); name.className = 'name';
    name.textContent = el.type === 'text' ? ('„' + el.text + '"') : 'Bild';
    const up = document.createElement('button'); up.className = 'lbtn'; up.textContent = '▲'; up.title = 'nach oben';
    const dn = document.createElement('button'); dn.className = 'lbtn'; dn.textContent = '▼'; dn.title = 'nach unten';
    const del = document.createElement('button'); del.className = 'lbtn'; del.textContent = '✕'; del.title = 'löschen';
    li.append(sw, name, up, dn, del);
    li.addEventListener('click', e => { if (e.target.classList.contains('lbtn')) return; bmSelect(el.id); });
    up.addEventListener('click', e => { e.stopPropagation(); moveLayer(i, +1); });
    dn.addEventListener('click', e => { e.stopPropagation(); moveLayer(i, -1); });
    del.addEventListener('click', e => { e.stopPropagation(); deleteLayer(i); });
    bm.layers.appendChild(li);
  }
}
function moveLayer(i, dir) {
  const j = i + dir; if (j < 0 || j >= doc.elements.length) return;
  const t = doc.elements[i]; doc.elements[i] = doc.elements[j]; doc.elements[j] = t; bmRender();
}
function deleteLayer(i) {
  const el = doc.elements[i]; doc.elements.splice(i, 1);
  if (state.selectedId === el.id) state.selectedId = null; bmRender();
}

// ---- Properties panel ----
function propRow(label, inputHTML) { return `<div class="field"><div class="field-head"><label>${label}</label></div>${inputHTML}</div>`; }
function renderProps() {
  const el = selected();
  if (!el) { bm.props.innerHTML = '<p class="hint">Kein Element ausgewählt.</p>'; return; }
  let html = '';
  if (el.type === 'text') {
    html += propRow('Text', `<input type="text" id="pText" value="${(el.text || '').replace(/"/g, '&quot;')}">`);
    html += propRow('Schrift', `<select id="pFont">
      ${['system-ui','serif','monospace','Georgia','Impact','Comic Sans MS'].map(f => `<option ${f===el.fontFamily?'selected':''}>${f}</option>`).join('')}
      ${el.fontFamily && !['system-ui','serif','monospace','Georgia','Impact','Comic Sans MS'].includes(el.fontFamily) ? `<option selected>${el.fontFamily}</option>` : ''}
      </select> <button class="btn" id="pFontUpload" type="button">Schrift laden</button>`);
    html += propRow('Fett', `<label class="toggle"><input type="checkbox" id="pBold" ${el.fontWeight==='bold'?'checked':''}> fett</label>`);
  }
  html += propRow('Farbe', `<input type="color" id="pColor" value="${el.color}">`);
  if (el.type === 'image') {
    html += propRow('Farbmodus', `<select id="pMode"><option value="solid" ${el.colorMode==='solid'?'selected':''}>Vollfarbe</option><option value="reduce" ${el.colorMode==='reduce'?'selected':''}>Farben reduzieren</option></select>`);
    if (el.colorMode === 'solid')
      html += propRow('Schwellwert', `<input type="range" id="pThresh" min="0" max="255" value="${el.threshold}"> <label class="toggle"><input type="checkbox" id="pInvert" ${el.invert?'checked':''}> invertieren</label>`);
    else
      html += propRow('Anzahl Farben', `<input type="range" id="pNum" min="2" max="16" value="${el.reduce.numColors}">`);
  }
  html += propRow('Tiefe (Schichten)', `<input type="range" id="pDepth" min="1" max="12" value="${el.depthLayers}"> <span class="badge">${el.depthLayers}</span>`);
  html += propRow('Breite (mm)', `<input type="range" id="pW" min="2" max="${doc.widthMm}" step="0.5" value="${el.wMm.toFixed(1)}">`);
  html += propRow('Höhe (mm)', `<input type="range" id="pH" min="2" max="${doc.heightMm}" step="0.5" value="${el.hMm.toFixed(1)}">`);
  html += propRow('Drehung (°)', `<input type="range" id="pRot" min="-180" max="180" value="${Math.round(el.rotationDeg)}">`);
  html += propRow('', `<label class="toggle"><input type="checkbox" id="pCut" ${el.cutout?'checked':''}> Aussparung (nichts dahinter)</label>`);
  bm.props.innerHTML = html;

  const on = (id, ev, fn) => { const e = document.getElementById(id); if (e) e.addEventListener(ev, fn); };
  on('pText', 'input', e => { el.text = e.target.value; bmRender(); });
  on('pFont', 'change', e => { el.fontFamily = e.target.value; bmRender(); });
  on('pFontUpload', 'click', () => bm.fontFile.click());
  on('pBold', 'change', e => { el.fontWeight = e.target.checked ? 'bold' : 'normal'; bmRender(); });
  on('pColor', 'input', e => { el.color = e.target.value; bmRender(); });
  on('pMode', 'change', e => { el.colorMode = e.target.value; bmRender(); });
  on('pThresh', 'input', e => { el.threshold = Number(e.target.value); });
  on('pInvert', 'change', e => { el.invert = e.target.checked; });
  on('pNum', 'input', e => { el.reduce.numColors = Number(e.target.value); });
  on('pDepth', 'input', e => { el.depthLayers = Number(e.target.value); renderProps(); });
  on('pW', 'input', e => { el.wMm = Number(e.target.value); bmRender(); });
  on('pH', 'input', e => { el.hMm = Number(e.target.value); bmRender(); });
  on('pRot', 'input', e => { el.rotationDeg = Number(e.target.value); bmRender(); });
  on('pCut', 'change', e => { el.cutout = e.target.checked; });
}

// ---- Custom font loading ----
function bmLoadFontFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    const fam = 'bmfont-' + file.name.replace(/\W+/g, '');
    const ff = new FontFace(fam, rd.result);
    ff.load().then(loaded => {
      document.fonts.add(loaded);
      const el = selected(); if (el && el.type === 'text') { el.fontFamily = fam; }
      bmRender();
      bmStatus('Schrift geladen: ' + file.name);
    }).catch(() => bmStatus('Schrift konnte nicht geladen werden.', true));
  };
  rd.readAsArrayBuffer(file);
}
bm.fontFile.addEventListener('change', e => { const f = e.target.files[0]; if (f) bmLoadFontFile(f); bm.fontFile.value = ''; });
window.bmLoadFontFile = bmLoadFontFile;

// ---- Pointer manipulation (move / scale / rotate) ----
function elemToLocal(el, px, py, s) {
  const dx = px - el.cxMm * s, dy = py - el.cyMm * s, a = -(el.rotationDeg || 0) * Math.PI / 180;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}
function bmHitTest(px, py) {
  const s = state.scale;
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const el = doc.elements[i], [lx, ly] = elemToLocal(el, px, py, s), w = el.wMm * s, h = el.hMm * s;
    if (Math.hypot(lx, ly + h / 2 + 22) <= 9) return { id: el.id, handle: 'rotate' };
    const corners = { nw:[-w/2,-h/2], ne:[w/2,-h/2], se:[w/2,h/2], sw:[-w/2,h/2] };
    for (const k in corners) if (Math.hypot(lx - corners[k][0], ly - corners[k][1]) <= 9) return { id: el.id, handle: k };
    if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return { id: el.id, handle: 'move' };
  }
  return null;
}
window.bmHitTest = bmHitTest;

let drag = null;
bm.canvas.addEventListener('pointerdown', e => {
  const rect = bm.canvas.getBoundingClientRect(), scaleC = bm.canvas.width / rect.width;
  const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
  const hit = bmHitTest(px, py);
  if (!hit) { state.selectedId = null; bmRender(); return; }
  state.selectedId = hit.id;
  const el = selected();
  drag = { handle: hit.handle, px, py, start: { cx: el.cxMm, cy: el.cyMm, w: el.wMm, h: el.hMm, rot: el.rotationDeg } };
  bm.canvas.setPointerCapture(e.pointerId); bmRender();
});
bm.canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const rect = bm.canvas.getBoundingClientRect(), scaleC = bm.canvas.width / rect.width, s = state.scale;
  const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
  const el = selected(); if (!el) return;
  if (drag.handle === 'move') {
    el.cxMm = drag.start.cx + (px - drag.px) / s; el.cyMm = drag.start.cy + (py - drag.py) / s;
  } else if (drag.handle === 'rotate') {
    const ang = Math.atan2(py - el.cyMm * s, px - el.cxMm * s) * 180 / Math.PI + 90;
    el.rotationDeg = Math.round(ang);
  } else {
    const [lx, ly] = elemToLocal(el, px, py, s);
    el.wMm = Math.max(2, Math.abs(lx) * 2 / s); el.hMm = Math.max(2, Math.abs(ly) * 2 / s);
  }
  bmRender();
});
function endDrag() { drag = null; }
bm.canvas.addEventListener('pointerup', endDrag);
bm.canvas.addEventListener('pointercancel', endDrag);
```

- [ ] **Step 2: Verify hit-test, layer list, and props via the browser**

`browser_navigate` to `file://<repo>/index.html`, then `browser_evaluate`:

```javascript
() => {
  document.getElementById('appModeBookmark').click();
  document.getElementById('bmAddText').click();
  const el = window.bmDoc.elements[0];
  const s = window.bmState.scale;
  const hit = window.bmHitTest(el.cxMm * s, el.cyMm * s); // center -> move
  const layerCount = document.querySelectorAll('#bmLayers li').length;
  const hasColor = !!document.getElementById('pColor');
  return { handle: hit && hit.handle, layerCount, hasColor };
}
```

Expected: `{handle:"move", layerCount:1, hasColor:true}`. Screenshot after dragging is optional; confirm the properties panel shows Text/Schrift/Farbe/Tiefe controls.

- [ ] **Step 3: Commit**

```bash
git add js/bookmark-editor.js
git commit -m "feat(bookmark): selection, move/scale/rotate, layer list, properties, fonts"
```

---

### Task 8: Project save/load, export wiring, end-to-end verification

**Files:**
- Modify: `js/bookmark-editor.js` (append save/load + export wiring)

**Interfaces:**
- Consumes: `serializeProject`/`deserializeProject` (Task 2), `exportBookmark3MF` (Task 4), editor state (Tasks 6–7).
- Produces: `#bmSave` downloads `lesezeichen.json`; `#bmLoad` loads a project (rebuilds `_img` for image elements); `#bmExport` calls `exportBookmark3MF(doc)`; `window.bmLoadProjectText(text)`.

- [ ] **Step 1: Append save/load + export wiring to `js/bookmark-editor.js`**

```javascript
// ---- Project save / load ----
bm.save.addEventListener('click', () => {
  const blob = new Blob([serializeProject(doc)], { type: 'application/json' });
  const a = document.createElement('a'); a.download = 'lesezeichen.json';
  a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href);
  bmStatus('Projekt gespeichert.');
});
bm.load.addEventListener('click', () => bm.loadFile.click());
bm.loadFile.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader(); rd.onload = () => bmLoadProjectText(rd.result); rd.readAsText(f); bm.loadFile.value = '';
});
function bmLoadProjectText(text) {
  try {
    doc = deserializeProject(text);
  } catch (err) { bmStatus('Projekt konnte nicht gelesen werden.', true); return; }
  state.selectedId = null;
  // sync sidebar inputs to loaded values
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; const b = document.getElementById(id + 'Val'); if (b) b.textContent = v; };
  set('bmWidth', doc.widthMm); set('bmHeight', doc.heightMm); set('bmCorner', doc.cornerRadiusMm);
  set('bmThickness', Number(doc.thicknessMm).toFixed(1)); set('bmLayerHeight', Number(doc.layerHeightMm).toFixed(2));
  set('bmHoleD', doc.hole.diameterMm); set('bmHoleMargin', doc.hole.marginTopMm); set('bmResolution', doc.resolution);
  document.getElementById('bmBaseColor').value = doc.baseColor;
  // re-decode images
  let pending = 0;
  for (const el of doc.elements) if (el.type === 'image' && el.src) {
    pending++; const img = new Image(); img.onload = () => { el._img = img; if (--pending === 0) bmRender(); }; img.onerror = () => { if (--pending === 0) bmRender(); }; img.src = el.src;
  }
  bmRender();
  bmStatus('Projekt geladen.');
}
window.bmLoadProjectText = bmLoadProjectText;

// ---- Export ----
bm.exportBtn.addEventListener('click', () => {
  try {
    const { parts } = exportBookmark3MF(doc);
    const tris = parts.reduce((s, p) => s + p.facets.length, 0);
    bmStatus(`.3mf exportiert: ${parts.length} Teile, ${tris} Dreiecke.`);
  } catch (err) { bmStatus('Export fehlgeschlagen: ' + err.message, true); }
});
```

- [ ] **Step 2: Verify save↔load roundtrip + export in the browser**

`browser_navigate` to `file://<repo>/index.html`, then `browser_evaluate`:

```javascript
() => {
  document.getElementById('appModeBookmark').click();
  document.getElementById('bmAddText').click();
  window.bmDoc.elements[0].text = 'Hallo';
  window.bmDoc.elements[0].color = '#ff0000';
  const json = window.serializeProject(window.bmDoc);
  window.bmLoadProjectText(json);
  const okRoundtrip = window.bmDoc.elements[0].text === 'Hallo';
  const parts = window.buildBookmarkParts(window.bmDoc);
  const colors = parts.map(p => p.color.join(','));
  return { okRoundtrip, partCount: parts.length, colors };
}
```

Expected: `okRoundtrip:true`; `partCount >= 2` (base black + red text); `colors` includes `0,0,0` and `255,0,0`.

- [ ] **Step 3: Full end-to-end smoke test (image + text + export)**

`browser_navigate` to `file://<repo>/index.html`, then `browser_evaluate`:

```javascript
() => {
  document.getElementById('appModeBookmark').click();
  // synthetic blue square "image"
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
  const cx = cv.getContext('2d'); cx.fillStyle = '#0000ff'; cx.fillRect(0,0,32,32);
  window.bmAddImageFromDataURL(cv.toDataURL());
  document.getElementById('bmAddText').click();
  const t = window.bmDoc.elements[window.bmDoc.elements.length-1];
  t.text = 'LESEN'; t.color = '#ff0000'; t.cyMm = 120;
  // mark image cutout
  window.bmDoc.elements[0].colorMode = 'solid'; window.bmDoc.elements[0].color = '#0000ff';
  window.bmDoc.elements[0].threshold = 255; window.bmDoc.elements[0].cutout = true;
  window.bmRender();
  const parts = window.buildBookmarkParts(window.bmDoc);
  const okVolumes = parts.every(p => window.signedVolume(p.facets) > 0);
  return { parts: parts.length, names: parts.map(p=>p.name), okVolumes };
}
```

Expected: at least 3 parts (base, blue, red), `okVolumes:true`. Take a screenshot of the canvas showing a black bookmark with a blue square and red "LESEN" text, hole at top, rounded corners.

- [ ] **Step 4: Confirm relief mode still works (regression)**

`browser_navigate` to `file://<repo>/index.html`, then `browser_evaluate`:

```javascript
() => {
  // default mode is relief; switch to bookmark and back
  document.getElementById('appModeBookmark').click();
  document.getElementById('appModeRelief').click();
  return { reliefVisible: !document.body.classList.contains('bookmark-mode'),
           dropPresent: !!document.getElementById('drop') };
}
```

Expected: `{reliefVisible:true, dropPresent:true}`. Screenshot: the original image→relief dropzone is shown.

- [ ] **Step 5: Commit**

```bash
git add js/bookmark-editor.js
git commit -m "feat(bookmark): project save/load + .3mf export wiring + e2e"
```

---

## Self-Review Notes

- **Spec coverage:** new "Lesezeichen" mode (Task 5/6) ✓; drag-and-drop canvas with move/scale/rotate (Task 7) ✓; many image + text elements (Tasks 6–7) ✓; per-element color solid/reduce, text solid (Tasks 3/7) ✓; reversed-relief geometry — smooth front, depth in layers, z-order cutout, base fills behind non-cutout (Tasks 3/4) ✓; adjustable dimensions + hole + rounded corners (Tasks 1/5/6) ✓; system fonts + custom upload via FontFace (Task 7) ✓; `.3mf` multicolor export (Task 4/8) ✓; project save/load (Tasks 2/8) ✓; file split editor/export/model + SDF in geometry.js (all tasks) ✓; reuse of `geometry.js`/`image-ops.js` (Tasks 3/4) ✓; testing via window-exposed functions + browser (every task) ✓.
- **Type consistency:** `composeDesign` return shape `{r,g,b,depthMm,cutout,isBase}` is produced in Task 3 and consumed in Task 4; `buildBookmarkParts(doc)` (no second arg — reads `doc.resolution`) consistent in Tasks 4/8; `exportBookmark3MF(doc) -> {parts, blob}` consistent Tasks 4/8; `roundedRectHoleField(cols, rows, p)` consistent Tasks 1/4; model functions consistent Tasks 2/6/8.
- **Performance note:** the live editor renders elements directly to the preview canvas (cheap); the O(cells) field/marching-squares work happens only on export, bounded by `resolution` (default 256 → ≈256×768).
- **Known minor risk:** abutting color/base z-slabs (`[T-d,T]` vs `[0,T-d]`) share a coplanar interface; slicers handle this, but if artifacts appear, add a ~0.01 mm overlap to the behind-slab thickness.
