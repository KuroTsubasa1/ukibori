# Öse Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** The Öse mount becomes a flat, plate-thickness tab protruding past the plate edge with a hole through it — one manifold solid via footprint union on an expanded raster domain.

**Architecture:** `buildParts` computes ONE shared grid `{cols, rows, pitch, x0, y0}` over a domain that expands beyond the body box only when the Öse washer overhangs; the base footprint becomes `max(plateSDF, washerSDF) min holeSDF`. Non-overhang docs take the existing code path byte-identically. Editor gets a view-origin offset, snap-to-top-edge, and an attach clamp; SVG reuses the same domain+footprint.

**Tech Stack:** vanilla JS classic scripts (IIFE + `window.*`), browser test harness `tests/run.html`, Playwright MCP smoke.

## Global Constraints
- No new dependencies (vendored/offline app).
- Classic-script IIFEs; never redeclare `window.els`; new globals only via explicit `window.x =`.
- German UI copy.
- `bookmark-model.js` untouched (no schema change; `ringHeightMm` kept but inert).
- Harness must end green; all pre-existing non-loop behavior byte-identical (default domain).
- Spec: `docs/superpowers/specs/2026-07-02-oese-tab-redesign-design.md` — its locked decisions govern.

---

### Task 1: Engine — expanded domain + washer union (build-parts.js, geometry.js additive)

**Files:**
- Modify: `js/geometry.js` (additive `bodySdfMm`; `shapeFootprintField` refactored to consume it, zero behavior change)
- Modify: `js/build-parts.js` (docDomain, gridForDomain, shared-grid threading, footprint union, rim removal, `window.docGridAndFootprint`)
- Modify: `tests/mount-ring.test.js` (rim assertions → flat-tab assertions), plus new assertions (may add `tests/oese-tab.test.js` + `tests/run.html` script tag)

**Interfaces:**
- Produces: `window.bodySdfMm(body)` → `(xMm, yMm) => signedMm` (>0 inside plate; rect uses rounded-rect SDF, circle inscribed-circle — exact math extracted from `shapeFootprintField`).
- Produces: `window.docGridAndFootprint(doc)` → `{ grid: {cols, rows, pitch, x0, y0}, footprint: (c,r)=>cellUnitsSigned }` — the single source for base footprint + domain, consumed by `buildParts` internally and by T3's SVG.
- Internal: `docDomain(doc)` → `{x0, y0, wMm, hMm}`; expansion (with ~1mm pad) ONLY on sides the washer actually exceeds; non-loop/inside-loop docs return exactly the body box `{0, 0, W, H}`.
- Internal: `gridForDomain(domain, resolution)` — same longest-side=resolution rule as `gridForBody` (delegate so the default is provably identical).
- Cell→mm mapping on the expanded path: `x = x0 + (c + 0.5) * pitch` (and y likewise). All sub-builders (`composeDesignV2`, `buildEngravedParts`/`__engravedBaseAndFloors`, `buildRaisedParts`, `buildHeightmapParts`, `__silhouetteMask`, `freeFootprintField`) accept the shared grid (optional param, default = current body-grid mapping → byte-identical). The 6 internal `gridForBody(` call sites collapse to one computation in `buildParts`.
- Footprint composition (expanded path): `washer = (x,y) => outerR − hypot(x−m.xMm, y−m.yMm)` with `outerR = m.diameterMm/2 + m.ringThicknessMm`; field = `max(plate, washer)` then `min(field, holeDist − holeR)`, in cell units (×1/pitch). Free bodies: union the washer into `freeFootprintField`'s value BEFORE its hole cut (`v = max(borderCells − dt, washer·s)` then hole min).
- Rim removal: `buildMountRingParts` no longer emits geometry for loop (returns `[]`; keep the export for compat; delete its call-site contribution). Degenerate loop (`ringThicknessMm ≤ 0` or `diameterMm ≤ 0`) behaves as plain hole.

