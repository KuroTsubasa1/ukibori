# Unified Editor — Phase 3: The Approachable UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-mode UI with ONE approachable editor on top of the finished `buildParts(doc)` engine — a global Simple/Advanced toggle, first-run coach-marks, one canvas, and `buildParts` driving both preview and export.

**Architecture:** A new `js/editor.js` controller owns the v2 `doc` and implements one canvas renderer + one pointer handler (replacing `paint()` in `app.js` and `bookmark-editor.js`'s `bmRender()`/drag). `index.html` becomes a single workspace shell (header Simple/Advanced toggle + sidebar + canvas). The old two-mode code (`bookmark-editor.js`, the relief pipeline in `app.js`, `buildBookmarkParts`) is unloaded, then deleted once the UI renders/exports through `buildParts`. Built incrementally: each task leaves a working (progressively richer) editor.

**Tech Stack:** Vanilla browser JS as classic `<script>`s (no build step); the v2 model (`js/bookmark-model.js`) + unified engine (`js/build-parts.js`) + `preview3d.js` + `bg-removal.js` + `sources.js`. Unit tests via the `tests/run.html` harness; UI behavior via Playwright (the plugin MCP browser).

## Global Constraints

- **No new dependencies** (vendored/offline; no npm/CDN/build step).
- **Classic-script globals.** New JS runs as classic `<script>`s; read shared functions off `window`; new files that need the DOM-element map must read `window.els` via an IIFE, **never redeclare `els`** (established project gotcha).
- **Served over HTTP** in prod (nginx); do not rely on `file://`. Tests run against a local `python3 -m http.server` + the Playwright MCP.
- **v2 `doc` is the single state** (`defaultDoc()`); load runs `migrateProject()`. UI-only state (view = `simple|advanced`, coach-marks `seen`) lives in `localStorage`, not `doc`.
- **Engine is fixed API:** `window.buildParts(doc) -> [{name,color:[r,g,b],facets}]` drives 3D preview + export; do not modify `js/build-parts.js` behavior.
- **No smoothing control** (`depth.smooth` is not wired in the engine).
- **German UI copy** matches the existing app's voice.

---

## Running the tests

- **Unit (harness):** serve the repo (`python3 -m http.server 8050`, background) and load `tests/run.html`; `window.__ready()` → `{pass,fail,failures}`; green = `fail === 0`. (Automated: Playwright MCP `browser_navigate` + `browser_evaluate(() => window.__ready())`.)
- **UI smoke (Playwright MCP):** with the server running, `browser_navigate` to `http://localhost:8050/index.html`, then drive/assert via `browser_snapshot` / `browser_evaluate` / `browser_click` / `browser_file_upload` / `browser_take_screenshot`. Use a fresh port per run to dodge the JS cache.

---

## File Structure

- **Modify `index.html`** — remove the `appModeRelief`/`appModeBookmark` switch, `#reliefWorkspace`, `#bmWorkspace`. Add ONE `#editor` shell: header (`#viewToggle` Simple/Advanced, `#openBtn`/`#saveBtn`/`#exportBtn`/`#tourBtn`), `#sidebarSimple` + `#sidebarAdvanced`, canvas area (`#canvas2d` + `#preview3dCanvas` + `#view2dBtn`/`#view3dBtn`). Rework `#exportModal`. Swap script includes: load `js/editor.js` + `js/coachmarks.js`; stop loading `js/app.js` + `js/bookmark-editor.js`; keep `image-ops`, `geometry`, `trace`, `potrace`, `sources`, `bg-removal`, `bookmark-model`, `bookmark-export` (for palette helpers), `build-parts`, `preview3d`.
- **Create `js/editor.js`** — unified controller (IIFE): `doc` state, view toggle, canvas renderer + pointer input, control wiring, `buildParts` → preview/export. One clear responsibility (the editor); grows across Tasks 1–5, 7.
- **Create `js/coachmarks.js`** — first-run tutorial (Task 6).
- **Modify `styles.css`** — one-workspace layout, Simple/Advanced panel visibility, coach-mark overlay.
- **Create `tests/editor-doc.test.js`** — DOM-light unit tests for the controller's `doc` mutators (harness).
- **Delete (Task in phase 3, late):** `js/bookmark-editor.js`; the relief pipeline + `paint`/mode wiring in `js/app.js`; `buildBookmarkParts` in `js/bookmark-export.js` (keep `__imagePaletteFromImg`/`__nearestColor`).

---

### Task 1: Unified shell + Simple/Advanced toggle + minimal `editor.js`

**Deliverable:** `index.html` is one editor shell; a minimal `js/editor.js` holds a `defaultDoc()`, draws an empty plate on `#canvas2d`, and toggles Simple/Advanced (persisted). The old workspaces + mode switch are gone; the app loads with no console errors. (Functionality is fleshed out in later tasks — this task delivers a working, minimal shell.)

**Files:**
- Modify: `index.html` (shell markup + script includes)
- Create: `js/editor.js`
- Modify: `styles.css` (shell layout + `.mode-advanced` visibility)
- Test: Playwright smoke (below)

**Interfaces:**
- Consumes: `window.defaultDoc()` (v2 model), `window.gridForBody` (for the plate outline — optional here).
- Produces (for later tasks): `window.editor = { doc, setView(v), getView(), render2D() }` where `doc` is the live v2 document, `setView('simple'|'advanced')` toggles + persists, `render2D()` redraws `#canvas2d`.

- [ ] **Step 1: Write the failing Playwright smoke check**

Create a scratch check the implementer runs via the Playwright MCP (document it in the task report). Concretely, after serving on `:8050`:
1. `browser_navigate` `http://localhost:8050/index.html`
2. `browser_evaluate`:
```js
() => ({
  hasEditor: !!document.getElementById('editor'),
  hasSimpleSidebar: !!document.getElementById('sidebarSimple'),
  hasToggle: !!document.getElementById('viewToggle'),
  noOldSwitch: !document.getElementById('appModeRelief') && !document.getElementById('appModeBookmark'),
  view: window.editor && window.editor.getView(),
  canvasDrawn: (() => { const c = document.getElementById('canvas2d'); if(!c) return false;
    const g = c.getContext('2d').getImageData(0,0,c.width,c.height).data; for(let i=3;i<g.length;i+=4) if(g[i]) return true; return false; })(),
  errors: window.__errs || [],
})
```
Expected BEFORE implementation: `hasEditor:false` (the shell doesn't exist yet).

- [ ] **Step 2: Restructure `index.html` into the shell**

Replace the mode-switch header + `#reliefWorkspace` + `#bmWorkspace` with:
```html
<header id="topbar">
  <span class="brand">ukibori</span>
  <div id="viewToggle" class="seg-group" role="tablist" aria-label="Ansicht">
    <button type="button" id="viewSimple" class="seg seg-active">Einfach</button>
    <button type="button" id="viewAdvanced" class="seg">Erweitert</button>
  </div>
  <div class="topbar-actions">
    <button type="button" id="openBtn">Öffnen</button>
    <button type="button" id="saveBtn">Speichern</button>
    <button type="button" id="exportBtn">Exportieren</button>
    <button type="button" id="tourBtn" aria-label="Tour">?</button>
  </div>
</header>
<main id="editor">
  <aside id="sidebarSimple" class="sidebar"><!-- Simple controls (Task 4) --></aside>
  <aside id="sidebarAdvanced" class="sidebar" hidden><!-- Advanced controls (Task 4) --></aside>
  <section id="preview">
    <div class="view-toggle"><button id="view2dBtn" class="seg seg-active">2D</button><button id="view3dBtn" class="seg">3D</button></div>
    <canvas id="canvas2d" width="800" height="1000"></canvas>
    <canvas id="preview3dCanvas" width="800" height="1000" hidden></canvas>
  </section>
</main>
```
Keep the `#exportModal` (Task 3 reworks it). Update the `<script>` block: remove `js/app.js` and `js/bookmark-editor.js`; add `<script src="js/editor.js"></script>` and `<script src="js/coachmarks.js"></script>` (coachmarks may be an empty stub until Task 6); keep the engine deps. Add a tiny error collector near the top of `<head>`: `<script>window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)))</script>`.

- [ ] **Step 3: Create minimal `js/editor.js`**

```javascript
"use strict";
// Unified editor controller. Owns the v2 doc; renders the 2D canvas; manages the
// Simple/Advanced view. Fleshed out across Phase 3 tasks.
(function () {
  const VIEW_KEY = "ukibori.view";
  const doc = window.defaultDoc();
  const cv = document.getElementById("canvas2d");

  function getView() { return document.body.classList.contains("mode-advanced") ? "advanced" : "simple"; }
  function setView(v) {
    const adv = v === "advanced";
    document.body.classList.toggle("mode-advanced", adv);
    document.getElementById("viewSimple").classList.toggle("seg-active", !adv);
    document.getElementById("viewAdvanced").classList.toggle("seg-active", adv);
    document.getElementById("sidebarSimple").hidden = adv;
    document.getElementById("sidebarAdvanced").hidden = !adv;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
  }

  // Minimal empty-plate draw (Task 2 replaces with the full renderer).
  function render2D() {
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    const pad = 40, w = cv.width - 2 * pad, h = cv.height - 2 * pad;
    ctx.fillStyle = "#e8e8e8"; ctx.strokeStyle = "#999"; ctx.lineWidth = 2;
    ctx.fillRect(pad, pad, w, h); ctx.strokeRect(pad, pad, w, h);
  }

  document.getElementById("viewSimple").addEventListener("click", () => setView("simple"));
  document.getElementById("viewAdvanced").addEventListener("click", () => setView("advanced"));
  setView((() => { try { return localStorage.getItem(VIEW_KEY) || "simple"; } catch (e) { return "simple"; } })());
  render2D();

  window.editor = { doc, setView, getView, render2D };
})();
```

- [ ] **Step 4: Add shell CSS to `styles.css`**

```css
#topbar{display:flex;align-items:center;gap:16px;padding:8px 12px;border-bottom:1px solid #ccc}
#topbar .brand{font-weight:600}
#topbar .topbar-actions{margin-left:auto;display:flex;gap:8px}
#editor{display:flex;gap:12px;padding:12px;align-items:flex-start}
#editor .sidebar{flex:0 0 280px}
#editor #preview{flex:1;position:relative}
#editor #preview .view-toggle{position:absolute;top:6px;right:6px;z-index:1}
#canvas2d,#preview3dCanvas{max-width:100%;height:auto;background:#fafafa;border:1px solid #ddd}
```
(The `.mode-advanced` show/hide is handled via the `hidden` attribute in `setView`; keep it attribute-based for simplicity.)

- [ ] **Step 5: Run the Playwright smoke check; verify it passes**

Serve `python3 -m http.server 8050`; run the Step-1 evaluate.
Expected: `hasEditor:true, hasSimpleSidebar:true, hasToggle:true, noOldSwitch:true, view:'simple', canvasDrawn:true, errors:[]`. Click `#viewAdvanced` (`browser_click`), re-evaluate: `view:'advanced'` and `#sidebarAdvanced` visible; reload → view persists as `'advanced'`. Take a screenshot for the report.

- [ ] **Step 6: Commit**

```bash
git add index.html js/editor.js styles.css
git commit -m "feat(ui): unified editor shell + Simple/Advanced toggle (retire mode switch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (Task 1)

- **Spec coverage (this task):** implements the spec's §Editor shell (one workspace, header toggle, canvas + 2D/3D) and §Progressive-disclosure mechanics (persisted `mode`), and begins §Cleanups (mode switch removed). Remaining spec sections → roadmap tasks below.
- **Placeholders:** none — the shell markup, `editor.js`, CSS, and the smoke check are all concrete.
- **Consistency:** `window.editor.{doc,setView,getView,render2D}` is the interface later tasks extend; element ids (`#canvas2d`, `#sidebarSimple/Advanced`, `#viewSimple/Advanced`, `#view2dBtn/3dBtn`, `#exportModal`) are used verbatim downstream.

---

## Roadmap — Tasks 2–7 (detailed at execution time against the concrete `editor.js`)

Each is a self-contained deliverable with a Playwright/harness test; detailed just-in-time so the code matches the real `editor.js` shape as it emerges.

- **Task 2 — Unified canvas renderer + pointer input.** In `editor.js`: draw the plate (rect/circle/free outline via `gridForBody`/shape), mount guide, elements (image/text/QR via the composer's proven draw math), and selection handles; pointer handlers for select / move / scale / rotate + mount drag + shape resize; drop-an-image → image element sized to the plate. *Test:* harness `doc`-mutation units + Playwright drag/drop smoke.
- **Task 3 — Wire `buildParts` → preview + export; retire legacy builders.** 3D toggle → `preview3d.show(#preview3dCanvas, () => buildParts(doc))` with a clean RAF/resize lifecycle; rework `#exportModal` → `buildParts(doc)` → `build3MF`/`facetsToBinarySTL`/SVG/PNG. Then **delete** `bookmark-editor.js`, the relief pipeline in `app.js`, and `buildBookmarkParts`. *Test:* Playwright export-produces-blob + 3D renders (or gracefully reverts); harness stays green.
- **Task 4 — Simple & Advanced control panels.** Build `#sidebarSimple` (Add · Depth · Shape · Mount · Size · Export) and `#sidebarAdvanced` (Convert · depth mode · Layers · Selected element · 3D/Export detail), each bound to `doc` mutators with strong defaults. *Test:* harness mutator units + Playwright control-changes-doc smoke.
- **Task 5 — One-click background removal in Simple.** "Hintergrund entfernen" on a selected image → `window.removeBackground` → replace the element's decoded image → re-render; German busy/error states. *Test:* Playwright (stub/served) smoke that the button runs and updates.
- **Task 6 — Coach-marks / first-run tutorial (#9).** `js/coachmarks.js`: 4-step overlay on Simple-view ids, `localStorage` `seen` flag, `#tourBtn` replay. *Test:* Playwright first-load-shows-once-then-not + replay.
- **Task 7 — Cleanups.** Empty-`src` guard; confirm the RAF/resize lifecycle; remove any dead ids/CSS from the old workspaces. *Test:* harness + Playwright no-regression + no console errors.
