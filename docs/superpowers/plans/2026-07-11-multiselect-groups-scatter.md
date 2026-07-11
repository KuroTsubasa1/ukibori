# Mehrfachauswahl · Transform-Griff-Fix · verschachtelte Gruppen · Streuen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multiselect (with a shared transform box, align/distribute), fix transform handles being stolen by overlapping elements, add nested layer groups, and add a scatter tool — all without changing the 3D/geometry/export pipeline.

**Architecture:** Extract pure, unit-testable logic into small new modules (`geom-util`, `selection-ops`, `transform-ops`, `align-ops`, `scatter`) plus group functions in `bookmark-model.js`; `editor.js` stays the DOM/pointer wiring layer that calls them. Groups are a **hierarchy overlay** (`element.groupId` + a `doc.groups` parentId tree) over the still-flat, still-absolute `doc.elements` list, and all group/multiselect transforms **bake** into member coordinates — so `build-parts.js`, `geometry.js`, export and their tests are untouched.

**Tech Stack:** Vanilla ES5-style JS, no build step, no framework. Sources register on `window`. Tests are browser-based: `tests/run.html` loads `tests/harness.js` (`test()`, `assert()`, `assertEqual()`, `assertClose()`) + sources + `*.test.js`, and prints `pass: N  fail: M`. Interaction logic is verified through the Playwright MCP against a locally served copy (`python3 -m http.server 8000`) using the exposed `window.editor` / `window.__editorState` / `window.__editorHitTest`.

## Global Constraints

- **No geometry/export change.** `docDomain`, `buildParts`, `visibleDoc()` output must stay byte-identical for group-free docs; existing `tests/*.test.js` must keep passing untouched. Groups/selection/scatter are editor-layer only.
- **`doc.elements` stays flat and absolute.** Each element keeps `cxMm/cyMm/wMm/hMm/rotationDeg/flipH/flipV` in plate mm. No stored group transform; group/multi transforms bake into members.
- **Additive model changes only.** `DOC_VERSION` stays `2`. New fields: `element.groupId` (default `null`), `doc.groups` (default `[]`). `migrateProject` backfills both on old saves.
- **No `package.json` / no CLI runner.** New source files must be added to BOTH `index.html` (before `js/editor.js`) and `tests/run.html` (before the test files that use them). New test files must be added to `tests/run.html`.
- **Group scaling is uniform/proportional.** Corner-drag on a multi/group box scales all members by one factor; per-axis scale stays a single-element operation.
- **German UI copy.** User-facing labels/titles in German, matching existing UI (e.g. „Gruppieren", „Streuen").
- **Registration pattern:** every pure function is attached to `window` at the bottom of its module (mirror `bookmark-model.js`).

---

## File Structure

**New pure modules (unit-tested via `tests/run.html`):**
- `js/geom-util.js` — rotated-corner geometry shared by everything: `rotatedCorners`, `elementAABB`, `aabbUnion`, `aabbsOverlap`.
- `js/selection-ops.js` — `marqueeHits(elements, rect)`.
- `js/transform-ops.js` — `selectionBBox`, `applyMove`, `applyScale`, `applyRotate`.
- `js/align-ops.js` — `alignElements`, `distributeElements`.
- `js/scatter.js` — `makeRng`, `scatterCopies`.

**Modified:**
- `js/bookmark-model.js` — group model (`makeGroup`, `groupElements`, `ungroupGroup`, `groupDescendantLeafIds`, `childGroupIds`, `flattenGroupForest`, `reindexContiguous`), field seeds, migration backfill.
- `js/editor.js` — selection state + helpers, marquee, collective ops, selection box + transform dispatch, `hitTest` priority pass, align/distribute buttons, recursive layers panel, group ops + DnD, scatter panel.
- `index.html` — new `<script>` tags; toolbar buttons (Gruppieren/Gruppierung aufheben, Ausrichten/Verteilen, Streuen); scatter panel markup.
- `styles.css` — selection box, marquee rectangle, nested group rows, scatter panel.
- `tests/run.html` — new `<script>` tags for sources + test files.
- `tests/*.test.js` — new test files per task.

**Module interface reference (locked — later tasks rely on these exact names/shapes):**

```
// js/geom-util.js
rotatedCorners(el) -> [[x,y],[x,y],[x,y],[x,y]]           // mm; el: {cxMm,cyMm,wMm,hMm,rotationDeg}
elementAABB(el)    -> {x0,y0,x1,y1}                       // mm
aabbUnion(list)    -> {x0,y0,x1,y1} | null                // list of {x0,y0,x1,y1}
aabbsOverlap(a,b)  -> boolean                             // a,b: {x0,y0,x1,y1}

// js/selection-ops.js
marqueeHits(elements, rect) -> [id,...]                   // rect {x0,y0,x1,y1}; skips el._hidden

// js/transform-ops.js   (starts: [{id,cxMm,cyMm,wMm,hMm,rotationDeg}])
selectionBBox(elements) -> {x0,y0,x1,y1}
applyMove(starts, dxMm, dyMm)        -> [{id,cxMm,cyMm,wMm,hMm,rotationDeg}]
applyScale(starts, pivot, k)         -> [{id,cxMm,cyMm,wMm,hMm,rotationDeg}]   // pivot {x,y}
applyRotate(starts, center, thetaDeg)-> [{id,cxMm,cyMm,wMm,hMm,rotationDeg}]   // center {x,y}

// js/align-ops.js
alignElements(elements, edge) -> [{id,cxMm,cyMm}]         // edge: left|right|top|bottom|centerH|centerV
distributeElements(elements, axis) -> [{id,cxMm,cyMm}]    // axis: h|v ; needs >=3

// js/scatter.js
makeRng(seed) -> () => [0,1)
scatterCopies(source, region, params, seed) -> [{cxMm,cyMm,wMm,hMm,rotationDeg}]
  // source {wMm,hMm}; region {x0,y0,x1,y1};
  // params {count,rotMin,rotMax,scaleMin,scaleMax,avoidOverlap}

// js/bookmark-model.js (additions)
makeGroup(props) -> {id,name,collapsed,parentId}
childGroupIds(doc, groupId) -> [groupId,...]
groupDescendantLeafIds(doc, groupId) -> [elementId,...]
flattenGroupForest(doc) -> [node]   // node: {type:'element',el} | {type:'group',group,children:[node]}; stacking order bottom->top
reindexContiguous(doc) -> void      // rewrites doc.elements order so each group's leaves are contiguous
groupElements(doc, elementIds) -> newGroupId | existingGroupId | null
ungroupGroup(doc, groupId) -> void
```

---

## Phase P0 — Transform-Griff-Fix

### Task 1: `hitTest` priority pass for the selected element's handles

**Files:**
- Modify: `js/editor.js` (`hitTest`, ~946-970)
- Test: Playwright MCP (uses `window.__editorHitTest`, `window.__editorState`, `window.editor.doc`)

**Interfaces:**
- Consumes: existing `elemToLocal(el,px,py,s)`, `state.scale`, `state.selectedId`.
- Produces: `hitTest` returns a selected element's handle before any other element's body.

- [ ] **Step 1: Write the failing Playwright check**

Serve and drive the app; set up two overlapping elements, select the lower one, and probe its corner handle. Save as `/private/tmp/claude-501/-Users-lharm-Dev-ukibori/976d1947-5a59-4f35-b269-e1b23a8b33af/scratchpad/p0-check.js` (a note of the steps to run via Playwright MCP):

```
// Playwright MCP steps:
// 1. browser_navigate http://localhost:8000/
// 2. browser_evaluate:
() => {
  const ed = window.editor, st = window.__editorState;
  ed.doc.elements.length = 0;
  const a = window.makeElementV2('shape', { shape:'rect', cxMm:25, cyMm:25, wMm:20, hMm:20 }); // lower (index 0)
  const b = window.makeElementV2('shape', { shape:'rect', cxMm:33, cyMm:25, wMm:20, hMm:20 }); // upper, overlaps a's NE corner
  ed.doc.elements.push(a, b);
  st.selectedId = a.id; st.selectionIds = [a.id];
  ed.render2D();
  // a's NE corner in mm is (35,15); convert to canvas px via the same mapping the app uses:
  const mmX = m => st.marginPx + (m - st.viewX0) * st.scale;
  const mmY = m => st.marginPx + (m - st.viewY0) * st.scale;
  const hit = window.__editorHitTest(mmX(35), mmY(15));
  return { hitId: hit && hit.id, handle: hit && hit.handle, aId: a.id, bId: b.id };
}
// Expected BEFORE the fix: hitId === b.id, handle === 'move'  (bug: neighbor stole it)
```

Expected: FAIL — `hitId` equals `b.id` / handle `move` (the bug), not `a.id` / `ne`.

- [ ] **Step 2: Add the priority pass at the top of `hitTest`**

In `js/editor.js`, immediately after `function hitTest(px, py) {` and the `const s = state.scale;` line, before the mount check's element loop, insert a selected-element handle probe. Replace the opening of `hitTest`:

```javascript
  function hitTest(px, py) {
    const s = state.scale;
    // Priority pass: the current selection's transform handles always win over any
    // element body, so an overlapping neighbor can't steal a scale/rotate grab.
    const selId = state.selectedId;
    if (selId != null) {
      const sel = doc.elements.find(e => e.id === selId);
      if (sel && !sel._hidden) {
        const [lx, ly] = elemToLocal(sel, px, py, s);
        const w = sel.wMm * s, h = sel.hMm * s;
        if (Math.hypot(lx, ly + h / 2 + 22) <= 9) return { id: sel.id, handle: "rotate" };
        const corners = { nw: [-w/2, -h/2], ne: [w/2, -h/2], se: [w/2, h/2], sw: [-w/2, h/2] };
        for (const k in corners) {
          if (Math.hypot(lx - corners[k][0], ly - corners[k][1]) <= 9) return { id: sel.id, handle: k };
        }
      }
    }
    // Mount marker hit (checked first — small target on top).
    const mount = doc.mount;
```

(The mount block and the top→bottom element loop that follow are unchanged.)

- [ ] **Step 3: Re-run the Playwright check**

Repeat Step 1's `browser_evaluate`.
Expected: PASS — `hitId === a.id`, `handle === 'ne'`.

- [ ] **Step 4: Run the headless test suite (regression guard)**

Playwright MCP: `browser_navigate http://localhost:8000/tests/run.html`, then `browser_evaluate: () => document.getElementById('out').textContent`.
Expected: `fail: 0` (unchanged; P0 touches no pure module).

- [ ] **Step 5: Commit**

