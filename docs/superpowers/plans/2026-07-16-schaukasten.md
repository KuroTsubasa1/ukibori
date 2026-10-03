# Schaukasten (Shadowbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document-scope Schaukasten mode: a stack of N single-color plates with progressively smaller organic tunnel openings, subject on the back plate, per-element plate assignment with opening-overhang, and a printed slotted stand — assembled 3D preview, print-ready side-by-side export.

**Architecture:** One signed opening field (mm, >0 inside the front opening) drives every plate: plate k's opening is `{f > k·insetPerLayerMm}` (nested by construction, the Zierlinie iso-band pattern). A new pure module `js/shadowbox.js` owns the field, plate colors, preview loops, and the stand; `buildShadowboxParts` inside the build-parts IIFE assembles per-plate parts by reusing the existing content builders with a custom footprint, then z-stacks (preview) or bed-lays (export) the facets. `buildParts` forks to it only when enabled — disabled output stays byte-identical.

**Tech Stack:** Vanilla JS classic scripts (window.* IIFE globals, no build step), canvas rasterization, potrace tracing, browser test harness (tests/run.html via Playwright over http).

**Spec:** `docs/superpowers/specs/2026-07-16-schaukasten-design.md`

## Global Constraints

- Code + comments + tests in English; UI strings and 3MF part names German (`ebene-1-grundplatte`, `staender-sockel`). No AI/Claude mentions in commit messages.
- Parity: with `shadowbox.enabled === false` (or field absent), `buildParts` output must be **byte-identical** (JSON.stringify) to a doc without the feature.
- New JS files: classic script wrapped in `"use strict"` IIFE; never redeclare `window.els`; must be registered in BOTH `index.html` (script list at bottom, dependency order: after `geometry.js`/`trace.js`, before `build-parts.js`) and `tests/run.html` sources block.
- tests/run.html has NO auto-discovery — add each new test file as a `<script>` line. Chromium caches `<script src>` per URL: EVERY edit to a source loaded by run.html requires a FRESH `?v=` token (`?v=sb1`, `?v=sb2`, `?v=sb3`, … — increment per task that touches the file, including `js/shadowbox.js` once it exists).
- Test recipe (run after every task): `python3 -m http.server 8899` from repo root (background), then Playwright MCP: navigate `http://localhost:8899/tests/run.html`, `page.evaluate(() => window.__ready())`, expect `fail: 0`. Kill the server after.
- Headless test docs: shrink body (60×40 mm), `d.resolution = 96`, `d.autoLayerHeights = false`, explicit `mount = {type:"none", ...}`.
- Verify BOTH depth directions — Lasse prints engraved („Vertieft“); the plan includes an engraved-back-plate test, do not drop it.
- All engine units mm; raster y-down, mesh y-up (builders y-flip internally); extrusions are flat +z only — shifts are baked into facet vertex arrays.
- Everything must degrade gracefully under `file://` (no fetch, no dev-server assumptions).

---

### Task 1: Data model + migration

**Files:**
- Modify: `js/bookmark-model.js` (defaults ~line 100-146, `migrateProject` v2 branch ~line 183-212, v1 branch ~line 217-245, `migrateElement` ~line 168-173, `makeElementV2` ~line 251-266)
- Create: `tests/shadowbox.test.js`
- Modify: `tests/run.html` (add test line; bump `bookmark-model.js?v=zl1` → `?v=sb1`)

**Interfaces:**
- Produces: `window.defaultShadowbox() -> {enabled, layers, insetPerLayerMm, opening:{source,marginMm,waviness,periodMm,seed,points}, colorFront, colorBack, stand:{enabled,heightMm,slotDepthMm,railMm,tolMm,color}}`; `doc.shadowbox` on every default/migrated doc; `el.sbLayer` (int|null, null = back plate), `el.sbOverhang` (bool) on every element.

- [ ] **Step 1: Write failing tests** — create `tests/shadowbox.test.js`:

```js
"use strict";
// Schaukasten: stacked paper-cut plates with a shared tunnel-opening field.
(function () {
  test("schaukasten: defaultDoc carries disabled shadowbox defaults", () => {
    const d = window.defaultDoc();
    assert(d.shadowbox && d.shadowbox.enabled === false, "shadowbox present + off");
    assertEqual(d.shadowbox.layers, 6, "layers default");
    assertEqual(d.shadowbox.insetPerLayerMm, 4, "inset default");
    assertEqual(d.shadowbox.opening.source, "auto", "opening source");
    assertEqual(d.shadowbox.opening.points, null, "no drawn points");
    assert(d.shadowbox.stand.enabled === true, "stand on by default");
  });

  test("schaukasten: makeElementV2 carries sbLayer/sbOverhang defaults", () => {
    const el = window.makeElementV2("text", {});
    assertEqual(el.sbLayer, null, "sbLayer null = back plate");
    assertEqual(el.sbOverhang, false, "no overhang");
  });

  test("schaukasten: migrateProject backfills v2 docs and elements", () => {
    const d = window.defaultDoc();
    delete d.shadowbox;
    d.elements.push(window.makeElementV2("shape", {}));
    delete d.elements[0].sbLayer; delete d.elements[0].sbOverhang;
    const m = window.migrateProject(d);
    assert(m.shadowbox && m.shadowbox.enabled === false, "doc backfilled");
    assertEqual(m.elements[0].sbLayer, null, "element sbLayer backfilled");
    assertEqual(m.elements[0].sbOverhang, false, "element sbOverhang backfilled");
  });

  test("schaukasten: migrateProject is idempotent on v2 docs", () => {
    const d = window.migrateProject(window.defaultDoc());
    const once = JSON.stringify(d);
    assertEqual(JSON.stringify(window.migrateProject(d)), once, "idempotent");
  });
})();
```

- [ ] **Step 2: Register + run to verify failure** — in `tests/run.html`: bump the bookmark-model line to `<script src="../js/bookmark-model.js?v=sb1"></script>`, append `<script src="shadowbox.test.js"></script>` at the end of the test block. Run the test recipe. Expected: the 4 new tests FAIL (`defaultShadowbox`/fields missing), everything else passes.

- [ ] **Step 3: Implement** — in `js/bookmark-model.js`, after `defaultFrame()` (~line 108):

```js
// Schaukasten: layered paper-cut stack. One opening field drives all plates;
// plate k's opening = {field > k*insetPerLayerMm}. layers includes the solid
// back plate. enabled=false keeps buildParts byte-identical (parity).
function defaultShadowbox() {
  return {
    enabled: false,
    layers: 6,
    insetPerLayerMm: 4,
    opening: { source: "auto", marginMm: 12, waviness: 0.5, periodMm: 40, seed: 1, points: null },
    colorFront: "#DDEEFA",
    colorBack: "#1B5E9E",
    stand: { enabled: true, heightMm: 15, slotDepthMm: 8, railMm: 5, tolMm: 0.4, color: "#C8BBAE" },
  };
}
```

In `defaultDoc()` add `shadowbox: defaultShadowbox(),` directly after `topLayerColor: null,`.
In `makeElementV2` base `Object.assign` add `sbLayer: null, sbOverhang: false,` after `groupId: null,`.
In `migrateElement`'s `out` object add `sbLayer: null, sbOverhang: false,` after `groupId: ...`.
In `migrateProject` v2 branch, after the `doc.body.baseThicknessMm` backfill:

```js
    if (doc.shadowbox == null) doc.shadowbox = defaultShadowbox();
    else {
      const sd = defaultShadowbox();
      if (doc.shadowbox.opening == null) doc.shadowbox.opening = sd.opening;
      if (doc.shadowbox.stand == null) doc.shadowbox.stand = sd.stand;
    }
```

and inside the per-element loop:

```js
      if (el.sbLayer === undefined) el.sbLayer = null;
      if (el.sbOverhang == null) el.sbOverhang = false;
```

In the v1 branch's returned doc add `shadowbox: defaultShadowbox(),` after `topLayerColor: null,`.

- [ ] **Step 4: Run tests** — full suite green (`fail: 0`).
- [ ] **Step 5: Commit** — `git commit -m "feat(schaukasten): Datenmodell — doc.shadowbox, Element-Ebene/Überhang, Migration"`

---

### Task 2: Pure module js/shadowbox.js — plate colors + auto opening field

**Files:**
- Create: `js/shadowbox.js`
- Modify: `index.html` (script list at bottom: add `<script src="js/shadowbox.js"></script>` immediately BEFORE the `build-parts.js` line)
- Modify: `tests/run.html` (sources block: add `<script src="../js/shadowbox.js"></script>` after `geom-util.js` line), `tests/shadowbox.test.js`

