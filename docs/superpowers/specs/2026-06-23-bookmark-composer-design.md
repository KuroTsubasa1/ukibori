# Lesezeichen (Bookmark) Composer — Design

**Date:** 2026-06-23
**Status:** Approved (pending implementation plan)

## Summary

Add a second mode to Ukibori: a **bookmark composer**. Where the existing app
turns *one* image into a relief, the bookmark composer is a **drag-and-drop
canvas** on a fixed-size bookmark body where the user lays out **multiple image
and text elements**, assigns colors, and exports a multicolor `.3mf` for
AMS/multicolor 3D printing. The existing "Bild → Relief" flow is untouched.

## Goals

- A bookmark body: rounded rectangle, default **50×150 mm**, hole near the top
  (default ⌀5 mm), rounded corners.
- A drag-and-drop editor: add/move/scale/rotate **many** image and text elements.
- **Each color is its own print layer** (its own `.3mf` part), consistent with
  the existing color-per-object export.
- **Reversed-relief geometry**: smooth front face; the design reads from the
  front; colors are stacked from the front by a per-element layer depth, with
  z-order cutout.
- Save and reload a design as a project file.

## Non-goals

- Changing the existing image→relief mode.
- PNG/SVG export of the bookmark (not requested; can be added later).
- A general layout engine (snapping, alignment guides, grouping) — basic
  move/scale/rotate only for the first version.

## Integration & layout

A top-level mode switch toggles between:

- **Bild → Relief** — the current app, unchanged.
- **Lesezeichen** — the new composer.

Layout follows the current app (**Layout A**): controls in the left sidebar, the
bookmark canvas centered in the preview area. The bookmark mode reuses the
header, dropzone (for adding images), and overall page chrome.

## Data model

### Bookmark document

```
{
  widthMm: 50,            // adjustable
  heightMm: 150,          // adjustable
  cornerRadiusMm: 4,      // adjustable
  thicknessMm: 3.0,       // total body thickness
  layerHeightMm: 0.2,     // printer layer height; depths = layers × this
  hole: {
    diameterMm: 5,
    marginTopMm: 8,       // distance from top edge to hole center
    // horizontally centered
  },
  baseColor: "#000000",   // smooth-front background + body color
  resolution: 256,        // max grid dimension for export sampling
  elements: [ ... ]       // ordered back→front (z-order); later = on top
}
```

### Element (shared fields)

```
{
  id,
  type: "image" | "text",
  cxMm, cyMm,             // center position in bookmark coordinates (mm)
  wMm, hMm,               // bounding size (mm)
  rotationDeg,
  depthLayers: 2,         // color depth in printer layers (× layerHeightMm)
  cutout: false,          // true → nothing printed behind it (recess); false → base fills behind (flat back)
  colorMode: "solid" | "reduce",   // "reduce" is image-only
}
```

### Image element extras

```
{
  src: "<dataURL>",
  // solid mode:
  color: "#RRGGBB",        // silhouette color
  threshold: 128,          // silhouette cutoff (reuses applyThreshold)
  invert: false,
  // reduce mode:
  reduce: { method: "palette" | "posterize", numColors: 8, levels: 4 }
}
```

### Text element extras

```
{
  text: "…",
  color: "#RRGGBB",        // text is always solid color
  fontFamily: "system-ui", // from a dropdown, or a custom-uploaded family
  fontWeight: "normal" | "bold",
  // size is driven by hMm / the bounding box
}
```

## Geometry & export pipeline (confirmed model)

**Confirmed print model:** design on the **front**, front face **smooth**
(colors flush at the front), color **depth measured in printer layers from the
front**, **z-order cutout** (topmost element owns a pixel and is cut out of the
colors beneath it). Base color fills the body behind non-cutout regions to reach
total thickness; cutout regions leave a recess on the back.

Coordinates: let `T = thicknessMm`, front face at `z = T`, back face at `z = 0`.
A color region with depth `d` mm occupies `z ∈ [T − d, T]`.

Pipeline (reuses `js/geometry.js` and `js/image-ops.js` wholesale):