```bash
git add js/editor.js
git commit -m "fix(auswahl): Transform-Griffe der Auswahl gewinnen gegen überlappende Elemente

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase P1 — Mehrfachauswahl-Basis

### Task 2: `js/geom-util.js` — rotated-corner geometry

**Files:**
- Create: `js/geom-util.js`
- Modify: `index.html` (add `<script>` before `js/editor.js`), `tests/run.html` (add source + test)
- Test: `tests/geom-util.test.js`

**Interfaces:**
- Produces: `rotatedCorners`, `elementAABB`, `aabbUnion`, `aabbsOverlap` (see interface reference).

- [ ] **Step 1: Write the failing test** — create `tests/geom-util.test.js`:

```javascript
"use strict";
(function () {
  test("geom: elementAABB of an unrotated element is its box", () => {
    const bb = elementAABB({ cxMm: 10, cyMm: 20, wMm: 8, hMm: 4, rotationDeg: 0 });
    assertClose(bb.x0, 6); assertClose(bb.x1, 14);
    assertClose(bb.y0, 18); assertClose(bb.y1, 22);
  });
  test("geom: elementAABB grows for a 45°-rotated square", () => {
    const bb = elementAABB({ cxMm: 0, cyMm: 0, wMm: 10, hMm: 10, rotationDeg: 45 });
    const half = Math.SQRT2 * 5; // corner distance
    assertClose(bb.x1, half, 1e-4); assertClose(bb.x0, -half, 1e-4);
  });
  test("geom: aabbUnion covers all inputs; null for empty", () => {
    assert(aabbUnion([]) === null, "empty -> null");
    const u = aabbUnion([{x0:0,y0:0,x1:2,y1:2}, {x0:3,y0:-1,x1:4,y1:1}]);
    assertClose(u.x0, 0); assertClose(u.x1, 4); assertClose(u.y0, -1); assertClose(u.y1, 2);
  });
  test("geom: aabbsOverlap true when touching-overlapping, false when apart", () => {
    assert(aabbsOverlap({x0:0,y0:0,x1:2,y1:2}, {x0:1,y0:1,x1:3,y1:3}) === true, "overlap");
    assert(aabbsOverlap({x0:0,y0:0,x1:1,y1:1}, {x0:2,y0:2,x1:3,y1:3}) === false, "apart");
  });
})();
```

- [ ] **Step 2: Register the test + (soon) source in `tests/run.html`**

Add under the `<!-- sources under test -->` group (after `bookmark-model.js`): `<script src="../js/geom-util.js"></script>`. Add under `<!-- tests -->`: `<script src="geom-util.test.js"></script>`.

- [ ] **Step 3: Run test to verify it fails**

Playwright: navigate `http://localhost:8000/tests/run.html`; read `#out`.
Expected: failures naming `elementAABB is not defined` (source not written yet).

- [ ] **Step 4: Write `js/geom-util.js`**

```javascript
"use strict";
// Pure rotated-rectangle geometry shared by selection, transform, align and scatter.
// No DOM. All coordinates in plate mm.
function rotatedCorners(el) {
  const cx = el.cxMm, cy = el.cyMm, hw = (el.wMm || 0) / 2, hh = (el.hMm || 0) / 2;
  const a = (el.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const out = [];
  const dd = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  for (let i = 0; i < 4; i++) {
    const dx = dd[i][0], dy = dd[i][1];
    out.push([cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]);
  }
  return out;
}
function elementAABB(el) {
  const c = rotatedCorners(el);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < c.length; i++) {
    if (c[i][0] < x0) x0 = c[i][0];
    if (c[i][0] > x1) x1 = c[i][0];
    if (c[i][1] < y0) y0 = c[i][1];
    if (c[i][1] > y1) y1 = c[i][1];
  }
  return { x0, y0, x1, y1 };
}
function aabbUnion(list) {
  if (!list || !list.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, y0, x1, y1 };
}
function aabbsOverlap(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}
window.rotatedCorners = rotatedCorners;
window.elementAABB = elementAABB;
window.aabbUnion = aabbUnion;
window.aabbsOverlap = aabbsOverlap;
```

- [ ] **Step 5: Run test to verify it passes**

Navigate `tests/run.html`; read `#out`. Expected: geom tests PASS, `fail: 0` overall.

- [ ] **Step 6: Add the source to `index.html`**

Insert after line `<script src="js/bookmark-model.js"></script>` (index.html:384):
`<script src="js/geom-util.js"></script>`

- [ ] **Step 7: Commit**

```bash
git add js/geom-util.js tests/geom-util.test.js tests/run.html index.html
git commit -m "feat(geom): geteilte Rotations-AABB-Helfer (geom-util)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3: `js/selection-ops.js` — marquee hit set

**Files:**
- Create: `js/selection-ops.js`
- Modify: `index.html`, `tests/run.html`
- Test: `tests/selection-ops.test.js`

**Interfaces:**
- Consumes: `elementAABB`, `aabbsOverlap` (geom-util).
- Produces: `marqueeHits(elements, rect) -> [id,...]`.

- [ ] **Step 1: Write the failing test** — `tests/selection-ops.test.js`:

```javascript
"use strict";
(function () {
  const els = [
    { id: "a", cxMm: 5,  cyMm: 5,  wMm: 4, hMm: 4, rotationDeg: 0 },
    { id: "b", cxMm: 20, cyMm: 20, wMm: 4, hMm: 4, rotationDeg: 0 },
    { id: "c", cxMm: 5,  cyMm: 20, wMm: 4, hMm: 4, rotationDeg: 0, _hidden: true },
  ];
  test("marquee: selects elements whose AABB intersects the rect", () => {
    const hit = marqueeHits(els, { x0: 0, y0: 0, x1: 10, y1: 10 });
    assertEqual(hit.length, 1); assertEqual(hit[0], "a");
  });
  test("marquee: skips hidden elements", () => {
    const hit = marqueeHits(els, { x0: 0, y0: 15, x1: 10, y1: 25 });
    assertEqual(hit.length, 0, "c is hidden");
  });
  test("marquee: a wide rect grabs multiple", () => {
    const hit = marqueeHits(els, { x0: 0, y0: 0, x1: 30, y1: 30 });
    assertEqual(hit.length, 2); // a and b (c hidden)
  });
})();
```

- [ ] **Step 2: Register in `tests/run.html`** — add `<script src="../js/selection-ops.js"></script>` (after `geom-util.js`) and `<script src="selection-ops.test.js"></script>`.

- [ ] **Step 3: Run to verify it fails** — navigate `tests/run.html`; expect `marqueeHits is not defined`.

- [ ] **Step 4: Write `js/selection-ops.js`**

```javascript
"use strict";
// Pure selection helpers. No DOM.
function marqueeHits(elements, rect) {
  const out = [];
  for (let i = 0; i < (elements || []).length; i++) {
    const el = elements[i];
    if (el._hidden) continue;
    if (aabbsOverlap(elementAABB(el), rect)) out.push(el.id);
  }
  return out;
}
window.marqueeHits = marqueeHits;
```

- [ ] **Step 5: Run to verify it passes** — expect `fail: 0`.

- [ ] **Step 6: Add to `index.html`** after `js/geom-util.js`: `<script src="js/selection-ops.js"></script>`.

- [ ] **Step 7: Commit**

```bash
git add js/selection-ops.js tests/selection-ops.test.js tests/run.html index.html
git commit -m "feat(auswahl): marqueeHits — Rahmenauswahl-Trefferset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 4: Selection state = primary + set (editor.js)

**Files:**
- Modify: `js/editor.js` (`state` init ~30-38; `selectedEl`/`withSelected` ~139-152; every `state.selectedId =` assignment; `buildLayerRow` highlight ~2023)
- Test: Playwright MCP

**Interfaces:**
- Produces: `state.selectionIds` (array, includes primary); `setSelection(ids)`, `isSelected(id)`, `toggleInSelection(id)`, `selectedEls()`, `clearSelection()`.
- Consumes: none new.

- [ ] **Step 1: Add `selectionIds` to state**

In the `state` object (editor.js:30-38), add after `selectedId: null,`:

```javascript
    selectionIds: [],
```

- [ ] **Step 2: Add selection helpers** after `selectedEl()` (editor.js:141):

```javascript
  // Multiselect: selectionIds is the full set; selectedId stays the PRIMARY (inspector target).
  function setSelection(ids) {
    state.selectionIds = (ids || []).slice();
    state.selectedId = state.selectionIds.length ? state.selectionIds[state.selectionIds.length - 1] : null;
  }
  function clearSelection() { setSelection([]); }
  function isSelected(id) { return state.selectionIds.indexOf(id) !== -1; }
  function toggleInSelection(id) {
    const i = state.selectionIds.indexOf(id);
    if (i === -1) state.selectionIds.push(id); else state.selectionIds.splice(i, 1);
    state.selectedId = state.selectionIds.length ? state.selectionIds[state.selectionIds.length - 1] : null;
  }
  function selectedEls() {
    return state.selectionIds.map(function (id) { return doc.elements.find(function (e) { return e.id === id; }); }).filter(Boolean);
  }
```

- [ ] **Step 3: Route every selection assignment through the helpers**

Replace each `state.selectedId = X;` with `setSelection([X]);` and each `state.selectedId = null;` with `clearSelection();` at these sites (verify with `grep -n "state.selectedId =" js/editor.js`):
- `pointerdown` hit (~1060): `setSelection([hit.id]);`
- `addImageFromDataURL` (~1242), `addTextAction` (~1807), `addShapeAction` (~1832), `addQrAction` (~1868): `setSelection([el.id]);`
- `selectByIndex` (~1271): `setSelection([els[idx].id]);`
- Tab/Enter/Escape deselect sites (~1291,1296,1310), `deleteSelected` (~2680), `resetDocTo` (~2842): `clearSelection();`
- `duplicateElement` (~2698): `setSelection([copy.id]);`
- The empty-canvas `pointerdown` deselect (~1049): leave for Task 5 (marquee replaces it).

- [ ] **Step 4: Highlight the whole set in the layers panel**

In `buildLayerRow` (editor.js:2023), replace:

```javascript
    if (el.id === state.selectedId) li.classList.add("adv-sel");
```
with:
```javascript
    if (isSelected(el.id)) li.classList.add("adv-sel");
```

And in the row `click` handler (editor.js:2130-2136), support additive click:

```javascript
    li.addEventListener("click", function (e) {
      if (e.target.classList.contains("adv-lbtn")) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) toggleInSelection(el.id);
      else setSelection([el.id]);
      refreshAdvancedForSelection();
      renderLayers();
      render2D();
    });
```

- [ ] **Step 5: Verify via Playwright**

Navigate `http://localhost:8000/`; `browser_evaluate`:
```
() => {
  const ed = window.editor, st = window.__editorState;
  ed.doc.elements.length = 0;
  const a = window.makeElementV2('shape',{shape:'rect',cxMm:15,cyMm:15,wMm:8,hMm:8});
  const b = window.makeElementV2('shape',{shape:'rect',cxMm:35,cyMm:15,wMm:8,hMm:8});
  ed.doc.elements.push(a,b); window.__editorState.selectionIds=[]; window.__editorState.selectedId=null;
  ed.renderLayers();
  // simulate the selection helpers directly:
  window.__editorState.selectionIds = [a.id, b.id]; window.__editorState.selectedId = b.id;
  ed.renderLayers();
  return { count: document.querySelectorAll('#advLayers .adv-sel').length };
}
```
Expected: `count === 2` (both rows highlighted).

- [ ] **Step 6: Run headless suite** — `tests/run.html` → `fail: 0` (no pure module changed).

- [ ] **Step 7: Commit**

