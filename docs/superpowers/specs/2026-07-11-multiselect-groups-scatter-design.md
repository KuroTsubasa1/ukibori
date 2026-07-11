# Mehrfachauswahl · Transform-Griff-Fix · verschachtelte Gruppen · Streuen — Design (2026-07-11)

## Motivation

Four editor requests, delivered as one coordinated feature set because they all
build on the same selection model:

1. **Mehrfachauswahl (multiselect).** Today only one element is selected at a time
   (`state.selectedId`). Users need to select several elements and move / align /
   transform them together.
2. **Transform-Griffe springen.** When a selected element overlaps another element
   that sits higher in the stack, grabbing the selected element's corner/rotate
   handle instead hits the *other* element's body and steals the selection. Annoying
   and frequent.
3. **Streuen (scatter).** Select one image, then generate *N* scattered copies with
   randomized position, rotation and scale.
4. **Ebenen-Gruppen (layer groups).** Group elements — nested — to organize, move,
   hide and transform them as a unit.

## Guiding principle — keep the geometry pipeline flat

The 3D/geometry/export pipeline (`js/build-parts.js`, `js/geometry.js`, export,
`thinFeatureMask`, snap) reads the flat `doc.elements` list, each element in
**absolute plate coordinates** (`cxMm/cyMm/wMm/hMm/rotationDeg/flipH/flipV`).

**Every feature below keeps that list flat and absolute.** Multiselect, groups and
scatter are *editor-layer* concepts:

- Groups are a **hierarchy overlay** (`element.groupId` + a `doc.groups` tree), not a
  literal element tree. `doc.elements` stays flat and ordered.
- Group/multiselect transforms **bake** into each member's absolute transform (there
  is no stored "group transform" that geometry would have to compose).
- `visibleDoc()` and the engine therefore stay **byte-identical**; existing
  geometry/export tests should pass unchanged and act as parity locks.

This is the deliberate risk-control decision: the user chose nested groups knowing a
literal tree would ripple through `build-parts.js` and every test; the overlay
delivers nesting without that blast radius.

## Delivery order (phased, each phase independently shippable)

**P0** Transform-Griff-Fix → **P1** Mehrfachauswahl-Basis → **P2** Transform-Box +
Ausrichten/Verteilen → **P3** verschachtelte Gruppen → **P4** Streuen.

P4 depends on P3 (scatter output is wrapped in a group). P0 is independent and ships
first.

---

## P0 — Transform-Griff-Fix (`hitTest`, js/editor.js)

**Root cause.** `hitTest(px,py)` (editor.js:946) walks `doc.elements` top→bottom and
for **each** element checks its rotate handle, corner handles **and** body. A selected
element's handle that visually sits over a higher-stacked neighbor loses: the walk
reaches the neighbor first and the point is inside the neighbor's body → returns
`{ id: neighbor, handle: "move" }`. Selection jumps.

**Fix.** Add a **priority pass** at the top of `hitTest`, before the stack walk:

- If there is an active selection, test the selection's handles first:
  - single selection → that element's rotate + 4 corner handles (existing geometry);
  - multi selection → the selection bounding-box's rotate + 4 corner handles (P2).
- If a selection handle is hit, return it immediately (`{ id, handle }` or
  `{ selection: true, handle }`).
- Only if no selection handle matches does control fall through to today's
  top→bottom element walk.

Selection handles always belong to the selection and can no longer be stolen by an
overlapping body. No data-model change. This phase is self-contained and can merge on
its own.

---

## P1 — Mehrfachauswahl-Basis (js/editor.js)

**Selection state.** Keep `state.selectedId` as the **primary** element — the
inspector (`refreshAdvancedForSelection`, `withSelected`, `selectedEl`) still edits a
single element and keeps working unchanged. Add:

- `state.selectionIds` — ordered array of all selected leaf ids; **always includes**
  the primary; length 1 in the common single-select case.

Helpers: `selectedEls()` (resolve ids→elements), `isSelected(id)`, `setSelection(ids)`
(also sets `selectedId` = last), `toggleInSelection(id)`, `clearSelection()`. Every
existing `state.selectedId = X` assignment is paired with a `setSelection([X])`
(wrap the assignment in a helper so the two never drift).

**Interactions** (canvas `pointerdown`, editor.js:1044):

