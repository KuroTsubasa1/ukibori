# Öse tab redesign — protruding lug with a hole

**Date:** 2026-07-02 · **Status:** approved (user design decisions locked)

## Problem
The Öse (loop) mount currently produces the same result as Loch (hole) plus a raised
2 mm rim on top of the plate. The engine explicitly forbids overhang: `buildMountRingParts`
intersects the ring with the body footprint ("so it can't overhang"), the raster grid only
spans the plate box, and the editor clamps the mount drag to inside the plate.

**User intent:** place the Öse NEXT TO / at the edge of the model and get a protruding
**tab (Lasche) with a hole through it** — like a keychain lug.

## Locked design decisions (user-approved)
1. **Flat tab** — the Öse is a full-plate-thickness washer (outer Ø = `diameterMm + 2·ringThicknessMm`)
   **unioned into the base footprint**, with the hole cut through. NO raised rim anymore.
   `ringThicknessMm` = tab wall width (default 2). `ringHeightMm` stays in the model
   (back-compat, migration untouched) but no longer produces geometry.
2. **Snap to top edge** — selecting Öse auto-places the marker centered on the top edge
   (half outside), so the tab is immediately visible; then drag to fine-tune.
3. Placed fully inside the plate, the Öse degrades to exactly a hole (the washer disappears
   inside the plate volume) — a "reinforced hole inside" no longer exists.
4. The tab can never detach: drag is clamped so the washer always bites ≥ 1 mm into the plate.

## Architecture

### One solid via footprint union (not a separate overlapping mesh)
The base footprint becomes `max(plateSDF, washerDiskSDF) min holeSDF` (all mm-space
signed fields, composed as closures). The existing trace/extrude pipeline then emits the
plate + tab as ONE manifold solid with the hole through — slicer-safe by construction
(no overlapping shells, no floating parts).

**AMENDED 2026-07-02 (user-found gap):** the union fires for EVERY loop doc — it must
NOT be gated on "domain expanded beyond the body box". The washer can be outside the
PLATE while inside the body box (free plaque: Öse next to the silhouette; circle plate
on a non-square body: Öse at the circle edge) — those need the tab too. Gating on
plate-containment is unnecessary: when the washer IS fully inside the plate, its
positive region is a subset of the plate's, so `max(plate, washer)` never changes the
traced mask's sign — union is a provable no-op there, and the loop-inside==hole parity
tests lock that. On the DEFAULT (unexpanded) branch the union composes with the
branch's own rectangular-cell mapping via the lattice identity
`min(max(p,w),h) = max(min(p,h), min(w,h))` — i.e. `max(shapeFootprintField_output,
min(washerSdf, holeSdf)·s)` — so geometry.js stays untouched and non-loop parity holds.

### Expanded raster domain
When `mount.type === 'loop'` and the washer extends beyond the body box, the raster
domain expands from `[0,W]×[0,H]` to the union bbox of plate + washer (+1 cell pad).
(Domain expansion controls only the RASTER BOUNDS; it is not the union trigger — see
the amendment above.)
A single shared `grid = {cols, rows, pitch, x0Mm, y0Mm}` is computed ONCE in `buildParts`
and threaded through every build function (they currently each call `gridForBody`
independently — 6 call sites). Cell→mm mapping becomes `x = x0Mm + (c+0.5)·pitch`.
**Default domain = body box ⇒ every existing behavior/test byte-identical.**
All parts (base, engraved, raised, heightmap) share the one grid, so relative alignment
is exact; the absolute origin shift (tab may reach negative y) is harmless for 3MF/STL.

### mm-space SDF extraction (DRY)
`js/geometry.js` gains an **additive** export `bodySdfMm(body)` → `(x,y) => signed mm`
(the rect/circle math extracted verbatim from `shapeFootprintField`, which is refactored
to consume it — zero behavior change, existing tests prove parity). `build-parts.js`
composes it for the expanded domain; `editor.js` reuses it for the drag attach-clamp.

Free-form plaques: `freeFootprintField` / `__silhouetteMask` (both in build-parts.js)
gain the same domain parameter (default = body box); the washer union composes on top
identically.

### Shared doc→grid+footprint entry point
`window.docGridAndFootprint(doc)` → `{grid, footprint}` — used by `buildParts` AND
`buildDesignSVG` (editor) so 2D/SVG/3D/exports all see the same expanded domain and
composed footprint.

## Component changes