**Interfaces:**
- Consumes: `window.bodySdfMm(body)`, `window.platePerimeterMm(body)` (js/geometry.js).
- Produces: `window.shadowboxPlateColors(sb) -> ["#RRGGBB", ...]` (length = clamped layers, front→back lerp); `window.shadowboxOpeningField(doc, grid) -> ((c,r) -> signed mm) | null` — >0 inside the FRONT opening, clamped so every opening keeps ≥2 mm ring to the plate edge, rectangular cell mapping `x=(c+0.5)/(cols/W)`; `window.__sbClampLayers(n) -> int` (3..10).

- [ ] **Step 1: Write failing tests** — append to `tests/shadowbox.test.js` (inside the IIFE):

```js
  function sbDoc() {
    const d = window.defaultDoc();
    d.body.widthMm = 60; d.body.heightMm = 40; d.body.thicknessMm = 2;
    d.resolution = 96; d.autoLayerHeights = false;
    d.mount = { type: "none", xMm: 30, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    d.shadowbox.enabled = true;
    d.shadowbox.layers = 4;
    d.shadowbox.insetPerLayerMm = 3;
    d.shadowbox.opening.marginMm = 8;
    d.shadowbox.stand.enabled = false;
    return d;
  }

  test("schaukasten: plate colors lerp front to back", () => {
    const cols = window.shadowboxPlateColors({ layers: 4, colorFront: "#000000", colorBack: "#FFFFFF" });
    assertEqual(cols.length, 4, "one color per plate");
    assertEqual(cols[0], "#000000", "front endpoint");
    assertEqual(cols[3], "#FFFFFF", "back endpoint");
    assertEqual(cols[1], "#555555", "1/3 lerp");
  });

  test("schaukasten: auto opening field sign and margin", () => {
    const d = sbDoc();
    const { grid } = window.docGridAndFootprint(d);
    const f = window.shadowboxOpeningField(d, grid);
    assert(typeof f === "function", "field exists for rect body");
    const sx = grid.cols / d.body.widthMm, sy = grid.rows / d.body.heightMm;
    const at = (xMm, yMm) => f(Math.round(xMm * sx - 0.5), Math.round(yMm * sy - 0.5));
    assert(at(30, 20) > 0, "center inside opening");
    assert(at(1, 20) < 0, "1mm from edge is outside (margin 8)");
    assert(at(30, 20) > at(15, 20), "field decreases toward the rim");
  });

  test("schaukasten: opening keeps a 2mm ring even with tiny margin", () => {
    const d = sbDoc();
    d.shadowbox.opening.marginMm = 0.5; d.shadowbox.opening.waviness = 0;
    const { grid } = window.docGridAndFootprint(d);
    const f = window.shadowboxOpeningField(d, grid);
    const sx = grid.cols / d.body.widthMm, sy = grid.rows / d.body.heightMm;
    // 1 mm inside the plate edge must stay plate (field < 0): ring clamp >= 2 mm
    assert(f(Math.round(1 * sx - 0.5), Math.round(20 * sy - 0.5)) < 0, "ring clamp holds");
  });

  test("schaukasten: field is null for free-form bodies", () => {
    const d = sbDoc();
    d.body.shape = "free";
    const { grid } = window.docGridAndFootprint(d);
    assertEqual(window.shadowboxOpeningField(d, grid), null, "no analytic perimeter");
  });
```

- [ ] **Step 2: Register scripts + verify failure** — add the two `<script>` lines (index.html + run.html as listed in Files). Run the recipe. Expected: new tests FAIL (`shadowboxPlateColors is not a function`).

- [ ] **Step 3: Implement `js/shadowbox.js`:**

```js
// Schaukasten engine: shared tunnel-opening field, plate color ramp, preview
// loops, and the printed stand. Pure module — no DOM, no editor state.
(function () {
  "use strict";

  const RING_MIN_MM = 2; // every opening keeps at least this ring to the plate edge

  function __sbClampLayers(n) {
    return Math.max(3, Math.min(10, Math.round(n || 6)));
  }

  // mulberry32 (same generator family as scatter.js makeRng) — deterministic wobble.
  function __rng(seed) {
    let a = (seed | 0) + 0x6d2b79f5;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function __hexRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  // Front->back per-plate colors: linear lerp between colorFront and colorBack.
  function shadowboxPlateColors(sb) {
    const n = __sbClampLayers(sb.layers);
    const a = __hexRgb(sb.colorFront || "#DDEEFA"), b = __hexRgb(sb.colorBack || "#1B5E9E");
    const out = [];
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const c = [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
      out.push("#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase());
    }
    return out;
  }

  // Seeded wobble profile along the plate perimeter. Two sinusoids whose repeat
  // counts snap to integers (Zierkante convention) so the profile closes
  // seamlessly at t=0/t=L. Returns (t)->mm, amplitude-bounded by ampMm.
  function __wobble(L, periodMm, waviness, seed, ampMm) {
    if (!(waviness > 0) || !(ampMm > 0)) return () => 0;
    const n1 = Math.max(3, Math.round(L / Math.max(4, periodMm || 40)));
    const n2 = n1 * 2 + 1;
    const rnd = __rng(seed || 1);
    const p1 = rnd() * 2 * Math.PI, p2 = rnd() * 2 * Math.PI;
    const a = ampMm * Math.max(0, Math.min(1, waviness));
    return (t) => a * (0.62 * Math.sin((2 * Math.PI * n1 * t) / L + p1)
                     + 0.38 * Math.sin((2 * Math.PI * n2 * t) / L + p2));
  }

  // Signed opening field in mm, >0 inside the FRONT (largest) opening. Plate k's
  // opening is {f > k*insetPerLayerMm}; nested by construction. Clamped by
  // min(f, plateSdf - RING_MIN_MM) so no opening ever thins the surrounding
  // ring below RING_MIN_MM. Cell mapping matches shapeFootprintField's default
  // rectangular mapping (x=(c+0.5)/(cols/W)) — shadowbox never expands the domain.
  // Returns null when the body has no analytic perimeter (free/image shapes).
  function shadowboxOpeningField(doc, grid) {
    const body = doc.body;
    if (body.shape !== "rect" && body.shape !== "circle") return null;
    const sb = doc.shadowbox;
    const bare = Object.assign({}, body, { edge: null }); // undecorated plate SDF
    const rawSdf = window.bodySdfMm(bare);
    const per = window.platePerimeterMm(bare);
    if (!per) return null;
    const o = sb.opening || {};
    const marginMm = Math.max(0.5, o.marginMm != null ? o.marginMm : 12);
    const amp = Math.min(marginMm * 0.7, 8);
    const wob = __wobble(per.length, o.periodMm, o.waviness != null ? o.waviness : 0.5, o.seed, amp);
    const sx = grid.cols / body.widthMm, sy = grid.rows / body.heightMm;
    return (c, r) => {
      const x = (c + 0.5) / sx, y = (r + 0.5) / sy;
      const d = rawSdf(x, y);
      const fRaw = d - marginMm + wob(per.nearest(x, y));
      return Math.min(fRaw, d - RING_MIN_MM); // ring guard for every layer at once
    };
  }

  window.__sbClampLayers = __sbClampLayers;
  window.shadowboxPlateColors = shadowboxPlateColors;
  window.shadowboxOpeningField = shadowboxOpeningField;
})();
```

- [ ] **Step 4: Run tests** — full suite green. (Note `#555555`: 0 + 255·(1/3) = 85 = 0x55.)
- [ ] **Step 5: Commit** — `git commit -m "feat(schaukasten): Öffnungsfeld (auto, seeded Wellen) und Platten-Farbverlauf"`

---

### Task 3: Drawn opening + preview loops

**Files:**
- Modify: `js/shadowbox.js`, `js/build-parts.js` (one-line export), `tests/shadowbox.test.js`, `tests/run.html` (bump `build-parts.js?v=zl1` → `?v=sb1`)

**Interfaces:**
- Consumes: `__chamferDT` from build-parts (newly exported as `window.__chamferDT`), `window.marchingSquaresLoops(f, cols, rows)` (geometry.js:312, window-exported), `window.smoothPath` (path-text.js, used by the UI task later).
- Produces: drawn-source support inside `shadowboxOpeningField` (same signature; falls back to auto when `points` degenerate); `window.shadowboxOpeningLoops(doc, k) -> [[{xMm,yMm},...], ...]` — plate k's opening outlines in doc mm (y-down) on a coarse display grid; `window.__sbPolygonMask(points, cols, rows, sx, sy) -> Uint8Array` (scanline even-odd fill, exposed for tests).

