# Unified Editor — Phase 2 (Foundation): Footprint Field + Base-Plate Parts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the groundable, DOM-free foundation of the unified geometry engine: a generalized body+mount **footprint field** (rect/circle, hole/loop), and a **base-plate parts builder** that turns a v2 `doc` into the base 3D part(s) — both additive, leaving the three existing builders (`buildParts`, `buildColorParts`, `buildBookmarkParts`) untouched.

**Architecture:** Additive. Add a pure `shapeFootprintField` to `js/geometry.js` (generalizes the existing `roundedRectHoleField`, which stays). Create a NEW module `js/build-parts.js` — the future home of the unified `buildParts(doc)` — and put `buildBaseParts(doc)` + a `gridForBody` helper there. Both reuse the existing shared primitives (`traceMaskToFacets`, `extrudeLoops`, `orientOutward`, `hexToRgb`) via `window.*` globals. Nothing in the running app calls the new code yet (the UI switches over in Phase 3), so the live app is unaffected.

**Tech Stack:** Vanilla browser JS as classic `<script>` tags; no build step. Tests run in-browser via `tests/run.html` against the `tests/harness.js` helpers. **The geometry used here is DOM-free** — `traceMaskToFacets` rasterizes a predicate to a `Uint8Array` and traces it with the vendored Potrace (no canvas), and `extrudeLoops`/`orientOutward` are pure — so these tasks need no canvas, fonts, or images, making the tests deterministic.

## Global Constraints

- **No new dependencies** (vendored/offline; no npm/CDN/build step).
- **Classic-script globals.** New files run as classic `<script>`s and read existing functions off `window` (`window.traceMaskToFacets`, `window.extrudeLoops`, `window.orientOutward`, `window.hexToRgb`, `window.shapeFootprintField`). Export new functions via `window.* = ...`. No ES modules / `import`. Do not redeclare an existing global.
- **Do NOT change behavior of the three existing builders** or `roundedRectHoleField`. This phase is additive — `buildParts`/`buildColorParts` (app.js) and `buildBookmarkParts` (bookmark-export.js) must remain byte-for-byte unchanged.
- **Data contracts (verbatim from the codebase map):**
  - FACET = `[[x,y,z],[x,y,z],[x,y,z]]` — one triangle, three `[x,y,z]` vertices in mm.
  - PART = `{ name: string, color: [r,g,b] (0–255), facets: FACET[] }`.
  - FIELD/SDF = `(c, r) => number`, `>0` inside, `<0` outside, in **cell units**; cell center `(c,r)` maps to mm via `x=(c+0.5)/(cols/widthMm)`, `y=(r+0.5)/(rows/heightMm)`, `r=0` at top.
  - `mount.xMm`/`mount.yMm` are the hole/loop **CENTER** (established in Phase 1).
- **v2 doc shape** is authoritative per `docs/superpowers/specs/2026-07-01-unified-editor-merge-design.md`.

---

## Running the tests

Browser harness; no node runner.

```bash
# from repo root, background terminal — use a FRESH port each run (Playwright's HTTP
# cache is not busted by ?t= because <script src> has no version param):
python3 -m http.server 8010
```
Load `http://localhost:8010/tests/run.html` in a (headless) browser; `window.__ready()` resolves to `{ pass, fail, failures }`. Green = `fail === 0`. For automated runs: ToolSearch `select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_evaluate`, navigate, then `browser_evaluate` `() => window.__ready()`. Bump the port between RED and GREEN reloads (8011, 8012, …) to force fresh JS.

---

## File Structure

- **Modify** `js/geometry.js` — append `shapeFootprintField(cols, rows, body, mount)` after `roundedRectHoleField` (line ~508) + `window.shapeFootprintField` export. `roundedRectHoleField` stays untouched.
- **Create** `js/build-parts.js` — new unified-engine module; defines `gridForBody(body, resolution)` and `buildBaseParts(doc)`; exports both on `window`.
- **Create** `tests/geometry-native.test.js` — DOM-free tests for `shapeFootprintField`.
- **Create** `tests/build-parts.test.js` — DOM-free tests for `gridForBody` + `buildBaseParts`.
- **Modify** `tests/run.html` — add `<script src="../js/build-parts.js"></script>` (after `bookmark-export.js`, before the test scripts) and the two new test `<script>` tags.
- **Modify** `index.html` — add `<script src="js/build-parts.js"></script>` after the existing `js/bookmark-export.js` tag (harmless/forward-looking; nothing calls it yet).

