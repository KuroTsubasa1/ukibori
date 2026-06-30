# Unified Editor — Phase 2 (Engine): Element Composition + Part Builders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the element side of the unified geometry engine on top of the Phase 2 foundation, starting with `composeDesignV2(doc, cols, rows)` — the per-pixel composition of a v2 doc's elements that both the engraved and raised part-builders consume.

**Architecture:** Additive, in `js/build-parts.js` (alongside `gridForBody`/`buildBaseParts`). `composeDesignV2` is the v2 analogue of the bookmark `composeDesign` (`js/bookmark-export.js:66`): it rasterizes each element to the grid via a v2 `__renderElementV2` (analogue of `__renderElement`, `js/bookmark-export.js:11`) and composites front-to-back into per-pixel arrays. The only differences from the v1 originals are v2 field reads — `doc.body.*` instead of `doc.*`, and `element.depth.{mode,threshold,invert,reduce}` instead of the v1 `element.{colorMode,threshold,invert,reduce}`. It returns the SAME array shape as `composeDesign` (`{r,g,b,depthMm,cutout,isBase,owner}`) so the downstream part-builders (later tasks) can mirror `buildBookmarkParts`. The v1 `composeDesign`/`__renderElement` stay untouched.

**Tech Stack:** Vanilla browser JS, classic `<script>`. Tests run in `tests/run.html`. `composeDesignV2` IS canvas-based (element rasterization), so its tests use the browser harness with a **deterministic, font-free fixture** — a solid-color image element generated from an in-test canvas `toDataURL` (no external files, no text/font rendering), making the per-pixel assertions stable.

## Global Constraints

- **No new dependencies** (vendored/offline; no npm/CDN/build step).
- **Classic-script globals.** Add code inside the existing `js/build-parts.js` IIFE; read existing functions off `window` (`window.hexToRgb`, `window.__imagePaletteFromImg`, `window.__nearestColor`, `window.posterize` if needed). Export new public functions via `window.* = ...`. No ES modules / `import`. Do not redeclare globals.
- **Do NOT change** the v1 `composeDesign`/`__renderElement` (`js/bookmark-export.js`) or any other existing builder. Additive only.
- **Return-shape parity:** `composeDesignV2` returns `{ r, g, b: Uint8ClampedArray, depthMm: Float32Array, cutout, isBase: Uint8Array, owner: Int32Array }`, each length `cols*rows`, row-major `i=r*cols+c` — identical to `composeDesign`.
- **v2 field reads** (the only behavioral change from v1): body dims from `doc.body.widthMm`/`doc.body.heightMm`; base color from `doc.body.baseColor`; base thickness from `doc.body.thicknessMm`; per element use `el.depth.mode` (`'colorLayers'` is the v2 name for the v1 `colorMode:'reduce'`; otherwise solid), `el.depth.reduce`, `el.depth.threshold`, `el.depth.invert`. Type-specific fields (`el.color`, `el.text`, `el.fontFamily`, `el.fontWeight`, `el.src`, `el._img`) stay top-level.

---

## Running the tests

Browser harness; no node runner. `composeDesignV2` needs a real canvas, so run in a (headless) browser.

```bash
python3 -m http.server 8020   # fresh port each run; ?t= doesn't bust Playwright's cache
```
Load `http://localhost:8020/tests/run.html`; `window.__ready()` → `{pass,fail,failures}`; green = `fail===0`. Automated: ToolSearch `select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_evaluate`, navigate, `browser_evaluate` `() => window.__ready()`. Bump the port between RED and GREEN reloads.

---

## File Structure

- **Modify** `js/build-parts.js` — add `__renderElementV2(el, doc, cols, rows)` (internal to the IIFE) and `composeDesignV2(doc, cols, rows)`; export `window.composeDesignV2`.
- **Create** `tests/compose-v2.test.js` — async, canvas-based, deterministic (in-test generated solid-color image).
- **Modify** `tests/run.html` — add `<script src="compose-v2.test.js"></script>` after `build-parts.test.js`.

---

### Task 1: `composeDesignV2(doc, cols, rows)` + `__renderElementV2`

**Files:**
- Modify: `js/build-parts.js` (inside the existing IIFE)
- Create: `tests/compose-v2.test.js`
- Modify: `tests/run.html`

**Interfaces:**
- Consumes: `window.hexToRgb`; for `colorLayers` images `window.__imagePaletteFromImg(img, method, numColors, levels)` + `window.__nearestColor(pal, r, g, b)` (both global from `js/bookmark-export.js`). v2 `doc`/elements from `js/bookmark-model.js`; `gridForBody` (already in this file).
- Produces:
  - `composeDesignV2(doc, cols, rows) -> { r, g, b, depthMm, cutout, isBase, owner }` (array shape per the Global Constraints).
  - `__renderElementV2(el, doc, cols, rows) -> { mask, r, g, b }` (internal; `mask[i]=1` where the element is opaque, `r/g/b` per-pixel color), analogue of `__renderElement`.

- [ ] **Step 1: Write the failing test**

Create `tests/compose-v2.test.js`:

