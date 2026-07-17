# Schaukasten v2 — Element-Arten: Rand-Wolke & Schwebeteile

Date: 2026-07-16
Status: approved (user-specified behavior; two controller decisions noted inline)
Builds on: `2026-07-16-schaukasten-design.md` (shipped, commits 02f1957..dfad2d0)
Reference look: `shadowbox_sample.webp` — clouds fused to the opening rims but standing
one layer proud; the subject (Pokémon) assembled from stacked floating pieces.

## Concept

Every element in Schaukasten mode gets an explicit **Art** (`el.sbMode`):

- **"plate"** (Auf Platte, default): today's behavior — content rendered on its
  plate, clipped to the plate ring.
- **"rim"** (Mit Rand verbunden): the cloud state. The element's silhouette is
  unioned into plate k's footprint exactly like the shipped overhang (plate
  material `[0,T]`, plate color), **plus** a prism `[T, 2T]` in the element's
  color — the object pokes exactly one level forward. The prism is clipped to
  the plate outline AND to the opening of the plate in front
  (`opening_{k-1}`), so the closed stack never collides; on the front plate
  (k=0) the prism is unclipped (decorative relief on the box face).
  *Decision:* this REPLACES the flush „ragt hinein" (`sbOverhang`) — old saves
  migrate `sbOverhang: true → sbMode: "rim"`. No flush-only mode remains.
- **"float"** (Schwebend): a separate flat piece. Silhouette ∩ `opening_k`
  (collision with the ring is cut off, per user spec), slab thickness `T`, in
  the element's color, occupying plate k's z-slab in the assembled stack
  (`z0 = (n-1-k)·T`). Floating pieces are **excluded from plate content** and
  become their own printed parts (own spots on the bed in bed layout, placed
  in a row after the stand with 5 mm gaps). Multiple floating pieces stack
  front-to-back (wings behind body behind head). The level is clamped to
  `k ≤ n-2` (the back plate has no opening; the deepest piece rests on it).

## Montagestifte (assembly pins)

`doc.shadowbox.pins = { enabled: true, diameterMm: 3, clearanceMm: 0.35 }`
(only `enabled` gets UI in v1; sizes are model-editable).

- Generated wherever two floating pieces sit on **directly adjacent levels**
  (their faces touch) and their silhouettes overlap — and, *decision:* also
  between the **back plate and floating pieces at level n-2** (anchors the
  deepest piece; without it the subject cannot be aligned on the back wall).
- Geometry: peg cylinder on the LOWER (rear) part's front face, d = 3 mm,
  h = `min(1.2, 0.6·T)`; matching **blind hole** in the upper part,
  d = `3 + clearanceMm`, depth = `pegH + 0.2`. The hole opens on the upper
  piece's REAR face, so printed front-face-up it is a bed-side recess — no
  supports, no hole visible from the front.
- The hole splits the upper piece's slab into two z-slabs (bottom slab with
  hole cut, solid top slab) — the established slab-splitting pattern.
- Placement is deterministic: interior chamfer-DT maxima of the overlap mask;
  up to 2 pins when the overlap supports two spots ≥ 12 mm apart (2 pins lock
  rotation); a pin is skipped where the overlap cannot host peg radius + 1 mm
  wall. Pure helper `shadowboxPinSpots(...)` in js/shadowbox.js, unit-tested.
- Back-plate pegs sit on the back plate's top face at the DT maxima of the
  deepest piece's silhouette; the piece gets the holes.

## Data model & migration (js/bookmark-model.js)

- `makeElementV2`: `sbMode: "plate"` (replaces the mode role of `sbOverhang`;
  the old boolean stays serialized but is no longer written by the UI).
- `migrateProject` v2 branch: `el.sbMode == null → el.sbOverhang ? "rim" :
  "plate"`; `doc.shadowbox.pins` backfilled from `defaultShadowbox()`.
- `defaultShadowbox()` gains the `pins` block.
- Parity unchanged: all new fields are read only inside `buildShadowboxParts`.

## Engine (js/build-parts.js + js/shadowbox.js)

In `buildShadowboxParts`:
- Element partition per plate k: `plateEls` (sbMode plate) → content as today;
  `rimEls` → footprint union (existing overhang block, now keyed on
  `sbMode === "rim"`) + prism parts `ebene-(k+1)-rand-M` (M = 1-based per
  plate), prism mask = silhouette ∩ `base > 0` ∩ (k === 0 or
  `f > (k-1)·inset`); `floatEls` → excluded from dk.elements entirely.