- [ ] **Step 1:** Write failing tests first (rewrite `tests/mount-ring.test.js`): (a) loop overhanging top (`yMm = 0` on a 40×80 rect, Ø6, wall 2.5) → `buildParts` base part has vertices with `y < 0` (grid-space: some vertex below the plate's mapped top edge — assert via footprint sampling AND via facet bbox of the base vs a no-loop doc); (b) through-hole: `docGridAndFootprint` footprint < 0 at the hole center, > 0 on the tab ring (e.g. hole center + (0, −(holeR+wall/2)) offset point), < 0 far outside the washer; (c) manifold: edge-count check on the base facets after 0.001 vertex snap (same method as the existing manifold test); (d) loop fully inside → base facets deep-equal the same doc with `type:'hole'` (washer swallowed, domain unexpanded); (e) no rim: parts contain NO `"oese"` part; (f) alignment: a raised-element doc with vs without overhanging loop — (raisedBBox − baseBBox) relative offset identical.
- [ ] **Step 2:** Run harness → new tests FAIL (rim still built, no expansion), pre-existing 55 still pass.
- [ ] **Step 3:** Implement `bodySdfMm` in geometry.js (extract verbatim from `shapeFootprintField`, refactor the latter to call it). Run harness: all pre-existing green (parity proof).
- [ ] **Step 4:** Implement `docDomain`/`gridForDomain`/shared-grid threading/footprint union/`docGridAndFootprint`/rim removal in build-parts.js.
- [ ] **Step 5:** Harness fully green (pre-existing + new). Byte-parity spot-proof: for a non-loop doc, `JSON.stringify(buildParts(doc))` identical before/after (compare against a stored snapshot or via the alignment/deep-equal tests).
- [ ] **Step 6:** Commit: `feat(engine): Öse as flat protruding tab — footprint union on expanded domain`

### Task 2: Editor 2D — view origin, snap-to-edge, attach clamp, tab draw

**Files:**
- Modify: `js/editor.js`

**Interfaces:**
- Consumes: `window.bodySdfMm` (T1) for the attach clamp; `window.docGridAndFootprint` optionally for domain bounds.
- View origin: `state.viewX0/viewY0` (mm ≤ 0 when tab overhangs top/left; domain may also extend right/bottom). ALL mm↔px conversions go through new helpers `mmX(x)=(x−viewX0)·s` / inverse (drawElement/drawSelection/bodyPath/mount marker/hitTest/pointer mm conversions/keyboard-nudge — mechanical sweep; behavior identical when viewX0/viewY0 = 0).
- `fitScale()` fits the domain (plate ∪ washer bbox), recomputed when mount type/pos changes.
- `applyMount('loop')` snap: rect `(W/2, 0)`; circle `(W/2, H/2 − min(W,H)/2)`; free = content-bbox `(centerX, top)`, fallback `(W/2, 0)` if no elements. `'hole'` keeps current position/clamp.
- Mount drag clamp for loop (replaces `[0,W]×[0,H]`): reject positions where `bodySdfMm(body)(x,y) < −(outerR − 1)` (≥1mm bite; free bodies approximate the plate with the content bbox SDF). Keep `[0,W]×[0,H]` clamp for `'hole'`.
- Tab draw: for loop the outer-radius circle becomes a solid-stroke outline (it IS printed geometry now), not the 0.4-alpha hint.
- Tooltip copy: `#mountLoop` title → `"Öse (Lasche mit Loch zum Aufhängen)"`.

- [ ] **Step 1:** Implement helpers + sweep, snap, clamp, draw, tooltip.
- [ ] **Step 2:** Playwright smoke (fresh port): select Öse → marker at top edge, half outside, visible on canvas (canvas fits expanded domain); drag beyond attach limit → clamped (bodySdfMm(x,y) ≥ −(outerR−1)); drag inside → allowed; elements/mount/keyboard/zoom behavior otherwise unchanged (`__errs` empty); harness green.
- [ ] **Step 3:** Commit: `feat(ui): Öse tab — snap to edge, drag past plate with attach clamp, tab outline`

### Task 3: SVG + integrated smoke

**Files:**
- Modify: `js/editor.js` (`buildDesignSVG`)

**Interfaces:**
- Consumes: `window.docGridAndFootprint(doc)` (T1) — replaces the direct `gridForBody` + `shapeFootprintField`/`freeFootprintField` calls; viewBox/width/height from `grid.cols·pitch × grid.rows·pitch`; element compositing scale unchanged (s = 1/pitch) but positioned via `x0/y0` offset so elements land correctly in the expanded canvas.

- [ ] **Step 1:** Rewire `buildDesignSVG` onto `docGridAndFootprint`.
- [ ] **Step 2:** Playwright: overhanging-Öse doc → SVG viewBox taller than the plate, base path includes tab with hole (two nested loops / evenodd), non-loop docs byte-identical SVG to before; 3MF/STL export non-empty with tab; harness green.
- [ ] **Step 3:** Commit: `feat(export): SVG includes the Öse tab (shared expanded domain)`

## Self-Review
- Spec coverage: union+domain (T1), snap/clamp/origin/draw/tooltip (T2), SVG (T3), tests incl. deliberate mount-ring rewrite (T1) — all spec sections mapped. 3D preview needs no task (Box3 auto-fits facets).
- Type consistency: `docGridAndFootprint` produced in T1, consumed in T3; `bodySdfMm` produced T1, consumed T2. Grid field names `{cols, rows, pitch, x0, y0}` used consistently.
- No placeholders.
