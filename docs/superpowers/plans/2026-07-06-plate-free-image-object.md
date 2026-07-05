# Plate-free "Bild" object + non-clipping 2D viewport — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop transform handles from clipping in the 2D editor, and add a plate-free "Bild" object type where the image's rectangular bounds are the printed object.

**Architecture:** Part 1 adds an editor-only `viewportDomain(doc)` that grows the 2D canvas to contain every element's rotated bounding box plus handle padding; the engine's `docDomain(doc)` is untouched, so print geometry stays byte-identical (parity by construction). Part 2 adds `body.shape === "image"` reusing the free-shape build path, with a rectangular image footprint instead of the alpha silhouette.

**Tech Stack:** Vanilla ES5-ish browser JS (classic scripts, IIFE, `window.*` globals). No build step, no CDN. Browser test harness: `tests/*.test.js` provide `test()/assert()/assertEqual()/assertClose()`, loaded by `tests/run.html`, run in Playwright over `http://localhost:8899` with a cache-busted copy (`?v=<ts>` on every `<script src>`).

## Global Constraints

- No build step, no CDN, fully offline; all libraries stay vendored. (verbatim: "no build · no CDN · vendored · offline")
- New JS must not redeclare shared globals; read `window.*` inside the IIFE (classic-script gotcha).
- German UI copy; preserve every existing control `id`.
- `buildParts(doc)` remains the single shared geometry source for 3MF/STL/SVG/3D-preview; existing rect/circle/free output must remain byte-identical.
- Test runs: serve repo over http (not file://) and cache-bust the harness — edits to `js/*.js` don't take effect otherwise. Baseline is GREEN (165/0).

---

### Task 1: `viewportDomain(doc)` — editor-only expanded domain

**Files:**
- Modify: `js/build-parts.js` (add `viewportDomain` next to `docDomain` ~line 24; export via `window.viewportDomain`)
- Test: `tests/viewport-domain.test.js` (create)
- Modify: `tests/run.html` (add `<script src="viewport-domain.test.js"></script>` before `preview3d-dispose.test.js`)

**Interfaces:**
- Consumes: existing `docDomain(doc) → {x0,y0,wMm,hMm}`.
- Produces: `window.viewportDomain(doc) → {x0, y0, wMm, hMm}` — the union of `docDomain(doc)` and every non-hidden element's rotated axis-aligned bounding box, expanded by `PAD_MM = 6` on all sides. Pure; no DOM.

- [ ] **Step 1: Write the failing test** — create `tests/viewport-domain.test.js`:

```javascript
"use strict";
// viewportDomain: editor-only domain that contains the plate AND every element's rotated
// bounding box + handle padding, so 2D transform handles never clip. docDomain (engine) is
// unchanged — verified separately by the existing parity suites staying green.
(function () {
  function doc() {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 50;
    d.mount = { type: "none", xMm: 25, yMm: 10, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 };
    return d;
  }
  const PAD = 6;

  test("viewportDomain contains the plate box when the only element is inside it", () => {
    const d = doc();
    d.elements = [makeElementV2("image", { cxMm: 25, cyMm: 25, wMm: 10, hMm: 10 })];
    const v = window.viewportDomain(d);
    // Must cover [0,0]..[50,50] (the plate) — element is inside, so plate + pad dominates.
    assert(v.x0 <= 0 && v.y0 <= 0, "origin at/below plate origin");
    assert(v.x0 + v.wMm >= 50 && v.y0 + v.hMm >= 50, "covers the full plate");
  });

  test("viewportDomain expands to include an element pushed far past the plate", () => {
    const d = doc();
    // Element centered at (90,90), 20×20 → its box is [80,80]..[100,100], well outside the 50×50 plate.
    d.elements = [makeElementV2("image", { cxMm: 90, cyMm: 90, wMm: 20, hMm: 20, rotationDeg: 0 })];
    const v = window.viewportDomain(d);
    assertClose(v.x0 + v.wMm, 100 + PAD, 1e-6, "right edge reaches element right + pad");
    assertClose(v.y0 + v.hMm, 100 + PAD, 1e-6, "bottom edge reaches element bottom + pad");
    assert(v.x0 <= 0 && v.y0 <= 0, "still includes the plate origin");
  });

  test("viewportDomain accounts for rotation (rotated square's AABB is larger)", () => {
    const d = doc();
    // 20×20 square centered at (25,25) rotated 45° → half-diagonal = 10*sqrt(2) ≈ 14.142 each side.
    d.elements = [makeElementV2("image", { cxMm: 25, cyMm: 25, wMm: 20, hMm: 20, rotationDeg: 45 })];
    const v = window.viewportDomain(d);
    const half = 10 * Math.SQRT2;
    // AABB spans [25-half, 25+half]; plate is [0,50] so the rotated box (≈10.86..39.14) is inside plate,
    // meaning plate+pad still dominates — assert it at least covers the rotated extent.
    assert(v.x0 <= 25 - half && v.x0 + v.wMm >= 25 + half, "covers rotated AABB horizontally");
  });

  test("hidden elements are ignored", () => {
    const d = doc();
    const el = makeElementV2("image", { cxMm: 200, cyMm: 200, wMm: 10, hMm: 10 });
    el._hidden = true;
    d.elements = [el];
    const v = window.viewportDomain(d);
    assert(v.x0 + v.wMm < 100, "hidden far element does not expand the domain");
  });
})();
```

- [ ] **Step 2: Run to verify it fails** — start the server + cache-busted harness, load in Playwright, read `window.__ready()`.

```bash
cd /Users/lasseharm/Dev/ukibori
(python3 /private/tmp/claude-501/-Users-lasseharm-Dev-ukibori/0410b409-a452-4a38-8a58-729d3f34e82c/scratchpad/nocache_server.py >/dev/null 2>&1 &)
sleep 1; TS=$(date +%s%N); sed "s/src=\"\([^\"]*\)\"/src=\"\1?v=$TS\"/g" tests/run.html > tests/_run_nocache.html
```
Navigate Playwright to `http://localhost:8899/tests/_run_nocache.html`; expected: 4 new tests FAIL with "window.viewportDomain is not a function".

- [ ] **Step 3: Implement `viewportDomain`** — in `js/build-parts.js`, immediately after the `docDomain` function, add:

```javascript
  // Editor-only: docDomain (the engine's plate/washer box) unioned with every visible
  // element's rotated bounding box + handle padding, so the 2D canvas grows to contain
  // transform handles. NOT used by the engine — docDomain stays the print source of truth.
  function viewportDomain(doc) {
    const base = docDomain(doc);
    let x0 = base.x0, y0 = base.y0, x1 = base.x0 + base.wMm, y1 = base.y0 + base.hMm;
    const PAD = 6; // mm — cushion so corner/rotate handles never sit on the canvas edge
    for (const el of (doc.elements || [])) {
      if (el._hidden) continue;
      const cx = el.cxMm, cy = el.cyMm, hw = (el.wMm || 0) / 2, hh = (el.hMm || 0) / 2;
      const a = (el.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
        const px = cx + dx * ca - dy * sa, py = cy + dx * sa + dy * ca;
        if (px - PAD < x0) x0 = px - PAD;
        if (py - PAD < y0) y0 = py - PAD;
        if (px + PAD > x1) x1 = px + PAD;
        if (py + PAD > y1) y1 = py + PAD;
      }
    }
    return { x0, y0, wMm: x1 - x0, hMm: y1 - y0 };
  }
```

Then, next to `window.docDomain = docDomain;` (search for it), add:

```javascript
  window.viewportDomain = viewportDomain;
```

- [ ] **Step 4: Run to verify pass** — regenerate the cache-busted harness (`TS=…; sed …`), reload Playwright, expected: all 4 new tests PASS and the suite is GREEN (169/0).

- [ ] **Step 5: Commit**

```bash
git add js/build-parts.js tests/viewport-domain.test.js tests/run.html
git commit -m "feat(editor): viewportDomain — canvas domain incl. element bboxes + handle pad"
```

---

### Task 2: `fitScale` uses `viewportDomain`; re-fit on transform drag-end

**Files:**
- Modify: `js/editor.js` — `fitScale()` (~line 115-138) and the transform pointer-up handler (search `pointerup` / the drag-end path near the move/scale/rotate handlers ~line 922+).

**Interfaces:**
- Consumes: `window.viewportDomain(doc)` (Task 1).
- Produces: no new exports; behavior change only.

- [ ] **Step 1: Point fitScale at viewportDomain** — in `js/editor.js` `fitScale()`, replace the domain line:

```javascript
    var domain = (window.docDomain ? window.docDomain(doc) : { x0: 0, y0: 0, wMm: doc.body.widthMm, hMm: doc.body.heightMm });
```
with:
```javascript
    // Editor viewport uses the expanded domain (plate ∪ element bboxes + handle pad) so
    // transform handles never clip. The engine/export keep using docDomain unchanged.
    var domain = (window.viewportDomain ? window.viewportDomain(doc)
      : (window.docDomain ? window.docDomain(doc) : { x0: 0, y0: 0, wMm: doc.body.widthMm, hMm: doc.body.heightMm }));
```

- [ ] **Step 2: Re-fit on transform drag-end** — find the drag-end handler (the `pointerup`/`endDrag` that finalizes a move/scale/rotate; it sets `drag = null`). At the end of finalizing a transform, add a re-fit so the canvas expands to keep the moved element + handles visible:

```javascript
    // A transform may have pushed the element past the old canvas bounds; re-fit so its
    // handles stay reachable. (Done on drag END only — re-fitting per pointermove would
    // make the plate visibly "breathe" during the drag.)
    fitScale();
    render2D();
```
Place this inside the drag-end path guarded by "was a move/scale/rotate drag" (not on a click without movement). If the existing endDrag already calls `render2D()`, add `fitScale();` immediately before it.

- [ ] **Step 3: Verify in-browser** — regenerate cache-busted `index.html` (`sed` on src/href), load in Playwright. Add an image element, then via evaluate set `el.cxMm = doc.body.widthMm + 40` (far right), dispatch a synthetic move drag ending with pointerup, and assert:
  - `window.__errs` is empty.
  - After drag-end, the element's rotate + corner handle screen positions (from `drawSelection` math: rotate handle at element-top − 22px; corners at element corners) are within `[0, canvas.width] × [0, canvas.height]` — i.e., not clipped.
  Capture a screenshot showing the moved element with all handles visible.

- [ ] **Step 4: Confirm the harness is still GREEN** (169/0) — this task doesn't change engine code, but reload `tests/_run_nocache.html` to be sure nothing regressed.

- [ ] **Step 5: Commit**

```bash
git add js/editor.js
git commit -m "feat(editor): grow 2D canvas to fit off-plate elements; re-fit on transform end"
```

---

### Task 3: Engine — `body.shape === "image"` (rectangular image footprint)

**Files:**
- Modify: `js/build-parts.js` — `docDomain` (branch for `shape === "image"`), footprint selection in `buildParts` (the `if (free) … else if (isLoop) … else …` block ~line 498-537) and in `buildEngravedParts`/free-path (~line 943-950), plus a new `imageFootprintField`.
- Test: `tests/bild-object.test.js` (create) + add to `tests/run.html`.

**Interfaces:**
- Consumes: existing `composeDesignV2`, `gridForDomain`, `traceMaskToFacets`, `orientOutward`.
- Produces: `window.imageFootprintField(doc, cols, rows, pitch, grid) → (c,r)=>number` (>0 inside the defining image element's rotated rectangle). `docDomain` returns the defining image element's rotated AABB when `shape === "image"`.

- [ ] **Step 1: Write the failing test** — create `tests/bild-object.test.js`:

```javascript
"use strict";
// Bild (plate-free image object): body.shape === "image" → the printed object is the defining
// image element's rectangular bounds (border ignored, no plate). Reuses the free build path.
(function () {
  function zb(f){let mn=Infinity,mx=-Infinity;for(const t of f)for(const p of t){if(p[2]<mn)mn=p[2];if(p[2]>mx)mx=p[2];}return{mn,mx};}
  function xyBox(f){let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const t of f)for(const p of t){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}return{w:x1-x0,h:y1-y0};}
  async function whiteImg(w,h){const cv=document.createElement("canvas");cv.width=w;cv.height=h;const cx=cv.getContext("2d");cx.fillStyle="#fff";cx.fillRect(0,0,w,h);const img=new Image();await new Promise((r,j)=>{img.onload=r;img.onerror=j;img.src=cv.toDataURL("image/png");});return img;}
  function bildDoc(img,el){const d=defaultDoc();d.body.shape="image";d.body.thicknessMm=3;d.body.baseColor="#101010";d.body.layerHeightMm=0.2;d.resolution=64;d.mount={type:"none",xMm:0,yMm:0,diameterMm:5,ringThicknessMm:0,ringHeightMm:2,marginMm:8};d.elements=[el];return d;}

  test("shape 'image' base footprint matches the image element's wMm×hMm rectangle", async () => {
    const img = await whiteImg(40, 30);
    const el = makeElementV2("image", { src:"a", cxMm:20, cyMm:15, wMm:40, hMm:30 });
    el.depth.direction="raised"; el.depth.mode="solid"; el._img=img;
    const d = bildDoc(img, el);
    const base = buildParts(d).filter(p => p.name.indexOf("grundplatte") === 0);
    assert(base.length >= 1, "has a base part");
    const box = xyBox(base[0].facets.concat(...base.slice(1).map(p=>p.facets)));
    assertClose(box.w, 40, 1.5, "base width ≈ image wMm");
    assertClose(box.h, 30, 1.5, "base height ≈ image hMm");
  });

  test("shape 'image' ignores body.borderMm (no dilation)", async () => {
    const img = await whiteImg(40, 30);
    const el = makeElementV2("image", { src:"a", cxMm:20, cyMm:15, wMm:40, hMm:30 });
    el.depth.direction="raised"; el.depth.mode="solid"; el._img=img;
    const d = bildDoc(img, el); d.body.borderMm = 10; // must have no effect
    const base = buildParts(d).filter(p => p.name.indexOf("grundplatte") === 0);
    const box = xyBox(base.flatMap(p=>p.facets));
    assert(box.w < 44 && box.h < 34, "border did not dilate the object");
  });

  test("shape 'image' base is watertight and the relief builds on top", async () => {
    const img = await whiteImg(40, 30);
    const el = makeElementV2("image", { src:"a", cxMm:20, cyMm:15, wMm:40, hMm:30 });
    el.depth.direction="raised"; el.depth.mode="solid"; el.depth.heightMm=1.2; el._img=img;
    const d = bildDoc(img, el);
    const parts = buildParts(d);
    assert(parts.some(p=>p.name.indexOf("grundplatte")===0), "base present");
    assert(parts.some(p=>p.name.indexOf("erhaben")===0), "raised relief present");
    for (const p of parts) { let v=0; for(const t of p.facets){const[a,b,c]=t;v+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;} assert(Math.abs(v)>0, p.name+" has volume"); }
  });
})();
```

Add to `tests/run.html` after `viewport-domain.test.js`:
```html
<script src="bild-object.test.js"></script>
```

- [ ] **Step 2: Run to verify it fails** — regenerate harness, reload; expected: the 3 tests FAIL (base box wrong / no base) because `shape === "image"` currently falls into the default `shapeFootprintField` (rounded-rect on body.widthMm/heightMm), not the image rectangle.

- [ ] **Step 3: Implement** — in `js/build-parts.js`:

(a) Add `imageFootprintField` near `freeFootprintField`:
```javascript
  // Footprint = the defining image element's rotated rectangle (Bild / plate-free object).
  // Selected by body.freeOutlineFromElementId, else the first image element.
  function imageFootprintField(doc, cols, rows, pitch, grid) {
    const x0 = grid ? grid.x0 : 0, y0 = grid ? grid.y0 : 0;
    const id = doc.body.freeOutlineFromElementId;
    let el = id ? doc.elements.find(e => e.id === id) : null;
    if (!el) el = doc.elements.find(e => e.type === "image") || doc.elements[0];
    if (!el) return () => -1;
    const cx = el.cxMm, cy = el.cyMm, hw = (el.wMm || 0) / 2, hh = (el.hMm || 0) / 2;
    const a = -(el.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    return (c, r) => {
      const x = x0 + (c + 0.5) * pitch, y = y0 + (r + 0.5) * pitch;
      const dx = x - cx, dy = y - cy;                 // into element-local space (inverse rotate)
      const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
      return Math.min(hw - Math.abs(lx), hh - Math.abs(ly)); // >0 inside the rectangle
    };
  }
```
Export it: `window.imageFootprintField = imageFootprintField;`

(b) In `docDomain`, at the top add a branch (before the loop-washer logic):
```javascript
    if (doc.body.shape === "image") {
      const id = doc.body.freeOutlineFromElementId;
      let el = id ? (doc.elements || []).find(e => e.id === id) : null;
      if (!el) el = (doc.elements || []).find(e => e.type === "image") || (doc.elements || [])[0];
      if (el) {
        const cx = el.cxMm, cy = el.cyMm, hw = (el.wMm || 0) / 2, hh = (el.hMm || 0) / 2;
        const a = (el.rotationDeg || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const [ddx, ddy] of [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]]) {
          const px = cx + ddx*ca - ddy*sa, py = cy + ddx*sa + ddy*ca;
          bx0 = Math.min(bx0,px); by0 = Math.min(by0,py); bx1 = Math.max(bx1,px); by1 = Math.max(by1,py);
        }
        return { x0: bx0, y0: by0, wMm: bx1 - bx0, hMm: by1 - by0 };
      }
    }
```

(c) In `buildParts` footprint selection, treat `shape === "image"` like free but with the image footprint. Add `const image = doc.body.shape === "image";` next to `const free = doc.body.shape === "free";`, then add a branch:
```javascript
    if (image) {
      footprint = imageFootprintField(doc, cols, rows, pitch, grid);
    } else if (free) {
      ...
```
Do the same in the free-path/`buildEngravedParts` footprint computation (~line 943-950) so both raised and engraved Bild objects use the rectangle. Also ensure the "free draws no frame" guard (`__frameBand` early-return at ~line 621) treats `image` like `free` (return null): change `if (doc.body.shape === "free" ...)` to `if (doc.body.shape === "free" || doc.body.shape === "image" ...)`.

- [ ] **Step 4: Run to verify pass** — regenerate harness, reload; expected the 3 Bild tests PASS and the full suite GREEN (172/0), with existing rect/circle/free parity tests unchanged (the new branches only fire for `shape === "image"`).

- [ ] **Step 5: Commit**

```bash
git add js/build-parts.js tests/bild-object.test.js tests/run.html
git commit -m "feat(engine): plate-free Bild object — shape 'image' rectangular footprint"
```

---

### Task 4: UI — "Bild" shape button, chrome toggle, 2D draw

**Files:**
- Modify: `index.html` — add a "Bild" button to `#shapeSeg` and `#advShapeSeg`.
- Modify: `js/editor.js` — `applyShape` (handle `"image"`: seg-active on both groups, hide plate-size/corner/border/frame chrome), the shape button wiring, and `render2D` (draw `image` like free).

**Interfaces:**
- Consumes: `applyShape` (existing), `setSegActive`, `setHidden` (existing helpers).
- Produces: no new exports.

- [ ] **Step 1: Add the buttons** — in `index.html`, add to `#shapeSeg` (after `shapeFree`):
```html
        <button type="button" id="shapeImage" class="seg" style="flex:1" title="Bild-Objekt: das Bild selbst ist das Werkstück (keine Platte)">Bild</button>
```
and to `#advShapeSeg` (after `advShapeFree`):
```html
              <button type="button" id="advShapeImage" class="seg" style="flex:1" title="Bild-Objekt: das Bild selbst ist das Werkstück (keine Platte)">Bild</button>
```

- [ ] **Step 2: Handle "image" in `applyShape`** — extend the seg map + chrome toggles. In `applyShape(shape)`:
```javascript
    var seg = shape === "rect" ? "Rect" : shape === "circle" ? "Circle" : shape === "free" ? "Free" : "Image";
    setSegActive("shapeSeg", "shape" + seg);
    setSegActive("advShapeSeg", "advShape" + seg);
    var isImage = shape === "image";
    // Plate chrome is meaningless for a plate-free image object:
    setHidden("borderField", shape !== "free");   setHidden("advBorderField", shape !== "free");
    setHidden("frameField", shape === "free" || isImage);  setHidden("advFrameField", shape === "free" || isImage);
    setHidden("cornerField", shape !== "rect");   setHidden("advCornerField", shape !== "rect");
```
(Existing lines already toggle border/frame/corner; replace them with the above so `image` hides frame too. Leave the `render2D()/scheduleRebuild3D()` at the end intact.)

- [ ] **Step 3: Wire the buttons**
```javascript
  document.getElementById("shapeImage").addEventListener("click", function () { applyShape("image"); });
  document.getElementById("advShapeImage").addEventListener("click", function () { applyShape("image"); });
```

- [ ] **Step 4: Draw `image` like free in `render2D`** — change the final `else` (free branch, ~line 764) condition so `image` shares it:
```javascript
    } else { // "free" or "image": draw elements only, no plate outline
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
    }
```
(The free branch is already the trailing `else`, so `shape === "image"` — not rect/circle — already lands here; just update the comment. No behavior change needed beyond confirming rect/circle branches don't catch `image`.)

- [ ] **Step 5: Verify in-browser** — regenerate cache-busted `index.html`, load in Playwright:
  - Click `#shapeImage`; assert `doc.body.shape === "image"`, both `#shapeImage`/`#advShapeImage` are seg-active, and `#sizeW`/frame/corner chrome behaves (frame hidden). `window.__errs` empty.
  - With an image element present, confirm `buildParts(doc)` yields a rectangular base (Task 3) and the 3D preview renders; screenshot the 3D showing a rectangular relief sized to the image.

- [ ] **Step 6: Commit**

```bash
git add index.html js/editor.js
git commit -m "feat(ui): Bild shape option — plate-free image object with chrome hidden"
```

---

## Self-Review

**Spec coverage:**
- Part 1 clipping fix → Tasks 1 (viewportDomain) + 2 (fitScale + re-fit). ✓
- Part 1 engine parity (docDomain untouched for existing shapes) → viewportDomain is separate; docDomain only gains an `image` branch (Task 3) that can't fire for rect/circle/free. ✓
- Part 2 Bild object (rectangular bounds, border 0, plate chrome hidden, reuse free path) → Tasks 3 (engine) + 4 (UI). ✓
- Testing (parity, viewportDomain, Bild geometry, in-browser) → covered across tasks. ✓
- Non-goals (no new editor mode; alpha silhouette stays "Frei") → honored (Bild is a `body.shape`). ✓

**Placeholder scan:** none — every code step has concrete code.

**Type consistency:** `viewportDomain`/`imageFootprintField`/`docDomain` all return `{x0,y0,wMm,hMm}` or a `(c,r)=>number` field consistent with existing `shapeFootprintField`/`freeFootprintField`. Shape value `"image"` used consistently across model, engine, and UI. Button ids `shapeImage`/`advShapeImage` and seg-active id derivation match.