- [ ] **Step 1: Export the DT** — in `js/build-parts.js` next to `window.freeFootprintField = freeFootprintField;` (~line 1469) add:

```js
  // Shared with js/shadowbox.js (drawn-opening signed field). Engine-internal.
  window.__chamferDT = __chamferDT;
```

- [ ] **Step 2: Write failing tests** — append to `tests/shadowbox.test.js`:

```js
  test("schaukasten: drawn opening — polygon mask + signed field", () => {
    const d = sbDoc();
    d.shadowbox.opening.source = "drawn";
    // diamond centered on the plate (60x40): well inside, area ~200 mm^2
    d.shadowbox.opening.points = [
      { xMm: 30, yMm: 8 }, { xMm: 50, yMm: 20 }, { xMm: 30, yMm: 32 }, { xMm: 10, yMm: 20 },
    ];
    const { grid } = window.docGridAndFootprint(d);
    const f = window.shadowboxOpeningField(d, grid);
    const sx = grid.cols / 60, sy = grid.rows / 40;
    const at = (x, y) => f(Math.round(x * sx - 0.5), Math.round(y * sy - 0.5));
    assert(at(30, 20) > 0, "diamond center inside");
    assert(at(4, 4) < 0, "plate corner outside");
    assert(at(30, 20) > at(38, 20), "distance decreases toward diamond rim");
  });

  test("schaukasten: degenerate drawn path falls back to auto", () => {
    const a = sbDoc();
    const b = sbDoc();
    b.shadowbox.opening.source = "drawn";
    b.shadowbox.opening.points = [{ xMm: 30, yMm: 20 }, { xMm: 31, yMm: 20 }]; // < 3 points
    const { grid } = window.docGridAndFootprint(a);
    const fa = window.shadowboxOpeningField(a, grid);
    const fb = window.shadowboxOpeningField(b, grid);
    assertClose(fa(48, 48), fb(48, 48), 1e-9, "same as auto at a probe cell");
  });

  test("schaukasten: opening loops are closed and nested", () => {
    const d = sbDoc();
    const l0 = window.shadowboxOpeningLoops(d, 0);
    const l2 = window.shadowboxOpeningLoops(d, 2);
    assert(l0.length >= 1 && l2.length >= 1, "loops exist");
    const span = (loops) => {
      let min = Infinity, max = -Infinity;
      for (const lp of loops) for (const p of lp) { min = Math.min(min, p.xMm); max = Math.max(max, p.xMm); }
      return max - min;
    };
    assert(span(l2) < span(l0), "deeper opening is smaller");
    for (const p of l0[0]) {
      assert(p.xMm > 0 && p.xMm < 60 && p.yMm > 0 && p.yMm < 40, "loop inside plate");
    }
  });
```

Run recipe: the 3 new tests FAIL.

- [ ] **Step 3: Implement** — in `js/shadowbox.js`, before the exports:

```js
  // Even-odd scanline polygon fill onto a raster grid (pure math, no canvas).
  // points: [{xMm,yMm}] closed implicitly; sx/sy = cells per mm.
  function __sbPolygonMask(points, cols, rows, sx, sy) {
    const mask = new Uint8Array(cols * rows);
    const n = points.length;
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) / sy;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const a = points[i], b = points[(i + 1) % n];
        if ((a.yMm <= y) !== (b.yMm <= y)) {
          xs.push(a.xMm + ((y - a.yMm) / (b.yMm - a.yMm)) * (b.xMm - a.xMm));
        }
      }
      xs.sort((p, q) => p - q);
      for (let j = 0; j + 1 < xs.length; j += 2) {
        const c0 = Math.max(0, Math.ceil(xs[j] * sx - 0.5));
        const c1 = Math.min(cols - 1, Math.floor(xs[j + 1] * sx - 0.5));
        for (let c = c0; c <= c1; c++) mask[r * cols + c] = 1;
      }
    }
    return mask;
  }

  function __polyAreaMm(points) {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      a += p.xMm * q.yMm - q.xMm * p.yMm;
    }
    return Math.abs(a) / 2;
  }
```

Inside `shadowboxOpeningField`, after computing `rawSdf`/`per` and before the auto return, add the drawn branch:

```js
    const pts = o.source === "drawn" ? o.points : null;
    if (pts && pts.length >= 3 && __polyAreaMm(pts) >= 25) {
      const { cols, rows } = grid;
      const mask = __sbPolygonMask(pts, cols, rows, sx0, sy0);
      const inv = new Uint8Array(mask.length);
      for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
      const dIn = window.__chamferDT(inv, cols, rows);   // distance to outside == inward depth
      const dOut = window.__chamferDT(mask, cols, rows); // distance to inside == outward gap
      const pitchX = 1 / sx0, pitchY = 1 / sy0, pmm = (pitchX + pitchY) / 2;
      return (c, r) => {
        const i = r * cols + c;
        const fRaw = (mask[i] ? dIn[i] : -dOut[i]) * pmm;
        const x = (c + 0.5) / sx0, y = (r + 0.5) / sy0;
        return Math.min(fRaw, rawSdf(x, y) - RING_MIN_MM);
      };
    }
```

(where `sx0 = grid.cols / body.widthMm`, `sy0 = grid.rows / body.heightMm` — hoist the existing `sx`/`sy` above the branch and reuse). Then:

```js
  // Plate k's opening outlines in doc mm (y-down) for the 2D workbench —
  // coarse display grid (longest side 160 cells), marching-squares sub-pixel.
  function shadowboxOpeningLoops(doc, k) {
    const body = doc.body;
    const RES = 160;
    const W = body.widthMm, H = body.heightMm;
    const long = Math.max(W, H);
    const cols = Math.max(8, Math.round((W / long) * RES));
    const rows = Math.max(8, Math.round((H / long) * RES));
    const grid = { cols, rows, pitch: long / RES, x0: 0, y0: 0 };
    const f = shadowboxOpeningField(doc, grid);
    if (!f) return [];
    const inset = k * Math.max(0.5, doc.shadowbox.insetPerLayerMm || 4);
    const g = (c, r) => f(c, r) - inset;
    const sx = cols / W, sy = rows / H;
    return window.marchingSquaresLoops(g, cols, rows)
      .filter((lp) => lp.length >= 3)
      .map((lp) => lp.map(([c, r]) => ({ xMm: (c + 0.5) / sx, yMm: (r + 0.5) / sy })));
  }
```

Add `window.shadowboxOpeningLoops = shadowboxOpeningLoops;` and `window.__sbPolygonMask = __sbPolygonMask;` to the exports.

- [ ] **Step 4: Run tests** — full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat(schaukasten): gezeichnete Öffnung (Scanline + Distanzfeld) und Vorschau-Konturen"`

---

### Task 4: Stand builder

**Files:**
- Modify: `js/shadowbox.js`, `tests/shadowbox.test.js`

**Interfaces:**
- Consumes: `window.extrudeLoops(loops, thickness, z0)` (geometry.js:372), `window.hexToRgb`.
- Produces: `window.buildStandParts(sb, plateWidthMm, thicknessMm) -> parts[]` — three parts `staender-sockel`, `staender-wand-vorne`, `staender-wand-hinten` at origin (x∈[0,L], y∈[0,D] mesh mm, z up), printed upright, no overhangs. Slot width = `clampedLayers*thicknessMm + tolMm`.

- [ ] **Step 1: Write failing tests:**

```js
  function zbounds(facets) {
    let lo = Infinity, hi = -Infinity;
    for (const f of facets) for (const v of f) { lo = Math.min(lo, v[2]); hi = Math.max(hi, v[2]); }
    return [lo, hi];
  }
  function ybounds(facets) {
    let lo = Infinity, hi = -Infinity;
    for (const f of facets) for (const v of f) { lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
    return [lo, hi];
  }

  test("schaukasten: stand — three upright parts with exact slot", () => {
    const sb = window.defaultShadowbox();
    sb.layers = 4;
    const parts = window.buildStandParts(sb, 60, 2);
    assertEqual(parts.length, 3, "sockel + two rails");
    const names = parts.map((p) => p.name).sort();
    assertEqual(JSON.stringify(names),
      JSON.stringify(["staender-sockel", "staender-wand-hinten", "staender-wand-vorne"]), "names");
    const sockel = parts.find((p) => p.name === "staender-sockel");
    const vorne = parts.find((p) => p.name === "staender-wand-vorne");
    const hinten = parts.find((p) => p.name === "staender-wand-hinten");
    assertClose(zbounds(sockel.facets)[0], 0, 1e-9, "sockel on bed");
    assertClose(zbounds(sockel.facets)[1], 15 - 8, 1e-9, "sockel top = H - slotDepth");
    assertClose(zbounds(vorne.facets)[0], 15 - 8, 1e-9, "rail bottom");
    assertClose(zbounds(vorne.facets)[1], 15, 1e-9, "rail top");
    // slot: gap between the two rails = layers*T + tol = 4*2 + 0.4
    const gap = ybounds(hinten.facets)[0] - ybounds(vorne.facets)[1];
    assertClose(gap, 8.4, 1e-9, "slot width");
  });

  test("schaukasten: stand returns [] when disabled or degenerate", () => {
    const sb = window.defaultShadowbox();
    sb.stand.enabled = false;
    assertEqual(window.buildStandParts(sb, 60, 2).length, 0, "disabled");
    sb.stand.enabled = true;
    assertEqual(window.buildStandParts(sb, 60, 0).length, 0, "no plate thickness");
  });
```

