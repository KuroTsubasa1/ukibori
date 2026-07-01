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

### Task 2: `buildEngravedParts(doc)` — v2 engraved model + parity vs `buildBookmarkParts`

**Files:**
- Modify: `js/build-parts.js` (inside the IIFE; add `__hex`, `__orderedNaturalHexesV2`, `buildEngravedParts`; export `window.buildEngravedParts`)
- Create: `tests/engraved-parity.test.js`
- Modify: `tests/run.html` (add the test script)

**Background:** This is a faithful v2 port of `buildBookmarkParts` (`js/bookmark-export.js:218–323`). It reuses that proven **slab + riser engraved base** construction (NOT the full-solid `buildBaseParts`, which is raised-only). For a *migrated v1 doc*, the footprint (`shapeFootprintField` with `mount.yMm = marginTopMm + diameterMm/2`) and the composition (`composeDesignV2`) are identical to the v1 path, so the output parts should match `buildBookmarkParts` to a tight tolerance — the parity test is the safety net that catches any port error.

**Interfaces:**
- Consumes: `gridForBody`, `composeDesignV2` (this file); `window.shapeFootprintField`, `window.traceMaskToFacets`, `window.orientOutward`, `window.hexToRgb`, `window.__imagePaletteFromImg`. Reads v2 `doc.body.*`, `doc.colorStepLayers`, `el.depth.{mode,reduce,color via el.color}`.
- Produces: `buildEngravedParts(doc) -> PART[]` = `[...baseParts, ...colorParts]` (same contract/order as `buildBookmarkParts`). Internal helpers `__hex(r,g,b)` and `__orderedNaturalHexesV2(el)` (v2 analogue of `__orderedNaturalHexes`, reading `el.depth.reduce`).

- [ ] **Step 1: Write the failing parity test**

Create `tests/engraved-parity.test.js`:

```javascript
"use strict";
(function () {
  function signedVol(facets) {
    let v = 0;
    for (const t of facets) { const [a,b,c]=t;
      v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6; }
    return v;
  }
  const totalVol = (parts) => parts.reduce((s,p)=>s+Math.abs(signedVol(p.facets)),0);
  async function solidImg(hex, w, h) {
    const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
    const cx=cv.getContext("2d"); cx.fillStyle=hex; cx.fillRect(0,0,w,h);
    const img=new Image(); await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});
    return img;
  }

  test("engraved parity: solid element — buildEngravedParts(migrated) == buildBookmarkParts(v1)", async () => {
    const img = await solidImg("#ffffff", 8, 8);
    const v1 = defaultBookmark();
    v1.widthMm = 40; v1.heightMm = 80; v1.resolution = 220; v1.baseColor = "#000000";
    const e = makeImageElement({ src:"a", colorMode:"solid", color:"#ff0000", cxMm:20, cyMm:40, wMm:24, hMm:24, depthLayers:2 });
    v1.elements = [e]; e._img = img;
    const ref = buildBookmarkParts(v1);          // v1 reference
    const v2 = migrateProject(v1); v2.elements[0]._img = img;
    const got = buildEngravedParts(v2);          // unified v2
    assertEqual(got.length, ref.length, "same number of parts");
    const eps = Math.max(1e-6, totalVol(ref) * 1e-3);
    assertClose(totalVol(got), totalVol(ref), eps, "total |volume| matches v1 within 0.1%");
    assert(got.every(p => Math.abs(signedVol(p.facets)) > 0), "every part has positive volume (watertight)");
  });

  test("engraved parity: empty doc — base only, matches v1", async () => {
    const v1 = defaultBookmark(); v1.widthMm = 30; v1.heightMm = 30; v1.resolution = 160; v1.baseColor = "#202020";
    const ref = buildBookmarkParts(v1);
    const got = buildEngravedParts(migrateProject(v1));
    assertEqual(got.length, ref.length, "same part count (base only)");
    const eps = Math.max(1e-6, totalVol(ref) * 1e-3);
    assertClose(totalVol(got), totalVol(ref), eps, "base volume matches v1");
  });
})();
```