```bash
git add js/editor.js
git commit -m "feat(auswahl): Auswahl-Set (selectionIds) neben primärer Auswahl

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 5: Marquee + Shift-click + collective move/delete/duplicate (editor.js)

**Files:**
- Modify: `js/editor.js` (`pointerdown` ~1044, `pointermove` ~1127, `endDrag` ~1192, `render2D` ~880, `deleteSelected` ~2675, `duplicateSelected` ~2704)
- Test: Playwright MCP

**Interfaces:**
- Consumes: `marqueeHits`, `setSelection`, `toggleInSelection`, `isSelected`, `selectedEls`, `state.selectionIds`.
- Produces: marquee drag, additive click, group-move drag, collective delete/duplicate.

- [ ] **Step 1: Shift-click + marquee start in `pointerdown`**

Replace the top of the canvas `pointerdown` handler (editor.js:1044-1049) through the no-hit branch:

```javascript
  cv.addEventListener("pointerdown", function (e) {
    const rect = cv.getBoundingClientRect();
    const scaleC = cv.width / rect.width;
    const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
    const hit = hitTest(px, py);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!hit) {
      // Empty canvas: start a marquee (rubber-band) selection.
      drag = { handle: "marquee", px, py, additive, base: additive ? state.selectionIds.slice() : [] };
      if (!additive) clearSelection();
      cv.setPointerCapture(e.pointerId);
      refreshAdvancedForSelection(); renderAdvancedLayers(); render2D();
      return;
    }
```

Then, before `state.selectedId = hit.id;` (now the selection block ~1060), insert additive/group handling and replace that line:

```javascript
    if (hit.handle === "move") {
      if (additive) { toggleInSelection(hit.id); refreshAdvancedForSelection(); renderAdvancedLayers(); render2D(); return; }
      if (!isSelected(hit.id)) setSelection([hit.id]);   // clicking an unselected body selects just it
      // else: keep the existing multi-selection so a group-move drag can begin
    } else {
      setSelection([hit.id]);                            // a handle grab always focuses that element
    }
    const el = doc.elements.find(el => el.id === hit.id);
    drag = {
      handle: hit.handle, px, py,
      start: { cx: el.cxMm, cy: el.cyMm, w: el.wMm, h: el.hMm, rot: el.rotationDeg || 0 },
      // Snapshot every selected member for a group move.
      starts: selectedEls().map(function (m) { return { id: m.id, cxMm: m.cxMm, cyMm: m.cyMm, wMm: m.wMm, hMm: m.hMm, rotationDeg: m.rotationDeg || 0 }; }),
    };
    cv.setPointerCapture(e.pointerId);
    refreshAdvancedForSelection(); renderAdvancedLayers(); render2D();
  });
```

- [ ] **Step 2: Marquee + group-move in `pointermove`**

In the `pointermove` handler (editor.js:1127), add a marquee branch right after the `if (!drag) return;` and the px/py computation, before the mount branch:

```javascript
    if (drag.handle === "marquee") {
      const rectMm = {
        x0: Math.min((drag.px - state.marginPx) / s + state.viewX0, (px - state.marginPx) / s + state.viewX0),
        x1: Math.max((drag.px - state.marginPx) / s + state.viewX0, (px - state.marginPx) / s + state.viewX0),
        y0: Math.min((drag.py - state.marginPx) / s + state.viewY0, (py - state.marginPx) / s + state.viewY0),
        y1: Math.max((drag.py - state.marginPx) / s + state.viewY0, (py - state.marginPx) / s + state.viewY0),
      };
      drag.rectPx = { x0: Math.min(drag.px, px), y0: Math.min(drag.py, py), x1: Math.max(drag.px, px), y1: Math.max(drag.py, py) };
      const hits = window.marqueeHits(doc.elements, rectMm);
      setSelection(drag.additive ? drag.base.concat(hits.filter(function (id) { return drag.base.indexOf(id) === -1; })) : hits);
      refreshAdvancedForSelection(); renderAdvancedLayers(); render2D();
      return;
    }
