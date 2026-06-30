# Unified Editor — Phase 1: Data Model + Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the v2 unified-document schema (`doc` v2) and a v1→v2 migration as pure, fully-tested model code, without changing the behavior of the live (v1) app.

**Architecture:** Phase 1 is **purely additive**. `js/bookmark-model.js` keeps its existing v1 exports (`defaultBookmark`, `makeImageElement`, `makeTextElement`, `serializeProject`, `deserializeProject`) exactly as-is so the current editor and exporter keep working. We add new exports — `defaultDoc()`, `defaultDepth(type)`, and `migrateProject(doc)` — that produce/translate the v2 shape defined in the design spec. Nothing consumes v2 yet; the UI merge (Phase 3) will switch the editor over and call `migrateProject` on load. This keeps Phase 1 independently shippable and green.

**Tech Stack:** Vanilla ES5/ES6 browser JS loaded as classic `<script>` tags; no build step, no package manager. Tests run in the browser via `tests/run.html` against the hand-rolled harness in `tests/harness.js` (`test`/`assert`/`assertEqual`/`assertClose`).

## Global Constraints

- **No new dependencies.** The app is vendored/offline; do not add npm packages, CDNs, or build tooling. (Copied from spec: "No change to the vendored libraries or the offline/vendored deployment model.")
- **Classic-script globals.** New code in `js/*.js` runs as a classic script and communicates via `window.*` globals (e.g. `window.defaultDoc = defaultDoc`). Do not introduce ES modules / `import`. New files that need an existing global must read it off `window`, never redeclare it.
- **Do not break the v1 app during Phase 1.** The existing `defaultBookmark`/`makeImageElement`/`makeTextElement`/`serializeProject`/`deserializeProject` exports and their behavior must remain unchanged; the current editor still depends on them.
- **German UI copy** is unaffected in this phase (no UI changes).
- **v2 schema is authoritative** as written in `docs/superpowers/specs/2026-07-01-unified-editor-merge-design.md` § "Object model (`doc` v2)".

---

## Running the tests

All tasks verify through the existing browser harness. There is no node runner.

