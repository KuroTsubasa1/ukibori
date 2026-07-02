# Öse Tab Redesign — T1 Engine Report

**Date:** 2026-07-02  
**Branch:** feature/feature-batch-2026-06  
**Task:** T1 — Engine: expanded domain + washer union (build-parts.js, geometry.js additive)

---

## Implemented Design

### Domain / Threading

`docDomain(doc)` computes the raster domain. For non-loop docs (and degenerate loop where `ringThicknessMm ≤ 0` or `diameterMm ≤ 0`), returns `{x0:0, y0:0, wMm:W, hMm:H}` — the body box, unchanged from before.

For loop docs where the washer `(outerR = diameterMm/2 + ringThicknessMm)` overhangs any side of the body box:
- Per-side expansion: only sides that actually overhang are expanded
- 1mm pad added on each overhanging side
- Returns `{x0, y0, wMm, hMm}` with `x0 ≤ 0`, `y0 ≤ 0` (or 0 if no overhang on that side)

`gridForDomain(domain, resolution)` delegates to `gridForBody({widthMm: domain.wMm, heightMm: domain.hMm}, resolution)` then attaches `x0`/`y0`. This means the longest-side=resolution rule is identical — provably byte-identical for the body-box case.

`buildParts` computes ONE shared `grid` via `docDomain` + `gridForDomain` and threads it through all sub-builders. The 6 independent `gridForBody(` call sites collapse to one computation at the top of `buildParts`.

### Footprint Composition

**Expanded path (loop with valid params):**
```
footprint(c, r):
  x = x0 + (c+0.5)*pitch,  y = y0 + (r+0.5)*pitch   // mm in doc space
  plate  = bodySdfMm(body)(x, y)                        // >0 inside plate
  washer = outerR - hypot(x - m.xMm, y - m.yMm)        // >0 inside washer disk
  union  = max(plate, washer)                            // inside plate OR washer
  hole   = hypot(x - m.xMm, y - m.yMm) - holeR         // >0 outside hole
  return min(union, hole) * (1/pitch)                    // cell units, hole cut
```

**Default path (non-loop or degenerate loop):** unchanged — calls `window.shapeFootprintField(cols, rows, body, mount)`.

**Free bodies:** `freeFootprintField` gains a `grid` param (optional) for expanded-domain mapping. Washer union is done BEFORE the hole cut: `v = max(borderCells − dt, washerSdf)` then `min(v, holeDist)`.

### Grid-Space Coordinates

`traceMaskToFacets` emits `x * pitch` (grid-space mm, not doc-space mm). The absolute origin shift (`x0, y0`) is not applied to vertices — it is baked into the `inside(c,r)` function (footprint checks use `x = x0 + (c+0.5)*pitch` internally). All parts share one grid, so relative alignment is automatic. The origin shift is harmless for 3MF/STL as slicers don't care about absolute origin.

For elements (drawing / heightmap), `__drawElement` accepts an optional `grid` parameter. When provided, it uses `pitch = grid.pitch` and adds `ox = -grid.x0/pitch` offset so elements are positioned correctly within the expanded canvas. For the default case (`grid=null`), behavior is unchanged.

### Parity Strategy

The critical invariant: **for any doc where `docDomain` returns `{x0:0, y0:0, wMm:W, hMm:H}`** (i.e., no expansion), `gridForDomain` produces the exact same `{cols, rows, pitch}` as `gridForBody`, and all downstream functions produce byte-identical output. This is proven by:
1. `gridForDomain` delegates to `gridForBody`
2. `x0=0, y0=0` means `__drawElement` offset terms are 0
3. `shapeFootprintField` is called unchanged for non-loop path
4. Test (d): loop-inside doc deep-equals plain-hole doc (both get body-box domain)
5. Test: degenerate loop (ringThicknessMm=0) byte-equals plain-hole doc

### Rim Removal

`buildMountRingParts` now returns `[]` unconditionally (the function signature is kept for API compat; its call in `buildParts` is kept but harmless). The Öse geometry is now part of the base footprint.

---

## Exported Signatures