Add to `tests/run.html` after the `compose-v2.test.js` tag:
```html
<script src="engraved-parity.test.js"></script>
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

`python3 -m http.server 8022`; load `tests/run.html`; `window.__ready()`.
Expected: `fail: 2`, `buildEngravedParts is not defined`. All 35 prior tests still pass.

- [ ] **Step 3: Implement in `js/build-parts.js`**

Inside the IIFE (before the `window.* =` exports), add:

```javascript
  function __hex(r, g, b) {
    return ("#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("")).toUpperCase();
  }

  // v2 analogue of bookmark-export __orderedNaturalHexes: a reduce-image element's
  // natural palette in the user's preferred order (el.depth.reduce.order first, then
  // any new colors). Reads el.depth.reduce (v1 read el.reduce).
  function __orderedNaturalHexesV2(el) {
    if (!(el.type === "image" && el.depth && el.depth.mode === "colorLayers" && el._img)) return [];
    const red = el.depth.reduce || {};
    const pal = window.__imagePaletteFromImg(el._img, red.method, red.numColors, red.levels)
      .map(c => __hex(c[0], c[1], c[2]));
    const ord = red.order || [];
    const out = [];
    for (const h of ord) { const H = String(h).toUpperCase(); if (pal.indexOf(H) !== -1 && out.indexOf(H) === -1) out.push(H); }
    for (const h of pal) if (out.indexOf(h) === -1) out.push(h);
    return out;
  }

  // Engraved model for a v2 doc: a v2 port of buildBookmarkParts. Solid base plate;
  // each color is a recess floor whose depth = rank * step (front-most = shallowest);
  // continuous bottom slab + background/under-color risers keep it manifold. Reuses
  // the same slab+riser construction as the bookmark builder (so a migrated v1 doc
  // reproduces buildBookmarkParts output). Raised/heightmap directions are separate
  // builders (later tasks); this is the engraved path.
  function buildEngravedParts(doc) {
    const { cols, rows, pitch } = gridForBody(doc.body, doc.resolution);
    const comp = composeDesignV2(doc, cols, rows);
    const footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    const T = doc.body.thicknessMm, layerH = doc.body.layerHeightMm;
    const baseHex = doc.body.baseColor.toUpperCase();
    const idx = (c, r) => r * cols + c;
    const colorParts = [], baseParts = [];
    const tracedFacets = (member, thickness, z0) => window.orientOutward(
      window.traceMaskToFacets((c, r) => member(c, r) && footprint(c, r) > 0, cols, rows, pitch, thickness, z0));

    const floor = Math.min(2 * layerH, T);
    const minBase = Math.min(Math.max(0.8, T * 0.34, 2 * layerH), Math.max(0, T - floor));
    const maxRecess = Math.max(0, T - floor - minBase);
    const recessOf = (d) => Math.max(0, Math.min(d, maxRecess));
    const baseUnder = (d) => T - recessOf(d) - floor;

    const step = Math.max(1, doc.colorStepLayers || 2) * layerH;
    const ownerEff = new Map();
    for (let i = 0; i < cols * rows; i++) {
      if (comp.isBase[i] || comp.cutout[i] || comp.owner[i] < 0) continue;
      const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
      let s = ownerEff.get(comp.owner[i]); if (!s) ownerEff.set(comp.owner[i], s = new Set());
      s.add(hex);
    }
    const orderedColors = [];
    const pushC = (h) => { if (orderedColors.indexOf(h) === -1) orderedColors.push(h); };
    for (let ei = doc.elements.length - 1; ei >= 0; ei--) {
      const present = ownerEff.get(ei); if (!present) continue;
      const el = doc.elements[ei], mode = el.depth && el.depth.mode;
      const seq = [];
      if (el.type === "text" || (el.type === "image" && mode !== "colorLayers")) {
        const c = window.hexToRgb(el.color); seq.push(__hex(c[0], c[1], c[2]));
      } else if (el.type === "image" && mode === "colorLayers") {
        const remap = (el.depth.reduce && el.depth.reduce.remap) || {};
        for (const nat of __orderedNaturalHexesV2(el)) { const c = window.hexToRgb(remap[nat] || nat); seq.push(__hex(c[0], c[1], c[2])); }
      }
      for (const h of seq) if (present.has(h)) pushC(h);
      for (const h of present) pushC(h);
    }
    const depthByHex = new Map();
    orderedColors.forEach((hex, rank) => depthByHex.set(hex, (rank + 1) * step));
    const depthFor = (hex) => depthByHex.get(hex) || step;

    const groups = new Map();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (comp.isBase[i] || comp.cutout[i]) continue;
      const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
      let grp = groups.get(hex); if (!grp) groups.set(hex, grp = { hex, set: new Uint8Array(cols * rows) });
      grp.set[i] = 1;
    }
    let cn = 0;
    for (const grp of groups.values()) {
      const z0 = baseUnder(depthFor(grp.hex));
      const facets = tracedFacets((c, r) => grp.set[idx(c, r)] === 1, floor, z0);
      if (facets.length) colorParts.push({ name: "farbe-" + (++cn), color: window.hexToRgb(grp.hex), facets });
    }

    const baseAdd = (member, thickness, z0) => {
      const facets = tracedFacets(member, thickness, z0);
      if (facets.length) baseParts.push({ name: "grundplatte", color: window.hexToRgb(baseHex), facets });
    };
    baseAdd((c, r) => comp.cutout[idx(c, r)] !== 1, minBase, 0);
    baseAdd((c, r) => comp.isBase[idx(c, r)] === 1, T - minBase, minBase);
    const behind = new Map();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (comp.cutout[i] || comp.isBase[i]) continue;
      const h = baseUnder(depthFor(__hex(comp.r[i], comp.g[i], comp.b[i])));
      if (h - minBase <= 1e-6) continue;
      const key = h.toFixed(4);
      let set = behind.get(key); if (!set) behind.set(key, set = { h, m: new Uint8Array(cols * rows) });
      set.m[i] = 1;
    }
    for (const set of behind.values()) baseAdd((c, r) => set.m[idx(c, r)] === 1, set.h - minBase, minBase);

    return [...baseParts, ...colorParts];
  }
