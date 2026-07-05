# Plate-free image object + non-clipping 2D viewport — Design (2026-07-05)

## Motivation

Two related pain points when transforming images in the 2D editor:

1. **Transform handles clip.** The 2D canvas is sized to the plate *domain* plus a
   fixed 48 px bleed (`MARGIN_PX`). `docDomain(doc)` returns only the plate box
   (expanded solely for a loop-washer overhang). When an element is moved / scaled /
   rotated past the plate edge, its corners and the rotate handle (which sits ~22 px
   above the top edge) fall outside `domain + margin` and are clipped by the canvas
   edge — you lose the grips you need to keep transforming.

2. **No plate-free object.** Every design is anchored to a plate (`body.shape`
   rect/circle/free). There is no way to treat the image itself as the printed object.

Both are addressed here. Part 1 (clipping) is a general viewport fix that benefits
every mode. Part 2 adds a plate-free object type by **extending the existing
free-shape engine** (lowest-risk path; chosen over a brand-new document mode).

## Part 1 — Non-clipping 2D viewport (all modes)

**Change:** `docDomain(doc)` (js/build-parts.js) currently returns the plate box.
Extend it to also union the axis-aligned bounding box of every **visible element's
rotated footprint**, expanded by a small mm padding that covers handle reach.

- For each non-hidden element compute its 4 rotated corners in mm doc-space
  (`cxMm/cyMm`, `wMm/hMm`, `rotationDeg`), take min/max → element AABB.
- Union all element AABBs with the existing plate/washer domain.
- Add a fixed mm pad (`HANDLE_PAD_MM`, e.g. derived so ~24 px at the current scale,
  but domain is scale-independent → use a modest constant like 6 mm) so corner/rotate
  handles never sit exactly on the canvas edge. The existing 48 px `MARGIN_PX` bleed
  remains as the pixel-space cushion; the mm-domain expansion is what actually grows
  the canvas to contain off-plate elements.
- `fitScale()` already derives the canvas size and view origin from `docDomain`, so it
  auto-grows once the domain includes the elements. **Add a `fitScale()` call at the
  end of a transform drag** (move/scale/rotate `pointerup`) so the view re-expands to
  keep a just-moved element (and its handles) fully visible. (Live re-fit on every
  `pointermove` is avoided — it would cause the plate to visibly "breathe" mid-drag;
  re-fit on drag end is the chosen behavior.)

**Parity / scope:** `docDomain` is also consumed by the engine grid
(`gridForDomain`) and SVG export. Expanding the domain to include off-plate elements
must NOT change printed geometry: the engine already clips content to the plate
footprint (`shapeFootprintField` / `freeFootprintField`), so a larger raster domain
only adds empty (footprint == 0) cells around the plate — no facets. **This must be
verified with a parity test** (buildParts output unchanged when an element sits fully
inside the plate; and no stray geometry when an element overhangs). If domain
expansion is found to perturb engine output, gate it to the *editor viewport only*
(a separate `viewportDomain()` used by `fitScale`, leaving `docDomain` — the engine's
source — untouched). **Decision: implement the viewport-only path from the start**
(`viewportDomain(doc)` = `docDomain(doc)` ∪ element AABBs + pad, used only by
`fitScale`/`render2D`), so the engine's `docDomain` stays byte-identical and parity is
guaranteed by construction. This is safer than mutating the shared `docDomain`.

**Clipping of image content:** rect/circle continue to clip element *content* to the
plate outline in `render2D` (the "what prints" preview). Only the *handles* stop
clipping (they draw after the clip is restored — already the case; the fix is purely
that the canvas is now large enough to contain them). "Bild" mode (Part 2) does not
clip content (like today's free shape).

## Part 2 — Plate-free "Bild" object (extends Frei)

A fourth shape option beside Rechteck / Kreis / Frei: **Bild**. The printed object *is*
the image — a rectangular base sized exactly to the image, no separate plate.

**Model (js/bookmark-model.js):** `body.shape` gains the value `"image"`. No new
top-level fields. `defaultDoc`/migration unaffected (older docs keep their shape).

**Geometry (js/build-parts.js):** reuse the free-shape path. `shape === "image"`
behaves like `"free"` except the footprint is the selected image's **rectangular
bounds** (its `wMm × hMm` box at its position/rotation) rather than the alpha
silhouette, and `borderMm` is forced to 0.
- Add a footprint branch: for `shape === "image"`, the base footprint = the image
  element's rotated rectangle (reuse the element-rect rasterization already used for
  `__drawElement`; a filled rect mask, not the alpha stencil).
- Which element defines the object: `body.freeOutlineFromElementId` (already exists for
  free) selects it; default = the first/only image element.
- Everything else (relief build-up/engrave, colorLayers, AMS, mount) works unchanged on
  top of that footprint.

**UI (index.html / js/editor.js):**
- Add a **"Bild"** button to both shape segments (`shapeSeg` + `advShapeSeg`).
- `applyShape("image")`: hide plate-size (Größe), corner, border, and frame controls
  (no plate chrome); show a hint that the object follows the image. The document
  auto-sizes to the image (the viewport fit from Part 1 does the visual sizing; the
  object dimensions come from the image element's `wMm/hMm`).
- 2D render: `shape === "image"` draws like free (elements only, no plate outline),
  optionally a faint dashed rectangle around the defining image so the object edge is
  visible.

## Components touched

| File | Change |
| --- | --- |
| `js/build-parts.js` | `viewportDomain()` (new, editor-only); `shape === "image"` footprint branch reusing free-shape path |
| `js/editor.js` | `fitScale` uses `viewportDomain`; re-fit on transform drag-end; `applyShape("image")` chrome toggling; "Bild" 2D draw |
| `index.html` | "Bild" shape button in `shapeSeg` + `advShapeSeg` |
| `js/bookmark-model.js` | accept `body.shape === "image"` (no schema change; documented) |
| `tests/*.test.js` | see Testing |

## Testing

- **Parity:** `buildParts` output is byte-identical for existing rect/circle/free docs
  (viewportDomain is editor-only; engine `docDomain` untouched). Locking test.
- **viewportDomain:** given an element moved far past the plate, the returned domain
  contains the element's rotated AABB + pad (so `fitScale` can't clip it).
- **Bild geometry:** `shape === "image"` produces a rectangular base matching the image
  element's `wMm × hMm` box; `borderMm` ignored; relief/engrave still build on it;
  watertight.
- **In-browser:** transform an image far outside the plate → handles remain fully
  visible (canvas grew); switch to Bild → plate chrome hidden, object = image rectangle,
  3D shows a rectangular relief sized to the image.

## Non-goals

- No new top-level editor mode (Relief/Lesezeichen unchanged); Bild is a `body.shape`.
- No cropping tool, no free-form image masking beyond the existing alpha handling.
- Alpha-silhouette plate-free objects remain covered by the existing "Frei" shape.
