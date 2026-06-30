# Unified Editor — Merge Relief + Bookmark Composer Into One Application

**Date:** 2026-07-01
**Status:** Design approved; implementation plan pending
**Branch:** `feature/feature-batch-2026-06`

## Problem

The app currently ships **two modes glued into one HTML file**:

- **Relief** (`#reliefWorkspace`, driven by `js/app.js`): one image (or text/QR) → threshold/color/circle/mount → raised relief. Exports PNG/SVG/STL/3MF. Has a live 2D/3D preview and a preset system.
- **Bookmark composer** (`#bmWorkspace`, driven by `js/bookmark-editor.js` + `js/bookmark-export.js` + `js/bookmark-model.js`): a layered WYSIWYG editor of text/image elements on a rounded-rectangle body, engraved color recesses by layer rank. Exports 3MF only. No 3D preview.

They are switched by `setAppMode()` (`js/bookmark-editor.js:31`) toggling a `body.bookmark-mode` CSS class (`styles.css:273-274`). Underneath, the two halves duplicate almost everything in the *middle* of the stack:

- separate state (`originalData`/`circle`/`mount`/`mode` globals vs a `doc` object),
- separate canvas renderers (`paint()` vs `bmRender()`/`redrawCanvas()`) and input handlers,
- separate geometry builders (`buildParts`/`buildColorParts` vs `buildBookmarkParts`),
- separate export paths.

The *bottom* of the stack is already shared and reusable: `js/geometry.js` (3MF/STL, `extrudeLoops`, `fieldFacets`, `orientOutward`, `roundedRectHoleField`, `build3MF`, `facetsToBinarySTL`), `js/trace.js` (`traceMaskToFacets`, `traceMaskLoops`), `js/image-ops.js` (threshold/quantize/posterize/`hexToRgb`), `js/sources.js` (text/QR), `js/bg-removal.js` (ML cutout), `js/preview3d.js` (three.js preview).

## Goal

Fold relief into the composer so there is **one layered editor**. Relief is no longer a mode; it becomes **capabilities of an element**. Eliminate the mode switch and the duplicated middle layer.

### Decisions (locked during brainstorming)