```

Add to the `window.* =` export block:
```javascript
  window.buildEngravedParts = buildEngravedParts;
```

- [ ] **Step 4: Run the tests; verify all pass**

Reload on a fresh port (`python3 -m http.server 8023`). Expected: `fail: 0`; the 2 parity tests pass (the migrated-doc engraved output matches `buildBookmarkParts` within 0.1%); all 35 prior tests still pass (37 total). If a parity test FAILS, the port has a bug — fix the port until it matches; do NOT loosen the tolerance.

- [ ] **Step 5: Commit**

```bash
git add js/build-parts.js tests/engraved-parity.test.js tests/run.html
git commit -m "feat(geometry): buildEngravedParts(doc) — v2 engraved model, parity vs bookmark

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3 (T5a): `buildMountRingParts(doc)` — the loop (Öse) ring

**Files:**
- Modify: `js/build-parts.js` (inside the IIFE; add `buildMountRingParts`; export `window.buildMountRingParts`)
- Create: `tests/mount-ring.test.js`
- Modify: `tests/run.html` (add the test script)

**Background:** The v2 analogue of relief's `fBoss`. When `doc.mount.type === 'loop'`, a reinforced ring (annulus) sits around the mounting hole, standing proud of the base top face. The hole itself is already cut by `shapeFootprintField` (Task foundation); this builds the additive ring. The v2 model now carries `mount.ringThicknessMm` (in-plane wall) and `mount.ringHeightMm` (protrusion height). Body-colored (`baseColor`), like relief's Öse.

**Interfaces:**
- Consumes: `gridForBody` (this file); `window.shapeFootprintField`, `window.traceMaskToFacets`, `window.orientOutward`, `window.hexToRgb`. Reads `doc.body.{widthMm,heightMm,thicknessMm,baseColor,shape,cornerRadiusMm}`, `doc.mount.{type,xMm,yMm,diameterMm,ringThicknessMm,ringHeightMm}`, `doc.resolution`.
- Produces: `buildMountRingParts(doc) -> PART[]`. Returns `[]` unless `mount.type === 'loop'` and `ringThicknessMm > 0` and `ringHeightMm > 0`. Otherwise `[{name:'oese', color:hexToRgb(baseColor), facets}]`: an annulus centered at `(mount.xMm, mount.yMm)` — inner radius `diameterMm/2`, outer radius `diameterMm/2 + ringThicknessMm` — intersected with the body (no-hole) footprint so it can't overhang the plate, extruded `z = thicknessMm .. thicknessMm + ringHeightMm`.

