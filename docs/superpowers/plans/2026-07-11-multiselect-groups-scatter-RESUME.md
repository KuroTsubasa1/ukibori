# RESUME — Mehrfachauswahl · Griff-Fix · Gruppen · Streuen

Continuation guide for the subagent-driven execution of
`docs/superpowers/plans/2026-07-11-multiselect-groups-scatter.md`
(spec: `docs/superpowers/specs/2026-07-11-multiselect-groups-scatter-design.md`).

This file is the **persistent** progress record. A live scratch ledger also
exists at `.superpowers/sdd/progress.md` (git-ignored; may be wiped by
`git clean -fdx` — if so, trust this file + `git log`).

## Quickstart to resume

1. `git checkout feature/multiselect-groups-scatter` (HEAD should be **49e0dfe** or later).
2. Start the test server: `python3 -m http.server 8000` (from repo root).
3. Re-invoke the **superpowers:subagent-driven-development** skill.
4. Resume at **Task 5** (Tasks 1–4 are DONE — do not re-dispatch them; verify against `git log`).
5. Continue the per-task loop: `task-brief` → dispatch implementer → `review-package` → dispatch task reviewer → fix Critical/Important → mark complete in the ledger. After Task 16, dispatch the final whole-branch review, then use **superpowers:finishing-a-development-branch**.

## Branch / commit state

- Branch: `feature/multiselect-groups-scatter` (branched from `master` at `cc0ae51`).
- HEAD: `49e0dfe`.
- Commits so far (newest first):
  - `49e0dfe` fix(auswahl): Zeilen-Löschen entfernt nur dieses Element aus der Auswahl  ← Task 4 fix
  - `cde09fe` feat(auswahl): Auswahl-Set (selectionIds) neben primärer Auswahl        ← Task 4
  - `ab49426` feat(auswahl): marqueeHits — Rahmenauswahl-Trefferset                    ← Task 3
  - `34d6d71` feat(geom): geteilte Rotations-AABB-Helfer (geom-util)                   ← Task 2
  - `865ae55` fix(auswahl): Transform-Griffe der Auswahl gewinnen …                    ← Task 1
  - `7eef4e2` docs(plan): Umsetzungsplan …
  - `cf3f5d8` docs(entwurf): … (spec)

## Test / verification recipe (browser-based; no CLI runner, no package.json)

- Server must be running on **http://localhost:8000**.
- Headless suite: Playwright MCP → `browser_navigate http://localhost:8000/tests/run.html` → `browser_evaluate: () => document.getElementById('out').textContent` → expect `fail: 0`.
- **Current baseline: 228 pass / 0 fail** (was 221/0 before Task 2 added geom-util tests; +3 per pure-module task).
- Editor interaction checks: `browser_navigate http://localhost:8000/` then use exposed globals — `window.editor` (`{doc, render2D, renderLayers, refreshAdvancedForSelection, resetDocTo, …}`), `window.__editorState` (the live `state`, incl. `selectedId`, `selectionIds`, `scale`, `marginPx`, `viewX0/viewY0`), `window.__editorHitTest(px,py)`, and model factories `window.makeElementV2` / `window.defaultDoc` / `window.migrateProject`.
- New source files must be `<script>`-registered in BOTH `index.html` (before `js/editor.js`) and `tests/run.html` (source under "sources under test" BEFORE its test script). New test files → `tests/run.html`.

## SDD workflow mechanics

- Scripts (in the skill dir `…/superpowers/6.0.3/skills/subagent-driven-development/scripts/`):
  - `task-brief PLAN_FILE N` → writes `.superpowers/sdd/task-N-brief.md`, prints path. **Briefs for Tasks 1–8 are already staged.** Generate 9–16 as you go.
  - `review-package BASE HEAD` → writes `.superpowers/sdd/review-<base7>..<head7>.diff`, prints path. BASE = the commit recorded **before** dispatching that task's implementer (never `HEAD~1`).