Run recipe: 2 new tests FAIL.

- [ ] **Step 2: Implement** — in `js/shadowbox.js`:

```js
  // Printed stand: upright as used (slot opens upward -> zero overhangs).
  // Three separate manifold boxes — same touching-solids pattern as plate+prisms.
  function buildStandParts(sb, plateWidthMm, thicknessMm) {
    const st = sb.stand || {};
    if (!st.enabled || !(thicknessMm > 0) || !(plateWidthMm > 0)) return [];
    const n = __sbClampLayers(sb.layers);
    const H = Math.max(6, st.heightMm || 15);
    const slotDepth = Math.min(H - 2, Math.max(3, st.slotDepthMm || 8));
    const rail = Math.max(2, st.railMm || 5);
    const slotW = n * thicknessMm + (st.tolMm != null ? st.tolMm : 0.4);
    const L = Math.max(20, plateWidthMm * 0.7);
    const D = 2 * rail + slotW;
    const color = window.hexToRgb(st.color || "#C8BBAE");
    const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
    const mk = (name, loops, th, z0) => ({
      name, color, facets: window.extrudeLoops(loops, th, z0),
    });
    return [
      mk("staender-sockel", rect(0, 0, L, D), H - slotDepth, 0),
      mk("staender-wand-vorne", rect(0, 0, L, rail), slotDepth, H - slotDepth),
      mk("staender-wand-hinten", rect(0, rail + slotW, L, D), slotDepth, H - slotDepth),
    ];
  }
```

Add `window.buildStandParts = buildStandParts;`. Note: `extrudeLoops` classifies outers by positive area — `rect()` as written is CCW in y-up mesh space (positive area). If the test's rail z-bounds fail with empty facets, check loop orientation first.

- [ ] **Step 3: Run tests** — full suite green.
- [ ] **Step 4: Commit** — `git commit -m "feat(schaukasten): Ständer — Sockel und zwei Wände, Schlitz exakt Stapeldicke plus Toleranz"`

---

### Task 5: Extract __contentParts (parity-locked refactor)

**Files:**
- Modify: `js/build-parts.js` (buildParts ~lines 815-841), `tests/shadowbox.test.js`

**Interfaces:**
- Produces: IIFE-private `__contentParts(doc, comp, grid, footprint, band, grooveBand) -> parts[]` — the engraved-reclassify block + `__engravedBaseAndFloors` + `buildRaisedParts` + `buildHeightmapParts`, verbatim behavior. `buildParts` output must not change by a byte.

- [ ] **Step 1: Write the parity test first:**

```js
  test("schaukasten: content-parts refactor keeps a plain doc byte-identical", () => {
    const d = sbDoc();
    d.shadowbox.enabled = false;
    d.elements.push(window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 16, hMm: 12, color: "#FF0000" }));
    d.elements.push(window.makeElementV2("text", { cxMm: 30, cyMm: 28, wMm: 20, hMm: 8, text: "Ukibori" }));
    d.elements[1].depth.direction = "engraved";
    const parts = window.buildParts(d);
    assert(parts.length >= 2, "plate + content parts");
    const names = parts.map((p) => p.name);
    assert(names.includes("grundplatte"), "grundplatte present");
    // structural snapshot so the refactor in this task cannot silently reorder parts
    const d2 = JSON.parse(JSON.stringify(d));
    assertEqual(JSON.stringify(window.buildParts(window.migrateProject(d2))),
      JSON.stringify(parts), "rebuild after serialize round-trip is identical");
  });
```

Run recipe: this passes already (it pins current behavior — commit it as the lock BEFORE refactoring).

- [ ] **Step 2: Refactor** — in `js/build-parts.js`, replace buildParts' tail (from `const isEngravedEi = ...` at line 815 through the closing `];` at line 841) with:

```js
    return [
      ...__contentParts(doc, comp, grid, footprint, band,
        lineMode === "engraved" ? lineBand : null),
      ...buildFrameParts(doc, band, cols, rows, pitch),
      ...buildZierlinieParts(doc, lineMode === "raised" ? lineBand : null, cols, rows, pitch),
      ...buildMountRingParts(doc),
    ];
  }

  // Content assembly shared by buildParts and buildShadowboxParts: reclassifies
  // non-engraved pixels as base for the engraved pass, then concatenates the
  // three content builders. Extracted verbatim — order and output byte-identical.
  function __contentParts(doc, comp, grid, footprint, band, grooveBand) {
    const { cols, rows, pitch } = grid;
    const isEngravedEi = (ei) => {
      const d = doc.elements[ei] && doc.elements[ei].depth;
      return !!(d && d.direction === "engraved" && d.mode !== "heightmap");
    };
    const base = window.hexToRgb(doc.body.baseColor);
    // depthMm and cutout are shared read-only (alias intentional; only r/g/b/isBase/owner are rewritten).
    const engComp = {
      r: comp.r.slice(), g: comp.g.slice(), b: comp.b.slice(),
      depthMm: comp.depthMm, cutout: comp.cutout,
      isBase: comp.isBase.slice(), owner: comp.owner.slice(),
    };
    for (let i = 0; i < cols * rows; i++) {
      const ei = comp.owner[i];
      if (ei >= 0 && !isEngravedEi(ei)) {
        engComp.isBase[i] = 1; engComp.owner[i] = -1;
        engComp.r[i] = base[0]; engComp.g[i] = base[1]; engComp.b[i] = base[2];
      }
    }
    return [
      ...__engravedBaseAndFloors(doc, engComp, cols, rows, pitch, footprint, band, grooveBand),
      ...buildRaisedParts(doc, footprint, comp, grid, band),
      ...buildHeightmapParts(doc, footprint, grid, band),
    ];
  }
```

Keep `const lineMode = lineBand ? doc.body.line.mode : "none";` where it is in buildParts (it is used by both spread arguments).

- [ ] **Step 3: Run tests** — full suite green, including the new lock test and ALL existing parity tests (plate-line, plate-edge etc. are the real guard here).
- [ ] **Step 4: Commit** — `git commit -m "refactor(build-parts): Inhalts-Teile in __contentParts extrahiert — Ausgabe byte-identisch"`

---

### Task 6: buildShadowboxParts — plates, openings, stack layout

**Files:**
- Modify: `js/build-parts.js` (fork in `buildParts` line 732; new function after `__contentParts`), `tests/shadowbox.test.js`

**Interfaces:**
- Consumes: `window.shadowboxOpeningField`, `window.shadowboxPlateColors`, `window.__sbClampLayers`, `window.buildStandParts` (runtime lookups — load order is irrelevant), `__contentParts`, `composeDesignV2`, `docDomain`, `gridForDomain`, `window.shapeFootprintField`.
- Produces: `buildParts(doc, opts)` — fork when `doc.shadowbox.enabled && (rect|circle)`; IIFE-private `buildShadowboxParts(doc, layout)`; part names `ebene-(k+1)-<name>`; stack layout: plate k at `z0=(n-1-k)*T` (front on top); element→plate via `el.sbLayer` (`null`→back, clamped).

- [ ] **Step 1: Write failing tests:**