- [ ] **Step 1: Write the failing test**

Create `tests/mount-ring.test.js`:

```javascript
"use strict";
(function () {
  function signedVol(facets) {
    let v = 0;
    for (const t of facets) { const [a,b,c]=t;
      v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6; }
    return v;
  }
  function zbounds(facets){ let mn=Infinity,mx=-Infinity; for(const t of facets) for(const p of t){ if(p[2]<mn)mn=p[2]; if(p[2]>mx)mx=p[2]; } return {mn,mx}; }
  function loopDoc() {
    const d = defaultDoc();
    d.body.shape="rect"; d.body.widthMm=40; d.body.heightMm=120; d.body.thicknessMm=3; d.body.baseColor="#334455";
    d.resolution=240;
    d.mount = { type:"loop", xMm:20, yMm:10, diameterMm:6, ringThicknessMm:2.5, ringHeightMm:2, marginMm:7 };
    return d;
  }

  test("mount ring: loop produces one watertight annular Öse at the right z", () => {
    const parts = buildMountRingParts(loopDoc());
    assertEqual(parts.length, 1, "one ring part");
    assertEqual(parts[0].name, "oese", "named oese");
    assert(parts[0].facets.length > 0, "has facets");
    assert(signedVol(parts[0].facets) > 0, "watertight (positive volume)");
    const zb = zbounds(parts[0].facets);
    assertClose(zb.mn, 3, 1e-6, "ring bottom at base top (thicknessMm)");
    assertClose(zb.mx, 5, 1e-6, "ring top at thicknessMm + ringHeightMm");
  });

  test("mount ring: none/hole/zero-thickness produce no ring", () => {
    const none = loopDoc(); none.mount.type = "none";
    assertEqual(buildMountRingParts(none).length, 0, "type none -> no ring");
    const hole = loopDoc(); hole.mount.type = "hole";
    assertEqual(buildMountRingParts(hole).length, 0, "type hole -> no ring");
    const zero = loopDoc(); zero.mount.ringThicknessMm = 0;
    assertEqual(buildMountRingParts(zero).length, 0, "zero ring thickness -> no ring");
  });
})();
```

Add to `tests/run.html` after the `engraved-parity.test.js` tag:
```html
<script src="mount-ring.test.js"></script>
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

`python3 -m http.server 8024`; load `tests/run.html`; `window.__ready()`.
Expected: `fail: 2`, `buildMountRingParts is not defined`. All 37 prior tests pass.

- [ ] **Step 3: Implement in `js/build-parts.js`**

Inside the IIFE (before the `window.* =` exports), add:

```javascript
  // The loop (Öse) ring: an annulus around the mount hole, standing proud of the
  // base top face. Only for mount.type==='loop' with a positive ring wall + height.
  // Body-colored, intersected with the (no-hole) body footprint so it can't overhang.
  function buildMountRingParts(doc) {
    const m = doc.mount || {};
    if (m.type !== "loop" || !(m.ringThicknessMm > 0) || !(m.ringHeightMm > 0)) return [];
    const { cols, rows, pitch } = gridForBody(doc.body, doc.resolution);
    const bodyOnly = window.shapeFootprintField(cols, rows, doc.body, { type: "none" });
    const sx = cols / doc.body.widthMm, sy = rows / doc.body.heightMm;
    const innerR = m.diameterMm / 2, outerR = innerR + m.ringThicknessMm;
    const cx = m.xMm, cy = m.yMm;
    const inRing = (c, r) => {
      const x = (c + 0.5) / sx, y = (r + 0.5) / sy;
      const d = Math.hypot(x - cx, y - cy);
      return d >= innerR && d <= outerR && bodyOnly(c, r) > 0;
    };
    const facets = window.orientOutward(
      window.traceMaskToFacets(inRing, cols, rows, pitch, m.ringHeightMm, doc.body.thicknessMm));
    if (!facets.length) return [];
    return [{ name: "oese", color: window.hexToRgb(doc.body.baseColor), facets }];
  }
```

Add to the `window.* =` export block:
```javascript
  window.buildMountRingParts = buildMountRingParts;
