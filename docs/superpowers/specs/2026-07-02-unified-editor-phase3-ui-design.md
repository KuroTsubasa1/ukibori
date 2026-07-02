# Unified Editor — Phase 3: The Approachable UI — Design

**Date:** 2026-07-02
**Status:** Design approved; implementation plan pending
**Branch:** `feature/feature-batch-2026-06`
**Depends on:** Phase 1 (v2 model + migration) ✅ and Phase 2 (unified `buildParts(doc)` engine) ✅ — both complete on this branch.

## Problem

The app still ships as **two modes glued into one HTML file** (`#reliefWorkspace` + `#bmWorkspace`, switched by `setAppMode()` toggling `body.bookmark-mode` in `js/bookmark-editor.js:31`). Beyond the duplication, the user's headline complaint is **option overload** — "too many options at once / too many possibilities" — and first-timers have no onboarding. Phase 3 builds **one approachable editor** on top of the finished unified engine (`js/build-parts.js`), retiring the two-mode split.

## Goal & locked decisions

Design one editor that leads with simplicity and reveals power on demand. Decisions settled during brainstorming (with a live visual companion for the layout):

1. **Backbone = progressive disclosure** via a **global Simple ⇄ Advanced toggle** (two curated views; choice persisted in `localStorage`).
2. **Simple view (default) set:** `Add` (Image/Text/QR) · `Depth` (Raised/Engraved) · `Shape` (Rect/Circle/Free+border) · `Mount` (none/hole/loop) · `Size` · **one-click ✂ Remove background** (on a selected image) · `Export`. Strong defaults so Simple is self-sufficient.
3. **Advanced view** adds everything else, grouped: image Convert (threshold/palette/invert), Depth *mode* (solid/colorLayers/heightmap), Layers list, Selected-element details (color/position/size/rotate/cutout), 3D & Export detail (thickness, layer height, resolution, color stacking; PNG/SVG/STL/3MF). Shape/Mount remain editable here too.
4. **First-run tutorial (#9) = coach-marks** over the real Simple-view controls (①add → ②depth → ③shape&size → ④export); `seen` flag in `localStorage`; skip / re-launch from a header `?`.
5. **Open → blank Simple editor** (an empty rounded-rect plate). No template gallery (YAGNI).
6. **One `buildParts(doc)` drives both live preview and export.**

### Non-goals
- No template/preset gallery.
- No heightmap **smoothing** control — `depth.smooth` is not wired in the engine (see the Phase-2 spec note); do not expose it.
- No new export formats beyond today's PNG/SVG/STL/3MF.
- The `file://` local-dev server stays **Phase 5** (production is nginx/HTTP).

## Object model

No new persisted model fields — the editor operates on the existing **v2 `doc`** (`defaultDoc()`), and loading a saved project runs `migrateProject()`. UI state (current view `simple|advanced`, coach-mark `seen`) lives in `localStorage`, **not** in `doc`.

## Architecture & components

The two workspaces collapse into **one workspace** driven by a single editor controller.

### DOM (`index.html`)
- **One workspace** replaces `#reliefWorkspace` + `#bmWorkspace`; the `Bild → Relief` / `Lesezeichen` segmented switch and `body.bookmark-mode` are removed.
- **Header:** title · `Simple | Advanced` toggle · `Open` · `Save` · `Export ▾` · `?` (tour).
- **Sidebar:** a **Simple panel** (its own clean minimal layout — not the full panel CSS-hidden) and an **Advanced panel** (the full grouped control set). Root class `mode-advanced` (persisted) chooses which shows.
- **Canvas area:** the shared canvas with a `2D / 3D` toggle (reuses `#output` + the `preview3d` canvas).
- **Export dialog:** rework the existing `#exportModal`, wired to `buildParts`.

### JS
- **New `js/editor.js` — the unified controller** (follows the classic-script `window.els` IIFE pattern per project convention). Owns the v2 `doc`; implements **one canvas renderer + one pointer-input handler** (replacing `paint()` in `app.js` and `bmRender()`/`redrawCanvas()` + the drag handlers in `bookmark-editor.js`): draws the plate (rect/circle/free outline) + mount guide + elements + selection handles; handles select / move / scale / rotate, mount drag, shape resize; drop-an-image → image element sized to the plate. Wires the Simple/Advanced controls to `doc` mutations, each triggering a 2D re-render and a debounced 3D rebuild.
- **`js/coachmarks.js`** — first-run coach-marks: steps target Simple-view element ids, highlight + bubble + Next/Skip; `localStorage` `seen` flag; re-launch API for the header `?`.
- **Reuse as-is:** `js/build-parts.js` (`buildParts`), `js/preview3d.js` (3D), `js/geometry.js` (`build3MF`/`facetsToBinarySTL`), `js/bg-removal.js` (`window.removeBackground`), `js/sources.js` (text/QR rasterizers), `js/bookmark-model.js` (v2 doc + migration).
- **Retire (delete after the UI is verified on `buildParts`):** the relief pipeline in `js/app.js` (`buildParts`/`buildColorParts`/`buildFields`/`buildColorFields`/`paint`/mode wiring), `js/bookmark-editor.js` (whole file), and `buildBookmarkParts` in `js/bookmark-export.js` (keep the reusable rasterization helpers that `build-parts.js` depends on — `composeDesign` is already superseded by `composeDesignV2`, but `__imagePaletteFromImg`/`__nearestColor` stay). The parity net (Phase 2) proved `buildParts` reproduces `buildBookmarkParts`, so deletion is safe once the UI renders/exports through `buildParts`.

## Data flow

```
user action (control / canvas drag / drop / bg-removal)
      │
      ▼  mutate the v2 doc
   editor.render2D()                 ← always, immediate
   editor.scheduleRebuild3D()        ← debounced; if 3D active: preview3d rebuild via () => buildParts(doc)
      │
Export ▾ → exportDialog → buildParts(doc) → build3MF | facetsToBinarySTL | reliefSVG | PNG(canvas)
```

- **2D preview** is the canvas renderer's own drawing (fast, per-frame); **3D preview** and **export** both go through the single `buildParts(doc)`.
- **One-click bg-removal:** button on a selected image element → `window.removeBackground(imageData)` → replace the element's decoded image with the alpha-cut result → re-render. (Errors surface as the existing German messages.)

## Progressive disclosure & tutorial mechanics

- **Toggle:** header switch sets a root `mode-advanced` class and writes `localStorage['ukibori.view']`; on load, restore it (default Simple). CSS shows the Simple panel by default and the Advanced panel when `mode-advanced`.
- **Coach-marks:** on load, if `!localStorage['ukibori.coachmarksSeen']` and Simple view, run the 4-step tour; "Skip"/completion sets the flag; header `?` replays it.

## Cleanups folded in
- Remove the mode switch + `body.bookmark-mode` entirely.
- **RAF/resize lifecycle:** the 3D render loop is started/stopped strictly by the `2D/3D` toggle (no orphaned loop); a single `resize` handler bound to the unified canvas.
- **Empty-`src` guard:** never assign an empty string to an `<img>.src` (the latent `file://`/wasted-fetch bug).
- New JS uses the `window.els` IIFE pattern (do not redeclare `els`).

## Testing

- **Engine tests stay green** (55/0, `tests/run.html`).
- **Doc-manipulation unit tests** (DOM-light): adding an element / setting depth·shape·mount·size through the controller's mutators yields the expected `doc` shape; view-toggle + coach-mark flags persist to `localStorage`.
- **Playwright smoke tests** (the UI is DOM/canvas-heavy): open → Simple view renders with an empty plate; toggle Advanced reveals the full panel; drop an image → an element is added and drawn; `Export` produces a blob; coach-marks appear on first load and not after the `seen` flag is set. Plus a merged-UI **screenshot** for visual confirmation (3D preview needs a GL context — the existing `preview3d` gracefully reverts to 2D if unavailable).

## Risks & mitigations
- **Large refactor of `app.js` + `bookmark-editor.js`** into `editor.js` — mitigated by phasing (shell first, then canvas, then wiring) and by keeping the legacy files until the UI is verified on `buildParts`, deleting them in a late sub-task.
- **Canvas interaction parity** (selection/drag/scale/rotate must feel as good as the composer's) — mitigated by porting the composer's proven pointer math into the unified handler and Playwright interaction smoke tests.
- **Simple view genuinely usable** — mitigated by strong defaults and the coach-marks; validated by the smoke test producing an exportable result from Simple alone.

## Phasing (for the implementation plan)
1. **Shell + Simple/Advanced toggle + one workspace** (retire the mode switch; static panels; persisted view).
2. **Unified canvas renderer + pointer input** on the v2 `doc` (plate/elements/selection; drop-to-add; drag/scale/rotate; mount/shape edit).
3. **Wire `buildParts` → 2D/3D preview + export dialog**; then **delete the legacy builders**.
4. **Simple & Advanced control panels + defaults** (all controls bound to `doc`).
5. **One-click bg-removal** in Simple.
6. **Coach-marks / first-run tutorial (#9).**
7. **Cleanups** (RAF/resize lifecycle, empty-`src` guard).