- Plain click on an element → select just it (`setSelection([id])`).
- **Shift/Cmd-click** on an element → `toggleInSelection(id)`.
- **Marquee**: pointerdown on empty canvas (current "deselect") starts a rubber-band
  rectangle; on drag it selects every element whose AABB intersects the rectangle;
  plain marquee replaces the selection, Shift-marquee adds. Releasing without moving =
  clear (today's behavior).
- Esc → clear (extends the existing Escape handler).

**Collective operations** on `selectionIds`:

- **Move**: `pointerdown` with `handle === "move"` on any selected member drags the
  **whole set** — each member's `cxMm/cyMm` shifts by the same delta. Move-snap applies
  to the set's bounding box.
- **Delete** (`deleteSelected`, Entf/Backspace, toolbar) removes all selected.
- **Duplicate** (`duplicateSelected`, Cmd+D, toolbar) clones all selected (offset +4mm),
  selecting the copies.

**Layers panel**: highlight every row in `selectionIds` (extend the single `adv-sel`
class); clicking a row sets primary + selection; Shift/Cmd-click toggles.

---

## P2 — Transform-Box + Ausrichten/Verteilen (js/editor.js)

**Selection bounding box.** When `selectionIds.length >= 2`, compute the
**axis-aligned** union of members' rotated footprints (the AABB helper already used by
`viewportDomain`). Draw one selection box with 4 corner handles + a rotate handle
(reuses `drawSelection`, generalized to take a box rather than an element). Single
selection keeps today's element-aligned box exactly.