```

- [ ] **Step 4: Run the tests; verify all pass**

Reload on a fresh port (`python3 -m http.server 8025`). Expected: `fail: 0`; the 2 ring tests pass; all 37 prior tests still pass (39 total).

- [ ] **Step 5: Commit**

```bash
git add js/build-parts.js tests/mount-ring.test.js tests/run.html
git commit -m "feat(geometry): buildMountRingParts — v2 loop (Öse) ring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4 (T5b): `buildRaisedParts(doc)` — raised element prisms

**Files:**
- Modify: `js/build-parts.js` (inside the IIFE; add `buildRaisedParts`; export `window.buildRaisedParts`)
- Create: `tests/raised-parts.test.js`
- Modify: `tests/run.html` (add the test script)

**Background:** The counterpart to `buildEngravedParts`. For elements with `depth.direction === 'raised'`, extrude their colored regions UP from the base top face (`z = thicknessMm`). This builds only the raised prisms — the base plate is built separately (`buildBaseParts` full-solid, or `buildEngravedParts`' recessed base; the T6 entry assembles them). Reuses `__hex` and `__orderedNaturalHexesV2` from Task 2 (already in the file).

**Interfaces:**
- Consumes: `gridForBody`, `composeDesignV2`, `__hex`, `__orderedNaturalHexesV2` (this file); `window.shapeFootprintField`, `window.traceMaskToFacets`, `window.orientOutward`, `window.hexToRgb`.
- Produces: `buildRaisedParts(doc) -> PART[]`. Groups raised-owned, non-cutout pixels by (element, colorHex) and extrudes each group `z = thicknessMm .. thicknessMm + height`, where height = `depth.heightMm` for solid/text (min one layer), or `(rank+1)*step` for a `colorLayers` element's colors (rank from `__orderedNaturalHexesV2`, `step = colorStepLayers*layerHeightMm`). Part names `erhaben-<n>`. Returns `[]` if no raised elements.

- [ ] **Step 1: Write the failing test**

Create `tests/raised-parts.test.js`:

```javascript
"use strict";
(function () {
  function signedVol(f){let v=0;for(const t of f){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return v;}
  function zbounds(f){let mn=Infinity,mx=-Infinity;for(const t of f)for(const p of t){if(p[2]<mn)mn=p[2];if(p[2]>mx)mx=p[2];}return{mn,mx};}
  async function solidImg(hex,w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle=hex;cx.fillRect(0,0,w,h);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});return img;}

  test("raised: solid element extrudes a prism above the base top", async () => {
    const img = await solidImg("#00ff00", 8, 8);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.thicknessMm=3; v1.resolution=200;
    v1.elements=[ makeImageElement({src:"a", colorMode:"solid", color:"#00ff00", cxMm:20,cyMm:20,wMm:20,hMm:20}) ];
    const v2 = migrateProject(v1);
    v2.elements[0].depth.direction = "raised"; v2.elements[0].depth.heightMm = 2; v2.elements[0]._img = img;
    const parts = buildRaisedParts(v2);
    assertEqual(parts.length, 1, "one raised prism");
    assert(parts[0].name.indexOf("erhaben") === 0, "raised part name");
    assertEqual(parts[0].color[1], 255, "green prism");
    assert(signedVol(parts[0].facets) > 0, "watertight (positive volume)");
    const zb = zbounds(parts[0].facets);
    assertClose(zb.mn, 3, 1e-6, "prism bottom at base top (thicknessMm)");
    assertClose(zb.mx, 5, 1e-6, "prism top at thicknessMm + heightMm");
  });

  test("raised: engraved elements are ignored", async () => {
    const img = await solidImg("#00ff00", 8, 8);
    const v1 = defaultBookmark(); v1.resolution=120;
    v1.elements=[ makeImageElement({src:"a", colorMode:"solid", color:"#00ff00", cxMm:25,cyMm:75,wMm:20,hMm:20}) ];
    const v2 = migrateProject(v1);  // direction defaults to 'engraved'
    v2.elements[0]._img = img;
    assertEqual(buildRaisedParts(v2).length, 0, "engraved element -> no raised parts");
  });
})();
```

Add to `tests/run.html` after the `mount-ring.test.js` tag:
```html
<script src="raised-parts.test.js"></script>
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

`python3 -m http.server 8026`; load `tests/run.html`; `window.__ready()`.
Expected: `fail: 2`, `buildRaisedParts is not defined`. All 39 prior tests pass.

- [ ] **Step 3: Implement in `js/build-parts.js`**

Inside the IIFE (before the `window.* =` exports), add:

```javascript
  // Raised element prisms: for depth.direction==='raised' elements, extrude their
  // colored regions UP from the base top face. Base plate is built separately.
  // Height: depth.heightMm for solid/text; (rank+1)*step per color for colorLayers.
  function buildRaisedParts(doc) {
    const { cols, rows, pitch } = gridForBody(doc.body, doc.resolution);
    const comp = composeDesignV2(doc, cols, rows);
    const footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    const T = doc.body.thicknessMm, layerH = doc.body.layerHeightMm;
    const step = Math.max(1, doc.colorStepLayers || 2) * layerH;
    const idx = (c, r) => r * cols + c;
    const tracedFacets = (member, thickness, z0) => window.orientOutward(
      window.traceMaskToFacets((c, r) => member(c, r) && footprint(c, r) > 0, cols, rows, pitch, thickness, z0));

    const heightForElemColor = (el, hex) => {
      if (el.depth && el.depth.mode === "colorLayers") {
        const remap = (el.depth.reduce && el.depth.reduce.remap) || {};
        const seq = __orderedNaturalHexesV2(el).map(nat => { const c = window.hexToRgb(remap[nat] || nat); return __hex(c[0], c[1], c[2]); });
        const rank = seq.indexOf(hex);
        return ((rank < 0 ? 0 : rank) + 1) * step;
      }
      return Math.max((el.depth && el.depth.heightMm) || 0, layerH);
    };

    const groups = new Map(); // "ei|hex" -> {ei, hex, set}
    for (let i = 0; i < cols * rows; i++) {
      const ei = comp.owner[i];
      if (ei < 0 || comp.cutout[i]) continue;
      const el = doc.elements[ei];
      if (!(el.depth && el.depth.direction === "raised")) continue;
      const hex = __hex(comp.r[i], comp.g[i], comp.b[i]);
      const key = ei + "|" + hex;
      let g = groups.get(key); if (!g) groups.set(key, g = { ei, hex, set: new Uint8Array(cols * rows) });
      g.set[i] = 1;
    }
    const parts = []; let n = 0;
    for (const g of groups.values()) {
      const h = heightForElemColor(doc.elements[g.ei], g.hex);
      const facets = tracedFacets((c, r) => g.set[idx(c, r)] === 1, h, T);
      if (facets.length) parts.push({ name: "erhaben-" + (++n), color: window.hexToRgb(g.hex), facets });
    }
    return parts;
  }
```

Add to the `window.* =` export block:
```javascript
  window.buildRaisedParts = buildRaisedParts;
```

- [ ] **Step 4: Run the tests; verify all pass**

Reload on a fresh port (`python3 -m http.server 8027`). Expected: `fail: 0`; the 2 raised tests pass; all 39 prior tests still pass (41 total).

- [ ] **Step 5: Commit**

```bash
git add js/build-parts.js tests/raised-parts.test.js tests/run.html
git commit -m "feat(geometry): buildRaisedParts — raised element prisms above the base

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5 (T5c): `buildHeightmapParts(doc)` — continuous brightness→height relief

**Files:**
- Modify: `js/build-parts.js` (extract `__drawElement`; refactor `__renderElementV2` to use it; add `buildHeightmapParts`; export `window.buildHeightmapParts`)
- Create: `tests/heightmap-parts.test.js`
- Modify: `tests/run.html` (add the test script)

**Background:** For `depth.mode === 'heightmap'` elements, the image's brightness drives height (the relief's signature). Since FDM slicing discretizes to `layerHeightMm` anyway, we build it as a **floor slab + stacked super-level slabs** (each a flat extrusion of the region where brightness ≥ a threshold) — reusing the proven `traceMaskToFacets`/`extrudeLoops` primitives (watertight per slab), physically identical to a continuous surface once printed. This needs the element's raw luminance, so we extract a shared `__drawElement` canvas helper (used by both `__renderElementV2` and the heightmap path — no new duplication).