- Dispatch each implementer with: 1 line of where it fits, the brief path (its requirements), interfaces/decisions from earlier tasks, and the report-file path `.superpowers/sdd/task-N-report.md`. Hand the reviewer the brief + report + review-package paths + the binding global constraints (verbatim from the plan's Global Constraints).
- Implementers CAN drive the Playwright MCP browser tools (verified on Tasks 1–4). Tell them the server is already running; if they truly lack the tools they must report BLOCKED, not fake results.

## Model assignments (used so far; keep going)

- **Pure-module tasks** (complete code + tests in the brief — transcription): **haiku** implementer. Applies to Tasks 6, 7, 10, 11, 12, 15. (Task 2/3 used haiku successfully.)
- **editor.js integration tasks** (anchoring edits into the 2933-line file, Playwright judgment): **sonnet** implementer. Applies to Tasks 5, 8, 9, 13, 14, 16. (Task 1/4 used sonnet.)
- **Task reviewers:** **sonnet** (scaled to the diff).
- **Final whole-branch review:** **opus** (most capable).

## Progress

| Task | Phase | What | Status |
|---|---|---|---|
| 1  | P0 | `hitTest` priority pass (editor.js) | ✅ done `865ae55`, review clean |
| 2  | P1 | `js/geom-util.js` | ✅ done `34d6d71`, review clean |
| 3  | P1 | `js/selection-ops.js` | ✅ done `ab49426`, review clean |
| 4  | P1 | selection state primary+set (editor.js) | ✅ done `cde09fe`+fix `49e0dfe`, review Approved |
| 5  | P1 | marquee + shift-click + collective move/delete/duplicate (editor.js) | ⏭ **NEXT** (brief staged) |
| 6  | P2 | `js/transform-ops.js` | ⬜ brief staged |
| 7  | P2 | `js/align-ops.js` | ⬜ brief staged |
| 8  | P2 | multi-box draw + transform dispatch (editor.js) | ⬜ brief staged |
| 9  | P2 | align/distribute toolbar (editor.js + index.html + styles.css) | ⬜ |
| 10 | P3 | group model fields + migration (bookmark-model.js) | ⬜ |
| 11 | P3 | group ops nesting+contiguity (bookmark-model.js) | ⬜ |
| 12 | P3 | geometry-invariance parity test | ⬜ |
| 13 | P3 | recursive layers panel + group ops (editor.js + index.html + styles.css) | ⬜ |
| 14 | P3 | group DnD + duplicate (editor.js) | ⬜ |
| 15 | P4 | `js/scatter.js` generator | ⬜ |
| 16 | P4 | scatter panel + region drag (editor.js + index.html + styles.css) | ⬜ |

## What's built and usable by later tasks

- `js/geom-util.js` → `window.rotatedCorners`, `elementAABB`, `aabbUnion`, `aabbsOverlap`.
- `js/selection-ops.js` → `window.marqueeHits(elements, rect)`.
- `editor.js` selection layer → `state.selectionIds` (array, includes primary), `setSelection(ids)`, `clearSelection()`, `isSelected(id)`, `toggleInSelection(id)`, `selectedEls()`. `state.selectedId` remains the inspector's single PRIMARY target.
- `hitTest` has a priority pass: the selected element's handles win over overlapping bodies (Task 8 extends it with the multi-box branch).

## Nuances to remember when resuming

- **Task 5 must NOT use `window.applyMove`** — it doesn't exist until Task 6. The plan inlines the multi-move delta loop in Task 5 on purpose. Task 5 also **replaces** the empty-canvas `pointerdown` deselect branch (which Task 4 intentionally left at ~line 1080) with the marquee branch, and rewrites `deleteSelected`/`duplicateSelected` to collective versions. It should NOT touch the per-row trash button (already fixed in `49e0dfe` to `toggleInSelection`).
- Verify Task 5 collective ops via the DOM buttons: set `selectionIds`, click `#selDelBtn` (→ delete all) / `#selDupBtn` (→ duplicate all). Raw marquee pointer-drag simulation is fiddly because `setPointerCapture` may reject synthetic pointerIds — rely on `marqueeHits` sanity + the button paths, do a best-effort pointer-drag.
- **Global constraint (all tasks): geometry pipeline stays byte-identical.** `doc.elements` stays flat + absolute; groups are an overlay; transforms bake into members. Existing geometry/export tests must keep passing untouched. Task 12 is the parity lock that proves it — keep it green before proceeding in P3.
- Group scaling (Task 8) is **uniform/proportional** only.

## Minor findings parked for the final whole-branch review

- Element-clone pattern (`drop`+`JSON.parse(JSON.stringify(...))`) recurs in `duplicateElement` / `duplicateSelected` (Task 5) / `scatterGenerate` (Task 16) — matches the existing house idiom; consider extracting `cloneElementProps()` if the final review agrees.
- `geom-util.js`: `aabbsOverlap` strict-`<` (shared edge ≠ overlap) is undocumented; `||0` fallbacks on `wMm/hMm/rotationDeg` are forgiving. Minor.
- `editor.js` `toggleInSelection`: removing a non-last id makes the primary jump to the new last element (fine for a toggle; a clarifying comment was suggested). Minor.