```

Then change the single-element move branch (editor.js:1168-1171) to move the whole set when >1 is selected:

```javascript
    if (drag.handle === "move") {
      const dx = (px - drag.px) / s, dy = (py - drag.py) / s;
      if (drag.starts && drag.starts.length > 1) {
        drag.starts.forEach(function (st0) {           // inline (no applyMove dependency yet)
          const m = doc.elements.find(function (x) { return x.id === st0.id; });
          if (m) { m.cxMm = st0.cxMm + dx; m.cyMm = st0.cyMm + dy; }
        });
      } else {
        el.cxMm = drag.start.cx + dx;
        el.cyMm = drag.start.cy + dy;
        applyMoveSnap(el);
      }
    } else if (drag.handle === "rotate") {
```

(The multi-move loop is inlined here so Task 5 has no forward dependency on Task 6. Once the multi-selection box exists (Task 8), clicking inside it returns a `{box:true, handle:"move"}` hit that goes through the box-move path instead, so this branch is only exercised in Phases P1–P2 interim — correct throughout.)

- [ ] **Step 3: Draw the marquee rectangle in `render2D`**

In `render2D`, just before `drawThinOverlay(ctx);` (editor.js:911), add:

```javascript
    if (drag && drag.handle === "marquee" && drag.rectPx) {
      ctx.save();
      ctx.strokeStyle = "#6b4fb0"; ctx.fillStyle = "rgba(107,79,176,0.10)";
      ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      const r = drag.rectPx;
      ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
    }
```

No `endDrag` change is needed: it already sets `drag = null` and calls `render2D()`, and the marquee rectangle only draws while `drag` is a live marquee (the `render2D` guard is `drag && ...`), so it disappears on release.

- [ ] **Step 4: Collective delete + duplicate**

Replace `deleteSelected` (editor.js:2675-2685):

```javascript
  function deleteSelected() {
    const ids = state.selectionIds.slice();
    if (!ids.length) return;
    doc.elements = doc.elements.filter(function (e) { return ids.indexOf(e.id) === -1; });
    clearSelection();
    refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
  }
```

Replace `duplicateSelected` (editor.js:2704):

```javascript
  function duplicateSelected() {
    const els = selectedEls();
    if (!els.length) return;
    if (els.length === 1) { duplicateElement(els[0]); return; }
    const copies = [];
    els.forEach(function (el) {
      const drop = { _img: 1, _display: 1, _displayKey: 1, _hidden: 1, id: 1 };
      const props = JSON.parse(JSON.stringify(el, function (k, v) { return drop[k] ? undefined : v; }));
      const copy = window.makeElementV2(el.type, props);
      copy._img = el._img || null; copy.groupId = null;
      copy.cxMm = el.cxMm + 4; copy.cyMm = el.cyMm + 4;
      doc.elements.push(copy); copies.push(copy.id);
    });
    setSelection(copies);
    refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
  }
```

- [ ] **Step 5: Verify via Playwright**

Navigate `http://localhost:8000/`; `browser_evaluate` to set two elements, then simulate a marquee covering both by directly invoking the math path is complex — instead assert the collective ops:
```
() => {
  const ed = window.editor, st = window.__editorState;
  ed.doc.elements.length = 0;
  const a = window.makeElementV2('shape',{shape:'rect',cxMm:15,cyMm:15,wMm:8,hMm:8});
  const b = window.makeElementV2('shape',{shape:'rect',cxMm:35,cyMm:15,wMm:8,hMm:8});
  ed.doc.elements.push(a,b);
  const hits = window.marqueeHits(ed.doc.elements, {x0:0,y0:0,x1:50,y1:50});
  return { hits: hits.length, total: ed.doc.elements.length };
}
```
Expected: `hits === 2`. Then manually (Playwright pointer): drag on empty canvas across both → both rows gain `.adv-sel`; press Delete → `ed.doc.elements.length === 0`.

- [ ] **Step 6: Run headless suite** — `tests/run.html` → `fail: 0`.

- [ ] **Step 7: Commit**

```bash
git add js/editor.js
git commit -m "feat(auswahl): Rahmenauswahl, Shift-Klick, Sammel-Verschieben/Löschen/Duplizieren

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase P2 — Transform-Box + Ausrichten/Verteilen

### Task 6: `js/transform-ops.js` — box math

**Files:**
- Create: `js/transform-ops.js`
- Modify: `index.html`, `tests/run.html`
- Test: `tests/transform-ops.test.js`

**Interfaces:**
- Consumes: `elementAABB`, `aabbUnion` (geom-util).
- Produces: `selectionBBox`, `applyMove`, `applyScale`, `applyRotate` (see reference).

- [ ] **Step 1: Write the failing test** — `tests/transform-ops.test.js`:

```javascript
"use strict";
(function () {
  const starts = [
    { id: "a", cxMm: 0,  cyMm: 0, wMm: 4, hMm: 4, rotationDeg: 0 },
    { id: "b", cxMm: 10, cyMm: 0, wMm: 4, hMm: 4, rotationDeg: 0 },
  ];
  test("transform: selectionBBox unions members", () => {
    const bb = selectionBBox(starts);
    assertClose(bb.x0, -2); assertClose(bb.x1, 12); assertClose(bb.y0, -2); assertClose(bb.y1, 2);
  });
  test("transform: applyMove shifts every center", () => {
    const u = applyMove(starts, 5, -3);
    assertClose(u[0].cxMm, 5); assertClose(u[0].cyMm, -3);
    assertClose(u[1].cxMm, 15); assertClose(u[1].cyMm, -3);
  });
  test("transform: applyScale is uniform about a pivot", () => {
    const u = applyScale(starts, { x: 0, y: 0 }, 2);
    assertClose(u[0].cxMm, 0);  assertClose(u[0].wMm, 8);
    assertClose(u[1].cxMm, 20); assertClose(u[1].hMm, 8);
  });
  test("transform: applyRotate rotates centers and accumulates rotationDeg", () => {
    const u = applyRotate(starts, { x: 0, y: 0 }, 90);
    // b at (10,0) rotates 90° CCW-in-math about origin -> (0,10) in this y-down space it's (0,10) via [x' = x cos - y sin, y' = x sin + y cos]
    assertClose(u[1].cxMm, 0, 1e-4); assertClose(u[1].cyMm, 10, 1e-4);
    assertEqual(u[1].rotationDeg, 90);
  });
})();
```

- [ ] **Step 2: Register in `tests/run.html`** — add `<script src="../js/transform-ops.js"></script>` (after selection-ops) and `<script src="transform-ops.test.js"></script>`.

- [ ] **Step 3: Run to verify it fails** — expect `selectionBBox is not defined`.

- [ ] **Step 4: Write `js/transform-ops.js`**

```javascript
"use strict";
// Pure multiselect/group transform math. Each function takes an array of "start"
// snapshots {id,cxMm,cyMm,wMm,hMm,rotationDeg} and returns updated snapshots.
function selectionBBox(elements) {
  return aabbUnion((elements || []).map(elementAABB));
}
function applyMove(starts, dxMm, dyMm) {
  return (starts || []).map(function (s) {
    return { id: s.id, cxMm: s.cxMm + dxMm, cyMm: s.cyMm + dyMm, wMm: s.wMm, hMm: s.hMm, rotationDeg: s.rotationDeg };
  });
}
function applyScale(starts, pivot, k) {
  return (starts || []).map(function (s) {
    return {
      id: s.id,
      cxMm: pivot.x + (s.cxMm - pivot.x) * k,
      cyMm: pivot.y + (s.cyMm - pivot.y) * k,
      wMm: Math.max(2, s.wMm * k), hMm: Math.max(2, s.hMm * k),
      rotationDeg: s.rotationDeg,
    };
  });
}
function applyRotate(starts, center, thetaDeg) {
  const a = thetaDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return (starts || []).map(function (s) {
    const dx = s.cxMm - center.x, dy = s.cyMm - center.y;
    return {
      id: s.id,
      cxMm: center.x + dx * ca - dy * sa,
      cyMm: center.y + dx * sa + dy * ca,
      wMm: s.wMm, hMm: s.hMm,
      rotationDeg: s.rotationDeg + thetaDeg,
    };
  });
}
window.selectionBBox = selectionBBox;
window.applyMove = applyMove;
window.applyScale = applyScale;
window.applyRotate = applyRotate;
```

- [ ] **Step 5: Run to verify it passes** — `tests/run.html` → `fail: 0`.

- [ ] **Step 6: Add to `index.html`** after `js/selection-ops.js`: `<script src="js/transform-ops.js"></script>`.

- [ ] **Step 7: Commit**

```bash
git add js/transform-ops.js tests/transform-ops.test.js tests/run.html index.html
git commit -m "feat(transform): Auswahl-Box-Mathematik (Verschieben/Skalieren/Drehen)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 7: `js/align-ops.js` — align + distribute

**Files:**
- Create: `js/align-ops.js`
- Modify: `index.html`, `tests/run.html`
- Test: `tests/align-ops.test.js`

**Interfaces:**
- Consumes: `elementAABB`, `aabbUnion`.
- Produces: `alignElements(elements, edge)`, `distributeElements(elements, axis)`.

- [ ] **Step 1: Write the failing test** — `tests/align-ops.test.js`:

```javascript
"use strict";
(function () {
  const mk = (id, cx, cy) => ({ id, cxMm: cx, cyMm: cy, wMm: 4, hMm: 4, rotationDeg: 0 });
  test("align: left snaps every element's left edge to the group's left", () => {
    const u = alignElements([mk("a", 10, 0), mk("b", 20, 5)], "left");
    // group x0 = 8 (a's left). Each element half-width 2 -> center x = 10.
    assertClose(u[0].cxMm, 10); assertClose(u[1].cxMm, 10);
  });
  test("align: centerV aligns vertical centers to the group's mid-y", () => {
    const u = alignElements([mk("a", 0, 0), mk("b", 0, 10)], "centerV");
    assertClose(u[0].cyMm, 5); assertClose(u[1].cyMm, 5);
  });
  test("distribute: h gives equal gaps, ends fixed", () => {
    const u = distributeElements([mk("a", 0, 0), mk("b", 3, 0), mk("c", 20, 0)], "h");
    // ends a(0) and c(20) fixed; total width 3*4=12; free space 20-(-2)-(20+2)... gap-based:
    // spans: a[-2,2] c[18,22]; inner b width 4; gap = ((18)-(2) - 4)/2 = 5 -> b span [7,11] -> center 9
    assertClose(u[1].cxMm, 9);
  });
})();
```

- [ ] **Step 2: Register in `tests/run.html`** — `<script src="../js/align-ops.js"></script>` + `<script src="align-ops.test.js"></script>`.

- [ ] **Step 3: Run to verify it fails** — expect `alignElements is not defined`.

- [ ] **Step 4: Write `js/align-ops.js`**

```javascript
"use strict";
// Pure align/distribute. Operate on rotated AABBs; return new centers only.
function alignElements(elements, edge) {
  const boxes = elements.map(function (el) { return { el: el, bb: elementAABB(el) }; });
  const g = aabbUnion(boxes.map(function (b) { return b.bb; }));
  const gcx = (g.x0 + g.x1) / 2, gcy = (g.y0 + g.y1) / 2;
  return boxes.map(function (b) {
    const bcx = (b.bb.x0 + b.bb.x1) / 2, bcy = (b.bb.y0 + b.bb.y1) / 2;
    let dx = 0, dy = 0;
    if (edge === "left") dx = g.x0 - b.bb.x0;
    else if (edge === "right") dx = g.x1 - b.bb.x1;
    else if (edge === "top") dy = g.y0 - b.bb.y0;
    else if (edge === "bottom") dy = g.y1 - b.bb.y1;
    else if (edge === "centerH") dx = gcx - bcx;
    else if (edge === "centerV") dy = gcy - bcy;
    return { id: b.el.id, cxMm: b.el.cxMm + dx, cyMm: b.el.cyMm + dy };
  });
}
function distributeElements(elements, axis) {
  const key = axis === "v" ? "y" : "x";
  const boxes = elements.map(function (el) {
    const bb = elementAABB(el);
    return { el: el, bb: bb, lo: bb[key + "0"], hi: bb[key + "1"], size: bb[key + "1"] - bb[key + "0"] };
  });
  boxes.sort(function (p, q) { return (p.lo + p.hi) / 2 - (q.lo + q.hi) / 2; });
  if (boxes.length < 3) return boxes.map(function (b) { return { id: b.el.id, cxMm: b.el.cxMm, cyMm: b.el.cyMm }; });
  const first = boxes[0], last = boxes[boxes.length - 1];
  let inner = 0; for (let i = 1; i < boxes.length - 1; i++) inner += boxes[i].size;
  const span = last.lo - first.hi;               // free run between the fixed ends
  const gap = (span - inner) / (boxes.length - 1);
  let cursor = first.hi + gap;
  const out = {};
  for (let i = 1; i < boxes.length - 1; i++) {
    const b = boxes[i];
    const newLo = cursor, delta = newLo - b.lo;
    out[b.el.id] = delta;
    cursor = newLo + b.size + gap;
  }
  return boxes.map(function (b) {
    const d = out[b.el.id] || 0;
    return {
      id: b.el.id,
      cxMm: b.el.cxMm + (axis === "v" ? 0 : d),
      cyMm: b.el.cyMm + (axis === "v" ? d : 0),
    };
  });
}
window.alignElements = alignElements;
window.distributeElements = distributeElements;
```

- [ ] **Step 5: Run to verify it passes** — `tests/run.html` → `fail: 0`.

- [ ] **Step 6: Add to `index.html`** after `js/transform-ops.js`: `<script src="js/align-ops.js"></script>`.

- [ ] **Step 7: Commit**

```bash
git add js/align-ops.js tests/align-ops.test.js tests/run.html index.html
git commit -m "feat(anordnen): Ausrichten/Verteilen-Mathematik (align-ops)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 8: Multi-selection box draw + transform dispatch (editor.js)

**Files:**
- Modify: `js/editor.js` (`render2D` selection block ~885-887; `drawSelection` ~763; `hitTest` priority pass from Task 1; `pointerdown` ~1060; `pointermove` scale/rotate ~1172-1188)
- Test: Playwright MCP

**Interfaces:**
- Consumes: `selectionBBox`, `applyScale`, `applyRotate`, `applyMove`; `state.selectionIds`.
- Produces: a drawn multi-box with handles routed through the transform-ops.

- [ ] **Step 1: Draw a box for the multi-selection**

Replace the selection-handles block in `render2D` (editor.js:885-887):

```javascript
    // Selection handles on top.
    const selEls = selectedEls();
    if (selEls.length === 1) {
      drawSelection(ctx, selEls[0], s);
    } else if (selEls.length > 1) {
      drawSelectionBox(ctx, window.selectionBBox(selEls), s);
    }
```

- [ ] **Step 2: Add `drawSelectionBox`** after `drawSelection` (editor.js:778):

```javascript
  // Axis-aligned box + handles for a multi-selection (mm bbox -> canvas px).
  function drawSelectionBox(ctx, bb, s) {
    if (!bb) return;
    const x0 = mmX(bb.x0), y0 = mmY(bb.y0), x1 = mmX(bb.x1), y1 = mmY(bb.y1);
    ctx.save();
    ctx.strokeStyle = "#6b4fb0"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = "#6b4fb0";
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(function (c) {
      ctx.beginPath(); ctx.rect(c[0] - 5, c[1] - 5, 10, 10); ctx.fill();
    });
    const mx = (x0 + x1) / 2;
    ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y0 - 22); ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, y0 - 22, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
```

- [ ] **Step 3: Extend the `hitTest` priority pass to the multi-box**

In `hitTest` (the priority block added in Task 1), before the `if (selId != null)` single-element block, add a multi-box probe:

```javascript
    // Multi-selection: the box's own handles take priority.
    if (state.selectionIds.length > 1) {
      const bb = window.selectionBBox(selectedEls());
      if (bb) {
        const x0 = mmX(bb.x0), y0 = mmY(bb.y0), x1 = mmX(bb.x1), y1 = mmY(bb.y1);
        const mx = (x0 + x1) / 2;
        if (Math.hypot(px - mx, py - (y0 - 22)) <= 9) return { box: true, handle: "rotate" };
        const corners = { nw: [x0, y0], ne: [x1, y0], se: [x1, y1], sw: [x0, y1] };
        for (const k in corners) {
          if (Math.hypot(px - corners[k][0], py - corners[k][1]) <= 9) return { box: true, handle: k };
        }
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return { box: true, handle: "move" };
      }
    }
```

- [ ] **Step 4: Start a box drag in `pointerdown`**

In `pointerdown`, right after computing `hit` and `additive`, handle a box hit before the no-hit branch:

```javascript
    if (hit && hit.box) {
      const bb = window.selectionBBox(selectedEls());
      drag = {
        handle: hit.handle, box: true, px, py, bb: bb,
        center: { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 },
        pivot: hit.handle === "nw" ? { x: bb.x1, y: bb.y1 } : hit.handle === "ne" ? { x: bb.x0, y: bb.y1 }
             : hit.handle === "se" ? { x: bb.x0, y: bb.y0 } : { x: bb.x1, y: bb.y0 },
        starts: selectedEls().map(function (m) { return { id: m.id, cxMm: m.cxMm, cyMm: m.cyMm, wMm: m.wMm, hMm: m.hMm, rotationDeg: m.rotationDeg || 0 }; }),
      };
      cv.setPointerCapture(e.pointerId);
      render2D();
      return;
    }
```

- [ ] **Step 5: Box transform in `pointermove`**

At the very top of the `pointermove` body (after px/py, before the marquee/mount branches), add:

```javascript
    if (drag && drag.box) {
      const applyUpdates = function (ups) {
        ups.forEach(function (u) {
          const m = doc.elements.find(function (x) { return x.id === u.id; });
          if (!m) return;
          m.cxMm = u.cxMm; m.cyMm = u.cyMm;
          if (u.wMm != null) m.wMm = u.wMm;
          if (u.hMm != null) m.hMm = u.hMm;
          if (u.rotationDeg != null) m.rotationDeg = u.rotationDeg;
        });
      };
      if (drag.handle === "move") {
        applyUpdates(window.applyMove(drag.starts, (px - drag.px) / s, (py - drag.py) / s));
      } else if (drag.handle === "rotate") {
        const cxpx = mmX(drag.center.x), cypx = mmY(drag.center.y);
        const theta = (Math.atan2(py - cypx, px - cxpx) - Math.atan2(drag.py - cypx, drag.px - cxpx)) * 180 / Math.PI;
        applyUpdates(window.applyRotate(drag.starts, drag.center, theta));
      } else {
        // corner: uniform factor = current pivot->cursor distance / pivot->start-corner distance
        const pivPx = { x: mmX(drag.pivot.x), y: mmY(drag.pivot.y) };
        const startD = Math.hypot(drag.px - pivPx.x, drag.py - pivPx.y) || 1;
        const nowD = Math.hypot(px - pivPx.x, py - pivPx.y);
        applyUpdates(window.applyScale(drag.starts, drag.pivot, Math.max(0.05, nowD / startD)));
      }
      render2D();
      return;
    }
```

- [ ] **Step 6: Verify via Playwright**

Navigate `http://localhost:8000/`; set two elements + `selectionIds` of both, then probe the box handle:
```
() => {
  const ed = window.editor, st = window.__editorState;
  ed.doc.elements.length = 0;
  const a = window.makeElementV2('shape',{shape:'rect',cxMm:10,cyMm:10,wMm:6,hMm:6});
  const b = window.makeElementV2('shape',{shape:'rect',cxMm:30,cyMm:10,wMm:6,hMm:6});
  ed.doc.elements.push(a,b); st.selectionIds=[a.id,b.id]; st.selectedId=b.id; ed.render2D();
  const bb = window.selectionBBox([a,b]);
  const mmX = m => st.marginPx + (m - st.viewX0)*st.scale, mmY = m => st.marginPx + (m - st.viewY0)*st.scale;
  const hit = window.__editorHitTest(mmX(bb.x1), mmY(bb.y1)); // SE corner of the box
  return { box: hit && hit.box, handle: hit && hit.handle };
}
```
Expected: `{ box: true, handle: 'se' }`.

- [ ] **Step 7: Run headless suite** — `tests/run.html` → `fail: 0`.

- [ ] **Step 8: Commit**

```bash
git add js/editor.js
git commit -m "feat(transform): Auswahl-Box mit einheitlichem Skalieren + Drehen für Mehrfachauswahl

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 9: Align/distribute toolbar buttons (editor.js + index.html)

**Files:**
- Modify: `index.html` (`selToolbar` ~173-181), `js/editor.js` (toolbar wiring ~2755-2764; `refreshAdvancedForSelection` toolbar visibility ~2227-2232), `styles.css`
- Test: Playwright MCP

**Interfaces:**
- Consumes: `alignElements`, `distributeElements`, `selectedEls`.
- Produces: 6 align + 2 distribute buttons acting on the selection.

- [ ] **Step 1: Add buttons to `selToolbar`** — insert before `selDelBtn` in index.html:

```html
      <span class="tb-sep" data-multi></span>
      <button type="button" id="selAlignL" class="tb-multi" title="Links ausrichten">⇤</button>
      <button type="button" id="selAlignCH" class="tb-multi" title="Horizontal zentrieren (Auswahl)">↔</button>
      <button type="button" id="selAlignR" class="tb-multi" title="Rechts ausrichten">⇥</button>
      <button type="button" id="selAlignT" class="tb-multi" title="Oben ausrichten">⤒</button>
      <button type="button" id="selAlignCV" class="tb-multi" title="Vertikal zentrieren (Auswahl)">↕</button>
      <button type="button" id="selAlignB" class="tb-multi" title="Unten ausrichten">⤓</button>
      <button type="button" id="selDistH" class="tb-multi" title="Horizontal verteilen">⇹</button>
      <button type="button" id="selDistV" class="tb-multi" title="Vertikal verteilen">⤡</button>
```

- [ ] **Step 2: Wire the buttons** — in the floating-toolbar IIFE (editor.js:2755-2764), add:

```javascript
    function applyLayout(fn) {
      const els = selectedEls();
      if (els.length < 2) return;
      fn(els).forEach(function (u) {
        const m = doc.elements.find(function (x) { return x.id === u.id; });
        if (m) { if (u.cxMm != null) m.cxMm = u.cxMm; if (u.cyMm != null) m.cyMm = u.cyMm; }
      });
      refreshAdvancedForSelection(); render2D(); scheduleRebuild3D();
    }
    wire("selAlignL",  function () { applyLayout(function (e) { return window.alignElements(e, "left"); }); });
    wire("selAlignR",  function () { applyLayout(function (e) { return window.alignElements(e, "right"); }); });
    wire("selAlignT",  function () { applyLayout(function (e) { return window.alignElements(e, "top"); }); });
    wire("selAlignB",  function () { applyLayout(function (e) { return window.alignElements(e, "bottom"); }); });
    wire("selAlignCH", function () { applyLayout(function (e) { return window.alignElements(e, "centerH"); }); });
    wire("selAlignCV", function () { applyLayout(function (e) { return window.alignElements(e, "centerV"); }); });
    wire("selDistH",   function () { applyLayout(function (e) { return window.distributeElements(e, "h"); }); });
    wire("selDistV",   function () { applyLayout(function (e) { return window.distributeElements(e, "v"); }); });
```

- [ ] **Step 3: Show multi-only buttons only when >1 selected** — in `refreshAdvancedForSelection` (editor.js ~2227), after the `selToolbar` hidden toggle, add:

```javascript
    var multi = state.selectionIds.length > 1;
    document.querySelectorAll("#selToolbar .tb-multi, #selToolbar [data-multi]").forEach(function (n) { n.hidden = !multi; });
    var dist = state.selectionIds.length >= 3;
    var dH = document.getElementById("selDistH"), dV = document.getElementById("selDistV");
    if (dH) dH.disabled = !dist; if (dV) dV.disabled = !dist;
```

- [ ] **Step 4: Style** — append to `styles.css`:

```css
#selToolbar .tb-sep { width:1px; height:18px; background:var(--line, #d9d2c4); display:inline-block; margin:0 3px; }
#selToolbar .tb-multi[disabled] { opacity:.4; cursor:default; }
```

- [ ] **Step 5: Verify via Playwright** — select 3 elements, click `#selDistH`, confirm the middle element's `cxMm` changed to an equal-gap position (compare to `window.distributeElements` output).

- [ ] **Step 6: Run headless suite** — `tests/run.html` → `fail: 0`.

- [ ] **Step 7: Commit**

```bash
git add js/editor.js index.html styles.css
git commit -m "feat(anordnen): Ausrichten/Verteilen-Knöpfe in der Auswahl-Toolbar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase P3 — Verschachtelte Gruppen

### Task 10: Group model fields + migration (bookmark-model.js)

**Files:**
- Modify: `js/bookmark-model.js` (`defaultDoc` ~91-125; `makeElementV2` ~220-232; `migrateProject` both paths ~159-215; `migrateElement` ~147-157)
- Test: `tests/groups-model.test.js`

**Interfaces:**
- Produces: `element.groupId` (default null), `doc.groups` (default []), `makeGroup(props)`.

- [ ] **Step 1: Write the failing test** — `tests/groups-model.test.js`:

```javascript
"use strict";
(function () {
  test("groups: defaultDoc has empty groups; makeElementV2 seeds groupId null", () => {
    const d = defaultDoc();
    assert(Array.isArray(d.groups) && d.groups.length === 0, "groups []");
    assert(makeElementV2("text", {}).groupId === null, "groupId null");
  });
  test("groups: makeGroup shape", () => {
    const g = makeGroup({ name: "X" });
    assert(typeof g.id === "string", "id");
    assertEqual(g.name, "X"); assertEqual(g.collapsed, false); assertEqual(g.parentId, null);
  });
  test("groups: migration backfills groups[] and groupId on old saves", () => {
    const d = defaultDoc();
    d.elements = [makeElementV2("text", {})];
    delete d.groups; delete d.elements[0].groupId; // pre-feature save
    const m = migrateProject(JSON.parse(serializeProject(d)));
    assert(Array.isArray(m.groups), "groups restored");
    assert(m.elements[0].groupId === null, "groupId restored");
  });
})();
```

- [ ] **Step 2: Register in `tests/run.html`** — `<script src="groups-model.test.js"></script>` (bookmark-model.js is already loaded there).

- [ ] **Step 3: Run to verify it fails** — expect `makeGroup is not defined` / `groups` undefined.

- [ ] **Step 4: Implement the model changes**

In `defaultDoc()` return object (bookmark-model.js ~123), change `elements: [], fonts: {},` to:
```javascript
    elements: [], groups: [], fonts: {},
```
In `makeElementV2` base `Object.assign` (bookmark-model.js ~221-226), add `groupId: null,` after `cutout: false, color: "#000000",`.

Add the factory near `makeElementV2` (after line ~232):
```javascript
function makeGroup(props) {
  return Object.assign({ id: __nextId(), name: "Gruppe", collapsed: false, parentId: null }, props || {});
}
```
In `migrateElement` (bookmark-model.js ~147-152), add `groupId: el.groupId != null ? el.groupId : null,` to the `out` object.
In `migrateProject` v2-in-place path (after line ~172), add:
```javascript
    if (!Array.isArray(doc.groups)) doc.groups = [];
```
and inside the `for (const el of doc.elements || [])` loop (~173), add:
```javascript
      if (el.groupId === undefined) el.groupId = null;
```
In the v1→v2 return object (~189-214), add `groups: [],` next to `fonts: doc.fonts || {},`.

At the bottom `window.*` exports, add: `window.makeGroup = makeGroup;`

- [ ] **Step 5: Run to verify it passes** — `tests/run.html` → group-model tests PASS, `fail: 0`.

- [ ] **Step 6: Commit**

```bash
git add js/bookmark-model.js tests/groups-model.test.js tests/run.html
git commit -m "feat(gruppen): Modellfelder groupId/groups + Migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 11: Group operations — nesting + contiguity (bookmark-model.js)

**Files:**
- Modify: `js/bookmark-model.js` (add functions after `makeGroup`; export)
- Test: `tests/groups-ops.test.js`

**Interfaces:**
- Consumes: `makeGroup`.
- Produces: `childGroupIds`, `groupDescendantLeafIds`, `flattenGroupForest`, `reindexContiguous`, `groupElements`, `ungroupGroup`.

- [ ] **Step 1: Write the failing test** — `tests/groups-ops.test.js`:

```javascript
"use strict";
(function () {
  function docWith(ids) {
    const d = defaultDoc();
    d.elements = ids.map(function (id) { const e = makeElementV2("shape", { shape: "rect" }); e.id = id; return e; });
    return d;
  }
  const orderIds = function (d) { return d.elements.map(function (e) { return e.id; }).join(""); };

  test("groups: groupElements sets groupId and keeps members contiguous", () => {
    const d = docWith(["a", "b", "c", "d"]);
    const gid = groupElements(d, ["a", "c"]);
    const a = d.elements.find(e => e.id === "a"), c = d.elements.find(e => e.id === "c");
    assertEqual(a.groupId, gid); assertEqual(c.groupId, gid);
    // a and c must be adjacent in doc.elements now
    const ids = d.elements.map(e => e.id);
    assert(Math.abs(ids.indexOf("a") - ids.indexOf("c")) === 1, "contiguous: " + ids.join(","));
  });

  test("groups: grouping two full groups nests them under a new parent", () => {
    const d = docWith(["a", "b", "c", "d"]);
    const g1 = groupElements(d, ["a", "b"]);
    const g2 = groupElements(d, ["c", "d"]);
    const parent = groupElements(d, ["a", "b", "c", "d"]);
    const G1 = d.groups.find(g => g.id === g1), G2 = d.groups.find(g => g.id === g2);
    assertEqual(G1.parentId, parent); assertEqual(G2.parentId, parent);
    // leaves still belong to their own groups (nesting, not flattening)
    assertEqual(d.elements.find(e => e.id === "a").groupId, g1);
  });

  test("groups: descendant leaves resolve through nested groups", () => {
    const d = docWith(["a", "b", "c"]);
    const g1 = groupElements(d, ["a", "b"]);
    const parent = groupElements(d, ["a", "b", "c"]);
    const leaves = groupDescendantLeafIds(d, parent).sort().join("");
    assertEqual(leaves, "abc");
  });

  test("groups: ungroup reparents children to the group's parent", () => {
    const d = docWith(["a", "b", "c"]);
    const g1 = groupElements(d, ["a", "b"]);
    const parent = groupElements(d, ["a", "b", "c"]);
    ungroupGroup(d, parent);
    assert(!d.groups.find(g => g.id === parent), "parent gone");
    assertEqual(d.groups.find(g => g.id === g1).parentId, null, "g1 back to top");
  });

  test("groups: flattenGroupForest reflects the hierarchy in stacking order", () => {
    const d = docWith(["a", "b", "c"]);
    const g1 = groupElements(d, ["a", "b"]);
    const forest = flattenGroupForest(d);
    // top level: one group (g1) + element c, both present
    const kinds = forest.map(n => n.type).sort().join(",");
    assertEqual(kinds, "element,group");
    const grp = forest.find(n => n.type === "group");
    assertEqual(grp.children.length, 2);
  });
})();
```

- [ ] **Step 2: Register in `tests/run.html`** — `<script src="groups-ops.test.js"></script>`.

- [ ] **Step 3: Run to verify it fails** — expect `groupElements is not defined`.

- [ ] **Step 4: Implement the group operations** — after `makeGroup` in bookmark-model.js:

```javascript
function childGroupIds(doc, groupId) {
  return (doc.groups || []).filter(function (g) { return String(g.parentId) === String(groupId); }).map(function (g) { return g.id; });
}
function groupDescendantLeafIds(doc, groupId) {
  var out = [];
  (doc.elements || []).forEach(function (e) { if (String(e.groupId) === String(groupId)) out.push(e.id); });
  childGroupIds(doc, groupId).forEach(function (cg) { groupDescendantLeafIds(doc, cg).forEach(function (id) { out.push(id); }); });
  return out;
}
function flattenGroupForest(doc) {
  var els = doc.elements || [], groups = doc.groups || [];
  var idxOf = {}; els.forEach(function (e, i) { idxOf[String(e.id)] = i; });
  var groupById = {}; groups.forEach(function (g) { groupById[String(g.id)] = g; });
  var memo = {};
  function groupMinIdx(gid) {
    if (memo[gid] != null) return memo[gid];
    var m = Infinity;
    els.forEach(function (e) { if (String(e.groupId) === String(gid)) m = Math.min(m, idxOf[String(e.id)]); });
    childGroupIds(doc, gid).forEach(function (cg) { m = Math.min(m, groupMinIdx(cg)); });
    memo[gid] = m; return m;
  }
  function build(gid) {
    var kids = [];
    els.forEach(function (e) { if (String(e.groupId) === String(gid)) kids.push({ type: "element", el: e, _idx: idxOf[String(e.id)] }); });
    childGroupIds(doc, gid).forEach(function (cg) { kids.push({ type: "group", group: groupById[String(cg)], children: build(cg), _idx: groupMinIdx(cg) }); });
    kids.sort(function (a, b) { return a._idx - b._idx; });
    kids.forEach(function (k) { delete k._idx; });
    return kids;
  }
  var top = [];
  els.forEach(function (e) { if (e.groupId == null) top.push({ type: "element", el: e, _idx: idxOf[String(e.id)] }); });
  groups.forEach(function (g) { if (g.parentId == null) top.push({ type: "group", group: g, children: build(g.id), _idx: groupMinIdx(g.id) }); });
  top.sort(function (a, b) { return a._idx - b._idx; });
  top.forEach(function (k) { delete k._idx; });
  return top;
}
function reindexContiguous(doc) {
  var order = [];
  (function walk(nodes) { nodes.forEach(function (n) { if (n.type === "element") order.push(n.el); else walk(n.children); }); })(flattenGroupForest(doc));
  (doc.elements || []).forEach(function (e) { if (order.indexOf(e) === -1) order.push(e); });
  doc.elements = order;
}
function __outermostSelected(doc, elId, idset) {
  var el = (doc.elements || []).find(function (e) { return String(e.id) === String(elId); });
  var node = { kind: "element", id: elId };
  var gid = el ? el.groupId : null;
  while (gid != null) {
    var leaves = groupDescendantLeafIds(doc, gid);
    if (leaves.length && leaves.every(function (id) { return idset[String(id)]; })) {
      node = { kind: "group", id: gid };
      var g = (doc.groups || []).find(function (x) { return String(x.id) === String(gid); });
      gid = g ? g.parentId : null;
    } else break;
  }
  return node;
}
function groupElements(doc, elementIds) {
  if (!doc || !elementIds || !elementIds.length) return null;
  var idset = {}; elementIds.forEach(function (id) { idset[String(id)] = 1; });
  var items = [], seen = {};
  elementIds.forEach(function (id) {
    var it = __outermostSelected(doc, id, idset);
    var key = it.kind + ":" + it.id;
    if (!seen[key]) { seen[key] = 1; items.push(it); }
  });
  if (items.length === 0) return null;
  if (items.length === 1 && items[0].kind === "group") return items[0].id; // already a group
  var g = makeGroup({ name: "Gruppe", parentId: null });
  if (!doc.groups) doc.groups = [];
  doc.groups.push(g);
  items.forEach(function (it) {
    if (it.kind === "element") {
      var el = doc.elements.find(function (e) { return String(e.id) === String(it.id); });
      if (el) el.groupId = g.id;
    } else {
      var cg = doc.groups.find(function (x) { return String(x.id) === String(it.id); });
      if (cg) cg.parentId = g.id;
    }
  });
  reindexContiguous(doc);
  return g.id;
}
function ungroupGroup(doc, groupId) {
  var g = (doc.groups || []).find(function (x) { return String(x.id) === String(groupId); });
  if (!g) return;
  var parent = g.parentId;
  (doc.elements || []).forEach(function (e) { if (String(e.groupId) === String(groupId)) e.groupId = parent; });
  childGroupIds(doc, groupId).forEach(function (cg) { var c = doc.groups.find(function (x) { return String(x.id) === String(cg); }); if (c) c.parentId = parent; });
  doc.groups = doc.groups.filter(function (x) { return String(x.id) !== String(groupId); });
  reindexContiguous(doc);
}
```

Add exports at the bottom:
```javascript
window.childGroupIds = childGroupIds;
window.groupDescendantLeafIds = groupDescendantLeafIds;
window.flattenGroupForest = flattenGroupForest;
window.reindexContiguous = reindexContiguous;
window.groupElements = groupElements;
window.ungroupGroup = ungroupGroup;
```

- [ ] **Step 5: Run to verify it passes** — `tests/run.html` → groups-ops tests PASS, `fail: 0`.

- [ ] **Step 6: Commit**

```bash
git add js/bookmark-model.js tests/groups-ops.test.js tests/run.html
git commit -m "feat(gruppen): Gruppieren/Aufheben mit Verschachtelung + Kontiguität

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 12: Geometry-invariance parity lock (test only)

**Files:**
- Test: `tests/groups-parity.test.js`
- Modify: `tests/run.html`

**Interfaces:**
- Consumes: `buildParts`, `groupElements`, model factories.
- Produces: a locking test proving groups don't change engine output.

- [ ] **Step 1: Write the parity test** — `tests/groups-parity.test.js`:

```javascript
"use strict";
// Grouping is an editor overlay: buildParts must produce byte-identical output
// whether or not elements are grouped (the engine reads flat doc.elements).
(function () {
  function baseDoc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 50; d.body.thicknessMm = 2;
    d.body.baseColor = "#ffffff"; d.resolution = 160; d.autoLayerHeights = false;
    d.mount = { type: "none", xMm: 25, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    const a = makeElementV2("shape", { shape: "rect", cxMm: 18, cyMm: 20, wMm: 12, hMm: 8, color: "#000000" });
    const b = makeElementV2("shape", { shape: "circle", cxMm: 34, cyMm: 30, wMm: 10, hMm: 10, color: "#000000" });
    a.depth.direction = "raised"; b.depth.direction = "raised";
    a.id = "a"; b.id = "b"; d.elements = [a, b];
    return d;
  }
  function sig(parts) {
    return parts.map(p => p.name + ":" + p.facets.length).join("|");
  }
  test("groups: buildParts output is identical grouped vs ungrouped", () => {
    const flat = baseDoc();
    const grouped = baseDoc();
    groupElements(grouped, ["a", "b"]);
    assert(grouped.groups.length === 1, "grouped has a group");
    assertEqual(sig(buildParts(grouped)), sig(buildParts(flat)));
  });
})();
```

- [ ] **Step 2: Register in `tests/run.html`** — `<script src="groups-parity.test.js"></script>`.

- [ ] **Step 3: Run to verify it passes** — `tests/run.html` → parity test PASS, `fail: 0`. (If it fails, groups perturbed ordering — fix `reindexContiguous` before proceeding.)

- [ ] **Step 4: Commit**

```bash
git add tests/groups-parity.test.js tests/run.html
git commit -m "test(gruppen): Parität — buildParts unverändert mit/ohne Gruppen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 13: Recursive layers panel + group/ungroup + group selection/visibility (editor.js + index.html)

**Files:**
- Modify: `js/editor.js` (`populateLayersList` ~2185-2198; new `buildGroupHeader`; `renderLayers` ~2202; group/ungroup wiring; group-select fills `selectionIds`), `index.html` (Gruppieren/Aufheben buttons), `styles.css`
- Test: Playwright MCP

**Interfaces:**
- Consumes: `flattenGroupForest`, `groupElements`, `ungroupGroup`, `groupDescendantLeafIds`, `setSelection`, `selectedEls`.
- Produces: nested layer rows; group selection; group hide; group delete.

- [ ] **Step 1: Add Gruppieren/Aufheben buttons** — in `selToolbar` (index.html), after the `data-multi` separator:

```html
      <button type="button" id="selGroupBtn" class="tb-multi" title="Gruppieren (Strg/Cmd+G)">▣</button>
      <button type="button" id="selUngroupBtn" title="Gruppierung aufheben (Strg/Cmd+Shift+G)">▢</button>
```

- [ ] **Step 2: Render the forest recursively** — replace `populateLayersList` (editor.js:2185-2198):

```javascript
  function renderForestNodes(list, nodes, depth) {
    // nodes are bottom->top; the panel shows topmost first, so iterate reversed.
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      if (n.type === "element") {
        list.appendChild(buildLayerRow(doc.elements.indexOf(n.el), depth));
      } else {
        list.appendChild(buildGroupHeader(n.group, depth));
        if (!n.group.collapsed) renderForestNodes(list, n.children, depth + 1);
      }
    }
  }
  function populateLayersList(list, empty) {
    if (!list) return;
    list.innerHTML = "";
    var els = doc.elements;
    if (!els || els.length === 0) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    renderForestNodes(list, window.flattenGroupForest(doc), 0);
  }
```

- [ ] **Step 3: Add `buildGroupHeader`** — before `populateLayersList`:

```javascript
  function buildGroupHeader(group, depth) {
    var li = document.createElement("li");
    li.className = "adv-group-head";
    li.style.paddingLeft = (6 + depth * 14) + "px";
    var leafIds = window.groupDescendantLeafIds(doc, group.id);
    var allSel = leafIds.length && leafIds.every(function (id) { return isSelected(id); });
    if (allSel) li.classList.add("adv-sel");

    var caret = document.createElement("button");
    caret.className = "adv-lbtn"; caret.textContent = group.collapsed ? "▸" : "▾"; caret.title = "Ein-/Ausklappen";
    caret.addEventListener("click", function (e) { e.stopPropagation(); group.collapsed = !group.collapsed; renderLayers(); });

    var name = document.createElement("span");
    name.className = "adv-lname"; name.textContent = group.name + " (" + leafIds.length + ")";
    name.title = "Doppelklick zum Umbenennen";
    name.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      var v = prompt("Gruppenname:", group.name);
      if (v != null && v.trim()) { group.name = v.trim(); renderLayers(); }
    });

    var anyHidden = leafIds.some(function (id) { var el = doc.elements.find(function (x) { return x.id === id; }); return el && el._hidden; });
    var vis = document.createElement("button");
    vis.className = "adv-lbtn"; vis.innerHTML = anyHidden ? ICONS.eyeOff : ICONS.eye; vis.title = anyHidden ? "Einblenden" : "Ausblenden";
    vis.addEventListener("click", function (e) {
      e.stopPropagation();
      leafIds.forEach(function (id) { var el = doc.elements.find(function (x) { return x.id === id; }); if (el) el._hidden = !anyHidden; });
      renderLayers(); render2D(); scheduleRebuild3D();
    });

    var del = document.createElement("button");
    del.className = "adv-lbtn"; del.innerHTML = ICONS.trash; del.title = "Gruppe löschen";
    del.addEventListener("click", function (e) {
      e.stopPropagation();
      // Delete the whole subtree: descendant leaves AND every descendant group record.
      var groupIds = [group.id];
      (function collect(gid) { window.childGroupIds(doc, gid).forEach(function (cg) { groupIds.push(cg); collect(cg); }); })(group.id);
      doc.elements = doc.elements.filter(function (el) { return leafIds.indexOf(el.id) === -1; });
      doc.groups = doc.groups.filter(function (g) { return groupIds.indexOf(g.id) === -1; });
      setSelection([]); refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
    });

    li.addEventListener("click", function (e) {
      if (e.target.classList.contains("adv-lbtn")) return;
      setSelection(leafIds);
      refreshAdvancedForSelection(); renderLayers(); render2D();
    });

    li.append(caret, name, vis, del);
    return li;
  }
```

- [ ] **Step 4: Let `buildLayerRow` accept a depth indent** — change its signature (editor.js:2020) to `function buildLayerRow(i, depth)` and after `var li = document.createElement("li");` add:

```javascript
    if (depth) li.style.paddingLeft = (6 + depth * 14) + "px";
```

- [ ] **Step 5: Wire group/ungroup buttons + shortcuts**

Define `doGroup`/`doUngroup` at **editor-function scope** (e.g. just after `duplicateSelected`, editor.js ~2704) so both the toolbar wiring and the keydown handler can see them:

```javascript
  function doGroup() {
    if (state.selectionIds.length < 2) return;
    var gid = window.groupElements(doc, state.selectionIds.slice());
    if (gid) { setSelection(window.groupDescendantLeafIds(doc, gid)); refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D(); }
  }
  function doUngroup() {
    var els = selectedEls(), gids = {};
    els.forEach(function (el) { if (el.groupId != null) gids[el.groupId] = 1; });
    Object.keys(gids).forEach(function (gid) { window.ungroupGroup(doc, gid); });
    refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
  }
```

Inside the existing floating-toolbar IIFE (editor.js ~2757, where `wire` is defined), add:

```javascript
    wire("selGroupBtn", doGroup);
    wire("selUngroupBtn", doUngroup);
```

And add a keydown at editor scope, near the existing Cmd+D handler (editor.js ~2705):

```javascript
  window.addEventListener("keydown", function (e) {
    if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== "g") return;
    var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
    e.preventDefault();
    if (e.shiftKey) doUngroup(); else doGroup();
  });
```

- [ ] **Step 6: Style nested rows** — append to `styles.css`:

```css
.adv-group-head { display:flex; align-items:center; gap:6px; font-weight:600; opacity:.95; }
.adv-group-head .adv-lname { flex:1; }
```

- [ ] **Step 7: Verify via Playwright** — navigate app; create two elements; set `selectionIds` to both; click `#selGroupBtn`; assert `window.editor.doc.groups.length === 1` and the panel shows one `.adv-group-head` with two indented rows; click the header → both element rows get `.adv-sel`.

- [ ] **Step 8: Run headless suite** — `tests/run.html` → `fail: 0`.

- [ ] **Step 9: Commit**

```bash
git add js/editor.js index.html styles.css
git commit -m "feat(gruppen): verschachteltes Ebenen-Panel, Gruppieren/Aufheben, Gruppen-Auswahl/Sichtbarkeit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 14: Group drag-into/out-of + group duplicate (editor.js)

**Files:**
- Modify: `js/editor.js` (row DnD `drop` ~2114-2128; add group-header drop targets; `duplicateSelected` group awareness)
- Test: Playwright MCP

**Interfaces:**
- Consumes: `reindexContiguous`, `groupDescendantLeafIds`, group records.
- Produces: dropping a row onto a group header assigns membership; group duplicate clones records + members.

- [ ] **Step 1: Assign membership on drop onto a group header** — in `buildGroupHeader` (Task 13), make the header a drop target by adding before `return li;`:

```javascript
    li.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; li.classList.add("drag-over"); });
    li.addEventListener("dragleave", function () { li.classList.remove("drag-over"); });
    li.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation(); li.classList.remove("drag-over");
      var fromId = e.dataTransfer.getData("text/plain");
      var el = doc.elements.find(function (x) { return String(x.id) === fromId; });
      if (!el) return;
      el.groupId = group.id;                 // join this group
      window.reindexContiguous(doc);
      renderLayers(); render2D(); scheduleRebuild3D();
    });