**geometry.js:**
```
window.bodySdfMm(body)
  → (xMm: number, yMm: number) => signedMm: number
  // >0 inside plate, <0 outside; rect uses rounded-rect SDF, circle inscribed-circle
  // body: {shape, widthMm, heightMm, cornerRadiusMm}
```

**build-parts.js:**
```
window.docGridAndFootprint(doc)
  → { grid: {cols, rows, pitch, x0, y0}, footprint: (c, r) => cellUnitsSigned }
  // grid.x0/y0 are 0 for non-loop/inside-loop docs; negative when washer overhangs
  // footprint > 0 inside plate+tab, < 0 outside or inside hole

window.docDomain(doc)
  → {x0, y0, wMm, hMm}    // internal, also exported for T2/T3 use

window.gridForDomain(domain, resolution)
  → {cols, rows, pitch, x0, y0}    // internal, also exported
```

All prior exports (`gridForBody`, `buildBaseParts`, `buildEngravedParts`, `buildRaisedParts`, `buildHeightmapParts`, `buildMountRingParts`, `buildParts`, `composeDesignV2`, `freeFootprintField`) retained.

---

## Test List RED → GREEN

Tests in `tests/mount-ring.test.js` (all 9 new tests, rewrote the file):

| Test | Status |
|------|--------|
| (a) oese tab: overhanging loop → base facets extend past plate body bounds | RED → GREEN |
| (b) oese tab: docGridAndFootprint footprint signs at key points | RED → GREEN |
| (c) oese tab: base part is a closed 2-manifold after 0.001mm vertex snap | RED → GREEN |
| (d) oese tab: loop fully inside → base equals plain-hole base (parity) | RED → GREEN |
| (e) oese tab: no part named 'oese' in buildParts output | RED → GREEN |
| (f) oese tab: raised element z-alignment unchanged with overhanging loop | RED → GREEN |
| (g) oese tab: buildMountRingParts returns empty for loop type (rim removed) | RED → GREEN |
| (h) oese tab: degenerate loop (ringThicknessMm=0) behaves as hole (no expansion) | GREEN from start |

Step 2 (pre-implementation baseline): 57 pass, 4 fail (new tests that referenced `docGridAndFootprint`, rim removal, etc.)  
Step 3 (geometry.js extraction): 57 pass, 4 fail (parity proof)  
Step 4 (build-parts.js full implementation): **61 pass, 0 fail**

---

## Final Harness Counts

**61 pass / 0 fail**  
Pre-existing tests: all 57 green  
New tests: all 9 green (the 2 old rim-assertion tests were deliberately replaced per the plan)

---

## Fix wave

**Commit:** fix(engine): restore rectangular-cell mapping on default paths; loop-inside routes as plain hole

### Critical 1 — `freeFootprintField` default path used square-pitch mapping

**What changed:** `freeFootprintField` now branches on `grid` being present.  
- *Expanded path* (grid passed, domain actually overhangs): unchanged square-pitch mapping with washer union — kept internally consistent with the shared grid.  
- *Default path* (grid absent): restored original rectangular-cell mapping — `sx = cols/W`, `sy = rows/H`, `s = (sx+sy)/2`, `x = (c+0.5)/sx`, `y = (r+0.5)/sy` — byte-identical to pre-T1 for any non-expanded body.

**RED evidence:** `nonprop: freeFootprintField default path uses rect-cell mapping on 23×97` — FAILED on pre-fix code (pre-fix always used square-pitch; the `actual` value was closer to the square-formula than the rect-formula).

### Critical 2 — loop fully-inside routed through washer-union path

**What changed:** Both `buildParts` and `docGridAndFootprint` now compute `domainExpanded` (true iff `docDomain` returned a strictly larger box than the body box). Only when `domainExpanded` is true does the washer-union footprint get built. When `domainExpanded` is false (loop fully inside), the `else` branch falls through to `shapeFootprintField(cols, rows, body, mount)` — which already cuts the hole for `type='loop'` — producing byte-identical output to a `type='hole'` doc.  
For free bodies, `freeFootprintField` is called with `grid` passed only when `domainExpanded`; otherwise `null`, triggering the restored rectangular-cell default branch.