- Floating pieces built per element: mask = `__renderElementV2` silhouette ∩
  `opening_k`; parts `ebene-(k+1)-schwebeteil-M` (+ `-oben` top sub-slab when
  a hole splits it) and pegs `ebene-(k+1)-stift-M` (peg color = its piece's
  color). Stack layout: piece at its slab; bed layout: sequential x-offsets
  after the stand (piece bbox width + 5 mm).
- Pin pairing: sort floating pieces by level; pair (piece at k, piece at k-1)
  when silhouette overlap non-empty; plus (back plate, piece at n-2).
- Cutout/cutout-flag elements keep today's meaning only for sbMode "plate";
  rim/float ignore `el.cutout` (documented).

## UI (index.html + js/editor.js)

- Inspector: the „ragt hinein" checkbox is replaced by a seg/select
  **„Schaukasten-Art“**: `Auf Platte | Mit Rand | Schwebend` (German copy
  contract). Visible with the existing `#sbLayerRow`. For „Schwebend" the
  Ebene select hides the hinten option (clamped to n-2).
- Accordion: checkbox **„Montagestifte“** (default checked) under Ständer.
- 2D: no new drawing in v1 (nested contours + element rendering already show
  placement; the 3D preview shows the truth including pins).

## Testing (tests/shadowbox.test.js)

1. Migration: sbOverhang true → "rim"; pins backfilled; idempotent.
2. Rim: prism exists `[T, 2T]` on plate k (zbounds), clipped by
   `opening_{k-1}` (differential: rim element near the ring of plate k with
   plate k-1 solid above → prism smaller than silhouette), k=0 unclipped.
3. Float: piece part exists in element color at the right z-slab (stack) and
   at z `[0,T]` disjoint-x (bed); ring collision cut (differential vs an
   element fully inside the opening); excluded from plate content parts;
   level clamp n-2.
4. Pins: adjacent pieces with overlap → peg `[T, T+pegH]` on the lower piece
   + hole splits the upper piece (two sub-slabs, bottom one has hole loops —
   assert via facet count/area differential vs pins disabled); no pins when
   `pins.enabled` false (byte-identical float output); tiny overlap → no pin;
   back-plate peg for level n-2 piece.
5. `shadowboxPinSpots`: exact spots on synthetic masks (single blob → 1 spot
   at center; two distant blobs → 2 spots; sliver → none).
6. Parity: Schaukasten off remains byte-identical (existing lock).

## Out of scope (v1)

Raised/engraved content ON floating pieces (flat slabs only, el.color);
pin size UI; pins between rim clouds and anything; collision warnings when a
floating piece outgrows the next opening; per-piece print orientation.
Same-slab collisions between floats and between a float and a rand cloud from
the plate behind are user-controlled (visible in the 3D preview). Float chains
whose deepest level is above n-2 have no anchor to the back wall (decision
pending: warning vs spacer pegs).

---

## Addendum (2026-07-17): Rand-Stifte, geschlossener Fuß, Explosionsansicht

User requests, added mid-implementation:

### 1. Rim pieces become separate printed parts with pins

The rim cloud's prism is no longer printed fused onto its plate (which would
force a multi-color plate print). Instead:
- The plate keeps the footprint extension `[0,T]` (plate color, unchanged) and
  gains **pegs** on the extension's top face at the chamfer-DT maxima of the
  prism mask (same `shadowboxPinSpots` mechanism, carrier = the plate, peg
  color = plate color, names continue the global `ebene-(k+1)-stift-J`
  numbering).
- The prism becomes a standalone piece (local slab `[0,T]`, element color,
  name unchanged `ebene-(k+1)-rand-M`, `-oben` split when holes exist) with
  **blind holes** on its underside — the float-piece pattern exactly. Stack
  layout: shown at plate-local `[T,2T]` as before; bed layout: own spot in
  the pieces row. `pins.enabled === false` keeps the separation but omits
  pegs/holes.

### 2. Stand: closed slot ends (left/right)

The slot becomes a closed pocket so the stack cannot slide sideways:
- Pocket length = `plateWidthMm + tolMm`; total stand length
  `L = pocket + 2*railMm` (the stand is now WIDER than the plates — required
  for closed ends).
- Two new parts `staender-wand-links` / `staender-wand-rechts`: end caps
  spanning the slot strip (`y ∈ [rail, rail+slotW]`, x ∈ `[0, rail]` /
  `[L-rail, L]`) at rail height `[H-slotDepth, H]`. Front/back rails and
  sockel unchanged except the new L. Five parts total.