**Recommended (HTTP, matches the project's nginx deployment):**

```bash
# from the repo root, in a background terminal:
python3 -m http.server 8000
# then load this URL in a browser (or a headless browser):
#   http://localhost:8000/tests/run.html
```

The page renders a single line: `pass: <N>  fail: <M>` followed by any `FAIL <name>: <message>` lines. **A green run is `fail: 0`.**

**Automated/headless check:** load `…/tests/run.html`, then read the resolved value of `window.__ready()` — it resolves to `{ pass, fail, failures }`. Assert `fail === 0`. (`window.__ready()` is defined in `tests/harness.js:19` and awaits all registered tests.)

Pure model tests do not fetch or spawn workers, so `file://` also works for this phase; HTTP is preferred to stay consistent with the rest of the suite.

---

## File Structure

- **Modify** `js/bookmark-model.js` — append v2 additions (`DOC_VERSION`, `defaultDepth`, `defaultDoc`, `migrateProject`, internal `migrateElement`) and their `window.*` exports. Leave all existing v1 code untouched.
- **Create** `tests/unified-model.test.js` — unit tests for the v2 factories and migration. Kept separate from `tests/bookmark-model.test.js` so the existing v1 test IIFE is not disturbed.
- **Modify** `tests/run.html` — add one `<script src="unified-model.test.js"></script>` tag after the existing test scripts.

---

### Task 1: v2 schema factories (`defaultDoc`, `defaultDepth`)

**Files:**
- Modify: `js/bookmark-model.js` (append after the existing v1 code, before/among the `window.*` exports at lines 61-65)
- Create: `tests/unified-model.test.js`
- Modify: `tests/run.html:16` (add the new test script tag)

**Interfaces:**
- Consumes: nothing new (standalone factories).
- Produces:
  - `defaultDepth(type: 'image'|'text'|'qr') -> Depth` where `Depth = { mode:'solid'|'colorLayers'|'heightmap', direction:'raised'|'engraved', heightMm:number, stepLayers:number, reduce:{method:'palette'|'posterize', numColors:number, levels:number, remap:object, order:string[]}, threshold:number, invert:boolean, smooth:number, baseFloorMm:number }`. For `type !== 'image'`, `mode` is forced to `'solid'`.
  - `defaultDoc() -> DocV2` where `DocV2 = { version:2, body:{shape:'rect', widthMm, heightMm, cornerRadiusMm, thicknessMm, layerHeightMm, baseColor, autoSizeFromElementId:null, freeOutlineFromElementId:null}, mount:{type:'none', xMm, yMm, diameterMm, ringThicknessMm, marginMm}, resolution:number, colorStepLayers:number, elements:[], fonts:{} }`.
  - `DOC_VERSION` constant (`2`), exported as `window.DOC_VERSION`.

- [ ] **Step 1: Add the new test file and wire it into the runner**

Create `tests/unified-model.test.js`:

```javascript
"use strict";
(function () {
  test("v2: defaultDoc has version 2 and nested body/mount", () => {
    const d = defaultDoc();
    assertEqual(d.version, 2, "version");
    assertEqual(d.body.shape, "rect", "shape");
    assertEqual(d.body.widthMm, 50, "body width");
    assertEqual(d.body.heightMm, 150, "body height");
    assertEqual(d.body.cornerRadiusMm, 4, "corner");
    assertEqual(d.body.thicknessMm, 3, "thickness");
    assertEqual(d.body.layerHeightMm, 0.2, "layerHeight");
    assertEqual(d.body.baseColor, "#000000", "baseColor");
    assertEqual(d.body.autoSizeFromElementId, null, "autoSize null");
    assertEqual(d.body.freeOutlineFromElementId, null, "freeOutline null");
    assertEqual(d.mount.type, "none", "mount none by default");
    assertEqual(d.resolution, 1024, "resolution");
    assertEqual(d.colorStepLayers, 2, "colorStepLayers");
    assertEqual(d.elements.length, 0, "no elements");
  });

  test("v2: defaultDepth forces text/qr to solid, image defaults raised", () => {
    assertEqual(defaultDepth("text").mode, "solid", "text solid");
    assertEqual(defaultDepth("qr").mode, "solid", "qr solid");
    const di = defaultDepth("image");
    assertEqual(di.mode, "solid", "image default mode solid");
    assertEqual(di.direction, "raised", "image default raised");
    assertEqual(di.reduce.method, "palette", "reduce method default");
    assert(Array.isArray(di.reduce.order), "reduce.order is an array");
    assertEqual(di.threshold, 128, "threshold default");
    assertEqual(di.invert, false, "invert default");
  });
})();
```

Add the script tag to `tests/run.html` immediately after line 16 (`<script src="bookmark-export.test.js"></script>`):

```html
<script src="unified-model.test.js"></script>
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

Load `http://localhost:8000/tests/run.html` (start `python3 -m http.server 8000` first).
Expected: `fail: 2` (or more), with failures like `FAIL v2: defaultDoc … : defaultDoc is not defined` and `FAIL v2: defaultDepth … : defaultDepth is not defined`. All previously-passing tests still pass.

- [ ] **Step 3: Implement `defaultDepth` and `defaultDoc` in `js/bookmark-model.js`**

Append after the existing v1 functions (after `deserializeProject`, before the `window.*` export block at line 61):

```javascript
// === v2 unified document schema =========================================
// Additive: the live editor still uses the v1 functions above. migrateProject()
// (Task 2) bridges saved v1 projects to this shape; the UI merge phase will
// switch the editor over to defaultDoc()/migrateProject().
const DOC_VERSION = 2;

function defaultDepth(type) {
  return {
    mode: "solid",                 // text/qr are always solid; images may change later
    direction: "raised",
    heightMm: 1.0,
    stepLayers: 2,
    reduce: { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] },
    threshold: 128,
    invert: false,
    smooth: 0.5,
    baseFloorMm: 0,
  };
}

function defaultDoc() {
  return {
    version: DOC_VERSION,
    body: {
      shape: "rect",
      widthMm: 50, heightMm: 150, cornerRadiusMm: 4,
      thicknessMm: 3, layerHeightMm: 0.2, baseColor: "#000000",
      autoSizeFromElementId: null, freeOutlineFromElementId: null,
    },
    mount: { type: "none", xMm: 25, yMm: 8, diameterMm: 5, ringThicknessMm: 0, marginMm: 8 },
    resolution: 1024, colorStepLayers: 2,
    elements: [], fonts: {},
  };
}
```

Add to the `window.*` export block (after line 65):

```javascript
window.DOC_VERSION = DOC_VERSION;
window.defaultDepth = defaultDepth;
window.defaultDoc = defaultDoc;
```

- [ ] **Step 4: Run the tests; verify all pass**

Reload `http://localhost:8000/tests/run.html`.
Expected: `fail: 0`. The two new v2 tests now pass; all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add js/bookmark-model.js tests/unified-model.test.js tests/run.html
git commit -m "feat(model): add v2 unified-doc factories (defaultDoc/defaultDepth)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: v1→v2 migration (`migrateProject`)

**Files:**
- Modify: `js/bookmark-model.js` (append `migrateProject` + internal `migrateElement`, add export)
- Modify: `tests/unified-model.test.js` (add migration tests)

**Interfaces:**
- Consumes: `DOC_VERSION`, `defaultDepth` (Task 1); v1 factories `defaultBookmark`, `makeImageElement`, `makeTextElement` (existing) — used only by the tests.
- Produces:
  - `migrateProject(doc) -> DocV2`. If `doc` is null/undefined or already `doc.version === DOC_VERSION`, returns it unchanged (same reference). Otherwise builds a v2 doc: flat body fields → `body{}`; v1 `hole` → `mount{type:'hole', xMm:widthMm/2, yMm:marginTopMm, diameterMm, ringThicknessMm:0, marginMm:marginTopMm}` (no hole → `mount.type:'none'`); each element migrated via `migrateElement`.
  - `migrateElement(el, doc, layerHmm)` (internal; not exported): returns a clean v2 element `{ id, type, cxMm, cyMm, wMm, hMm, rotationDeg, cutout, color, depth, …type-specific }`. Folds v1 `colorMode`/`depthLayers`/`threshold`/`invert`/`reduce` into `depth` and drops the v1 `colorMode`/`depthLayers` keys. `colorMode==='reduce'` → `depth.mode:'colorLayers'`, else `'solid'`; `depth.direction:'engraved'` (v1 composer was engraved); `depth.heightMm = (depthLayers ?? 2) * layerHmm`.

- [ ] **Step 1: Write the failing migration tests**

Append inside the IIFE in `tests/unified-model.test.js` (before the closing `})();`):

```javascript
  test("migrate: v1 doc -> v2 body + mount(hole)", () => {
    const v2 = migrateProject(defaultBookmark());
    assertEqual(v2.version, 2, "version");
    assertEqual(v2.body.shape, "rect", "shape rect");
    assertEqual(v2.body.widthMm, 50, "body width carried");
    assertEqual(v2.body.cornerRadiusMm, 4, "corner carried");
    assertEqual(v2.body.thicknessMm, 3, "thickness carried");
    assertEqual(v2.body.layerHeightMm, 0.2, "layerHeight carried");
    assertEqual(v2.mount.type, "hole", "v1 hole -> mount hole");
    assertEqual(v2.mount.diameterMm, 5, "hole diameter");
    assertEqual(v2.mount.yMm, 8, "hole y from marginTop");
    assertClose(v2.mount.xMm, 25, 1e-9, "hole centered x");
  });

  test("migrate: reduce image -> colorLayers engraved, v1 keys folded", () => {
    const v1 = defaultBookmark();
    v1.elements.push(makeImageElement({ src: "data:x", colorMode: "reduce", depthLayers: 3 }));
    const e = migrateProject(v1).elements[0];
    assertEqual(e.depth.mode, "colorLayers", "reduce -> colorLayers");
    assertEqual(e.depth.direction, "engraved", "engraved");
    assertClose(e.depth.heightMm, 0.6, 1e-9, "height = depthLayers*layerH");
    assertEqual(e.depth.reduce.method, "palette", "reduce method carried");
    assert(Array.isArray(e.depth.reduce.order), "reduce.order array");
    assert(!("colorMode" in e), "colorMode folded away");
    assert(!("depthLayers" in e), "depthLayers folded away");
    assertEqual(e.src, "data:x", "src preserved");
    assert(e._img === null, "_img slot present");
  });

  test("migrate: solid image -> solid depth, threshold/invert moved to depth", () => {
    const v1 = defaultBookmark();
    v1.elements.push(makeImageElement({ src: "data:y", colorMode: "solid", threshold: 100, invert: true }));
    const e = migrateProject(v1).elements[0];
    assertEqual(e.depth.mode, "solid", "solid mode");
    assertEqual(e.depth.threshold, 100, "threshold in depth");
    assertEqual(e.depth.invert, true, "invert in depth");
  });

  test("migrate: text element -> solid depth, text fields preserved", () => {
    const v1 = defaultBookmark();
    v1.elements.push(makeTextElement({ text: "Hi", color: "#ff0000" }));
    const e = migrateProject(v1).elements[0];
    assertEqual(e.type, "text", "type text");
    assertEqual(e.depth.mode, "solid", "text solid");
    assertEqual(e.text, "Hi", "text preserved");
    assertEqual(e.color, "#ff0000", "color preserved");
  });

  test("migrate: idempotent on a v2 doc (same reference)", () => {
    const v2 = defaultDoc();
    assert(migrateProject(v2) === v2, "v2 returned unchanged");
  });

  test("migrate: null/undefined passthrough", () => {
    assert(migrateProject(null) === null, "null passthrough");
    assert(migrateProject(undefined) === undefined, "undefined passthrough");
  });

  test("migrate: preserves fonts", () => {
    const v1 = defaultBookmark();
    v1.fonts = { "bmfont-x": "data:font" };
    assertEqual(migrateProject(v1).fonts["bmfont-x"], "data:font", "fonts carried");
  });
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

Reload `http://localhost:8000/tests/run.html`.
Expected: `fail: 7`, each failing with `migrateProject is not defined`. Task 1 tests still pass.

- [ ] **Step 3: Implement `migrateProject` + `migrateElement`**

Append in `js/bookmark-model.js` after `defaultDoc` (before the `window.*` export block):

```javascript
function migrateElement(el, doc, layerHmm) {
  const isReduce = el.type === "image" && el.colorMode === "reduce";
  const depth = {
    mode: isReduce ? "colorLayers" : "solid",
    direction: "engraved",                       // v1 composer engraved colors into the front
    heightMm: (el.depthLayers != null ? el.depthLayers : 2) * layerHmm,
    stepLayers: doc.colorStepLayers != null ? doc.colorStepLayers : 2,
    reduce: el.reduce
      ? { method: el.reduce.method || "palette", numColors: el.reduce.numColors || 8,
          levels: el.reduce.levels || 4, remap: el.reduce.remap || {}, order: el.reduce.order || [] }
      : { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] },
    threshold: el.threshold != null ? el.threshold : 128,
    invert: !!el.invert,
    smooth: doc.smooth != null ? doc.smooth : 0.5,
    baseFloorMm: 0,
  };
  const out = {
    id: el.id, type: el.type,
    cxMm: el.cxMm, cyMm: el.cyMm, wMm: el.wMm, hMm: el.hMm, rotationDeg: el.rotationDeg || 0,
    cutout: !!el.cutout, color: el.color, depth,
  };
  if (el.type === "image") { out.src = el.src; out._img = null; }
  if (el.type === "text") { out.text = el.text; out.fontFamily = el.fontFamily; out.fontWeight = el.fontWeight; }
  if (el.type === "qr") { out.qrData = el.qrData; out.qrEcLevel = el.qrEcLevel; }
  return out;
}

function migrateProject(doc) {
  if (!doc || doc.version === DOC_VERSION) return doc;
  const layerH = doc.layerHeightMm != null ? doc.layerHeightMm : 0.2;
  const hole = doc.hole || null;
  return {
    version: DOC_VERSION,
    body: {
      shape: "rect",
      widthMm: doc.widthMm, heightMm: doc.heightMm,
      cornerRadiusMm: doc.cornerRadiusMm != null ? doc.cornerRadiusMm : 0,
      thicknessMm: doc.thicknessMm, layerHeightMm: layerH,
      baseColor: doc.baseColor || "#000000",
      autoSizeFromElementId: null, freeOutlineFromElementId: null,
    },
    mount: hole
      ? { type: "hole", xMm: doc.widthMm / 2, yMm: hole.marginTopMm,
          diameterMm: hole.diameterMm, ringThicknessMm: 0, marginMm: hole.marginTopMm }
      : { type: "none", xMm: (doc.widthMm || 0) / 2, yMm: 8, diameterMm: 5, ringThicknessMm: 0, marginMm: 8 },
    resolution: doc.resolution != null ? doc.resolution : 1024,
    colorStepLayers: doc.colorStepLayers != null ? doc.colorStepLayers : 2,
    elements: (doc.elements || []).map(el => migrateElement(el, doc, layerH)),
    fonts: doc.fonts || {},
  };
}
```

Add to the `window.*` export block:

```javascript
window.migrateProject = migrateProject;
```

(`migrateElement` is intentionally not exported — it is an internal helper.)

- [ ] **Step 4: Run the tests; verify all pass**

Reload `http://localhost:8000/tests/run.html`.
Expected: `fail: 0`. All Task 1 + Task 2 tests and all pre-existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/bookmark-model.js tests/unified-model.test.js
git commit -m "feat(model): add v1->v2 project migration (migrateProject)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (this phase only):** The spec's § "Object model (`doc` v2)" is implemented by `defaultDoc`/`defaultDepth` (Task 1). The spec's § "Persistence & migration" → "Migrate v1 → v2 on load" is implemented by `migrateProject`/`migrateElement` (Task 2), including the body-field wrapping, `hole`→`mount` mapping, and per-element `depth` defaults (`colorMode:'reduce'`→`colorLayers`, else `solid`; `direction:'engraved'`). Serialize/deserialize **changes are deliberately deferred** to Phase 3 (the spec notes deserialize will auto-migrate when the editor switches to v2; doing it now would break v1 loading — see Architecture).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows real assertions and exact expected output.

**Type consistency:** `defaultDepth`'s returned shape matches the `depth` object built in `migrateElement` (same keys: `mode/direction/heightMm/stepLayers/reduce/threshold/invert/smooth/baseFloorMm`). `defaultDoc`'s `body`/`mount` keys match those produced by `migrateProject`. `DOC_VERSION` is used consistently in `defaultDoc` and the `migrateProject` idempotency guard.

---

## Subsequent phases (to be detailed after Phase 1 lands)

Per the spec's § "Phasing", the remaining plans will be written once their foundations are concrete (so they reference real signatures, not guesses):

- **Phase 2 — Unified geometry engine:** one `buildParts(doc)` covering `solid`/`colorLayers`/`heightmap` × `raised`/`engraved` and rect/circle/free bases, verified against current `buildParts`/`buildColorParts`/`buildBookmarkParts` output before the old builders are removed.
- **Phase 3 — UI shell/canvas merge:** drop the mode switch, single sidebar + canvas/input handler, merged properties panel, drop-to-add; switch the editor to `defaultDoc()` and wire `migrateProject` into load.
- **Phase 4 — Export + 3D preview unification:** one export dialog (PNG/SVG/STL/3MF) and 3D preview for the whole design.
- **Phase 5 — Cleanup/fixes:** empty-`src` guard, RAF/resize lifecycle, dev HTTP server + README.
