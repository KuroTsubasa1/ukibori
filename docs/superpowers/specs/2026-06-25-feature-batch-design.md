# Ukibori — Feature Batch Design (2026-06-25)

Design for a batch of nine features. Built in four phases (A → B → C → D),
each independently verifiable. Phase D (3D preview) is last because it
visualizes the geometry produced by the earlier phases.

## Identity shift

Ukibori was "zero dependencies, no build, one `index.html`, fully offline".
Two of these features (live 3D preview via three.js, ML background removal)
require **vendored libraries**. After this batch Ukibori is:

- **Still offline & private** — everything vendored locally, no CDN, no upload,
  no tracking. All processing stays in the browser.
- **No longer zero-dependency** — it ships vendored assets:
  - `vendor/three.module.js` (~600 KB) — 3D preview
  - `vendor/ort.min.js` + `vendor/ort-wasm-simd.wasm` — onnxruntime-web
  - `vendor/u2netp.onnx` (~4–5 MB) — background-removal model
- **Still no build step** — loaded directly from `index.html`.

README badges/pitch change from `Dependencies: 0` / `Build: keiner` to
"no build step · no CDN · fully offline · vendored deps". The README update is
part of this work.

## Module layout

Existing split is preserved and extended:

| File | Role (existing → added) |
| --- | --- |
| `js/image-ops.js` | pixel ops → unchanged (consumed by new sources) |
| `js/geometry.js` | mesh/3MF → **+ binary STL**, **+ per-color fields**, **+ hole/loop fields** |
| `js/app.js` | DOM/state → wires every new feature, owns new controls |
| `js/sources.js` | **NEW** — text rasterizer + self-contained QR encoder |
| `js/bg-removal.js` | **NEW** — onnxruntime-web + u2netp cutout, graceful fallback |
| `js/preview3d.js` | **NEW** — three.js scene rendering exporter `parts` |
| `js/presets.js` | **NEW** — localStorage persistence + named presets |

**Convergence point:** text, QR, and cutout all converge on the same
`originalData` `ImageData` that `loadFile` produces today. They are alternate
*sources* feeding the unchanged processing pipeline (`processImage` →
`buildFields` → export). This keeps them isolated and individually testable.

The exporter's `parts` array (`[{name, color:[r,g,b], facets}]`) is the single
shared interface between geometry, STL, 3MF, and the 3D preview. Refactor
`exportModel` so building `parts` is separated from downloading the `.3mf`:

- `buildParts()` → returns `{ parts, stats }` (pure-ish; no download)
- `exportModel()` → `buildParts()` then `build3MF` + download
- `exportSTL()` → `buildParts()` then `facetsToSTL` + download
- `preview3d` → `buildParts()` then renders

---

## Phase A — independent quick wins

### #2 STL export
- `geometry.js`: `facetsToBinarySTL(facets)` → `Blob`. Union all parts' facets
  into one solid (STL is colorless, so colors are dropped; geometry only).
- New sidebar button **"STL"** next to the `.3mf` / PNG buttons. Filename
  `modell.stl`.