```

- [ ] **Step 2: Allow dropping to top level** — in the existing element-row `drop` handler (editor.js:2114-2128), after computing the reorder, preserve the dragged element's `groupId` as the drop target's `groupId` so cross-group drags reassign membership. Replace the body of that `drop` listener's reorder section with:

```javascript
      var moved = doc.elements.splice(from, 1)[0];
      moved.groupId = el.groupId != null ? el.groupId : null;  // adopt the target row's group
      doc.elements.splice(to, 0, moved);
      window.reindexContiguous(doc);
      renderLayers(); render2D(); scheduleRebuild3D();
```

- [ ] **Step 3: Group-aware duplicate** — extend `duplicateSelected` (from Task 5) so a duplicated multi-selection that shares a single group is re-wrapped in a fresh group. After the `setSelection(copies);` line, before the re-render, insert:

```javascript
    var srcGroups = {}; els.forEach(function (el) { if (el.groupId != null) srcGroups[el.groupId] = 1; });
    if (Object.keys(srcGroups).length === 1) {
      var gid = window.groupElements(doc, copies);
      if (gid) setSelection(window.groupDescendantLeafIds(doc, gid));
    }
```

- [ ] **Step 4: Verify via Playwright** — create a group of 2 + a loose element; drag the loose row onto the group header; assert its `groupId` equals the group id and `flattenGroupForest` shows 3 children; duplicate the group → `doc.groups.length === 2`, copies form their own group.

- [ ] **Step 5: Run headless suite** — `tests/run.html` → `fail: 0`.

- [ ] **Step 6: Commit**

```bash
git add js/editor.js
git commit -m "feat(gruppen): Ziehen in/aus Gruppen + Gruppen-Duplikat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase P4 — Streuen (scatter)