```javascript
"use strict";
(function () {
  // Deterministic, font-free fixture: a solid-color image decoded from an in-test
  // canvas data URL (no external files, no text rendering).
  async function solidImg(hex, w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.fillStyle = hex; cx.fillRect(0, 0, w, h);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cv.toDataURL("image/png"); });
    return img;
  }
  // Build a v2 doc (via migration) with one solid image element centered on a 40x40 plate.
  function v2DocWithCenteredImage() {
    const v1 = defaultBookmark();
    v1.widthMm = 40; v1.heightMm = 40; v1.baseColor = "#000000"; v1.resolution = 40;
    v1.elements = [ makeImageElement({ src: "x", colorMode: "solid", color: "#ff0000",
                                       cxMm: 20, cyMm: 20, wMm: 20, hMm: 20 }) ];
    return migrateProject(v1); // -> v2 doc, element gets .depth{mode:'solid',...}
  }

  test("composeDesignV2: solid image overlays base with correct owner/color", async () => {
    const doc = v2DocWithCenteredImage();
    doc.elements[0]._img = await solidImg("#ff0000", 8, 8);
    const { cols, rows } = gridForBody(doc.body, doc.resolution); // 40x40, sx=sy=1
    const comp = composeDesignV2(doc, cols, rows);
    assertEqual(comp.r.length, cols * rows, "arrays sized cols*rows");
    const ix = (c, r) => r * cols + c;
    const ci = ix(20, 20);                 // mm(20.5,20.5) inside the 10..30 element box
    assertEqual(comp.owner[ci], 0, "center owned by element 0");
    assertEqual(comp.isBase[ci], 0, "center is not base");
    assertEqual(comp.r[ci], 255, "center R=255"); assertEqual(comp.g[ci], 0, "center G=0"); assertEqual(comp.b[ci], 0, "center B=0");
    const bi = ix(2, 2);                    // mm(2.5,2.5) outside the element -> base
    assertEqual(comp.isBase[bi], 1, "corner is base");
    assertEqual(comp.owner[bi], -1, "corner owner = -1");
    assertEqual(comp.r[bi], 0, "corner = base color (#000000)");
  });

  test("composeDesignV2: empty doc is all base", async () => {
    const v1 = defaultBookmark(); v1.widthMm = 30; v1.heightMm = 30; v1.baseColor = "#123456"; v1.resolution = 30;
    const doc = migrateProject(v1);
    const { cols, rows } = gridForBody(doc.body, doc.resolution);
    const comp = composeDesignV2(doc, cols, rows);
    let allBase = true; for (let i = 0; i < cols * rows; i++) if (comp.isBase[i] !== 1) allBase = false;
    assert(allBase, "no elements -> every pixel is base");
    assertEqual(comp.owner[0], -1, "owner -1 everywhere");
  });
})();
```