```js
  test("schaukasten: enabling it changes output; disabling matches a doc without the field", () => {
    const d = sbDoc();
    const off = JSON.parse(JSON.stringify(d)); off.shadowbox.enabled = false;
    const stripped = JSON.parse(JSON.stringify(off)); delete stripped.shadowbox;
    stripped.elements = stripped.elements || [];
    assertEqual(JSON.stringify(window.buildParts(off)),
      JSON.stringify(window.buildParts(window.migrateProject(stripped))), "off == no field");
    assert(JSON.stringify(window.buildParts(d)) !== JSON.stringify(window.buildParts(off)),
      "enabled changes geometry");
  });

  test("schaukasten: stack — one plate per layer at its z-slab, front on top", () => {
    const d = sbDoc(); // 4 layers, T=2
    const parts = window.buildParts(d);
    for (let k = 0; k < 4; k++) {
      const plate = parts.filter((p) => p.name.indexOf("ebene-" + (k + 1) + "-") === 0);
      assert(plate.length >= 1, "plate " + (k + 1) + " exists");
      const zb = zbounds(plate.flatMap((p) => p.facets));
      assertClose(zb[0], (4 - 1 - k) * 2, 1e-6, "plate " + (k + 1) + " bottom");
      assertClose(zb[1], (4 - 1 - k) * 2 + 2, 1e-6, "plate " + (k + 1) + " top");
    }
  });

  test("schaukasten: openings shrink toward the back; back plate is solid", () => {
    const d = sbDoc();
    const parts = window.buildParts(d);
    const capArea = (k) => {
      // top-cap triangle area of the grundplatte at its own zTop
      const p = parts.find((q) => q.name === "ebene-" + (k + 1) + "-grundplatte");
      const zTop = zbounds(p.facets)[1];
      let a = 0;
      for (const f of p.facets) {
        if (Math.abs(f[0][2] - zTop) < 1e-6 && Math.abs(f[1][2] - zTop) < 1e-6 && Math.abs(f[2][2] - zTop) < 1e-6) {
          a += Math.abs((f[1][0] - f[0][0]) * (f[2][1] - f[0][1])
                      - (f[2][0] - f[0][0]) * (f[1][1] - f[0][1])) / 2;
        }
      }
      return a;
    };
    assert(capArea(0) < capArea(1), "front opening largest");
    assert(capArea(1) < capArea(2), "middle shrinks");
    assert(capArea(3) > 60 * 40 * 0.95, "back plate solid (full face)");
  });

  test("schaukasten: element lands only on its assigned plate", () => {
    const d = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 10, hMm: 8, color: "#FF0000" });
    el.sbLayer = 1;
    d.elements.push(el);
    const parts = window.buildParts(d);
    const withEl = parts.filter((p) => p.name.indexOf("ebene-2-") === 0);
    const others = parts.filter((p) => p.name.indexOf("ebene-2-") !== 0 && p.name.indexOf("ebene-") === 0);
    assert(withEl.some((p) => p.name !== "ebene-2-grundplatte"), "content part on plate 2");
    assert(!others.some((p) => /-(farbe|erhaben|farbschicht)/.test(p.name)), "no content elsewhere");
  });

  test("schaukasten: engraved element carves the back plate (Vertieft)", () => {
    const d = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 10, color: "#00AA00" });
    el.depth.direction = "engraved";
    d.elements.push(el); // sbLayer null -> back plate (k=3, z 0..2)
    const parts = window.buildParts(d);
    const floors = parts.filter((p) => p.name.indexOf("ebene-4-") === 0 && p.name !== "ebene-4-grundplatte");
    assert(floors.length >= 1, "engraved floor part exists on the back plate");
    const zb = zbounds(floors.flatMap((p) => p.facets));
    assert(zb[1] <= 2 + 1e-6, "carved below the back plate top");
    assert(zb[0] >= 0 - 1e-6, "floor keeps a base");
  });

  test("schaukasten: cutout element punches through its plate", () => {
    const a = sbDoc();
    const b = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 12, cyMm: 20, wMm: 6, hMm: 6, color: "#000000" });
    el.sbLayer = 0; el.cutout = true;
    b.elements.push(el);
    assert(JSON.stringify(window.buildParts(a)) !== JSON.stringify(window.buildParts(b)),
      "cutout changes the front plate");
  });
```

Run recipe: new tests FAIL (`buildParts` ignores shadowbox).

- [ ] **Step 2: Implement** — in `js/build-parts.js`:

At the very top of `buildParts` (line 732), change the signature and add the fork:

```js
  function buildParts(doc, opts) {
    // Schaukasten: stacked paper-cut plates — separate assembly path. Only
    // rect/circle bodies (the opening field needs the analytic perimeter).
    // Disabled or unsupported shapes fall through untouched (parity).
    if (doc.shadowbox && doc.shadowbox.enabled &&
        (doc.body.shape === "rect" || doc.body.shape === "circle")) {
      return buildShadowboxParts(doc, opts && opts.layout === "bed" ? "bed" : "stack");
    }
```

After `__contentParts`, add:

```js
  // In-place vertex translation — builders emit fresh facet arrays per call.
  function __shiftFacets(parts, dx, dy, dz) {
    for (const p of parts) for (const f of p.facets) for (const v of f) {
      v[0] += dx; v[1] += dy; v[2] += dz;
    }
    return parts;
  }

  const __SB_MOUNT_NONE = { type: "none", xMm: 0, yMm: 0, diameterMm: 0, ringThicknessMm: 0, ringHeightMm: 0, marginMm: 0 };

  // Schaukasten assembly: one plate per layer, shared opening field thresholded
  // at k*insetPerLayerMm, content via the standard per-plate pipeline.
  // layout 'stack' = assembled preview (front plate on top); 'bed' = print
  // layout, every plate at z0=0 side-by-side, stand beside the plates.
  function buildShadowboxParts(doc, layout) {
    const sb = doc.shadowbox;
    const n = window.__sbClampLayers(sb.layers);
    const T = doc.body.thicknessMm;
    const W = doc.body.widthMm, H = doc.body.heightMm;
    const colors = window.shadowboxPlateColors(Object.assign({}, sb, { layers: n }));
    const inset = Math.max(0.5, sb.insetPerLayerMm || 4);
    // Domain never expands: mount is 'hole' at most (loop stripped below).
    const domain = docDomain(Object.assign({}, doc, { mount: __SB_MOUNT_NONE }));
    const grid = gridForDomain(domain, doc.resolution);
    const { cols, rows, pitch } = grid;
    const f = window.shadowboxOpeningField(doc, grid);
    const layerOf = (el) => el.sbLayer == null ? n - 1 : Math.max(0, Math.min(n - 1, el.sbLayer | 0));
    const sx = cols / W, sy = rows / H, s = (sx + sy) / 2;
    const gapMm = 5;
    const out = [];

    for (let k = 0; k < n; k++) {
      const isBack = k === n - 1;
      const dk = Object.assign({}, doc, {
        body: Object.assign({}, doc.body, {
          baseColor: colors[k],
          frame: { widthMm: 0, heightMm: 2, color: "#000000" },   // v1: off on all plates
          line: { mode: "none", insetMm: 2.5, widthMm: 0.8, depthMm: 0.6, count: 1, color: "#000000" },
        }),
        // back plate keeps a hanging hole; 'loop' (Öse) is not supported in v1
        mount: (isBack && doc.mount && doc.mount.type === "hole") ? doc.mount : __SB_MOUNT_NONE,
        elements: doc.elements.filter((el) => layerOf(el) === k),
        shadowbox: null,
      });
      const base = window.shapeFootprintField(cols, rows, dk.body, dk.mount);
      let fp = base;
      if (!isBack && f) {
        const insetK = k * inset;
        fp = (c, r) => Math.min(base(c, r), (insetK - f(c, r)) * s);
      }
      const comp = composeDesignV2(dk, cols, rows, grid);
      const plateParts = __contentParts(dk, comp, grid, fp, null, null);
      for (const p of plateParts) p.name = "ebene-" + (k + 1) + "-" + p.name;
      if (layout === "stack") __shiftFacets(plateParts, 0, 0, (n - 1 - k) * T);
      else __shiftFacets(plateParts, k * (W + gapMm), 0, 0);
      out.push(...plateParts);
    }

    const stand = window.buildStandParts(Object.assign({}, sb, { layers: n }), W, T);
    if (stand.length) {
      const dx = layout === "stack" ? W + 2 * gapMm : n * (W + gapMm) + gapMm;
      out.push(...__shiftFacets(stand, dx, 0, 0));
    }
    return out;
  }
```

- [ ] **Step 3: Run tests** — full suite green. If the opening-area test is flaky at resolution 96, raise the test doc margin (not the assertions).
- [ ] **Step 4: Commit** — `git commit -m "feat(schaukasten): Plattenstapel — geteiltes Öffnungsfeld, Ebenen-Zuordnung, Stapel-Layout, Ständer"`

---

### Task 7: Overhang union + bed layout tests