### Task 15: `js/scatter.js` — seeded scatter generator

**Files:**
- Create: `js/scatter.js`
- Modify: `index.html`, `tests/run.html`
- Test: `tests/scatter.test.js`

**Interfaces:**
- Consumes: `elementAABB`, `aabbsOverlap`.
- Produces: `makeRng(seed)`, `scatterCopies(source, region, params, seed)`.

- [ ] **Step 1: Write the failing test** — `tests/scatter.test.js`:

```javascript
"use strict";
(function () {
  const source = { wMm: 6, hMm: 6 };
  const region = { x0: 0, y0: 0, x1: 40, y1: 40 };
  const params = { count: 8, rotMin: 0, rotMax: 90, scaleMin: 0.5, scaleMax: 1.5, avoidOverlap: false };

  test("scatter: makeRng is deterministic for a seed", () => {
    const r1 = makeRng(42), r2 = makeRng(42);
    assertClose(r1(), r2(), 0);
    assertClose(r1(), r2(), 0);
  });
  test("scatter: same seed -> identical layout", () => {
    const a = scatterCopies(source, region, params, 7);
    const b = scatterCopies(source, region, params, 7);
    assertEqual(a.length, b.length);
    for (let i = 0; i < a.length; i++) { assertClose(a[i].cxMm, b[i].cxMm, 0); assertClose(a[i].rotationDeg, b[i].rotationDeg, 0); }
  });
  test("scatter: places exactly count and stays in region (overlaps allowed)", () => {
    const out = scatterCopies(source, region, params, 3);
    assertEqual(out.length, 8);
    out.forEach(c => {
      assert(c.cxMm >= region.x0 && c.cxMm <= region.x1, "cx in region");
      assert(c.cyMm >= region.y0 && c.cyMm <= region.y1, "cy in region");
      assert(c.rotationDeg >= 0 && c.rotationDeg <= 90, "rot in range");
      const k = c.wMm / source.wMm; assert(k >= 0.5 - 1e-9 && k <= 1.5 + 1e-9, "scale in range");
    });
  });
  test("scatter: avoid-overlaps yields non-overlapping boxes (<= count)", () => {
    const out = scatterCopies(source, region, Object.assign({}, params, { avoidOverlap: true, count: 6 }), 11);
    assert(out.length <= 6, "at most count");
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      assert(!aabbsOverlap(elementAABB(out[i]), elementAABB(out[j])), "no overlap " + i + "," + j);
    }
  });
})();
```