Add to `tests/run.html` after the `build-parts.test.js` tag:
```html
<script src="compose-v2.test.js"></script>
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

`python3 -m http.server 8020`; load `tests/run.html`; `window.__ready()`.
Expected: `fail: 2`, `composeDesignV2 is not defined`. All 33 prior tests still pass.

- [ ] **Step 3: Implement `__renderElementV2` + `composeDesignV2` in `js/build-parts.js`**

Inside the IIFE in `js/build-parts.js` (before the `window.* =` exports), add:

```javascript
  const __ALPHA_CUTOFF = 128;

  // v2 analogue of bookmark-export __renderElement: rasterize one element to a
  // cols×rows grid. mask[i]=1 where opaque; r/g/b per pixel. Reads el.depth.* for
  // mode/threshold/invert/reduce (v1 read el.colorMode/threshold/invert/reduce).
  function __renderElementV2(el, doc, cols, rows) {
    const sx = cols / doc.body.widthMm, sy = rows / doc.body.heightMm;
    const cv = document.createElement("canvas"); cv.width = cols; cv.height = rows;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const w = el.wMm * sx, h = el.hMm * sy;
    ctx.save();
    ctx.translate(el.cxMm * sx, el.cyMm * sy);
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    if (el.type === "text") {
      ctx.fillStyle = el.color;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${el.fontWeight} ${Math.max(1, Math.round(h))}px ${el.fontFamily}`;
      ctx.fillText(el.text, 0, 0);
    } else if (el._img) {
      ctx.drawImage(el._img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
    const d = ctx.getImageData(0, 0, cols, rows).data, n = cols * rows;
    const mask = new Uint8Array(n);
    const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
    const depth = el.depth || {};

    if (el.type === "image" && depth.mode === "colorLayers" && el._img) {
      const red = depth.reduce || { method: "palette", numColors: 8, levels: 4, remap: {} };
      const pal = window.__imagePaletteFromImg(el._img, red.method, red.numColors, red.levels);
      const remap = red.remap || {};
      const hx = (R, G, B) => ("#" + [R, G, B].map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
      for (let i = 0; i < n; i++) {
        if (d[i * 4 + 3] < __ALPHA_CUTOFF) continue;
        const near = window.__nearestColor(pal, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        let cr = near[0], cg = near[1], cb = near[2];
        const m = remap[hx(cr, cg, cb)];
        if (m) { const c = window.hexToRgb(m); cr = c[0]; cg = c[1]; cb = c[2]; }
        mask[i] = 1; r[i] = cr; g[i] = cg; b[i] = cb;
      }
      return { mask, r, g, b };
    }

    const col = window.hexToRgb(el.color);
    const thr = depth.threshold != null ? depth.threshold : 128;
    for (let i = 0; i < n; i++) {
      let on = d[i * 4 + 3] >= __ALPHA_CUTOFF;
      if (on && el.type === "image") {
        const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        on = depth.invert ? lum >= thr : lum < thr;
      }
      if (on) { mask[i] = 1; r[i] = col[0]; g[i] = col[1]; b[i] = col[2]; }
    }
    return { mask, r, g, b };
  }

  // v2 analogue of bookmark-export composeDesign: composite elements (last = on
  // top) into per-pixel front color/depth/flags. Same return shape as composeDesign.
  function composeDesignV2(doc, cols, rows) {
    const n = cols * rows;
    const base = window.hexToRgb(doc.body.baseColor);
    const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
    const depthMm = new Float32Array(n), cutout = new Uint8Array(n), isBase = new Uint8Array(n);
    const owner = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) { r[i] = base[0]; g[i] = base[1]; b[i] = base[2]; depthMm[i] = doc.body.thicknessMm; isBase[i] = 1; }
    doc.elements.forEach((el, ei) => {
      if (el.type === "image" && !el._img) return;
      const layer = __renderElementV2(el, doc, cols, rows);
      const eh = (el.depth && el.depth.heightMm) || 0;
      for (let i = 0; i < n; i++) {
        if (!layer.mask[i]) continue;
        r[i] = layer.r[i]; g[i] = layer.g[i]; b[i] = layer.b[i];
        depthMm[i] = eh; cutout[i] = el.cutout ? 1 : 0; isBase[i] = 0; owner[i] = ei;
      }
    });
    return { r, g, b, depthMm, cutout, isBase, owner };
  }
```

Add to the `window.* =` export block in the IIFE:
```javascript
  window.composeDesignV2 = composeDesignV2;
```
(`__renderElementV2` stays internal.)

- [ ] **Step 4: Run the tests; verify all pass**

Reload on a fresh port (`python3 -m http.server 8021`). Expected: `fail: 0`; the 2 new compose tests pass; all 33 prior tests still pass (35 total).

- [ ] **Step 5: Commit**

```bash
git add js/build-parts.js tests/compose-v2.test.js tests/run.html
git commit -m "feat(geometry): composeDesignV2 — per-pixel element composition for v2 docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Implements the spec's § "Geometry engine" step 1 ("Rasterize each element to the resolution grid … reusing the composer's composeDesign/__renderElement + image-ops + bg-removal") for v2, reading `element.depth`. Steps 2–4 (per-mode/direction part emission, base recesses, assembly) are the follow-on tasks.

**Placeholder scan:** No TBD/TODO; complete code; tests use a deterministic in-test fixture (no fonts/external files) with concrete per-pixel assertions.

**Type consistency:** `composeDesignV2` returns the documented `{r,g,b,depthMm,cutout,isBase,owner}` shape (matching `composeDesign`); `__renderElementV2` returns `{mask,r,g,b}` (matching `__renderElement`); consumes `hexToRgb`/`__imagePaletteFromImg`/`__nearestColor` per their map signatures; reads `el.depth.{mode,threshold,invert,reduce,heightMm}` per the v2 model.

---

## Roadmap — remaining engine tasks (detailed after this lands, against concrete code)

- **T4 — engraved part-builder + base recesses + parity.** Port `buildBookmarkParts`' engraved color-rank recess/floor/riser construction (`bookmark-export.js:236–317`) to read v2 (`doc.body.*`, `doc.colorStepLayers`, `el.depth.direction==='engraved'`) consuming `composeDesignV2`. **The base must be recessed under engraved pixels** (slab + risers grouped by `T − recessDepth`), NOT the full-solid `buildBaseParts`. Parity gate: a migrated v1 fixture through the unified engraved path vs `buildBookmarkParts`, compared by **total/union manifold volume within tolerance** (the base decomposition differs by construction — per the foundation review).
- **T5 — raised + heightmap.** Raised: extrude prisms `T..T+heightMm` (solid) or rank-stacked (colorLayers) on top of a full-`T` base. Heightmap: continuous brightness→height field per element via `fieldFacets`, clamped by `depth.baseFloorMm`. Plus the mount **loop ring** (`mount.ringThicknessMm`/`ringHeightMm`, now in the model).
- **T6 — unified `buildParts(doc)` entry.** Assemble base (recessed where engraved, solid elsewhere) + engraved floors + raised prisms + mount ring; add `body.shape:'free'` (trace `freeOutlineFromElementId`'s silhouette before the footprint field). Integration tests: watertight/manifold per part + a `preview3d` screenshot. Old builders stay until Phase 3 switches the UI over.