**Files:**
- Modify: `js/build-parts.js` (inside `buildShadowboxParts`), `tests/shadowbox.test.js`

**Interfaces:**
- Consumes: `__renderElementV2(el, doc, cols, rows, grid) -> {mask, r, g, b}` (IIFE-private; verify the exact return shape at build-parts.js:187 before using).
- Produces: `el.sbOverhang` unions the element silhouette into its plate's footprint (clipped to the plate outline, openings of OTHER plates unaffected); bed layout verified disjoint.

- [ ] **Step 1: Write failing tests:**

```js
  test("schaukasten: overhang element extends the plate into the opening", () => {
    const mk = (overhang) => {
      const d = sbDoc();
      const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 14, hMm: 10, color: "#FFFFFF" });
      el.sbLayer = 1; el.sbOverhang = overhang;
      d.elements.push(el);
      return window.buildParts(d).filter((p) => p.name === "ebene-2-grundplatte")[0];
    };
    const zTopArea = (p) => {
      const zTop = zbounds(p.facets)[1];
      let a = 0;
      for (const f of p.facets) if (f.every((v) => Math.abs(v[2] - zTop) < 1e-6)) {
        a += Math.abs((f[1][0] - f[0][0]) * (f[2][1] - f[0][1])
                    - (f[2][0] - f[0][0]) * (f[1][1] - f[0][1])) / 2;
      }
      return a;
    };
    assert(zTopArea(mk(true)) > zTopArea(mk(false)) + 20, "overhang grows the plate face");
  });

  test("schaukasten: bed layout — all plates on the bed, disjoint in x", () => {
    const d = sbDoc();
    const parts = window.buildParts(d, { layout: "bed" });
    const xbounds = (fs) => {
      let lo = Infinity, hi = -Infinity;
      for (const f of fs) for (const v of f) { lo = Math.min(lo, v[0]); hi = Math.max(hi, v[0]); }
      return [lo, hi];
    };
    let prevHi = -Infinity;
    for (let k = 0; k < 4; k++) {
      const plate = parts.filter((p) => p.name.indexOf("ebene-" + (k + 1) + "-") === 0);
      const zb = zbounds(plate.flatMap((p) => p.facets));
      assertClose(zb[0], 0, 1e-6, "plate " + (k + 1) + " on the bed");
      assert(zb[1] <= 2 + 1e-6, "plate " + (k + 1) + " content stays within reason for empty plates");
      const xb = xbounds(plate.flatMap((p) => p.facets));
      assert(xb[0] > prevHi - 1e-6, "plate " + (k + 1) + " right of plate " + k);
      prevHi = xb[1];
    }
  });
```

(Note: the z upper-bound assertion holds because `sbDoc()` has no raised elements; drop that single line if you add raised content here later.) Run recipe: overhang test FAILS, bed test may pass already — keep both.

- [ ] **Step 2: Implement overhang** — inside `buildShadowboxParts`'s plate loop, after `let fp = ...` and before `composeDesignV2`:

```js
      // Overhang: union flagged elements' silhouettes into the plate so they
      // jut into the opening (clouds on the rim). Clipped to the plate outline.
      let over = null;
      for (const el of dk.elements) {
        if (!el.sbOverhang || el.cutout) continue;
        if (el.type === "image" && !el._img) continue;
        const rendered = __renderElementV2(el, dk, cols, rows, grid);
        if (!rendered || !rendered.mask) continue;
        if (!over) over = new Uint8Array(cols * rows);
        const m = rendered.mask;
        for (let i = 0; i < m.length; i++) if (m[i]) over[i] = 1;
      }
      if (over) {
        const inner = fp;
        fp = (c, r) => {
          if (over[r * cols + c] && base(c, r) > 0) return Math.max(inner(c, r), 0.5);
          return inner(c, r);
        };
      }
```

Before coding, Read `js/build-parts.js:187` (`__renderElementV2`) and confirm the returned object's mask field name; adjust if it differs.

- [ ] **Step 3: Run tests** — full suite green.
- [ ] **Step 4: Commit** — `git commit -m "feat(schaukasten): Überhang-Elemente ragen in die Öffnung; Druckbett-Layout geprüft"`

---

### Task 8: Export wiring (bed layout, Pausen disable)

**Files:**
- Modify: `js/editor.js` (`exportMf` handler line 1990, `exportStl` line 2002, `exportPause` line 2017)

**Interfaces:**
- Consumes: `window.buildParts(doc, {layout:"bed"})` from Task 6.
- Produces: 3MF/STL exports use the bed layout; Pausen-Spickzettel refuses with a German message while shadowbox is active. 3D preview (`getPartsFn`, line 1904) intentionally unchanged — it shows the assembled stack.

- [ ] **Step 1: Implement** — in both `exportMf` and `exportStl` handlers replace `window.buildParts(visibleDoc())` with:

```js
      const parts = window.buildParts(visibleDoc(), { layout: "bed" });
```

In `exportPause`, first line inside the `try`:

```js
      if (doc.shadowbox && doc.shadowbox.enabled) {
        setExportStatus("Im Schaukasten-Modus nicht verfügbar — jede Platte wird einzeln und einfarbig gedruckt.");
        return;
      }
```

- [ ] **Step 2: Verify** — run the full suite (editor.js is not loaded by run.html; the suite guards against accidental engine edits). Expected: green. Then smoke-check over http with Playwright: open `http://localhost:8899/index.html` with `fetch(..., {cache:"reload"})`-style hard refresh (or a cache-busted query), confirm no console errors on load.
- [ ] **Step 3: Commit** — `git commit -m "feat(schaukasten): Export im Druckbett-Layout; Pausen-Zettel im Schaukasten-Modus deaktiviert"`

---

### Task 9: UI — Schaukasten accordion (doc controls)

**Files:**
- Modify: `index.html` (insert new accordion after `</details>` of `#accWorkpiece`, line 157)
- Modify: `js/editor.js` (new `initShadowboxControls()` + sync; call sites: init near the other doc-control wiring, sync inside the function that refreshes doc inputs — find it via the line setting `advThickness` value, editor.js:3822)

**Interfaces:**
- Consumes: `doc.shadowbox` (Task 1), `render2D()`, `scheduleRebuild3D()`.
- Produces: working controls `sbEnabled, sbLayers, sbInset, sbOpeningAuto/sbOpeningDrawn (seg), sbMargin, sbWaviness, sbPeriod, sbReroll, sbColorFront, sbColorBack, sbStand, sbStandHeight`; `syncShadowboxControls()` called from the doc-input refresh; rect/circle guard (`#sbShapeHint`). Element-layer select and draw button come in Tasks 10/11.

- [ ] **Step 1: Markup** — insert after line 157 (`</details>` closing `#accWorkpiece`):