**Interfaces:**
- Consumes: `gridForBody` (this file); `window.shapeFootprintField`, `window.traceMaskToFacets`, `window.orientOutward`, `window.hexToRgb`.
- Produces:
  - `__drawElement(el, doc, cols, rows) -> Uint8ClampedArray` (internal): the RGBA pixel data after drawing the element (translate/rotate/drawImage or fillText) at grid resolution. `__renderElementV2` is refactored to call it (behavior unchanged — the canvas ops are moved verbatim, so engraved parity holds).
  - `buildHeightmapParts(doc) -> PART[]`: for each `heightmap` element, a floor slab over the silhouette (`z = thicknessMm .. thicknessMm + baseFloor`, `baseFloor = clamp(depth.baseFloorMm, layerHeightMm, heightMm)`) plus K super-level slabs (`K = clamp(round((heightMm-baseFloor)/layerHeightMm), 0, 48)`), slab k present where per-pixel brightness ≥ `k/K`, at `z = thicknessMm + baseFloor + (k-1)*Δ`, thickness `Δ = (heightMm-baseFloor)/K`. Brightness = luminance/255 (inverted if `depth.invert`). All slabs colored `el.color`. Part names `hoehe-<ei+1>-boden` / `hoehe-<ei+1>-<k>`. `[]` if no heightmap elements.