**RED evidence:** `nonprop: loop fully inside 23×97 rect body == hole (buildParts parity)` — FAILED on pre-fix code (224 expected, got 288 facets — different grid mapping produced different hole boundary cells).

### Important 1 — non-proportional parity tests added (`tests/oese-nonprop.test.js`)

Three new tests using a 23×97mm body (cols=47, rows=200, `sx≈2.043 ≠ sy≈2.062`):

| Test | RED on pre-fix? | After fix |
|------|----------------|-----------|
| (i) loop fully inside 23×97 rect body == hole (buildParts parity) | YES — 224 vs 288 facets | GREEN |
| (ii) loop fully inside 23×97 free body == hole (buildParts parity) | NO — washer-inside union is a no-op for a full-coverage element; both paths already agreed | GREEN |
| (iii) freeFootprintField default path uses rect-cell mapping on 23×97 (canary) | YES — assertion `closer to rect than square` failed | GREEN |

Note on test (ii): the free-body loop-inside parity passes even on pre-fix because the washer is geometrically contained within the plate (the union `max(plate, washerSdf)` equals `plate` everywhere when the washer doesn't extend beyond the silhouette boundary). The test is retained as a post-fix regression guard.

### Important 2 — test (f) extended with XY relative offset check

**What changed:** `tests/oese-nonprop.test.js` includes test `nonprop/imp2` which asserts:  
1. Raised element absolute center near `(cxMm=20, cyMm=40)` within 1.5mm (catches grossly mis-gridded sub-builders).  
2. Base plate left edge (`mnx`) identical with/without overhang (overhang is in y, not x).  
3. Raised element X offset from body left edge consistent within 1.5mm.

The existing test (f) in `mount-ring.test.js` already checked z-bounds; this adds XY verification.

### Important 3 — corrected test arithmetic

- Original report claimed "9 new tests / 61 total". The file had 8 tests (counting shows (a)–(h) but (h) was listed as "GREEN from start" not new).
- After this fix wave: `tests/oese-nonprop.test.js` adds 4 new tests.
- **Final harness: 65 pass / 0 fail.**
  - Pre-existing (from T1): 61 tests
  - New this fix wave: 4 tests (`tests/oese-nonprop.test.js` — tests i, ii, iii, imp2)
  - Harness verified via Playwright: `window.__results = { pass: 65, fail: 0 }`

---

## Concerns / Risks for T2 and T3

### T2 (editor.js)
- `bodySdfMm` is exported from `geometry.js` as `window.bodySdfMm` — T2 can call it directly for drag clamp.
- The grid `x0/y0` from `docGridAndFootprint` give the view origin offset T2 needs for `state.viewX0/viewY0`.
- Free-body clamp approximation: `bodySdfMm` is only defined for rect/circle; for free bodies T2 should use content-bbox SDF as noted in the spec.
- The `applyMount('loop')` snap position `(W/2, 0)` sets `yMm=0` — this triggers the expanded domain (y0 < 0). T2 must recalculate `fitScale` whenever mount changes.

### T3 (SVG in editor.js)
- T3 replaces direct `gridForBody` + `shapeFootprintField`/`freeFootprintField` calls in `buildDesignSVG` with `docGridAndFootprint`.
- The returned `grid.x0` and `grid.y0` are used to set the SVG viewBox origin: `viewBox="${x0} ${y0} ${cols*pitch} ${rows*pitch}"`.
- Element positions in SVG: must use `(el.cxMm - x0)` for SVG x, `(el.cyMm - y0)` for SVG y.
- Note: the SVG `buildDesignSVG` function currently has its own rasterization logic; T3 needs to thread the grid origin consistently — same pattern as `__drawElement` offset (`-x0 * sx`).

### General
- No risks to 3MF/STL export: trace.js untouched, vertex coordinates are grid-space (relative), slicer-safe.
- `ringHeightMm` is kept in the model but no longer produces geometry — this is per spec (back-compat, migration untouched).
- The `buildMountRingParts` export still exists (returns `[]`) so any code calling it won't break.