- Works in B/W and (after #9) color mode — it just serializes whatever
  `buildParts()` returns.
- Test: a known 2-triangle field produces a valid 84-byte-header binary STL
  with correct triangle count and little-endian floats.

### #8 Dimensions readout
- Live line in the sidebar: `B × H × T mm`.
  - `B` = `modelWidth`.
  - `H` = `B × (rows / cols)` from `buildFields` aspect (or the image aspect
    before a model is built).
  - `T` = `baseThick + max(thickBlack, thickWhite, ringThick, ...)` (the tallest
    stack), reflecting hole/loop where relevant.
- Updates on any dimension-affecting control change. No export needed.

### #7 Presets + memory
- `presets.js`:
  - `captureState()` / `applyState(state)` — read/write every control value
    (sliders, toggles, colors, mode, color method).
  - Persist current state to `localStorage` (key `ukibori:last`) on change
    (debounced); restore on load if present.
  - Named presets in `localStorage` (key `ukibori:presets`): save current as a
    name, load, delete.
  - Built-in presets seeded if absent: **Untersetzer** (circle on, ring,
    base), **Schild** (rectangle frame, base), **Magnet** (thin, no base/ring).
- UI: a small preset `<select>` + "Speichern" / "Löschen" in the sidebar head.
- Test: `applyState(captureState())` is a round-trip no-op; built-ins load
  without throwing.

### #6 Stamp mode
- Toggle **"Stempel-Modus"** in the Conversion accordion (B/W-oriented).
- When on: the *exported* geometry/PNG is **mirrored horizontally** and the
  relief is **inverted** (design raised, background recessed) so a physical
  stamp prints right-reading. Preview shows the mirrored result so what you see
  is what prints.
- Implemented as a flag consumed at field/exportData build time (flip X of the
  sampled grid; swap fBlack/fWhite roles), not a destructive edit of
  `processedData`.
- Test: with stamp on, the field grid is the horizontal mirror of stamp off,
  and black/white thickness roles are swapped.

---

## Phase B — new input sources

### #5 Text + QR input
- Input-source tabs at the dropzone: **Bild · Text · QR**.
- `sources.js`:
  - `renderText({ text, font, size, bold })` → `ImageData` (canvas `fillText`,
    black on white, padded). Multi-line supported via `\n`.
  - `encodeQR(string, ecLevel)` → boolean module matrix. Self-contained encoder:
    byte mode, automatic version selection, mask-pattern selection per spec.
    EC level selectable **L/M/Q/H, default M**. No external library.
  - `qrToImageData(matrix, scale, quiet)` → `ImageData`.
- Selecting Text/QR shows the relevant inputs (textarea / string field + EC
  level) and a "Anwenden" button that sets `originalData` and runs the normal
  load path (`enableControls`, default circle, `render`).
- Tests: QR encoder round-trips against known vectors (e.g. `"HELLO"` and a URL
  produce the spec's expected matrix size/finder patterns); decodable by a
  standard reader is verified manually. Text renders non-empty black pixels.

### #10 Background removal (ML)
- `bg-removal.js`:
  - Lazy-loads `vendor/ort.min.js` + `vendor/u2netp.onnx` on first use.
  - `removeBackground(imageData)` → `Promise<ImageData>`: resize to model input
    (320×320 for u2netp), run, upscale matte to source size, apply as alpha.
  - Sets `keepAlpha` on and re-renders with the new transparent `originalData`.
- UI: **"Hintergrund entfernen"** button (near the dropzone / conversion).
  Shows a spinner + status during inference.
- **Graceful degradation:** if the model/runtime files are missing or fail to
  load, the button reports "KI-Freistellung nicht verfügbar (Modell fehlt)"
  via `setStatus(..., true)` — never a silent failure, never a thrown crash.
- Test: with a stubbed runtime returning a known matte, alpha is applied
  correctly; with the runtime absent, the user-facing error path fires.

---

## Phase C — geometry

### #9 Color-mode 3D (both height modes)
- Enable the **3D-Modell** accordion in color mode (remove the `mode-bw` gate;
  add color-specific controls).
- `buildFields` (or a new `buildColorFields`) produces, for each palette color
  present in `processedData`, a **coverage field** (signed: >0 where that color
  is the nearest/assigned color), intersected with alpha/circle/frame like B/W.
- `buildParts()` in color mode: one `{name, color, facets}` per palette color,
  plus base/ring as today.
- **Height sub-toggle** (color mode only):
  - **Gleichmäßig (Uniform):** every color object uses one shared relief
    thickness slider → AMS-flat multicolor.
  - **Helligkeit → Höhe (Brightness):** per-color thickness = function of the
    color's luminance, with a **Dunkel hoch / Hell hoch** switch and a max-height
    slider. Produces a stepped multicolor relief.
- Both feed 3MF (per-color objects, already supported by `build3MF`) and STL
  (union).
- Tests: N reduced colors → N coverage fields whose supports are disjoint and
  cover the footprint; uniform mode gives equal z, brightness mode gives
  monotonic z vs luminance in the chosen direction.

### #4 Mounting hole / loop
- New **Befestigung** accordion: type **Kein · Loch · Öse**, diameter slider,
  position via a draggable marker on the 2D preview (default top-center).
- **Loch:** carve a circular hole through base + relief. Implemented as an
  analytic field: every part field is intersected with `dist(cell, hole) -
  holeR` (so inside the hole the field is negative → removed).
- **Öse:** add a protruding annulus tab at the top edge (outer ring with a hole
  through it), as its own colored object (body color) fused to the base.
- Position marker reuses the existing pointer-drag infra on `#output`.
- Tests: with a hole, no facets fall inside the hole radius; with a loop, an
  extra part exists whose footprint is an annulus at the marker position.

---

## Phase D — live 3D preview (built last)

### #1 Live 3D preview (three.js)
- `preview3d.js`: a three.js scene (vendored module), perspective camera,
  orbit-style controls (drag to rotate, wheel to zoom), one `Mesh` per exporter
  part using the part color, soft lighting, a ground/shadow hint.
- Source of geometry: `buildParts()` — the **exact** array the exporter uses, so
  preview == print.
- Preview area gets a **2D ⇄ 3D toggle**:
  - **2D** (default): existing edit canvas — required for circle drag, hole/loop
    marker drag, live image tuning.
  - **3D:** the three.js canvas; rebuilds (debounced ~150 ms) when a
    geometry-affecting control changes while 3D is active.
- Lazy: three.js + the scene are only initialized when 3D is first shown.
- Test: switching to 3D with a loaded image creates a scene with one mesh per
  part and meshes' bounding box matches the model dimensions; toggling back to
  2D preserves circle/hole editing.

---

## Cross-cutting

- **Error handling:** every vendored-asset load (three.js, ORT, model) is
  guarded; missing assets degrade to a clear status message, never a crash or
  silent no-op. STL/3MF/preview share `buildParts`, so a "no facets" condition
  is reported once, consistently.
- **Testing approach:** logic (QR encoder, STL bytes, color fields, presets
  round-trip, stamp mirroring, hole carving) is unit-tested by exposing pure
  functions on `window` (the codebase already does this) and asserting via
  `browser_evaluate`. Visual/preview behavior is verified manually with a
  loaded image.
- **No regressions:** the existing B/W → `.3mf` path, PNG export, circle crop,
  and transparency must keep working; the `parts` refactor is behavior-
  preserving for B/W.

## Out of scope

- Lithophane / continuous-height B/W mode (was offered, not selected).
- Cloud anything, accounts, server-side processing.
- Slicer integration beyond producing `.3mf` / `.stl`.