```html
      <!-- "Schaukasten": layered paper-cut stack (shadowbox mode) -->
      <details class="acc" id="accShadowbox">
        <summary>Schaukasten</summary>
        <div class="acc-body adv-section">
          <div class="adv-field">
            <label class="adv-label toggle">
              <input type="checkbox" id="sbEnabled" title="Schaukasten-Modus: das Werkstück wird ein Stapel einzelner Platten mit organischen, nach hinten kleiner werdenden Öffnungen (Paper-Cut-Effekt). Elemente liegen auf wählbaren Ebenen; die hinterste Platte trägt das Motiv."> Schaukasten-Modus
            </label>
            <div id="sbShapeHint" class="hint" hidden>Nur für Rechteck- und Kreis-Platten verfügbar.</div>
          </div>
          <div id="sbParams" hidden>
            <div class="adv-two-col">
              <div class="adv-field">
                <label for="sbLayers" class="adv-label">Ebenen</label>
                <input type="number" id="sbLayers" class="sp-num adv-num-full" min="3" max="10" step="1" value="6" title="Anzahl der Platten inklusive Rückwand">
              </div>
              <div class="adv-field">
                <label for="sbInset" class="adv-label">Versatz (mm)</label>
                <input type="number" id="sbInset" class="sp-num adv-num-full" min="1" max="20" step="0.5" value="4" title="Wie viel kleiner jede Öffnung je Ebene nach hinten wird">
              </div>
            </div>
            <div class="adv-field">
              <label class="adv-label">Öffnung</label>
              <div id="sbOpeningSeg" class="seg-group seg-sm" style="width:100%">
                <button type="button" id="sbOpeningAuto" class="seg seg-active" style="flex:1" title="Automatisch erzeugte organische Öffnung">Automatisch</button>
                <button type="button" id="sbOpeningDrawn" class="seg" style="flex:1" title="Öffnung frei auf der Arbeitsfläche zeichnen">Gezeichnet</button>
              </div>
            </div>
            <div id="sbAutoParams">
              <div class="adv-two-col">
                <div class="adv-field">
                  <label for="sbMargin" class="adv-label">Randabstand (mm)</label>
                  <input type="number" id="sbMargin" class="sp-num adv-num-full" min="4" max="40" step="1" value="12" title="Abstand der vordersten Öffnung vom Plattenrand">
                </div>
                <div class="adv-field">
                  <label for="sbPeriod" class="adv-label">Wellenlänge (mm)</label>
                  <input type="number" id="sbPeriod" class="sp-num adv-num-full" min="10" max="120" step="5" value="40" title="Länge einer Welle entlang des Randes">
                </div>
              </div>
              <div class="adv-field">
                <label for="sbWaviness" class="adv-label">Welligkeit</label>
                <input type="range" id="sbWaviness" min="0" max="1" step="0.05" value="0.5" style="width:100%" title="Wie stark die Öffnung wellt (0 = glatt)">
              </div>
              <div class="adv-field">
                <button type="button" id="sbReroll" class="btn" style="width:100%" title="Neue zufällige Wellenform">Neu würfeln</button>
              </div>
            </div>
            <div id="sbDrawnParams" hidden>
              <div class="adv-field">
                <button type="button" id="sbDrawBtn" class="btn" style="width:100%" title="Geschlossene Öffnungsform auf der Arbeitsfläche zeichnen">Öffnung zeichnen</button>
                <div id="sbDrawHint" class="hint" hidden>Auf der Arbeitsfläche ziehen — Loslassen schließt die Form.</div>
              </div>
            </div>
            <div class="adv-two-col">
              <div class="adv-field">
                <label for="sbColorFront" class="adv-label">Farbe vorne</label>
                <input type="color" id="sbColorFront" value="#DDEEFA" title="Farbe der vordersten Platte">
              </div>
              <div class="adv-field">
                <label for="sbColorBack" class="adv-label">Farbe hinten</label>
                <input type="color" id="sbColorBack" value="#1B5E9E" title="Farbe der Rückwand">
              </div>
            </div>
            <div class="adv-field adv-field-row">
              <label class="adv-label toggle" style="flex:1">
                <input type="checkbox" id="sbStand" checked title="Ständer mit Schlitz für den Plattenstapel mitdrucken"> Ständer
              </label>
              <input type="number" id="sbStandHeight" class="sp-num" style="width:64px" min="8" max="40" step="1" value="15" title="Höhe des Ständers in mm">
            </div>
          </div>
        </div>
      </details>
```

- [ ] **Step 2: Wiring** — in `js/editor.js`, add near the other doc-control init code (follow the pattern of the `advThickness` listener at editor.js:3351; every mutation ends with `render2D(); scheduleRebuild3D();`):

```js
  // ---- Schaukasten (shadowbox) doc controls ----
  function sbState() { return doc.shadowbox; }

  function syncShadowboxControls() {
    const sb = sbState();
    if (!sb) return;
    const supported = doc.body.shape === "rect" || doc.body.shape === "circle";
    document.getElementById("sbEnabled").checked = !!sb.enabled;
    document.getElementById("sbEnabled").disabled = !supported;
    document.getElementById("sbShapeHint").hidden = supported;
    document.getElementById("sbParams").hidden = !sb.enabled || !supported;
    document.getElementById("sbLayers").value = sb.layers;
    document.getElementById("sbInset").value = sb.insetPerLayerMm;
    const auto = sb.opening.source !== "drawn";
    document.getElementById("sbOpeningAuto").classList.toggle("seg-active", auto);
    document.getElementById("sbOpeningDrawn").classList.toggle("seg-active", !auto);
    document.getElementById("sbAutoParams").hidden = !auto;
    document.getElementById("sbDrawnParams").hidden = auto;
    document.getElementById("sbMargin").value = sb.opening.marginMm;
    document.getElementById("sbPeriod").value = sb.opening.periodMm;
    document.getElementById("sbWaviness").value = sb.opening.waviness;
    document.getElementById("sbColorFront").value = sb.colorFront;
    document.getElementById("sbColorBack").value = sb.colorBack;
    document.getElementById("sbStand").checked = !!sb.stand.enabled;
    document.getElementById("sbStandHeight").value = sb.stand.heightMm;
  }

  function sbChanged() {
    syncShadowboxControls();
    render2D();
    scheduleRebuild3D();
  }

  function initShadowboxControls() {
    const on = (id, evt, fn) => document.getElementById(id).addEventListener(evt, fn);
    on("sbEnabled", "change", function () { sbState().enabled = this.checked; sbChanged(); });
    on("sbLayers", "change", function () {
      const v = parseInt(this.value, 10);
      if (!isNaN(v)) { sbState().layers = Math.max(3, Math.min(10, v)); sbChanged(); }
    });
    on("sbInset", "change", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v) && v > 0) { sbState().insetPerLayerMm = v; sbChanged(); }
    });
    on("sbOpeningAuto", "click", function () { sbState().opening.source = "auto"; sbChanged(); });
    on("sbOpeningDrawn", "click", function () { sbState().opening.source = "drawn"; sbChanged(); });
    on("sbMargin", "change", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v) && v >= 0.5) { sbState().opening.marginMm = v; sbChanged(); }
    });
    on("sbPeriod", "change", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v) && v >= 4) { sbState().opening.periodMm = v; sbChanged(); }
    });
    on("sbWaviness", "input", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v)) { sbState().opening.waviness = v; sbChanged(); }
    });
    on("sbReroll", "click", function () { sbState().opening.seed = (sbState().opening.seed | 0) + 1; sbChanged(); });
    on("sbColorFront", "input", function () { sbState().colorFront = this.value.toUpperCase(); sbChanged(); });
    on("sbColorBack", "input", function () { sbState().colorBack = this.value.toUpperCase(); sbChanged(); });
    on("sbStand", "change", function () { sbState().stand.enabled = this.checked; sbChanged(); });
    on("sbStandHeight", "change", function () {
      const v = parseFloat(this.value);
      if (!isNaN(v) && v >= 6) { sbState().stand.heightMm = v; sbChanged(); }
    });
  }
  initShadowboxControls();
```

Then: locate the doc-input refresh function (the one setting `advThickness` at editor.js:3822) and append `syncShadowboxControls();` at its end. Also find `applyShape` (editor.js:~2222) and append `syncShadowboxControls();` so switching to Frei/Bild disables the toggle live. Undo/redo needs no extra work (noteDocChanged rides render2D/scheduleRebuild3D), but `resetDocTo` must refresh the controls — verify the doc-input refresh runs there (it does for advThickness; same path covers us).

- [ ] **Step 3: Verify** — full suite (guards engine); Playwright smoke over http: enable the toggle, change Ebenen to 4, click „Neu würfeln", switch 3D view — expect a stacked-plates preview, no console errors. Screenshot for the record.
- [ ] **Step 4: Commit** — `git commit -m "feat(schaukasten): Dokument-Steuerung — Ebenen, Versatz, Öffnung, Farben, Ständer"`

---

### Task 10: UI — element plate assignment + 2D nested contours

