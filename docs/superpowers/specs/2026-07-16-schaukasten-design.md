# Schaukasten (Shadowbox) — Design

Date: 2026-07-16
Status: approved (Bauweise: separate plates + stand; Öffnung: auto + freehand — per user choice)
Reference look: `shadowbox_sample.webp` (layered paper-cut tunnel, subject on back plate, clouds overhanging openings, printed stand)

## Concept

A document-scope mode (`doc.shadowbox`) that turns the design into a stack of N
single-color plates. Each plate has an organic cutout opening; openings shrink
toward the back by a fixed inset per plate, producing the paper-cut tunnel
effect. The back plate is solid and carries the subject (existing elements,
raised or engraved, multi-color allowed). Elements can be assigned to any
plate; a per-element flag lets an element's silhouette extend into the opening
(clouds overlapping the rim — the signature look). An optional printed stand
with a slot holds the assembled stack.

Physical build: **separate plates**, printed flat (each mostly one filament
color — no AMS required for the tunnel plates), stacked into the stand.

## Data model (js/bookmark-model.js)

```js
doc.shadowbox = defaultShadowbox() = {
  enabled: false,
  layers: 6,                // total plates incl. back, clamp 3..10
  insetPerLayerMm: 4,       // opening shrink per plate toward the back
  opening: {
    source: 'auto',         // 'auto' | 'drawn'
    marginMm: 12,           // auto: front opening distance from plate edge
    waviness: 0.5,          // auto: 0..1 wobble amplitude factor
    periodMm: 40,           // auto: wobble wavelength along perimeter
    seed: 1,                // auto: deterministic randomness
    points: null            // drawn: [{xMm,yMm},...] closed path, doc coords
  },
  colorFront: '#DDEEFA',    // plate colors lerp front -> back
  colorBack:  '#1B5E9E',
  stand: { enabled: true, heightMm: 15, slotDepthMm: 8, railMm: 5,
           tolMm: 0.4, color: '#C8BBAE' }
}
```

Element additions (all types): `el.sbLayer` (int plate index, `0` = front,
`null` = back plate — the default so existing docs keep their meaning) and
`el.sbOverhang` (bool, default false — union element silhouette into its
plate's footprint so it juts into the opening).

`migrateProject` backfills `doc.shadowbox` and the element fields on v2 docs;
`serializeProject` needs no change (fields are plain data). `sbLayer`/
`sbOverhang` do not alter an element's rendered pixels, so
`elementDisplayKey` is untouched.

**Parity invariant:** `buildParts(doc)` output is byte-identical to today
whenever `shadowbox.enabled` is false (single early fork, no shared-path
changes).

**Guard:** Schaukasten requires `body.shape` rect or circle (the analytic
perimeter the auto opening needs); the UI disables the toggle otherwise.

## Opening field (js/shadowbox.js — new pure module, DOM-free)

One signed field `f(x,y)` in mm, `> 0` inside the *front* opening. Plate `k`'s
opening is simply `{ f > k * insetPerLayerMm }` — openings are nested by
construction and stay in phase across layers (the Zierlinie iso-band pattern).
The back plate (`k = layers-1`) is always solid.

- **auto:** `f = rawBodySdf(x,y) - marginMm + A * w(t)` where `rawBodySdf` is
  `bodySdfMm({...body, edge off})`, `t = platePerimeterMm(body).nearest(x,y)`,
  and `w` is a seeded sum of 2–3 sinusoids whose periods snap to integer
  repeat counts (`n = max(3, round(L/periodMm))`, Zierkante convention) so the
  wobble closes seamlessly. `A = waviness * min(marginMm * 0.7, 8)`.
- **drawn:** closed polyline (freehand, Chaikin-smoothed via `smoothPath`)
  → scanline polygon fill into a grid mask (pure math, no canvas)
  → two `__chamferDT` passes → signed mm field. Invalid path (< 3 points,
  degenerate area) falls back to auto.

Exports on `window`: `defaultShadowbox` (lives in bookmark-model.js next to
`defaultEdge`), `shadowboxOpeningField(doc, grid)`,
`shadowboxPlateColors(sb) -> ['#rrggbb', ...]` (front→back lerp),
`shadowboxOpeningLoops(doc, grid, k)` (marching-squares mm loops for the 2D
preview), `buildStandParts(sb, stackMm, plateWidthMm)`.

## Per-plate geometry (js/build-parts.js)

`buildParts(doc)` forks at the top:
`if (doc.shadowbox && doc.shadowbox.enabled) return buildShadowboxParts(doc, layout)`.

`buildShadowboxParts(doc, layout='stack')`, inside the build-parts IIFE (needs
the private builders): for each plate `k`:

1. Derived doc `doc_k`: same body/print settings, `baseColor = colors[k]`,
   `elements = doc.elements.filter(sbLayer resolves to k)`; frame/Zierlinie/
   mount forced off on tunnel plates (v1 simplification; back plate keeps
   mount so the box stays hangable).
2. Footprint: `plateFootprint(c,r) > 0 && !(f(x,y) > k*inset)`, then OR the
   rasterized silhouettes (`__renderElementV2` masks) of this plate's
   `sbOverhang` elements, clipped to the raw plate SDF ≥ 0.
3. Parts: existing pipeline per plate — `composeDesignV2(doc_k)` +
   `__engravedBaseAndFloors` / `buildRaisedParts` / `buildHeightmapParts` with
   the custom footprint. Engraved subjects (Vertieft) work per plate
   unchanged; raised subjects on the back plate rise into the tunnel space.
4. Naming: every part name prefixed `ebene-(k+1)-` (German contract strings,
   e.g. `ebene-1-grundplatte`, `ebene-6-farbe-2`).
5. Layout:
   - `'stack'` (3D preview): plate `k` translated to `z0 = (layers-1-k) * T`
     — assembled view, front plate on top; stand parts beside the stack.
   - `'bed'` (export): every plate at `z0 = 0`, laid out side-by-side in XY
     with 5 mm gaps (grid columns), stand beside — print-ready.

The z/XY translation is a plain map over facet vertices (no transform
abstraction exists; all builders emit flat +z extrusions).

Thin-ring guard: if `k*inset` leaves less than `2 mm` between opening and
plate edge anywhere, clamp that plate's opening (reuse the
`thinFeatureMask`-style erosion idea as a simple margin clamp:
`f > min(k*inset, maxInset)` where `maxInset` keeps ring ≥ 2 mm).