### 1. Engine — `js/build-parts.js` (+ additive `bodySdfMm` in `js/geometry.js`)
- `docDomain(doc)`: body box, expanded to include the washer bbox when loop overhangs.
- `gridForDomain(domain, resolution)`: longest side = resolution (same rule as `gridForBody`).
- Thread the shared grid through `buildBaseParts`, `composeDesignV2`, `buildEngravedParts`,
  `buildRaisedParts`, `buildHeightmapParts`, `__silhouetteMask`, `freeFootprintField`
  (added optional param, default preserves current mapping).
- Footprint for loop = union washer, cut hole (rect/circle via `bodySdfMm`; free via the
  dilated silhouette field). `traceMaskToFacets` emits grid-space mm (c·pitch) — consistent
  across parts because the grid is shared.
- `buildMountRingParts` (raised rim): loop no longer emits the "oese" rim part. Keep the
  function returning `[]` for loop (or delete + update call site) — decided by implementer,
  but NO raised ring geometry.
- Expose `window.docGridAndFootprint`.

### 2. Editor 2D — `js/editor.js`
- View origin: `state.viewX0/viewY0` (mm; ≤ 0 when the tab overhangs top/left) applied in
  ALL mm↔px conversions (draw, hitTest, pointer, keyboard-nudge conversions). Introduce
  `mmToPxX/Y` + inverse helpers and use them everywhere (mechanical sweep).
- `fitScale()` fits the expanded domain (plate + tab), not just the plate.
- `applyMount('loop')`: snap to top edge — rect: `(W/2, 0)`; circle: `(W/2, H/2 − R)`;
  free: `(content-bbox centerX, content-bbox top)`; free with NO elements falls back to
  `(W/2, 0)`. (`type='hole'` keeps current position.)
- Drag clamp (replaces the `[0,W]×[0,H]` clamp for mounts): the washer must bite ≥ 1 mm —
  clamp so `bodySdfMm(body)(x,y) ≥ −(outerR − 1)` (signed dist to plate ≥ −(outerR−1) ⇒
  overlap ≥ 1 mm). Free shape: approximate the plate with the content bbox for the clamp.
  `type='hole'` keeps the current inside-plate clamp.
- Draw the tab: for loop, the existing outer-radius hint circle becomes the tab outline
  (solid stroke, not 0.4 alpha) since it now IS printed geometry.
- Öse tooltip copy: "Öse (Lasche mit Loch zum Aufhängen)".

### 3. SVG export — `js/editor.js` (`buildDesignSVG`)
Use `window.docGridAndFootprint(doc)`; viewBox/width/height from the expanded domain.
Everything else unchanged (per-color tracing already domain-agnostic).

## Error handling
- Degenerate loop params (`ringThicknessMm ≤ 0` or `diameterMm ≤ 0`): treat as hole (no union).
- Hand-edited docs with a detached washer: engine builds what the doc says (garbage-in);
  the editor clamp prevents it interactively.
- Empty free silhouette + loop: footprint = washer alone minus hole; still manifold.

## Testing (browser harness `tests/run.html` — must end green)
- **Parity:** all existing tests green; rect/circle/free docs without loop → byte-identical
  parts (default domain). `geometry-native` loop-cuts-hole test stays valid.
- **Update deliberately:** `tests/mount-ring.test.js` — the rim assertions (z top at
  thickness+ringHeight, "oese" part) are REPLACED by flat-tab assertions.
- **New:** loop at top edge → domain expands (grid bbox > body box); base part contains
  facets with y < 0 (the tab); the hole is a through-hole in the tab (no facets inside
  hole radius); manifold check (edge-count after vertex snap, same method as the
  existing manifold test); parts alignment: an element's facets land at the same mm
  position with and without the tab (shared-grid alignment proof); loop fully inside →
  base equals plain-hole base (washer swallowed).
- Playwright smoke: snap-on-select, drag past edge (clamped attached), 2D shows tab,
  SVG contains the tab in an expanded viewBox, 3MF/STL export non-empty, `__errs` empty.

## Non-goals
- No model/schema change (`ringHeightMm` kept, inert). No migration change.
- No multi-Öse, no Öse shape variants (round only), no rim option.
- No slicer-side union reliance (the union happens in the footprint).

## Execution
3 SDD tasks: **T1 engine** (domain + union + tests; the risky one) → **T2 editor 2D**
(origin offset + snap + clamp + draw) → **T3 SVG + copy + integrated smoke**.
Global constraints as ever: no new deps, classic-script IIFEs/window.* (no `els`
redeclare), German copy, harness green.