- The bed-layout stand-width term in build-parts follows the new L (the
  cross-referenced formula).

### 3. Explosionsansicht (preview-only)

`buildParts(doc, { explodeMm: g })` spreads the stack: every level's z-shift
becomes `(n-1-k) * (T + g)` (plates, their rand pieces, float pieces, pegs —
everything rides its carrier). Bed layout and exports ignore it. UI: range
slider „Explosionsansicht“ (0–20 mm) in the Schaukasten accordion —
editor-local view state (like zoom): never serialized, no undo entries, only
`scheduleRebuild3D()`.

---

## Addendum 2 (2026-07-17): „Mit Rand" v3 — die Ebenen wachsen um das Objekt

User feedback: „Ich erwarte, die jetzige Ebene um das Objekt herum wächst, die
unteren Schichten müssen sich der neuen Form anpassen." — matches the sample
image, where the stepped tunnel rings wrap around each cloud.

### Semantics

A rim object on plate k locally DEFORMS the opening field for its own plate
and every deeper plate (j ≥ k):

- Per rim object: silhouette mask on the shared grid → signed distance
  `dC(x,y)` in mm (positive outside the silhouette, negative inside; two
  chamfer DTs, the drawn-opening pattern).
- Border `B = max(2, insetPerLayerMm)` — the plate-material margin around the
  object on its own plate.
- Plate j is OPEN at (x,y) iff `f > j·inset` AND for every rim object c with
  `k_c ≤ j`: `dC_c > B + (j - k_c)·inset`. So plate k grows around the object
  with margin B („wächst um das Objekt herum"), plate k+1 wraps it one inset
  step wider, k+2 two steps, … — uniform steps, exactly like the tunnel
  itself. Plates in FRONT of k (j < k) are unaffected.
- This REPLACES the silhouette footprint union of V2-8 (the adapted opening
  subsumes it and adds the border + deeper-plate wrap).
- Consumers of openings all use the ADAPTED test: plate footprints, float
  piece clips (+ seam clearance), rand prism clips against plate k-1
  (+ seam clearance; an object's own term never applies at k-1 since terms
  require k_c ≤ j). Pegs/holes/piece emission unchanged (flat-top rule from
  the final-review fix stays).
- Multiple rim objects compose via the per-object terms (max of cuts).
- 2D preview: nested contours must show the adapted openings — new
  `window.shadowboxAdaptedOpeningLoops(doc, k)` in build-parts.js (needs
  `__renderElementV2` for silhouettes at the coarse display grid); the editor
  swaps to it and extends the contour cache key with a rim-element
  fingerprint (id, position, size, rotation, level per rim element).

### Unchanged

The object itself stays a separate printed piece one level forward
`[T, 2T]` with pegs on the plate extension and blind holes underneath.

---

## Addendum 3 (2026-07-17): Platten-Ausrichtung — Dübel durch den Stapel

User request: alignment pins/holes for the LAYERS themselves.

Design: two printed dowels through the whole stack instead of per-joint
peg/hole pairs — registers ALL plates simultaneously, avoids slicing the
parity-locked plate solids for blind holes, and the holes sit in the bottom
rim strip where the stand pocket hides them completely.

- **Holes:** two through-holes (d = `pins.diameterMm + clearanceMm`) punched
  into EVERY plate via the footprint (the mount-hole pattern), at
  `y = H - 4 mm` (bottom strip; fallback `y = 4 mm` top strip when the bottom
  yields no valid spots). Valid x positions (deterministic 1 mm scan,
  `x ∈ [6, W-6]`): decorated plate SDF ≥ holeR + 1.2 (edge/Zierkante
  clearance); base opening field `f ≤ -(holeR + 0.8)` (inside every ring —
  adapted openings only shrink, so the base field suffices); clear of every
  plate/rim element's rotated AABB (1 mm gap from the dowel SURFACE, i.e. center clearance 1 + dowelR) on any plate; clear of the back
  plate's mount hole. Pick the two valid x maximizing separation (min
  20 mm); one valid x → single dowel; none → skip silently (documented).
- **Dowels:** parts `duebel-1`/`duebel-2` (d = `pins.diameterMm`, color =
  colorBack). Length `stackH - 0.6` (0.3 mm recessed per side; stack layout:
  z `[0.3, stackH-0.3]` at the hole xy; with Explosion the length stretches
  to the exploded stack — reads as the alignment axis). Bed layout: standing
  cylinders in the pieces row.
- **Toggle:** rides `pins.enabled` (Montagestifte) — no new UI.
- Parity: pins off → no holes, no dowels (differential-tested).