- [ ] **Step 2: Register in `tests/run.html`** — `<script src="../js/scatter.js"></script>` (after align-ops) + `<script src="scatter.test.js"></script>`.

- [ ] **Step 3: Run to verify it fails** — expect `makeRng is not defined`.

- [ ] **Step 4: Write `js/scatter.js`**

```javascript
"use strict";
// Pure seeded scatter. No DOM. Depends on geom-util (elementAABB, aabbsOverlap).
function makeRng(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function scatterCopies(source, region, params, seed) {
  var rng = makeRng(seed);
  var count = params.count, avoid = !!params.avoidOverlap;
  var maxAttempts = Math.max(count * 25, 200);
  var rw = region.x1 - region.x0, rh = region.y1 - region.y0;
  var out = [], placed = [], attempts = 0;
  while (out.length < count && attempts < maxAttempts) {
    attempts++;
    var k = params.scaleMin + rng() * (params.scaleMax - params.scaleMin);
    var cand = {
      cxMm: region.x0 + rng() * rw,
      cyMm: region.y0 + rng() * rh,
      wMm: source.wMm * k, hMm: source.hMm * k,
      rotationDeg: Math.round(params.rotMin + rng() * (params.rotMax - params.rotMin)),
    };
    if (avoid) {
      var box = elementAABB(cand);
      var clash = false;
      for (var i = 0; i < placed.length; i++) { if (aabbsOverlap(box, placed[i])) { clash = true; break; } }
      if (clash) continue;
      placed.push(box);
    }
    out.push(cand);
  }
  return out;
}
window.makeRng = makeRng;
window.scatterCopies = scatterCopies;
```