**Transform math** (drag on a box handle; `drag` records the initial box + each
member's start transform):

- **Move** (body drag): translate every member center by the drag delta.
- **Scale** (corner drag): **uniform/proportional** factor `k` from the pivot (opposite
  corner). For each member: `center = pivot + (start.center − pivot) · k`;
  `wMm = start.w · k`; `hMm = start.h · k`. Uniform-only so rotated members never shear.
- **Rotate** (rotate handle): angle θ about the box center. For each member:
  rotate `start.center` about box center by θ; `rotationDeg = start.rot + θ`.

All three **bake** into absolute member transforms — nothing is stored on the box.
`hitTest`'s priority pass (P0) already routes box-handle hits here.

**Ausrichten** (enabled when `>= 2` selected) and **Verteilen** (`>= 3`): new buttons in
the floating selection toolbar (`selToolbar`). Align L/R/T/B/center-H/center-V to the
selection bounds; distribute equal gaps H/V. Both just rewrite member `cxMm/cyMm`.

---

## P3 — Verschachtelte Gruppen (Hierarchie-Overlay)

**Model (js/bookmark-model.js), additive:**

- `element.groupId` — id of the owning group, or `null` (top level).
- `doc.groups` — `[{ id, name, collapsed, parentId }]`; `parentId` (`null` = top level)
  provides **nesting**.
- `makeElementV2` seeds `groupId: null`. `defaultDoc` seeds `groups: []`.
- **Migration** (`migrateProject`, both the v2-in-place and v1→v2 paths): backfill
  `doc.groups = []` and each `el.groupId = null` when absent. No `DOC_VERSION` bump
  (additive). `serializeProject`/`deserializeProject` need no change (plain fields).

**Ordering invariant.** A group's members occupy a **contiguous range** in
`doc.elements`; nested groups are nested contiguous ranges. This is the standard
"grouping brings members together in stacking order" behavior. All structural ops
(group / ungroup / reorder / duplicate / scatter-insert) maintain contiguity. Because
`doc.elements` stays flat + ordered, **the geometry pipeline and `visibleDoc()` are
untouched**.

**Operations (js/editor.js):**

- **Group** (`selectionIds`, ≥1): create a group record; move members contiguous
  (insert at the topmost member's position); set their `groupId`. If the selection spans
  existing groups, those groups get the new group as `parentId` = nesting.
- **Ungroup**: delete the record; reparent children (`groupId`/`parentId`) to the
  group's parent.
- **Select a group**: fills `selectionIds` with all descendant leaves (reuses the P2
  transform box); the group header is the selection's identity.
- **Visibility**: a group's eye toggles `_hidden` on all descendant leaves (geometry
  already honors `_hidden`).
- **Delete / duplicate a group**: acts on descendant leaves + records; duplicate mints
  fresh group + element ids and inserts the cloned range contiguously.

**Layers panel (`buildLayerRow`/`populateLayersList`)** becomes **recursive**: render the
group forest — collapsible group headers (caret, name, element count, eye, delete) with
indented child rows and nested sub-group headers. Drag-and-drop gains "into / out of a
group" targets (reusing the existing row DnD), always re-establishing contiguity.

## P4 — Streuen (scatter tool, js/editor.js)

**Entry.** With exactly **one** element selected, a **Streuen** action (floating
toolbar + inspector button) opens a small scatter panel.

**Region.** Drag a rectangle on the canvas to define the placement area; if none is
drawn, the whole plate is used. (New pointer sub-mode, active only while the scatter
panel is open, so it doesn't collide with marquee-select.)

**Parameters:** count *N*; rotation range `[min,max]°`; scale range `[min,max]×`
(relative to the source's `wMm/hMm`); **Überlappung vermeiden** (avoid-overlaps)
toggle; **Neu würfeln** (re-roll / new seed) button.

**Generate:** seeded RNG (stored seed → reproducible + testable). Clone the source *N*
times; each copy gets a uniform-random position inside the region and uniform-random
rotation/scale within range. With avoid-overlaps on, use **rejection sampling** against
already-placed AABBs (capped attempts; may place fewer than *N* if it can't fit, with a
note). The *N* copies are wrapped in a **new group** (P3); the source element is left
unchanged. Re-roll regenerates the preview with a new seed; **Anwenden** commits (the
group + copies become permanent), **Abbrechen** discards.

---

## Components touched

| File | Change |
| --- | --- |
| `js/editor.js` | `hitTest` priority pass (P0); `state.selectionIds` + selection helpers, marquee, Shift/Cmd-click, collective move/delete/duplicate (P1); selection-box draw + move/uniform-scale/rotate baking + align/distribute (P2); group ops + recursive layers panel + group DnD (P3); scatter panel, region drag, seeded generate, group-wrap (P4) |
| `js/bookmark-model.js` | `element.groupId`, `doc.groups`; `makeElementV2`/`defaultDoc` seeds; `migrateProject` backfill (P3) |
| `index.html` | Align/distribute buttons in `selToolbar` (P2); Streuen button + scatter panel markup (P4); group affordances in the layers dock (P3) |
| `styles.css` | Selection-box + marquee styling (P1/P2); nested group rows / caret / indent (P3); scatter panel (P4) |
| `tests/*.test.js` | see Testing |

## Testing

Headless model/unit tests alongside the existing `tests/` (Node harness), plus
Playwright for canvas pointer interactions.

- **Geometry parity (lock):** a doc with groups flattens to the **identical**
  `doc.elements` a flat doc produces → `buildParts` output byte-identical; existing
  geometry/export tests stay green untouched. Proves the pipeline is not perturbed.
- **Migration:** old v1 and v2 saves backfill `groups: []` / `groupId: null`; round-trip
  save/open preserves groups.
- **Groups:** group/ungroup maintain **contiguity** and **nesting** (parentId chains);
  group visibility toggles descendant `_hidden`; duplicate mints fresh ids.
- **Selection:** set add/remove/toggle; marquee AABB-intersection selection; primary
  stays in the set.
- **Transform box:** move/uniform-scale/rotate produce correct baked member transforms
  (pivot math; rotated-member rotation accumulation); single-select path unchanged.
- **Align/distribute:** edge/center alignment and equal-gap distribution math.
- **Scatter:** seeded determinism (same seed → same layout); all copies inside the
  region; count == *N* with overlaps allowed; avoid-overlaps places non-colliding copies
  (≤ *N*); output is one group; source untouched.
- **hitTest priority:** with a selected element overlapped by a higher-stacked neighbor,
  a click on the selected element's corner/rotate handle returns that handle, not the
  neighbor (Playwright).

## Non-goals

- **No stored group transform.** Groups don't carry their own position/rotation/scale;
  operations bake into members. (Trade-off: no "reset group scale"; floating-point drift
  on repeated rotate-back is accepted.)
- **No non-uniform group scaling** (would shear rotated members). Corner scale is
  proportional; per-axis scale remains a single-element operation.
- **No literal element tree / recursive geometry.** Nesting is an editor overlay; the
  engine keeps its flat element list.
- **No group locking**, no z-order interleaving of non-members between group members
  (contiguity is intentional).
- **No scatter-along-path / brush spray** in v1 (drawn-region placement only).