1. **Merge = fold relief into the composer.** The composer's layered editor is the single editor.
2. **Base plate shapes:** rounded `rect` | `circle` | `free` plaque (plate follows a chosen element's traced outline), each with an optional mounting hole/loop.
3. **Per-element depth:** each image element picks a depth `mode` — `solid` | `colorLayers` | `heightmap` — and a `direction` — `raised` | `engraved`. Text and QR elements are always `solid`.
4. **Run context:** production is served over HTTP by nginx (deployed via GH Actions). The `file://` console error is **local-dev-only**; the fix is to serve over HTTP in dev and to remove a latent empty-`src` bug. No production behavior change.

### Non-goals

- No new export formats beyond today's PNG/SVG/STL/3MF.
- No rewrite of the shared geometry primitives (`geometry.js`, `trace.js`) — they are reused as-is.
- No undo/redo system (pre-existing absence; out of scope).
- No change to the vendored libraries or the offline/vendored deployment model.

## Object model (`doc` v2)

A single document drives the editor, geometry, and export:

```
doc = {
  version: 2,
  body: {
    shape: 'rect' | 'circle' | 'free',
    widthMm, heightMm,                  // circle: width === height === diameter
    cornerRadiusMm,                     // rect only
    thicknessMm, layerHeightMm, baseColor,
    autoSizeFromElementId: string|null, // optional: size plate to an image's aspect ratio
    freeOutlineFromElementId: string|null, // 'free' shape: element whose silhouette defines the plate
  },
  mount: {
    type: 'none' | 'hole' | 'loop',
    xMm, yMm,            // hole/loop CENTER (xMm/yMm), not top-margin
    diameterMm,
    ringThicknessMm,     // loop only: in-plane ring wall thickness
    ringHeightMm,        // loop only: how far the ring stands proud above the base top face
    marginMm,            // original top-margin UI value (yMm = marginMm + diameterMm/2)
  },
  resolution,          // composition grid resolution (cols×rows derived from body aspect)
  colorStepLayers,     // default discrete step thickness in layers
  elements: [ Element, … ],
  fonts: {},           // family -> data URL (FontFace), as today
}

Element = {
  id, type: 'image' | 'text' | 'qr',
  cxMm, cyMm, wMm, hMm, rotationDeg,
  cutout: boolean,     // carve a through-hole instead of adding/recessing material
  color,               // solid color for solid/text/qr
  depth: {
    mode: 'solid' | 'colorLayers' | 'heightmap',
    direction: 'raised' | 'engraved',
    heightMm,          // solid: total height; heightmap: max height
    stepLayers,        // colorLayers: discrete step thickness (× layerHeightMm)
    reduce: { method:'palette'|'posterize', numColors, levels, remap:{}, order:[] }, // colorLayers
    threshold, invert, // image thresholding / heightmap inversion
    smooth, baseFloorMm, // heightmap: smoothing + minimum floor under the surface
  },
  // type-specific:
  src, _img,                     // image (runtime _img never serialized)
  text, fontFamily, fontWeight,  // text
  qrData, qrEcLevel,             // qr
}
```

This folds the relief globals into the document:

- relief `mode`/`colorMethod`/`colorHeight` → `element.depth.mode` (+ `reduce` for color, `smooth`/`baseFloorMm` for heightmap),
- relief `circle`/ring/frame → `body.shape:'circle'` + `mount`,
- relief mounting hole/loop (already added to both modes) → `mount`.

Text/QR elements ignore `depth.mode` other than `solid` and ignore `reduce`/`smooth`.

## Geometry engine (one `buildParts`)

Collapse `buildParts`, `buildColorParts`, and `buildBookmarkParts` into a **single `buildParts(doc)`** that reuses the already-shared primitives. Pipeline:

1. **Rasterize** each element onto the resolution grid (cols×rows from `body` aspect), reusing the composer's `composeDesign`/`__renderElement` plus `image-ops` (threshold, `quantizeMedianCut`, `posterize`) and `bg-removal` for image alpha.
2. **Emit geometry per element by `depth.mode`:**
   - `solid` → one binary mask → `traceMaskToFacets` → extrude at `heightMm`, raised above or engraved into the base per `direction`.
   - `colorLayers` → one mask per palette color, each extruded to a stepped height ranked by `reduce.order` (× `stepLayers`/`colorStepLayers`). This unifies relief color mode and composer layer stacking.
   - `heightmap` → continuous brightness→height field via `fieldFacets` (relief's brightness path), clamped by `baseFloorMm`, smoothed by `smooth`.
   - `cutout` elements carve through-holes (exclude from base) as the composer does today.
3. **Base plate** from `body.shape`: rounded rect (`roundedRectHoleField`), circle (circular field), or `free` (traced outline of `freeOutlineFromElementId`). Carve/raise the `mount` hole or loop.
4. **Assemble** parts `[{name, color:[r,g,b], facets}]` and hand to the shared exporters.

All parts share the existing `{name, color, facets}` contract that `build3MF` (`geometry.js:516`) and `preview3d.js` already consume, so the 3D preview becomes truly format-agnostic for the unified design.

## UI shell + canvas

Remove the segmented Relief/Lesezeichen switch and the `body.bookmark-mode` mechanism. One workspace:

```
┌ ukibori ───────────────────────────  [Open] [Save] [Export ▾] ┐
├──────────────┬───────────────────────────────────────────────┤
│ + Image      │                                                │
│ + Text  + QR │            ╭─────────────────╮                 │
│              │            │   live canvas    │   [2D] [3D]     │
│ ▸ Base plate │            │  (plate+elements)│                 │
│   shape ◻◯⌑  │            ╰─────────────────╯                 │
│   size/mount │                                                │
│ ▸ Layers     │   (3D = rotatable three.js preview of parts)   │
│ ▸ Selected:  │                                                │
│   depth mode │                                                │
│   ▲raised ▼  │                                                │
│   relief opts│                                                │
│ ▸ Presets    │                                                │
└──────────────┴───────────────────────────────────────────────┘
```

- **Add element**: Image | Text | QR (the composer's add buttons + relief's source tabs collapse into one "add element" surface). QR/text rasterization reuses `js/sources.js`.
- **Base plate panel**: shape selector (rect/circle/free), dimensions, corner radius (rect), thickness, layer height, base color, resolution, mount type/position.
- **Layers list**: the composer's `#bmLayers`.
- **Selected element properties**: the composer's `#bmProps`, extended with depth `mode`/`direction` and image relief options (threshold, color reduce/palette, bg-removal, heightmap `smooth`/`invert`/`baseFloorMm`).
- **Canvas**: one renderer + one input handler replaces `paint()` and `bmRender()`/`redrawCanvas()`. It draws the plate (rect/circle/free outline) + mount guide + elements + selection handles, and handles select/move/scale/rotate, mount drag, and circle-body resize. The relief's 2D/3D toggle (`preview3d`) now applies to the whole design.
- **Drop-an-image** anywhere creates an image element sized to the plate (auto-sizing an empty plate to the image aspect), preserving the old one-step "drop → relief" feel.
- **Export dialog**: one modal (relief's `#exportModal`) offering PNG/SVG/STL/3MF for the whole design.

## Persistence & migration

- Extend the composer's `serializeProject`/`deserializeProject` (`js/bookmark-model.js`) for `doc` v2.
- **Migrate v1 → v2** on load: a doc with no `version` is treated as v1. Wrap the flat body fields (`widthMm`, `heightMm`, `cornerRadiusMm`, `thicknessMm`, `layerHeightMm`, `baseColor`, `hole`) into `body{}` + `mount{}`; give each element a default `depth{ mode:'colorLayers' for reduce images else 'solid', direction:'engraved', … }` derived from its existing `depthLayers`/`reduce`/`colorMode`. Existing saved bookmark projects keep loading and produce the same geometry.
- Generalize the relief preset system (`js/presets.js`) to snapshot the whole `doc` to localStorage, replacing the hardcoded `PRESET_CONTROLS` list. Relief had no saved project format (only localStorage control values), so there is nothing else to migrate.

## Fixes folded into the merge

- **Empty-`src` guard.** `js/bookmark-model.js:33` defaults `e.src = ""` and `js/bookmark-editor.js:462` does `img.src = el.src`. An empty `src` makes the browser re-request the current document URL (the `file://` "unique security origin" error locally, a wasted document fetch over HTTP). Guard the load loop to skip non-image/empty-`src` elements and never assign an empty string to an `<img>.src`.
- **RAF + resize-listener lifecycle.** The 3D render loop is only stopped on the relief→bookmark switch path, not the reverse; a `resize` listener attached at load (`js/bookmark-editor.js:421`) is never removed. With the switch gone, tie the RAF loop strictly to the 2D/3D toggle (no orphaned loop) and attach a single resize handler to the unified canvas.
- **Dev server.** Add an HTTP serve script (e.g. `python3 -m http.server` wrapper or tiny static server) + a README note so developers never open the app via `file://` (where ML cutout and workers break). Production is unaffected — nginx already serves over HTTP.

## Testing (TDD)

Extend the existing browser harness (`tests/harness.js`, `tests/run.html`, `*.test.js`):

- **Model migration**: a v1 bookmark project deserializes to a valid v2 `doc` with equivalent geometry.
- **Unified `buildParts`**: for each `depth.mode` ∈ {solid, colorLayers, heightmap} × `direction` ∈ {raised, engraved}, parts are **watertight and manifold** (closed surfaces, positive `signedVolume`, correct winding via `orientOutward`).
- **Base shapes**: rect / circle / free each produce a valid plate; mount hole/loop carves/adds correctly.
- **Export**: 3MF (valid OPC zip + basematerials) and binary STL are well-formed; SVG/PNG render.

Follow `superpowers:test-driven-development` for each unit during implementation.

## Phasing (for the implementation plan)

1. **Data model + migration** — `doc` v2, element `depth`, v1→v2 migration, serialize/deserialize (+ tests).
2. **Unified geometry engine** — single `buildParts(doc)` covering all depth modes + base shapes, verified against current relief/bookmark output (+ tests).
3. **UI shell/canvas merge** — drop the mode switch, one sidebar + one canvas/input handler, merged properties panel, drop-to-add.
4. **Export + 3D-preview unification** — one export dialog (PNG/SVG/STL/3MF), 3D preview for the whole design.
5. **Cleanup/fixes** — empty-`src` guard, RAF/resize lifecycle, dev server + README.

## Risks & mitigations

- **Geometry regressions** (raised vs engraved, color stepping, heightmap watertightness) — mitigated by phase-2 tests comparing against current output before deleting the old builders.
- **Large refactor of `js/app.js`** (~1000 lines) and the composer — mitigated by phasing and by keeping the shared primitives untouched.
- **Old saved projects** — mitigated by the v1→v2 migration and a regression test.
- **Heightmap as an element** is the least-precedented fold (relief's heightmap was a whole-image concept) — mitigated by treating it as a per-element field constrained to the element's bounds with a `baseFloorMm`.