- [ ] **Step 5: Run to verify it passes** — `tests/run.html` → scatter tests PASS, `fail: 0`.

- [ ] **Step 6: Add to `index.html`** after `js/align-ops.js`: `<script src="js/scatter.js"></script>`.

- [ ] **Step 7: Commit**

```bash
git add js/scatter.js tests/scatter.test.js tests/run.html index.html
git commit -m "feat(streuen): geseedeter Streu-Generator (scatter)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 16: Scatter panel + region drag + apply (editor.js + index.html)

**Files:**
- Modify: `index.html` (Streuen button in `selToolbar`; scatter panel markup near `snapPopover`), `js/editor.js` (scatter state, region drag sub-mode in pointer handlers, panel wiring, generate/apply/cancel), `styles.css`
- Test: Playwright MCP

**Interfaces:**
- Consumes: `scatterCopies`, `makeElementV2`, `groupElements`, `groupDescendantLeafIds`, `setSelection`.
- Produces: a scatter workflow that appends a grouped set of randomized copies of the selected element.

- [ ] **Step 1: Add the Streuen button + panel** — in `selToolbar` (index.html) add:

```html
      <button type="button" id="selScatterBtn" title="Streuen">✳</button>
```

And after the `snapPopover` block (search `id="snapPopover"` in index.html), add a sibling panel:

```html
    <div id="scatterPanel" class="popover" hidden>
      <div class="pop-row"><strong>Streuen</strong></div>
      <label class="pop-row">Anzahl <input id="scCount" type="number" min="1" max="200" value="12"></label>
      <label class="pop-row">Drehung° <input id="scRotMin" type="number" value="0"> – <input id="scRotMax" type="number" value="360"></label>
      <label class="pop-row">Skalierung× <input id="scScaleMin" type="number" step="0.1" value="0.6"> – <input id="scScaleMax" type="number" step="0.1" value="1.4"></label>
      <label class="pop-row"><input id="scAvoid" type="checkbox"> Überlappung vermeiden</label>
      <p class="hint" id="scHint">Ziehe auf der Fläche einen Bereich auf (sonst ganze Platte).</p>
      <div class="pop-row">
        <button type="button" id="scReroll" class="btn">Neu würfeln</button>
        <button type="button" id="scApply" class="btn btn-primary">Anwenden</button>
        <button type="button" id="scCancel" class="btn">Abbrechen</button>
      </div>
    </div>
```

- [ ] **Step 2: Add scatter state + open/close** — near the top of the editor IIFE state (after `state` definition), add module-locals:

```javascript
  var scatter = null; // { sourceId, region:{x0,y0,x1,y1}|null, seed, previewIds:[] }
```

And a helper set (place beside the other UI helpers, e.g. after `duplicateSelected`):

```javascript
  function scatterOpen() {
    var el = selectedEl();
    if (!el || state.selectionIds.length !== 1) return;
    scatter = { sourceId: el.id, region: null, seed: (Date.now() >>> 0), previewIds: [] };
    var p = document.getElementById("scatterPanel"); if (p) p.hidden = false;
    scatterGenerate();
  }
  function scatterClose(commit) {
    var p = document.getElementById("scatterPanel"); if (p) p.hidden = true;
    if (scatter && !commit) scatterClearPreview();
    scatter = null;
    render2D(); scheduleRebuild3D();
  }
  function scatterClearPreview() {
    if (!scatter) return;
    doc.elements = doc.elements.filter(function (e) { return scatter.previewIds.indexOf(e.id) === -1; });
    scatter.previewIds = [];
  }
  function scatterParams() {
    var num = function (id, d) { var n = document.getElementById(id); var v = n ? parseFloat(n.value) : NaN; return isNaN(v) ? d : v; };
    return {
      count: Math.max(1, Math.round(num("scCount", 12))),
      rotMin: num("scRotMin", 0), rotMax: num("scRotMax", 360),
      scaleMin: num("scScaleMin", 0.6), scaleMax: num("scScaleMax", 1.4),
      avoidOverlap: !!(document.getElementById("scAvoid") && document.getElementById("scAvoid").checked),
    };
  }
  function scatterGenerate() {
    if (!scatter) return;
    scatterClearPreview();
    var src = doc.elements.find(function (e) { return e.id === scatter.sourceId; });
    if (!src) return;
    var region = scatter.region || { x0: 0, y0: 0, x1: doc.body.widthMm, y1: doc.body.heightMm };
    var transforms = window.scatterCopies({ wMm: src.wMm, hMm: src.hMm }, region, scatterParams(), scatter.seed);
    var ids = [];
    transforms.forEach(function (t) {
      var drop = { _img: 1, _display: 1, _displayKey: 1, _hidden: 1, id: 1 };
      var props = JSON.parse(JSON.stringify(src, function (k, v) { return drop[k] ? undefined : v; }));
      var copy = window.makeElementV2(src.type, props);
      copy._img = src._img || null; copy.groupId = null;
      copy.cxMm = t.cxMm; copy.cyMm = t.cyMm; copy.wMm = t.wMm; copy.hMm = t.hMm; copy.rotationDeg = t.rotationDeg;
      doc.elements.push(copy); ids.push(copy.id);
    });
    scatter.previewIds = ids;
    render2D(); scheduleRebuild3D();
  }
```

- [ ] **Step 3: Region drag sub-mode** — in `pointerdown`, at the very top (before `hitTest`), intercept when the scatter panel is active:

```javascript
    if (scatter) {
      const rect0 = cv.getBoundingClientRect(), sc0 = cv.width / rect0.width;
      const px0 = (e.clientX - rect0.left) * sc0, py0 = (e.clientY - rect0.top) * sc0;
      drag = { handle: "scatterRegion", px: px0, py: py0 };
      cv.setPointerCapture(e.pointerId);
      return;
    }
```

In `pointermove`, add a branch (near the marquee branch):

```javascript
    if (drag && drag.handle === "scatterRegion") {
      const toMm = function (p, base, v0) { return (p - state.marginPx) / s + v0; };
      scatter.region = {
        x0: Math.min(toMm(drag.px, 0, state.viewX0), toMm(px, 0, state.viewX0)),
        x1: Math.max(toMm(drag.px, 0, state.viewX0), toMm(px, 0, state.viewX0)),
        y0: Math.min(toMm(drag.py, 0, state.viewY0), toMm(py, 0, state.viewY0)),
        y1: Math.max(toMm(drag.py, 0, state.viewY0), toMm(py, 0, state.viewY0)),
      };
      drag.rectPx = { x0: Math.min(drag.px, px), y0: Math.min(drag.py, py), x1: Math.max(drag.px, px), y1: Math.max(drag.py, py) };
      render2D();
      return;
    }
```

In `endDrag`, after `drag` is captured but before `drag = null;`, regenerate if it was a region drag:

```javascript
    var wasScatter = drag && drag.handle === "scatterRegion";
```
and after `drag = null;` add:
```javascript
    if (wasScatter && scatter) scatterGenerate();
```

Reuse the marquee rectangle drawing in `render2D` by also drawing `drag.rectPx` when `drag.handle === "scatterRegion"` — extend the marquee condition (Task 5, Step 3) to `if (drag && (drag.handle === "marquee" || drag.handle === "scatterRegion") && drag.rectPx)`.

- [ ] **Step 4: Wire the panel buttons** — in a new IIFE near the other wiring:

```javascript
  (function () {
    var wire = function (id, fn) { var n = document.getElementById(id); if (n) n.addEventListener("click", fn); };
    wire("selScatterBtn", scatterOpen);
    wire("scReroll", function () { if (scatter) { scatter.seed = (Date.now() >>> 0); scatterGenerate(); } });
    wire("scApply", function () {
      if (!scatter || !scatter.previewIds.length) { scatterClose(false); return; }
      var gid = window.groupElements(doc, scatter.previewIds.slice());
      var ids = gid ? window.groupDescendantLeafIds(doc, gid) : scatter.previewIds.slice();
      scatter.previewIds = []; // keep them (committed)
      scatterClose(true);
      setSelection(ids); refreshAdvancedForSelection(); renderLayers(); render2D(); scheduleRebuild3D();
    });
    wire("scCancel", function () { scatterClose(false); refreshAdvancedForSelection(); renderLayers(); });
    ["scCount","scRotMin","scRotMax","scScaleMin","scScaleMax"].forEach(function (id) {
      var n = document.getElementById(id); if (n) n.addEventListener("input", function () { if (scatter) scatterGenerate(); });
    });
    var av = document.getElementById("scAvoid"); if (av) av.addEventListener("change", function () { if (scatter) scatterGenerate(); });
  }());
```

- [ ] **Step 5: Show Streuen only for a single selection** — in `refreshAdvancedForSelection`, near the multi toggle (Task 9 Step 3), add:

```javascript
    var scBtn = document.getElementById("selScatterBtn");
    if (scBtn) scBtn.hidden = state.selectionIds.length !== 1;
```

- [ ] **Step 6: Style** — append to `styles.css`:

```css
#scatterPanel .pop-row { display:flex; gap:6px; align-items:center; margin:4px 0; }
#scatterPanel input[type=number] { width:56px; }
```

- [ ] **Step 7: Verify via Playwright**

Navigate app; add one image/shape; select it; `browser_evaluate` to open + generate deterministically:
```
() => {
  const ed = window.editor, st = window.__editorState;
  ed.doc.elements.length = 0; ed.doc.groups.length = 0;
  const src = window.makeElementV2('shape',{shape:'rect',cxMm:25,cyMm:25,wMm:6,hMm:6});
  ed.doc.elements.push(src); st.selectionIds=[src.id]; st.selectedId=src.id;
  // open panel via the button:
  document.getElementById('selScatterBtn').hidden = false;
  document.getElementById('selScatterBtn').click();
  document.getElementById('scApply').click();
  return { total: ed.doc.elements.length, groups: ed.doc.groups.length };
}
```
Expected: `total === 1 + count` (default 12 → 13), `groups === 1`.

- [ ] **Step 8: Run headless suite** — `tests/run.html` → `fail: 0`.

- [ ] **Step 9: Commit**

```bash
git add js/editor.js index.html styles.css
git commit -m "feat(streuen): Streu-Panel mit Bereichsauswahl, Vorschau und Gruppen-Ausgabe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **All headless tests green:** serve (`python3 -m http.server 8000`), navigate `http://localhost:8000/tests/run.html`, confirm `fail: 0` (includes the groups-parity lock proving the engine is unchanged).
- [ ] **Manual smoke (Playwright or by hand):** overlapping-handle grab works (P0); marquee + shift-click multiselect; multi-box scale/rotate; align + distribute; group/ungroup + nested panel + collapse; save→open round-trips groups; scatter produces a grouped set; 3D preview + `.3mf` export still build.
- [ ] **Branch:** work lands on `feature/multiselect-groups-scatter` (already created); open a PR when the phases are complete.