1. **Rasterize the composition** to a grid sized from `resolution` (longest
   side = `resolution`, aspect-correct), at the bookmark's mm extent. Paint
   elements **top-to-bottom** (painter's algorithm) so each pixel's owner is the
   topmost element covering it. Per pixel record: front color, depth (mm), and
   the owner's cutout flag. Background pixels (no element) → base color, full
   thickness.
   - **Solid image** silhouette: `applyThreshold` (+ optional invert) on the
     drawn image → mask in the chosen color.
   - **Reduce image**: `quantizeMedianCut` (palette) or `posterize`, optionally
     cleaned with `removeSmallColorIslands` / `majorityFilter` → multiple colors.
   - **Text**: drawn with canvas `fillText` at high resolution → mask in the
     chosen color.

2. **Group pixels by `(color, depth)`** and build a binary signed field per
   group. **Intersect (min)** each field with an analytic **rounded-rectangle
   SDF** and an **outside-hole SDF** so every part shares one smooth outline and
   hole.

3. **Extrude each group** with the existing `fieldFacets(field, cols, rows,
   pitch, thickness, smoothTol, z0)`:
   - Color slab (front): `z0 = T − d`, `thickness = d`.
   - Base body behind **non-cutout** pixels: `z0 = 0`, `thickness = T − d`,
     grouped by `d`.
   - **Cutout** pixels: no base behind (recess).
   - Background pixels: base color, full thickness `[0, T]`.

4. **Assemble parts**: merge all base-colored facets into one `grundplatte`
   part; each other color → its own part. Pass parts to the existing
   `build3MF(parts)` → downloadable `.3mf`.

This yields **sub-pixel-smooth** contours (via `marchingSquaresLoops` +
`chaikinClosed` + `dpSimplify` inside `fieldFacets`) for the outline, hole, and
internal color boundaries — matching the existing export quality.

### New geometry helper

Add to `js/geometry.js` an analytic **rounded-rectangle + hole SDF** builder
(positive inside the body and outside the hole), returning a sampler usable by
the field grid — the natural home alongside the other geometry primitives.

## Editor (canvas interactions)

A `<canvas>` renders the bookmark at a px/mm scale: rounded body, hole, and all
elements with their colors (reduce-mode images shown quantized). The selected
element shows a bounding box with handles:

- **Drag body** → move (clamped so the element stays reasonably on the bookmark).
- **Corner handles** → scale.
- **Top handle** → rotate.

Sidebar contents (bookmark mode):

- Bookmark settings: size, corner radius, thickness, layer height, hole
  diameter + margin-from-top, base color, resolution.
- **+ Bild / + Text** buttons (image add reuses the existing dropzone/file
  input).
- **Layer list**: elements in z-order, reorderable (drag or up/down), with
  delete; selecting an item selects it on canvas.
- **Selected-element properties**: position/size/rotation (numeric), color, color
  mode (+ reduce settings for images), depth (layers), cutout toggle, and font
  controls for text.

## Fonts

- **System fonts**: a dropdown of common families used directly by canvas
  `fillText`.
- **Custom upload (.ttf/.otf)**: loaded via the browser **FontFace API**
  (`new FontFace(name, arrayBuffer)` → `document.fonts.add`), then usable like a
  system family. Keeps the **zero-dependency** promise — no font-parsing library.

Text is always rasterized → traced as a mask, so any loaded font works without
glyph-outline extraction.

## Export & project file

- **`.3mf` multicolor** — primary deliverable via `build3MF`.
- **Project save/load** — a JSON file capturing the full bookmark document
  (settings + elements). Images and uploaded fonts are embedded as **data URLs**
  so a project is self-contained. Save = download JSON; load = file input that
  rebuilds the document and re-registers any embedded fonts.

## File structure

- `index.html` — add the mode switch and the bookmark workspace markup
  (sidebar + canvas). Existing markup unchanged.
- `styles.css` — bookmark editor styles (selection handles, layer list, panels).
- `js/geometry.js` — **add** the rounded-rect + hole SDF helper. Existing
  functions reused as-is.
- `js/bookmark-editor.js` — **new**: data model, canvas rendering, hit-testing,
  drag/scale/rotate, layer list, project save/load.
- `js/bookmark-export.js` — **new**: raster composition → grouped `(color,
  depth)` fields → `.3mf` (reuses `geometry.js` + `image-ops.js`).

Splitting editor vs. export keeps each file focused and within easy reading size
(the existing `app.js` is ~530 lines; the new code should stay similarly scoped).

## Reused building blocks

- `js/geometry.js`: `marchingSquaresLoops`, `fieldFacets`, `extrudeLoops`,
  `chaikinClosed`, `dpSimplify`, `orientOutward`, `facetsToIndexedMesh`,
  `signedVolume`, `zipStore`, `build3MF`.
- `js/image-ops.js`: `applyThreshold`, `computeOtsuThreshold`,
  `quantizeMedianCut`, `posterize`, `removeSmallColorIslands`,
  `majorityFilter`, `removeSmallIslands`, `hexToRgb`.

## Defaults

- Corner radius **4 mm**, layer height **0.2 mm**, total thickness **3 mm**,
  hole **⌀5 mm, 8 mm** from the top, base color **black**.

## Testing

Following the existing verification style (pure functions exposed on `window`,
asserted via `browser_evaluate`):

- **Rounded-rect + hole SDF**: sign/value at known points (inside body, in hole,
  outside).
- **Raster composition**: z-order ownership, cutout flagging, and `(color,
  depth)` grouping for a small synthetic design.
- **Project save↔load roundtrip**: serialize → parse → deep-equal of the
  document (modulo ids).
- **`.3mf` sanity**: expected part count, non-zero triangles, outward-facing
  volume via `signedVolume`/`orientOutward`.
- **Editor smoke test**: add image + text, select, drag/scale/rotate, export;
  visual screenshot check.

## Risks / notes

- **Performance**: a 50×150 mm bookmark at high resolution is a large grid;
  marching squares is O(cells). Mitigate with the resolution control (default
  256 longest side, ≈ 256×768) and only re-rasterizing the export grid on export
  (the live editor renders elements directly, not via the field grid).
- **Coincident faces** between abutting color slabs and the base body: keep
  z-slabs exactly adjacent (`[T−d, T]` and `[0, T−d]`) and rely on the slicer; if
  artifacts appear, introduce a tiny overlap.
- **Custom font licensing** is the user's responsibility; fonts are embedded in
  the project file as data URLs.
