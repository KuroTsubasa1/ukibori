# AMS-Ebenen-Ausrichtung (engraved motif ↔ plate/Öse bands, layer-grid snap)

Date: 2026-07-22
Status: approved (user: full alignment + grid-snap, both directions consistent)
Bug: In "Höhe je Farbe" / AMS engraved mode the motif's per-color engraved floors and
the plate/Öse color bands land at DIFFERENT z per color, and off the print-layer grid,
so the same AMS color prints at different heights and filament swaps fall mid-layer.

## Root cause (verified empirically)

`__engravedBaseAndFloors` (js/build-parts.js) uses two independent depth steps:
- Plate/Öse bands: `bandThick = min(step, (T - minBase) / N)`, N = `bandHexes.length`.
- Motif engraved floors: `amsStep = min(step, maxRecess / (ams.length + deckShift))`,
  `maxRecess = T - floor - minBase`.

Different budgets ⇒ per-color depths diverge (measured T=2, layerH=0.4, 2 colors, auto-heights:
plate bands at 0.8/1.2/1.6/2.0 = grid-aligned; motif floors at 1.0/1.8 = off-grid, different).
`step = colorStepLayers*layerH` is already an integer layer count; the COMPRESSION is what
breaks grid alignment, and the two paths compress differently.

## Target model — one shared layer plan

There is a single ordered color→z-band plan; every appearance of a color (plate band,
Öse tab band, engraved motif floor) uses the SAME band, snapped to the layer grid.

### Engraved (vertieft) AMS / Höhe-je-Farbe

1. **Grid-snapped band thickness.** With `avail = T - minBase`, `N = bandHexes.length`:
   `bandThick = layerH * max(1, floor(min(step, avail / N) / layerH))`.
   Degenerate fallback (plate too thin to fit N whole layers, `avail < N*layerH`):
   `bandThick = min(step, avail / N)` (unsnapped, keeps colors distinct — documented).
2. **Plate/Öse bands (unchanged structure):** band k (1 = darkest/topmost .. N) occupies
   `[T - k*bandThick, T - (k-1)*bandThick]`, color `bandHexes[k-1]`; interior base fills
   `[minBase, T - N*bandThick]`; bottom slab `[0, minBase]`. (Only `bandThick` changes.)
3. **Motif floors align to the plan.** For a motif pixel of color C where
   `p = bandHexes.indexOf(C)+1 > 0`: the floor's visible top must equal band-C's top,
   `T - (p-1)*bandThick`. So recess `= (p-1)*bandThick`; the color-floor slab keeps its
   `floor` thickness with top at `T - (p-1)*bandThick` (`baseUnder = T-(p-1)*bandThick-floor`,
   clamped ≥ minBase). The shallowest plan color (p=1) is flush with T (no carve); deeper
   colors carve down to their band's surface. Base beneath a pixel reaches its deepest floor.
4. **Fallback (no shared plan).** When `bandHexes` is empty (amsSolidBase, or no AMS/auto
   participant) OR a motif color C ∉ bandHexes: keep the current per-element compression for
   that element (no alignment target exists). Non-AMS designs stay byte-identical (parity).
5. **Restructure:** compute the band plan (`bandHexes` + snapped `bandThick`) BEFORE emitting
   motif floors, so both the special `bands` pass and the auto-height solid floors carve to
   the plan. (Today the plan is computed after the motif pass.)

### Raised (erhaben) AMS

`buildRaisedParts` already stacks bands at `[T+L*step, T+(L+1)*step]` with
`step = colorStepLayers*layerH` (an integer layer count) and the Deckschicht at `[T, T+step]`
— already grid-aligned, no plate-band to diverge from. **Verify** via test that raised AMS
band boundaries are multiples of `layerH`; no code change expected. If any raised compression
exists that breaks the grid, snap it the same way.

## Consistency invariants (the tests to add)

For engraved auto-heights + AMS palette + an overhanging Öse (the reported case):
- For every palette color, motif-floor-top == plate-band-top == Öse-tab-band-top (±1e-6).
- Every band/floor z-boundary is a multiple of `layerHeightMm`.
- Öse tab layer stack == surround plate layer stack (already holds; keep asserting).
- Parity: a doc with no AMS/auto participant is byte-identical to before.

## Out of scope
Changing `colorStepLayers` semantics; per-color manual heights (heightOverrideMm) still opt out;
heightmap elements (own surface). Existing engraved-AMS parity tests that encode the OLD
diverged depths will be updated to the aligned depths, each with a one-line justification.