**Files:**
- Modify: `index.html` (element sidebar, „Anordnung" insp-group ~line 370-416: add the row), `js/editor.js` (`bindElementField` wiring near the other inspector bindings ~line 3245; visibility in `refreshAdvancedForSelection` ~line 3025; contours in `render2D` after the plate outline drawing ~line 1201)

**Interfaces:**
- Consumes: `window.shadowboxOpeningLoops(doc, k)` (Task 3), `bindElementField(id, evt, apply)` (editor.js:149-181), `mmX/mmY` px mapping (editor.js:50-51).
- Produces: inspector row `#sbLayerRow` with `#sbLayerSel` (options `1 (vorne)` … `N (hinten)`; value = 0-based index, back stored as `null`) and `#sbOverhangChk`; ghosted nested opening contours on the 2D stage; module-level loop cache invalidated by key.

- [ ] **Step 1: Markup** — inside the „Anordnung" insp-group in the element sidebar add:

```html
          <div class="adv-field" id="sbLayerRow" hidden>
            <label for="sbLayerSel" class="adv-label">Schaukasten-Ebene</label>
            <div style="display:flex;gap:6px;align-items:center">
              <select id="sbLayerSel" class="text-input" style="flex:1" title="Auf welcher Platte das Element liegt (1 = vorne)"></select>
              <label class="adv-label toggle" style="white-space:nowrap" title="Die Silhouette des Elements ragt in die Öffnung seiner Platte (z. B. Wolken am Rand)">
                <input type="checkbox" id="sbOverhangChk"> ragt hinein
              </label>
            </div>
          </div>
```

- [ ] **Step 2: Wiring** — in `js/editor.js` near the other `bindElementField` calls:

```js
  function sbPopulateLayerSelect() {
    const sel = document.getElementById("sbLayerSel");
    const sb = doc.shadowbox;
    const n = sb ? Math.max(3, Math.min(10, sb.layers)) : 6;
    if (sel.options.length !== n) {
      sel.innerHTML = "";
      for (let k = 0; k < n; k++) {
        const opt = document.createElement("option");
        opt.value = String(k);
        opt.textContent = (k + 1) + (k === 0 ? " (vorne)" : k === n - 1 ? " (hinten)" : "");
        sel.appendChild(opt);
      }
    }
  }
  bindElementField("sbLayerSel", "change", function (el) {
    const sb = doc.shadowbox, n = sb ? Math.max(3, Math.min(10, sb.layers)) : 6;
    const v = parseInt(document.getElementById("sbLayerSel").value, 10);
    el.sbLayer = (isNaN(v) || v >= n - 1) ? null : v; // back plate stored as null
  });
  bindElementField("sbOverhangChk", "change", function (el) {
    el.sbOverhang = document.getElementById("sbOverhangChk").checked;
  });
```

In `refreshAdvancedForSelection` (pattern at editor.js:3025-3032) add:

```js
    var sbRow = document.getElementById("sbLayerRow");
    var sbOn = doc.shadowbox && doc.shadowbox.enabled;
    if (sbRow) {
      sbRow.hidden = !(sbOn && el);
      if (sbOn && el) {
        sbPopulateLayerSelect();
        var n = Math.max(3, Math.min(10, doc.shadowbox.layers));
        var k = el.sbLayer == null ? n - 1 : Math.max(0, Math.min(n - 1, el.sbLayer));
        document.getElementById("sbLayerSel").value = String(k);
        document.getElementById("sbOverhangChk").checked = !!el.sbOverhang;
      }
    }
```

- [ ] **Step 3: 2D contours** — module-level cache + drawing in `render2D` (after the plate outline + Zierlinie drawing, before element handles):

```js
  var sbLoopsCache = { key: "", loops: null };
  function sbContourLoops() {
    const sb = doc.shadowbox;
    if (!sb || !sb.enabled) return null;
    const key = JSON.stringify([sb.layers, sb.insetPerLayerMm, sb.opening,
      doc.body.shape, doc.body.widthMm, doc.body.heightMm, doc.body.cornerRadiusMm]);
    if (sbLoopsCache.key !== key) {
      const n = Math.max(3, Math.min(10, sb.layers));
      const all = [];
      for (let k = 0; k < n - 1; k++) all.push(window.shadowboxOpeningLoops(doc, k));
      sbLoopsCache = { key, loops: all };
    }
    return sbLoopsCache.loops;
  }
```

In `render2D`, insert:

```js
    // Schaukasten: ghosted nested opening contours (front = strongest).
    const sbLoops = sbContourLoops();
    if (sbLoops) {
      for (let k = 0; k < sbLoops.length; k++) {
        ctx.strokeStyle = "rgba(30,90,158," + (0.55 - (0.4 * k) / Math.max(1, sbLoops.length - 1)) + ")";
        ctx.lineWidth = k === 0 ? 1.5 : 1;
        for (const lp of sbLoops[k]) {
          ctx.beginPath();
          lp.forEach((p, i) => {
            const px = mmX(p.xMm), py = mmY(p.yMm);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
```

(Adapt `mmX/mmY` argument style to the local drawing code you see around the insertion point — render2D draws in canvas px via those mappers.)

- [ ] **Step 4: Verify** — full suite green; Playwright smoke: enable mode, add a Rechteck element, set its Ebene to 2, tick „ragt hinein", observe contours on the 2D stage and the changed 3D stack; undo (Ctrl+Z) reverts. Screenshot.
- [ ] **Step 5: Commit** — `git commit -m "feat(schaukasten): Element-Ebene und Überhang im Inspektor; verschachtelte Öffnungskonturen in 2D"`

---

### Task 11: UI — freehand „Öffnung zeichnen"

**Files:**
- Modify: `js/editor.js` (draw-state flag near `textPathDraw` line 1364; pointerdown branch ~line 1410; pointerup ~line 1690; live overlay condition ~line 1176; button wiring in `initShadowboxControls`)

**Interfaces:**
- Consumes: the `textPath` drag plumbing (`drag = {handle, ptsPx}` capture, smoothing via `window.smoothPath` on pointerup — read editor.js:1410-1420 and 1690-1710 first and mirror the px→mm conversion used there), `doc.shadowbox.opening` (Task 1).
- Produces: clicking `#sbDrawBtn` arms one freehand capture; on release the smoothed CLOSED path is stored as `doc.shadowbox.opening.points` (doc mm), `source` stays `"drawn"`, hint toggles, geometry rebuilds.

- [ ] **Step 1: Implement** — mirror the textPath flow exactly:

1. Next to `var textPathDraw = null;` (line 1364) add `var sbOpeningDraw = false;`.
2. In the pointerdown handler where `textPathDraw` is checked (line 1410), add first:

```js
    if (sbOpeningDraw) {
      drag = { handle: "sbOpening", px, py, ptsPx: [{ x: px, y: py }] };
      return;
    }
```

3. In pointermove, the generic path-collection branch (line 1611) currently matches `scatterPath`/`textPath` — extend the condition with `|| drag.handle === "sbOpening"`.
4. Same extension in the live-overlay condition at line 1176 so the user sees the stroke while drawing.
5. In pointerup (the `textPath` block at line 1690 shows the px→mm conversion — copy its mapping), add:

```js
    if (drag.handle === "sbOpening") {
      sbOpeningDraw = false;
      document.getElementById("sbDrawHint").hidden = true;
      const mm = drag.ptsPx.map(function (p) {
        return { xMm: state.viewX0 + (p.x - state.marginPx) / state.scale,
                 yMm: state.viewY0 + (p.y - state.marginPx) / state.scale };
      });
      // NOTE: use the SAME px->mm mapping the textPath block above uses — if it
      // differs from this expression, copy that one. Then smooth + store closed.
      const sm = window.smoothPath(mm.map(function (p) { return { x: p.xMm, y: p.yMm }; }), 2)
        .map(function (p) { return { xMm: p.x, yMm: p.y }; });
      if (sm.length >= 3) {
        doc.shadowbox.opening.points = sm;
        doc.shadowbox.opening.source = "drawn";
      }
      drag = null;
      syncShadowboxControls();
      render2D(); scheduleRebuild3D();
      return;
    }
```

6. In `initShadowboxControls` add:

```js
    on("sbDrawBtn", "click", function () {
      sbOpeningDraw = true;
      document.getElementById("sbDrawHint").hidden = false;
    });
```

- [ ] **Step 2: Verify** — full suite green; Playwright smoke: switch Öffnung to „Gezeichnet", click „Öffnung zeichnen", drag a blob on the stage (pointer events via Playwright mouse), release — contours + 3D stack follow the drawn shape; a two-point scribble falls back to auto (no crash). Screenshot.
- [ ] **Step 3: Commit** — `git commit -m "feat(schaukasten): Öffnung frei zeichnen — geglätteter geschlossener Pfad auf der Arbeitsfläche"`

---

### Task 12: Finalize — docs, counts, end-to-end smoke

**Files:**
- Modify: `README.md` (test badge line 15, tests table row ~line 319)
- Verify: whole feature end-to-end

- [ ] **Step 1: Counts** — run the suite, note the total (`pass: N`); update README badge and table with N (the branch was already stale at 255 vs 304 — write the real current number).
- [ ] **Step 2: End-to-end smoke over http (Playwright)** — hard-refresh index.html; scenario: enable Schaukasten (6 Ebenen), add text element on the back plate with „Vertieft" direction (Lasse's primary path — verify the engraved carve shows in 3D), add a shape element on Ebene 2 with Überhang, reroll the opening, switch to 3D + layer scrubber, then Exportieren → 3MF and confirm a download blob is produced without error (and Pausen shows the disabled message). Check the browser console for errors throughout.
- [ ] **Step 3: Full suite one last time** — `fail: 0`.
- [ ] **Step 4: Commit** — `git commit -m "feat(schaukasten): Schaukasten-Modus abgeschlossen — Doku und Testzahlen aktualisiert"`