---

### Task 1: `shapeFootprintField(cols, rows, body, mount)` — generalized body+mount footprint field

**Files:**
- Modify: `js/geometry.js` (append after `roundedRectHoleField`, ~line 508)
- Create: `tests/geometry-native.test.js`
- Modify: `tests/run.html` (add the new test script tag)

**Interfaces:**
- Consumes: nothing (pure math).
- Produces: `shapeFootprintField(cols, rows, body, mount) -> (c, r) => number`. `body = {shape:'rect'|'circle', widthMm, heightMm, cornerRadiusMm}`; `mount = {type:'none'|'hole'|'loop', xMm, yMm, diameterMm}` (or null). Returns a FIELD (cell units, `>0` inside the body and outside any hole). For `shape:'circle'`, radius = `min(widthMm,heightMm)/2`, centered. A hole is subtracted when `mount.type` is `'hole'` **or** `'loop'` (the loop's raised ring is additive geometry built elsewhere; the through-hole is cut for both). Anything other than `shape:'circle'` is treated as the rounded rectangle (free-outline bodies use a separate builder in a later task).

- [ ] **Step 1: Write the failing tests**

Create `tests/geometry-native.test.js`:

```javascript
"use strict";
(function () {
  // sx=sy=1 (cols=widthMm, rows=heightMm) so mm (x,y) = (c+0.5, r+0.5).
  test("footprint: rect interior > 0, exterior < 0", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const f = shapeFootprintField(50, 150, body, { type: "none" });
    assertClose(f(24.5, 74.5), 25, 1e-6, "deep center = min half-extent (25mm)");
    assert(f(-0.4, -0.4) < 0, "rounded corner cuts mm(0.1,0.1) outside");
    assert(f(-5, 74.5) < 0, "left of body is outside");
  });

  test("footprint: circle inside vs outside", () => {
    const body = { shape: "circle", widthMm: 40, heightMm: 40, cornerRadiusMm: 0 };
    const f = shapeFootprintField(40, 40, body, { type: "none" });
    assertClose(f(19.5, 19.5), 20, 1e-6, "center = radius (20mm)");
    assert(f(1.5, 1.5) < 0, "corner mm(2,2) is outside the inscribed circle");
  });

  test("footprint: mount hole carves the disk", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const mount = { type: "hole", xMm: 25, yMm: 10.5, diameterMm: 5 };
    const f = shapeFootprintField(50, 150, body, mount);
    assertClose(f(24.5, 10), -2.5, 1e-6, "hole center is inside the hole (negative)");
    assertClose(f(24.5, 74.5), 25, 1e-6, "far from hole = full body depth");
  });

  test("footprint: loop cuts the same through-hole as hole", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const loop = { type: "loop", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 2 };
    const f = shapeFootprintField(50, 150, body, loop);
    assertClose(f(24.5, 10), -2.5, 1e-6, "loop also carves the hole");
  });

  test("footprint: mount none leaves the body solid where a hole would be", () => {
    const body = { shape: "rect", widthMm: 50, heightMm: 150, cornerRadiusMm: 4 };
    const f = shapeFootprintField(50, 150, body, { type: "none" });
    assert(f(24.5, 10) > 0, "no hole -> still inside the body");
  });
})();
```

Add to `tests/run.html` after line 16 (`<script src="bookmark-export.test.js"></script>`):
```html
<script src="geometry-native.test.js"></script>
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

Start `python3 -m http.server 8010`; load `http://localhost:8010/tests/run.html`; `window.__ready()`.
Expected: `fail: 5`, each `shapeFootprintField is not defined`. All pre-existing tests still pass.

- [ ] **Step 3: Implement `shapeFootprintField` in `js/geometry.js`**

Append after `window.roundedRectHoleField = roundedRectHoleField;` (line 508):

```javascript
// Generalized footprint field for the unified engine: >0 inside the body AND
// outside any mount hole, in cell units (same convention as roundedRectHoleField).
// body={shape:'rect'|'circle', widthMm, heightMm, cornerRadiusMm}. mount.xMm/yMm
// are the hole CENTER. The through-hole is cut for type 'hole' AND 'loop' (the
// loop's raised ring is built separately). Non-'circle' shapes use the rounded
// rectangle; free-outline bodies use a dedicated builder (later task).
function shapeFootprintField(cols, rows, body, mount) {
  const W = body.widthMm, H = body.heightMm;
  const sx = cols / W, sy = rows / H;            // cells per mm
  const s = (sx + sy) / 2;                       // ~uniform mm -> cells
  const hw = W / 2, hh = H / 2;
  const isCircle = body.shape === "circle";
  const rr = Math.min(body.cornerRadiusMm || 0, hw, hh);
  const bodyR = Math.min(hw, hh);                // inscribed circle radius
  const m = mount || { type: "none" };
  const hasHole = m.type === "hole" || m.type === "loop";
  const holeR = hasHole ? (m.diameterMm || 0) / 2 : 0;
  const holeCx = hasHole ? m.xMm : 0, holeCy = hasHole ? m.yMm : 0;
  return (c, r) => {
    const x = (c + 0.5) / sx, y = (r + 0.5) / sy;        // mm, origin top-left
    let bodyInside;
    if (isCircle) {
      bodyInside = bodyR - Math.hypot(x - hw, y - hh);   // >0 inside circle, mm
    } else {
      const qx = Math.abs(x - hw) - (hw - rr), qy = Math.abs(y - hh) - (hh - rr);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
      bodyInside = -outside;                             // >0 inside rounded-rect, mm
    }
    if (!hasHole) return bodyInside * s;
    const holeOutside = Math.hypot(x - holeCx, y - holeCy) - holeR; // >0 outside hole
    return Math.min(bodyInside, holeOutside) * s;        // mm -> cells
  };
}
window.shapeFootprintField = shapeFootprintField;
```

- [ ] **Step 4: Run the tests; verify all pass**

Reload on a fresh port (`python3 -m http.server 8011`). Expected: `fail: 0`; the 5 new footprint tests pass; all pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add js/geometry.js tests/geometry-native.test.js tests/run.html
git commit -m "feat(geometry): shapeFootprintField — rect/circle body + hole/loop cut"
```

---

### Task 2: `buildBaseParts(doc)` — base-plate part(s) from a v2 doc

**Files:**
- Create: `js/build-parts.js`
- Create: `tests/build-parts.test.js`
- Modify: `tests/run.html` (add `build-parts.js` source + test script)
- Modify: `index.html` (add `build-parts.js` source)

**Interfaces:**
- Consumes: `window.shapeFootprintField` (Task 1); `window.traceMaskToFacets(inside, cols, rows, pitch, thickness, z0)`, `window.extrudeLoops`, `window.orientOutward`, `window.hexToRgb` (existing). v2 `doc` from `js/bookmark-model.js`.
- Produces:
  - `gridForBody(body, resolution) -> { cols, rows, pitch }`. Longest side = `resolution`; aspect-matched; `pitch = body.widthMm / cols` (mm/cell). Mirrors the existing `__gridFor` logic for v2 `body`.
  - `buildBaseParts(doc) -> PART[]`. Traces `doc.body` footprint (with `doc.mount` hole cut) and extrudes it from `z=0` to `doc.body.thicknessMm`, colored `doc.body.baseColor`. Returns `[{name:'grundplatte', color, facets}]` (empty array only if the footprint is degenerate/empty). The loop's raised ring is NOT built here (later task).

- [ ] **Step 1: Write the failing tests**

Create `tests/build-parts.test.js`:

```javascript
"use strict";
(function () {
  // Local signed-volume + bbox helpers (don't depend on a possibly-unexported global).
  function signedVol(facets) {
    let v = 0;
    for (const t of facets) {
      const [a, b, c] = t;
      v += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
    }
    return v;
  }
  function bbox(facets) {
    let mnx=Infinity,mny=Infinity,mnz=Infinity,mxx=-Infinity,mxy=-Infinity,mxz=-Infinity;
    for (const t of facets) for (const p of t) {
      if (p[0]<mnx) mnx=p[0]; if (p[0]>mxx) mxx=p[0];
      if (p[1]<mny) mny=p[1]; if (p[1]>mxy) mxy=p[1];
      if (p[2]<mnz) mnz=p[2]; if (p[2]>mxz) mxz=p[2];
    }
    return { mnx, mny, mnz, mxx, mxy, mxz };
  }
  function rectDoc(mount) {
    const d = defaultDoc();
    d.body.shape = "rect"; d.body.widthMm = 50; d.body.heightMm = 150;
    d.body.cornerRadiusMm = 4; d.body.thicknessMm = 3; d.body.baseColor = "#101010";
    d.resolution = 256;
    if (mount) d.mount = Object.assign({}, d.mount, mount);
    else d.mount = { type: "none", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, marginMm: 8 };
    return d;
  }

  test("gridForBody: longest side = resolution, aspect preserved", () => {
    const g = gridForBody({ widthMm: 50, heightMm: 150 }, 300);
    assertEqual(g.rows, 300, "tall body -> rows = resolution");
    assertEqual(g.cols, 100, "cols = round(300*50/150)");
    assertClose(g.pitch, 0.5, 1e-9, "pitch = widthMm/cols = 50/100");
  });

  test("buildBaseParts: solid rect base is watertight and within bounds", () => {
    const parts = buildBaseParts(rectDoc(null));
    assertEqual(parts.length, 1, "one base part");
    assertEqual(parts[0].name, "grundplatte", "base name");
    assert(parts[0].facets.length > 0, "base has facets");
    assert(signedVol(parts[0].facets) > 0, "outward-oriented (positive volume)");
    const bb = bbox(parts[0].facets);
    assertClose(bb.mnz, 0, 1e-6, "base bottom at z=0");
    assertClose(bb.mxz, 3, 1e-6, "base top at z=thicknessMm");
    assert(bb.mnx >= -0.6 && bb.mxx <= 50.6, "x within body width (+/- ~1 cell)");
    assert(bb.mny >= -0.6 && bb.mxy <= 150.6, "y within body height (+/- ~1 cell)");
  });

  test("buildBaseParts: mount hole adds interior geometry (more triangles)", () => {
    const solid = buildBaseParts(rectDoc(null))[0].facets.length;
    const holed = buildBaseParts(rectDoc({ type: "hole", xMm: 25, yMm: 10.5, diameterMm: 5 }))[0].facets.length;
    assert(holed > solid, "carving a hole increases the triangle count");
  });

  test("buildBaseParts: circle body produces a watertight base", () => {
    const d = defaultDoc();
    d.body.shape = "circle"; d.body.widthMm = 40; d.body.heightMm = 40;
    d.body.thicknessMm = 2; d.resolution = 256;
    d.mount = { type: "none", xMm: 20, yMm: 20, diameterMm: 5, ringThicknessMm: 0, marginMm: 8 };
    const parts = buildBaseParts(d);
    assertEqual(parts.length, 1, "one base part");
    assert(signedVol(parts[0].facets) > 0, "circle base outward-oriented");
    const bb = bbox(parts[0].facets);
    assertClose(bb.mxz, 2, 1e-6, "circle base top at thicknessMm");
  });
})();
```

- [ ] **Step 2: Run the tests; verify the new ones FAIL**

Add the source + test tags to `tests/run.html`: after line 12 (`<script src="../js/bookmark-export.js"></script>`) add
```html
<script src="../js/build-parts.js"></script>
```
and after the `geometry-native.test.js` tag from Task 1 add
```html
<script src="build-parts.test.js"></script>
```
Start a fresh server (`python3 -m http.server 8012`); load `tests/run.html`; `window.__ready()`.
Expected: `fail: 5`, with `gridForBody is not defined` / `buildBaseParts is not defined`. Task 1 footprint tests + all pre-existing tests still pass.

- [ ] **Step 3: Implement `js/build-parts.js`**

Create `js/build-parts.js`:

```javascript
"use strict";
// Unified geometry engine (additive; nothing calls it yet — the UI switches over
// in a later phase). Turns a v2 doc into 3D parts [{name, color:[r,g,b], facets}],
// reusing the shared primitives (shapeFootprintField, traceMaskToFacets,
// extrudeLoops, orientOutward, hexToRgb) via window globals.
(function () {
  // Aspect-preserving raster grid for a v2 body: longest side = resolution.
  // pitch = widthMm / cols (mm per cell). Mirrors the bookmark __gridFor logic.
  function gridForBody(body, resolution) {
    const res = Math.max(8, Math.round(resolution));
    let cols, rows;
    if (body.widthMm >= body.heightMm) {
      cols = res; rows = Math.max(2, Math.round(res * body.heightMm / body.widthMm));
    } else {
      rows = res; cols = Math.max(2, Math.round(res * body.widthMm / body.heightMm));
    }
    return { cols, rows, pitch: body.widthMm / cols };
  }

  // Base plate: the body footprint (with the mount hole cut) extruded from z=0 to
  // body.thicknessMm, colored body.baseColor. The loop's raised ring is built
  // separately (later task).
  function buildBaseParts(doc) {
    const body = doc.body, mount = doc.mount;
    const { cols, rows, pitch } = gridForBody(body, doc.resolution);
    const field = window.shapeFootprintField(cols, rows, body, mount);
    const inside = (c, r) => field(c, r) > 0;
    const facets = window.orientOutward(
      window.traceMaskToFacets(inside, cols, rows, pitch, body.thicknessMm, 0)
    );
    if (!facets.length) return [];
    return [{ name: "grundplatte", color: window.hexToRgb(body.baseColor), facets }];
  }

  window.gridForBody = gridForBody;
  window.buildBaseParts = buildBaseParts;
})();
```

Add to `index.html` after the `<script src="js/bookmark-export.js"></script>` line:
```html
<script src="js/build-parts.js"></script>
```

- [ ] **Step 4: Run the tests; verify all pass**

Reload on a fresh port (`python3 -m http.server 8013`). Expected: `fail: 0`; the 5 new build-parts tests pass; Task 1 tests + all pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add js/build-parts.js tests/build-parts.test.js tests/run.html index.html
git commit -m "feat(geometry): buildBaseParts(doc) — v2 base-plate from footprint field"
```

---

## Self-Review

**Spec coverage (this foundation):** The spec's § "Geometry engine" step 3 ("Base plate from `body.shape`: rounded rect / circle / traced free outline + mount carve") is begun here for rect + circle + hole/loop cut (`shapeFootprintField` + `buildBaseParts`); free-outline and the additive loop ring are explicitly deferred to later Phase 2 tasks (see roadmap). Element geometry (steps 1–2) and assembly (step 4) are the next tasks.

**Placeholder scan:** No TBD/TODO; every code step has complete code; every test step has real assertions with computed expected values (footprint values hand-derived at `sx=sy=1`; base assertions use structural invariants — `signedVolume>0`, z-extent `=thicknessMm`, bbox within body, hole increases triangle count — that are stable across environments since no fonts/images/canvas are involved).

**Type consistency:** `shapeFootprintField` returns a FIELD `(c,r)=>number` consumed by `buildBaseParts` via `inside=(c,r)=>field(c,r)>0`, matching `traceMaskToFacets(inside, …)`'s contract. `buildBaseParts` returns `PART[]` (`{name,color:[r,g,b],facets}`) matching the engine-wide contract used by `build3MF`/`preview3d`. `gridForBody` returns `{cols,rows,pitch}` consumed immediately. `hexToRgb` returns `[r,g,b]` per the map.

---

## Roadmap — remaining Phase 2 tasks (to be detailed after this foundation lands)

These are deferred deliberately so they're authored against the concrete `shapeFootprintField`/`buildBaseParts` code and so open conventions get resolved first (noted inline):

- **Task 3 — element rasterization + compositing for v2 (`composeDesignV2`).** Adapt the bookmark `composeDesign`/`__renderElement` to read `element.depth` (instead of v1 `depthLayers`) and `doc.body.*`. Canvas-based → tests need the browser harness with deterministic fixtures (generated data-URL images / solid fills, avoiding font nondeterminism). **Open decision to resolve first:** which fixtures give a stable parity snapshot.
- **Task 4 — regression-parity snapshot.** Capture current `buildBookmarkParts(v1doc)` output (per-part `{name,color,triangleCount,bbox,signedVolume}`) for a fixture set into `tests/fixtures/`, then assert a migrated v1 doc through the new element pipeline matches it (the safety net the Phase 1 review recommended). Snapshot is captured + compared in the same Chromium-headless env.
- **Task 5 — per-element depth modes × direction.** `solid` / `colorLayers` / `heightmap` × `raised` / `engraved`. Reuse the engraved color-rank/recess/riser math (bookmark-export.js:236–317) for engraved; invert the z-math for raised. **Open decision:** the mount **loop ring** height convention (not in the v2 model yet) — resolve before building the ring part.
- **Task 6 — unified `buildParts(doc)` entry** assembling base + elements + mount ring, plus free-outline base (`body.shape:'free'`). Old builders stay until Phase 3 switches the UI over.