- [ ] **Step 1: Write the failing test**

Create `tests/heightmap-parts.test.js`:

```javascript
"use strict";
(function () {
  function signedVol(f){let v=0;for(const t of f){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return v;}
  function zbounds(f){let mn=Infinity,mx=-Infinity;for(const t of f)for(const p of t){if(p[2]<mn)mn=p[2];if(p[2]>mx)mx=p[2];}return{mn,mx};}
  async function halfImg(leftHex,rightHex,w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle=leftHex;cx.fillRect(0,0,w/2,h);cx.fillStyle=rightHex;cx.fillRect(w/2,0,w/2,h);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=cv.toDataURL("image/png");});return img;}

  test("heightmap: brightness drives height (black floor, white full relief)", async () => {
    const img = await halfImg("#000000", "#ffffff", 16, 16);
    const v1 = defaultBookmark(); v1.widthMm=40; v1.heightMm=40; v1.thicknessMm=3; v1.layerHeightMm=0.2; v1.resolution=120;
    v1.elements=[ makeImageElement({src:"a", color:"#888888", cxMm:20,cyMm:20,wMm:40,hMm:40}) ];
    const v2 = migrateProject(v1);
    v2.elements[0].depth.mode = "heightmap"; v2.elements[0].depth.heightMm = 1.0; v2.elements[0].depth.baseFloorMm = 0.2;
    v2.elements[0]._img = img;
    const parts = buildHeightmapParts(v2);
    assert(parts.length >= 2, "floor + at least one relief slab");
    assert(parts.every(p => signedVol(p.facets) > 0), "every slab watertight");
    assert(parts.every(p => p.color[0] === 0x88), "all slabs use el.color (#888888)");
    const all = parts.reduce((a, p) => a.concat(p.facets), []);
    const zb = zbounds(all);
    assertClose(zb.mn, 3, 1e-6, "relief bottom at base top (thicknessMm)");
    assertClose(zb.mx, 4, 1e-6, "brightest (white) reaches thicknessMm + heightMm");
  });

  test("heightmap: no heightmap elements -> []", async () => {
    const v1 = defaultBookmark(); v1.resolution=80;
    const v2 = migrateProject(v1); // empty
    assertEqual(buildHeightmapParts(v2).length, 0, "empty -> no parts");
  });
})();
```

Add to `tests/run.html` after the `raised-parts.test.js` tag:
```html
<script src="heightmap-parts.test.js"></script>
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

`python3 -m http.server 8030`; load `tests/run.html`; `window.__ready()`.
Expected: `fail: 2`, `buildHeightmapParts is not defined`. All 41 prior tests pass.

- [ ] **Step 3: Implement in `js/build-parts.js`**

First, **extract `__drawElement` and refactor `__renderElementV2`**. `__renderElementV2` currently begins by creating a canvas, translating/rotating, drawing text/image, then `const d = ctx.getImageData(...).data; const n = cols*rows; ...`. Replace that opening canvas block with a call to a new shared helper. Add `__drawElement` immediately before `__renderElementV2`:

```javascript
  // Draw one element (translate/rotate + text/image) to a cols×rows canvas and
  // return its RGBA pixel data. Shared by __renderElementV2 (mask/color) and the
  // heightmap builder (luminance). Canvas ops are identical to the prior inline
  // version, so engraved parity is unaffected.
  function __drawElement(el, doc, cols, rows) {
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
    return ctx.getImageData(0, 0, cols, rows).data;
  }