## Stand (pure analytic, js/shadowbox.js)

Printed upright exactly as used — no overhangs, no rotation baking. Three
box parts (separate manifold solids, house pattern like plate + prisms):

- `staender-sockel`: `L × D` slab, z `[0, H - slotDepth]`
- `staender-wand-vorne` / `staender-wand-hinten`: rails `L × railMm`,
  z `[H - slotDepth, H]`

with `L = plateWidth * 0.7`, `slotW = layers * T + tolMm`,
`D = 2*railMm + slotW`. Built with `extrudeLoops` on analytic rect loops.

## Export & preview wiring (js/editor.js)

- 3D preview: `getPartsFn` unchanged (`buildParts` returns the assembled
  stack); clip scrubber and camera fit adapt automatically.
- 3MF: `buildParts` in `'bed'` layout — plates spatially separated, existing
  `build3MF` works unchanged (one composite parent, absolute coords; shared
  colors share extruders automatically). Export call passes the layout flag.
- STL: bed layout, plates disjoint in space (single united mesh, acceptable).
- Pausen-Spickzettel: disabled while shadowbox is active (z-based sheet is
  meaningless across side-by-side plates); button gets a German tooltip.

## UI (index.html + js/editor.js)

New accordion **„Schaukasten“** in `#sidebarAdvanced` after „Werkstück":

- An/Aus toggle; Ebenen (3–10); Versatz je Ebene (mm)
- Öffnung seg **Automatisch | Gezeichnet**; auto: Randabstand, Welligkeit,
  Wellenlänge, „Neu würfeln“ (seed++); gezeichnet: „Öffnung zeichnen" button →
  freehand closed-path capture on the 2D stage (reuse the Pfadtext draw-mode
  plumbing, Chaikin smoothing, auto-close)
- Farben: Vorne / Hinten color pickers
- Ständer: An/Aus, Höhe

Element inspector (visible only when enabled), in „Anordnung": **Ebene**
select (`1 (vorne) … N (hinten)`, stored 0-based, default hinten) and
**„Ragt in Öffnung“** checkbox.

2D workbench: when enabled, draw the N nested opening contours
(`shadowboxOpeningLoops`, ghosted strokes, front = strongest); elements draw
as today. All controls wire through the existing
`bindElementField`/`withSelected` + `render2D(); scheduleRebuild3D();` pattern
(undo/redo free).

## Testing (tests/shadowbox.test.js + run.html wiring)

Standard headless recipe (60×40 mm doc, `resolution 96`, `autoLayerHeights
false`, mount none). Cases:

1. Parity: disabled shadowbox → `buildParts` JSON byte-identical.
2. Auto field: sign correct (center +, rim −), margin respected, wobble
   closes (f at t=0 equals t=L).
3. Nesting: plate k opening ⊆ plate k−1 opening (mask monotonicity).
4. Stack build: N `ebene-*-grundplatte` parts; `zbounds` per plate slab;
   back plate solid (no interior hole loop → larger area).
5. Bed layout: all plates in `[0, T]`, XY bboxes disjoint.
6. Stand: slot width = `layers*T + tol` (rail bbox gap), part names/z.
7. Colors: lerp endpoints + monotone gradient.
8. Drawn opening: scanline mask sanity; degenerate path → auto fallback.
9. Element on plate k only affects `ebene-(k+1)-*` parts (differential).
10. Overhang: footprint area grows (differential).
11. Engraved (Vertieft) subject on back plate: parts below T, floor intact.
12. Migration: backfill + idempotence.

run.html: add `../js/shadowbox.js` to sources (after geometry/trace, before
build-parts), the test file, and bump `?v=` tokens of every edited source.
Update README test-count badge.

## Out of scope (v1)

Per-plate color overrides beyond the gradient; frame/Zierkante/Zierlinie on
tunnel plates; physical spacer gaps between plates; upright-in-stand preview
rotation; free/image plate shapes; per-plate 3MF file downloads (single
side-by-side file only).