```

Then change the start of `__renderElementV2` so that instead of its own canvas setup it does:
```javascript
  function __renderElementV2(el, doc, cols, rows) {
    const d = __drawElement(el, doc, cols, rows);
    const n = cols * rows;
    const mask = new Uint8Array(n);
    const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
    const depth = el.depth || {};
    // ... (the existing colorLayers branch and solid/raised branch unchanged) ...
```
(Keep the rest of `__renderElementV2` — the `colorLayers` branch and the solid/threshold/`raised` branch — exactly as-is. Only its canvas-setup preamble is replaced by the `__drawElement` call.)

Then add `buildHeightmapParts` (before the `window.* =` exports):

```javascript
  // Continuous brightness->height relief for depth.mode==='heightmap' elements:
  // a floor slab over the silhouette + K super-level slabs (region where brightness
  // >= k/K), each a flat extrusion. Prints identically to a smooth surface after
  // slicing. Single color (el.color); height from luminance.
  function buildHeightmapParts(doc) {
    const { cols, rows, pitch } = gridForBody(doc.body, doc.resolution);
    const footprint = window.shapeFootprintField(cols, rows, doc.body, doc.mount);
    const T = doc.body.thicknessMm, layerH = doc.body.layerHeightMm;
    const idx = (c, r) => r * cols + c;
    const tracedFacets = (member, thickness, z0) => window.orientOutward(
      window.traceMaskToFacets((c, r) => member(c, r) && footprint(c, r) > 0, cols, rows, pitch, thickness, z0));
    const parts = [];
    doc.elements.forEach((el, ei) => {
      const depth = el.depth || {};
      if (depth.mode !== "heightmap") return;
      if (el.type === "image" && !el._img) return;
      const d = __drawElement(el, doc, cols, rows);
      const maxH = Math.max(layerH, depth.heightMm || 0);
      const baseFloor = Math.min(Math.max(depth.baseFloorMm || 0, layerH), maxH);
      const availH = Math.max(0, maxH - baseFloor);
      const invert = !!depth.invert;
      const col = window.hexToRgb(el.color);
      const n = cols * rows;
      const bright = new Float32Array(n), inRegion = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (d[i * 4 + 3] < 128) continue;
        let lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
        if (invert) lum = 1 - lum;
        bright[i] = lum; inRegion[i] = 1;
      }
      const floor = tracedFacets((c, r) => inRegion[idx(c, r)] === 1, baseFloor, T);
      if (floor.length) parts.push({ name: "hoehe-" + (ei + 1) + "-boden", color: col, facets: floor });
      const K = Math.max(0, Math.min(48, Math.round(availH / layerH)));
      const dz = K > 0 ? availH / K : 0;
      for (let k = 1; k <= K; k++) {
        const thr = k / K, z0 = T + baseFloor + (k - 1) * dz;
        const facets = tracedFacets((c, r) => inRegion[idx(c, r)] === 1 && bright[idx(c, r)] >= thr, dz, z0);
        if (facets.length) parts.push({ name: "hoehe-" + (ei + 1) + "-" + k, color: col, facets });
      }
    });
    return parts;
  }
```

Add to the `window.* =` export block:
```javascript
  window.buildHeightmapParts = buildHeightmapParts;
```

- [ ] **Step 4: Run the tests; verify all pass**

Reload on a fresh port (`python3 -m http.server 8031`). Expected: `fail: 0`; the 2 heightmap tests pass; all 41 prior tests still pass (43 total) — **including the engraved-parity tests** (confirming the `__drawElement` extraction didn't change `__renderElementV2`'s behavior). If engraved parity breaks, the extraction changed a canvas op — revert to verbatim.

- [ ] **Step 5: Commit**

```bash
git add js/build-parts.js tests/heightmap-parts.test.js tests/run.html
git commit -m "feat(geometry): buildHeightmapParts — brightness->height relief (slab stack)

Extract __drawElement shared canvas helper; heightmap builds a floor + super-level
slabs from per-pixel luminance. Prints identically to a continuous surface.

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
