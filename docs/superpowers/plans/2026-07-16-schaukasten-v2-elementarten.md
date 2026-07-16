# Schaukasten v2 — Element-Arten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-element Schaukasten-Arten: „Mit Rand" (rim cloud — footprint union + one-level prism) and „Schwebend" (floating pieces clipped to the opening, stackable, with deterministic assembly pins), replacing the flush `sbOverhang`.

**Architecture:** `el.sbMode` ("plate"|"rim"|"float") partitions elements per plate. Rim elements keep the shipped footprint-union and additionally emit a per-element prism `[T,2T]` clipped by the front plate's opening. Float elements leave the plate pipeline entirely and become standalone slabs (silhouette ∩ opening_k) with raster pegs/blind holes generated from chamfer-DT maxima of overlap masks (`shadowboxPinSpots`). Everything raster → `traceMaskToFacets` (no analytic-mesh mapping risk).

**Tech Stack:** unchanged (vanilla JS, browser tests via tests/run.html + Playwright over http).

**Spec:** `docs/superpowers/specs/2026-07-16-schaukasten-v2-elementarten-design.md`

## Global Constraints

Identical to the v1 plan (`2026-07-16-schaukasten.md`) — English code/tests, German UI/part names, no AI mentions in commits, parity when Schaukasten off, run.html has no auto-discovery, **fresh `?v=` token on EVERY edit of a run.html-loaded source** (continue after `sb10`: `sb11`, `sb12`, …), and the hard-won operational rule: **Chromium disk cache survives `?v=` bumps within a session — every decisive test run uses a FRESH http port.** Headless doc recipe: `sbDoc()` helper already in tests/shadowbox.test.js (60×40 mm, res 96, marginMm 14, 4 layers, inset 3, stand off). Suite currently: **327 pass / 0 fail**.

New German copy contract (verbatim): seg „Schaukasten-Art" options **Auf Platte | Mit Rand | Schwebend**; accordion checkbox **Montagestifte**. New part names: `ebene-(k+1)-rand-M`, `ebene-(k+1)-schwebeteil-M` (+ `-oben`), `ebene-(k+1)-stift-M`.

---

### Task V2-1: Model — sbMode + pins block + migration

**Files:**
- Modify: `js/bookmark-model.js` (defaultShadowbox ~line 111; makeElementV2 base assign; migrateProject v2 element loop + shadowbox backfill; migrateElement out object)
- Modify: `tests/shadowbox.test.js`, `tests/run.html` (bump `bookmark-model.js?v=sb2` → `?v=sb11`)

**Interfaces:**
- Produces: `el.sbMode` ("plate" default; migration `sbOverhang:true → "rim"`); `doc.shadowbox.pins = { enabled: true, diameterMm: 3, clearanceMm: 0.35 }`.

- [ ] **Step 1: Failing tests** (append inside the IIFE):

```js
  test("schaukasten-v2: sbMode defaults and pins block", () => {
    const el = window.makeElementV2("shape", {});
    assertEqual(el.sbMode, "plate", "default mode");
    const sb = window.defaultShadowbox();
    assert(sb.pins && sb.pins.enabled === true, "pins on");
    assertEqual(sb.pins.diameterMm, 3, "peg diameter");
    assertClose(sb.pins.clearanceMm, 0.35, 1e-9, "hole clearance");
  });

  test("schaukasten-v2: migration upgrades sbOverhang to rim and backfills pins", () => {
    const d = window.defaultDoc();
    delete d.shadowbox.pins;
    const a = window.makeElementV2("shape", {}); delete a.sbMode; a.sbOverhang = true;
    const b = window.makeElementV2("shape", {}); delete b.sbMode;
    d.elements.push(a, b);
    const m = window.migrateProject(d);
    assertEqual(m.elements[0].sbMode, "rim", "overhang upgraded");
    assertEqual(m.elements[1].sbMode, "plate", "plain element");
    assert(m.shadowbox.pins && m.shadowbox.pins.enabled === true, "pins backfilled");
    const once = JSON.stringify(m);
    assertEqual(JSON.stringify(window.migrateProject(m)), once, "idempotent");
  });
```

- [ ] **Step 2: Register + RED run** (fresh port). Expected: both fail (`sbMode` undefined).
- [ ] **Step 3: Implement** — `defaultShadowbox()` gains `pins: { enabled: true, diameterMm: 3, clearanceMm: 0.35 },` after `stand: {...}`. `makeElementV2` base assign gains `sbMode: "plate",` after `sbOverhang: false,`. `migrateElement` out gains `sbMode: "plate",`. `migrateProject` v2: in the shadowbox backfill else-branch add `if (doc.shadowbox.pins == null) doc.shadowbox.pins = sd.pins;`; in the element loop add `if (el.sbMode == null) el.sbMode = el.sbOverhang ? "rim" : "plate";` (AFTER the sbOverhang backfill line).
- [ ] **Step 4: GREEN run** (fresh port) — expect 329/0.
- [ ] **Step 5: Commit** — `feat(schaukasten): Element-Art sbMode und Stift-Parameter — Migration hebt ragt-hinein auf Mit-Rand`

---

### Task V2-2: shadowboxPinSpots + disk stamp (pure helpers)

**Files:**
- Modify: `js/shadowbox.js` (token → `?v=sb12` in run.html), `tests/shadowbox.test.js`

**Interfaces:**
- Consumes: `window.__chamferDT` (build-parts export).
- Produces: `window.shadowboxPinSpots(mask, cols, rows, sx, sy, minMm, sepMm) -> [{xMm,yMm}]` (0..2 deterministic interior-clearance maxima; second spot ≥ sepMm from first; empty when max clearance < minMm); `window.__sbStampDisk(mask, cols, rows, sx, sy, xMm, yMm, rMm, value)` (in-place filled disk, rectangular mapping `x=(c+0.5)/sx`).

- [ ] **Step 1: Failing tests:**

```js
  function blobMask(cols, rows, sx, sy, discs) {
    const m = new Uint8Array(cols * rows);
    for (const d of discs) window.__sbStampDisk(m, cols, rows, sx, sy, d.x, d.y, d.r, 1);
    return m;
  }

  test("schaukasten-v2: pin spots — one centered spot for a single blob", () => {
    const cols = 96, rows = 64, sx = cols / 60, sy = rows / 40;
    const m = blobMask(cols, rows, sx, sy, [{ x: 30, y: 20, r: 8 }]);
    const spots = window.shadowboxPinSpots(m, cols, rows, sx, sy, 2.5, 12);
    assertEqual(spots.length, 1, "one spot (blob too small for two 12mm apart)");
    assertClose(spots[0].xMm, 30, 1.5, "centered x");
    assertClose(spots[0].yMm, 20, 1.5, "centered y");
  });

  test("schaukasten-v2: pin spots — two spots for two distant blobs, none for slivers", () => {
    const cols = 96, rows = 64, sx = cols / 60, sy = rows / 40;
    const two = blobMask(cols, rows, sx, sy, [{ x: 14, y: 20, r: 7 }, { x: 46, y: 20, r: 7 }]);
    assertEqual(window.shadowboxPinSpots(two, cols, rows, sx, sy, 2.5, 12).length, 2, "two anchors");
    const sliver = blobMask(cols, rows, sx, sy, [{ x: 30, y: 20, r: 1.2 }]);
    assertEqual(window.shadowboxPinSpots(sliver, cols, rows, sx, sy, 2.5, 12).length, 0, "sliver skipped");
    assertEqual(window.shadowboxPinSpots(new Uint8Array(cols * rows), cols, rows, sx, sy, 2.5, 12).length, 0, "empty mask");
  });
```

- [ ] **Step 2: RED run** (fresh port). **Step 3: Implement** in js/shadowbox.js:

```js
  // Stamp a filled disk into a raster mask (rectangular cell mapping, in place).
  function __sbStampDisk(mask, cols, rows, sx, sy, xMm, yMm, rMm, value) {
    const c0 = Math.max(0, Math.floor((xMm - rMm) * sx)), c1 = Math.min(cols - 1, Math.ceil((xMm + rMm) * sx));
    const r0 = Math.max(0, Math.floor((yMm - rMm) * sy)), r1 = Math.min(rows - 1, Math.ceil((yMm + rMm) * sy));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const dx = (c + 0.5) / sx - xMm, dy = (r + 0.5) / sy - yMm;
      if (dx * dx + dy * dy <= rMm * rMm) mask[r * cols + c] = value;
    }
  }

  // Deterministic assembly-pin spots: up to two interior chamfer-DT maxima of
  // an overlap mask. A spot needs >= minMm clearance to the mask boundary;
  // the second spot must sit >= sepMm from the first (two pins lock rotation).
  function shadowboxPinSpots(mask, cols, rows, sx, sy, minMm, sepMm) {
    const n = cols * rows, inv = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) { inv[i] = mask[i] ? 0 : 1; if (mask[i]) any = true; }
    if (!any) return [];
    const dt = window.__chamferDT(inv, cols, rows);
    const pmm = (1 / sx + 1 / sy) / 2;
    const mm = (i) => ({ xMm: ((i % cols) + 0.5) / sx, yMm: (Math.floor(i / cols) + 0.5) / sy });
    let best = -1;
    for (let i = 0; i < n; i++) if (mask[i] && (best < 0 || dt[i] > dt[best])) best = i;
    if (best < 0 || dt[best] * pmm < minMm) return [];
    const p1 = mm(best);
    let best2 = -1;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const p = mm(i);
      if (Math.hypot(p.xMm - p1.xMm, p.yMm - p1.yMm) < sepMm) continue;
      if (best2 < 0 || dt[i] > dt[best2]) best2 = i;
    }
    const out = [p1];
    if (best2 >= 0 && dt[best2] * pmm >= minMm) out.push(mm(best2));
    return out;
  }
```

Export both on `window`. **Step 4: GREEN** (fresh port, expect 331/0). **Step 5: Commit** — `feat(schaukasten): Stift-Positionen — deterministische Abstandsfeld-Maxima der Überlappungsmaske`

---

### Task V2-3: Engine — rim mode (prism one level forward)

**Files:**
- Modify: `js/build-parts.js` (`buildShadowboxParts`, currently lines 876-949; token → `?v=sb13`), `tests/shadowbox.test.js`

**Interfaces:**
- Consumes: existing overhang block (lines 913-931), `traceMaskToFacets`, `window.hexToRgb`.
- Produces: per-plate partition via `modeOf(el) = el.sbMode || (el.sbOverhang ? "rim" : "plate")` (defensive legacy fallback); dk.elements = **plate-mode only**; rim elements excluded from `composeDesignV2` (their prism replaces content — overlapping solids are a print defect) but their masks (a) union into the footprint exactly as today and (b) emit prism parts `rand-M` (before the ebene-prefix rename): `traceMaskToFacets(clipped mask, cols, rows, pitch, T, T)` → `[T, 2T]`, color `el.color`, clip = `mask && base > 0 && (k === 0 || !f || f(c,r) > (k-1)*inset)`.

- [ ] **Step 1: Failing tests:**

```js
  test("schaukasten-v2: rim element — prism one level forward, footprint kept", () => {
    const d = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 12, hMm: 8, color: "#FFFFFF" });
    el.sbLayer = 1; el.sbMode = "rim";
    d.elements.push(el);
    const parts = window.buildParts(d); // stack layout; plate 2 slab = [4,6]
    const prism = parts.find((p) => p.name === "ebene-2-rand-1");
    assert(!!prism, "prism part exists");
    const zb = zbounds(prism.facets);
    assertClose(zb[0], 6, 1e-6, "prism starts at plate top");
    assertClose(zb[1], 8, 1e-6, "prism ends one level forward");
    assert(!parts.some((p) => /^ebene-2-(farbe|erhaben|farbschicht)/.test(p.name)),
      "rim element emits no ordinary content");
  });

  test("schaukasten-v2: rim prism is clipped by the front plate's opening", () => {
    const mk = (cx) => {
      const d = sbDoc();
      const el = window.makeElementV2("shape", { cxMm: cx, cyMm: 20, wMm: 10, hMm: 8, color: "#FFFFFF" });
      el.sbLayer = 2; el.sbMode = "rim"; // front plate above is k=1 (opening threshold 3mm)
      d.elements.push(el);
      const p = window.buildParts(d).find((q) => q.name === "ebene-3-rand-1");
      return p ? p.facets.length : 0;
    };
    // near the plate edge the front plate is solid above -> heavy clipping
    assert(mk(9) < mk(30), "edge-hugging prism is clipped harder than a centered one");
  });

  test("schaukasten-v2: rim on the front plate is unclipped decorative relief", () => {
    const d = sbDoc();
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 10, hMm: 8, color: "#FFFFFF" });
    el.sbLayer = 0; el.sbMode = "rim";
    d.elements.push(el);
    const prism = window.buildParts(d).find((p) => p.name === "ebene-1-rand-1");
    assert(!!prism, "front-plate prism exists");
    // front plate slab [6,8] in a 4x2mm stack; the prism adds one more level
    assertClose(zbounds(prism.facets)[1], 4 * 2 + 2, 1e-6, "pokes above the whole stack");
  });
```

- [ ] **Step 2: RED** (fresh port). **Step 3: Implement** — inside `buildShadowboxParts`:
  - Add near `layerOf`: `const modeOf = (el) => el.sbMode || (el.sbOverhang ? "rim" : "plate");`
  - dk.elements filter becomes `doc.elements.filter((el) => layerOf(el) === k && modeOf(el) === "plate")`.
  - Replace the overhang block's element source: `const rimEls = doc.elements.filter((el) => layerOf(el) === k && modeOf(el) === "rim" && !el.cutout && !(el.type === "image" && !el._img));` — keep the union logic (mask into `over`, wrap `fp`), collect `rimMasks.push({ el, mask })`.
  - After `const plateParts = __contentParts(...)` and BEFORE the rename loop:

```js
      // Rand-Wolken: prism one level forward in the element color, clipped to
      // the front plate's opening so the closed stack never collides.
      let rimIdx = 0;
      for (const rm of rimMasks) {
        rimIdx++;
        const insetFront = (k - 1) * inset;
        const clip = (c, r) => {
          if (!rm.mask[r * cols + c] || base(c, r) <= 0) return false;
          return k === 0 || !f || f(c, r) > insetFront;
        };
        const facets = traceMaskToFacets(clip, cols, rows, pitch, T, T);
        if (facets.length) plateParts.push({ name: "rand-" + rimIdx, color: window.hexToRgb(rm.el.color || "#FFFFFF"), facets });
      }
```

  - Update the stale comment above `__contentParts` (it references sbOverhang; now say "rim elements").
- [ ] **Step 4: GREEN full suite** (fresh port) — the two Task-7 overhang tests still pass via the `modeOf` legacy fallback (they set `sbOverhang = true` without sbMode → "rim"); the overhang-area test compares grundplatte top-cap area which the footprint union still grows. If it fails, update those two tests to set `el.sbMode = "rim"` explicitly and re-verify — do not weaken assertions. Expect 334/0.
- [ ] **Step 5: Commit** — `feat(schaukasten): Mit-Rand-Elemente — Randerweiterung plus Prisma eine Ebene nach vorn, am Vorderöffnungs-Rand beschnitten`

---

### Task V2-4: Engine — floating pieces

**Files:**
- Modify: `js/build-parts.js` (token → `?v=sb14`), `tests/shadowbox.test.js`

**Interfaces:**
- Produces: floats collected BEFORE the plate loop: `floatLevel(el) = clamp(el.sbLayer == null ? n-2 : el.sbLayer, 0, n-2)`; piece mask = `__renderElementV2(el, doc, ...)` silhouette ∩ `{f > level*inset}`; parts `ebene-(level+1)-schwebeteil-M` (M = 1-based over all pieces), color `el.color`, slab `[0,T]` shifted: stack `dz=(n-1-level)*T`; bed: sequential x after the stand (`bedX` cursor advanced by mask bbox width + 5 mm; piece shifted by `bedX - bboxMinX`). Private `__maskBBoxMm(mask, cols, rows, sx, sy) -> {x0,x1,y0,y1}`. Float elements never reach plate content (already excluded by V2-3's plate-only filter). Pieces skipped when the clipped mask is empty. `if (!f) floats stay empty` (defensive).

- [ ] **Step 1: Failing tests:**

```js
  test("schaukasten-v2: floating piece — clipped to its opening, own part, right slab", () => {
    const d = sbDoc(); // 4 layers, T=2, inset 3
    // deterministic field: no wobble, margin 12 -> opening_2 = {d > 18} (exists at plate center)
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 12;
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 40, hMm: 20, color: "#FF7700" });
    el.sbLayer = 2; el.sbMode = "float"; // deepest allowed level (n-2)
    d.elements.push(el);
    const parts = window.buildParts(d);
    const piece = parts.filter((p) => p.name.indexOf("ebene-3-schwebeteil-") === 0);
    assert(piece.length >= 1, "piece exists");
    const zb = zbounds(piece.flatMap((p) => p.facets));
    assertClose(zb[0], (4 - 1 - 2) * 2, 1e-6, "piece bottom at its level slab");
    assertClose(zb[1], (4 - 1 - 2) * 2 + 2, 1e-6, "piece top");
    // 40x20 element vs opening threshold 6mm: the ring collision is cut off
    const xb = (fs) => { let lo = Infinity, hi = -Infinity; for (const f2 of fs) for (const v of f2) { lo = Math.min(lo, v[0]); hi = Math.max(hi, v[0]); } return [lo, hi]; };
    const [x0, x1] = xb(piece.flatMap((p) => p.facets));
    assert(x1 - x0 < 40 - 1, "wider than the opening -> clipped");
    assert(!parts.some((p) => /^ebene-3-(farbe|erhaben|farbschicht)/.test(p.name)), "not plate content");
  });

  test("schaukasten-v2: floating level clamps to n-2 and bed layout gives it its own spot", () => {
    const d = sbDoc();
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 12; // deterministic field
    const el = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 10, hMm: 8, color: "#FF7700" });
    el.sbLayer = null; el.sbMode = "float"; // null would be back plate -> clamped to n-2
    d.elements.push(el);
    const stack = window.buildParts(d);
    assert(stack.some((p) => p.name.indexOf("ebene-3-schwebeteil-") === 0), "clamped to level n-2");
    const bed = window.buildParts(d, { layout: "bed" });
    const piece = bed.filter((p) => p.name.indexOf("schwebeteil") >= 0);
    const zb = zbounds(piece.flatMap((p) => p.facets));
    assertClose(zb[0], 0, 1e-6, "on the bed");
    assertClose(zb[1], 2, 1e-6, "one plate thick");
    let plateHiX = -Infinity;
    for (const p of bed) if (p.name.indexOf("schwebeteil") < 0) for (const f2 of p.facets) for (const v of f2) plateHiX = Math.max(plateHiX, v[0]);
    let pieceLoX = Infinity;
    for (const p of piece) for (const f2 of p.facets) for (const v of f2) pieceLoX = Math.min(pieceLoX, v[0]);
    assert(pieceLoX > plateHiX - 1e-6, "piece placed right of plates and stand");
  });
```

- [ ] **Step 2: RED** (fresh port). **Step 3: Implement** per the Interfaces block: collect `floats` after `layerOf`/`modeOf` are defined and `f` exists; emit after the stand block (so `bedX` can start right of the stand: `let bedX = n * (W + gapMm) + gapMm + (stand.length ? Math.max(20, W * 0.7) + gapMm : 0);`). Piece emission:

```js
    let pieceIdx = 0;
    for (const fl of floats) {
      pieceIdx++;
      const pieceParts = [{
        name: "ebene-" + (fl.level + 1) + "-schwebeteil-" + pieceIdx,
        color: window.hexToRgb(fl.el.color || "#000000"),
        facets: traceMaskToFacets((c, r) => fl.mask[r * cols + c] === 1, cols, rows, pitch, T, 0),
      }].filter((p) => p.facets.length);
      if (!pieceParts.length) continue;
      if (layout === "stack") __shiftFacets(pieceParts, 0, 0, (n - 1 - fl.level) * T);
      else {
        const bb = __maskBBoxMm(fl.mask, cols, rows, sx, sy);
        __shiftFacets(pieceParts, bedX - bb.x0, 0, 0);
        bedX += (bb.x1 - bb.x0) + gapMm;
      }
      out.push(...pieceParts);
    }
```

NOTE on bed x: mesh x equals doc x (no flip on x) — `__maskBBoxMm` returns doc-mm and the shift is valid in mesh space.
- [ ] **Step 4: GREEN full suite** (fresh port). Expect 336/0. **Step 5: Commit** — `feat(schaukasten): Schwebeteile — eigene flache Teile in der Öffnung, am Rand abgeschnitten, eigener Druckbett-Platz`

---

### Task V2-5: Engine — assembly pins

**Files:**
- Modify: `js/build-parts.js` (token → `?v=sb15`), `tests/shadowbox.test.js`

**Interfaces:**
- Consumes: `window.shadowboxPinSpots`, `window.__sbStampDisk` (V2-2), floats list (V2-4).
- Produces: pins per spec — pairs (float at level k, float at k-1) with silhouette overlap, plus (back plate, float at n-2). Params: `pegR = pins.diameterMm/2` (default 1.5), `holeR = (diameterMm + clearanceMm)/2`, `pegH = min(1.2, 0.6*T)`, `holeDepth = min(T - 0.4, pegH + 0.2)`, spot args `(…, holeR + 1.0, 12)`. Peg = raster disk (radius pegR) traced `[T, T+pegH]` piece-local (or plate-local for back-plate pegs), name `ebene-(level+1)-stift-J` (J = 1-based global), color = its carrier's color (piece color / back plate color). Hole = disk (radius holeR) stamped OUT of the upper piece's bottom sub-slab `[0, holeDepth]`; solid top sub-slab `[holeDepth, T]` named `…-schwebeteil-M-oben`. Pegs/holes ship with their carrier through the SAME `__shiftFacets` call (build before shifting). `pins.enabled === false` → float output byte-identical to no-pins.

- [ ] **Step 1: Failing tests:**

```js
  function sbFloatDoc() { // two stacked floating pieces with a fat overlap
    const d = sbDoc();
    d.shadowbox.layers = 5; // levels 0..3 usable for floats (n-2 = 3)
    // deterministic field with generous deep openings: level3 = {d > 12}, level2 = {d > 10}
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    const lo = window.makeElementV2("shape", { cxMm: 30, cyMm: 20, wMm: 18, hMm: 12, color: "#00AA00" });
    lo.sbLayer = 3; lo.sbMode = "float";
    const up = window.makeElementV2("shape", { cxMm: 33, cyMm: 20, wMm: 14, hMm: 10, color: "#FF7700" });
    up.sbLayer = 2; up.sbMode = "float";
    d.elements.push(lo, up);
    return d;
  }

  test("schaukasten-v2: pins — peg on the lower piece, hole splits the upper piece", () => {
    const parts = window.buildParts(sbFloatDoc()); // stack: level3 slab [2,4], level2 slab [4,6]
    const peg = parts.filter((p) => p.name.indexOf("ebene-4-stift-") === 0);
    assert(peg.length >= 1, "peg exists on the lower piece");
    const zp = zbounds(peg.flatMap((p) => p.facets));
    assertClose(zp[0], 4, 1e-6, "peg base on lower piece's face");
    assertClose(zp[1], 4 + 1.2, 1e-6, "peg height 1.2 (0.6*T)");
    const upper = parts.filter((p) => p.name.indexOf("ebene-3-schwebeteil-") === 0);
    assert(upper.some((p) => /-oben$/.test(p.name)), "upper piece split into two slabs");
    const bottom = upper.find((p) => !/-oben$/.test(p.name));
    const top = upper.find((p) => /-oben$/.test(p.name));
    assertClose(zbounds(bottom.facets)[1], 4 + 1.4, 1e-6, "bottom sub-slab up to holeDepth");
    assertClose(zbounds(top.facets)[0], 4 + 1.4, 1e-6, "top sub-slab from holeDepth");
  });

  test("schaukasten-v2: pins — back plate anchors the deepest piece; toggle off is clean", () => {
    const d = sbFloatDoc();
    const parts = window.buildParts(d);
    assert(parts.some((p) => p.name.indexOf("ebene-5-stift-") === 0), "back plate peg for level n-2 piece");
    const off = sbFloatDoc(); off.shadowbox.pins.enabled = false;
    const po = window.buildParts(off);
    assert(!po.some((p) => p.name.indexOf("-stift-") >= 0), "no pegs when disabled");
    assert(!po.some((p) => /-oben$/.test(p.name)), "no split slabs when disabled");
  });

  test("schaukasten-v2: pins — tiny overlap yields no pin", () => {
    const d = sbDoc();
    d.shadowbox.layers = 5;
    d.shadowbox.opening.waviness = 0; d.shadowbox.opening.marginMm = 6; d.shadowbox.insetPerLayerMm = 2;
    const lo = window.makeElementV2("shape", { cxMm: 26, cyMm: 20, wMm: 8, hMm: 8, color: "#00AA00" });
    lo.sbLayer = 3; lo.sbMode = "float";
    const up = window.makeElementV2("shape", { cxMm: 34.5, cyMm: 20, wMm: 8, hMm: 8, color: "#FF7700" });
    up.sbLayer = 2; up.sbMode = "float"; // ~0.5mm sliver overlap with lo
    d.elements.push(lo, up);
    const parts = window.buildParts(d);
    assert(!parts.some((p) => p.name.indexOf("ebene-4-stift-") === 0), "sliver overlap -> no piece-piece pin");
  });
```

- [ ] **Step 2: RED** (fresh port). **Step 3: Implement** — after the floats are collected (before the plate loop, because back-plate pegs join plate n-1's parts):

```js
    // Montagestifte: peg on the rear part's face, blind hole in the front part.
    const pinCfg = sb.pins || {};
    const pinsOn = pinCfg.enabled !== false;
    const pegR = (pinCfg.diameterMm || 3) / 2;
    const holeR = ((pinCfg.diameterMm || 3) + (pinCfg.clearanceMm != null ? pinCfg.clearanceMm : 0.35)) / 2;
    const pegH = Math.min(1.2, 0.6 * T);
    const holeDepth = Math.min(T - 0.4, pegH + 0.2);
    const pinList = []; // { lower: float|"back", upper: float, spots }
    if (pinsOn && floats.length) {
      for (const lo of floats) for (const up of floats) {
        if (up.level !== lo.level - 1) continue;
        const overlap = new Uint8Array(cols * rows);
        let any = false;
        for (let i = 0; i < overlap.length; i++) if (lo.mask[i] && up.mask[i]) { overlap[i] = 1; any = true; }
        if (!any) continue;
        const spots = window.shadowboxPinSpots(overlap, cols, rows, sx, sy, holeR + 1.0, 12);
        if (spots.length) pinList.push({ lower: lo, upper: up, spots });
      }
      for (const up of floats) {
        if (up.level !== n - 2) continue;
        const spots = window.shadowboxPinSpots(up.mask, cols, rows, sx, sy, holeR + 1.0, 12);
        if (spots.length) pinList.push({ lower: "back", upper: up, spots });
      }
    }
    let pegIdx = 0;
    const pegParts = (spots, levelForName, color) => spots.map((sp) => {
      const m = new Uint8Array(cols * rows);
      window.__sbStampDisk(m, cols, rows, sx, sy, sp.xMm, sp.yMm, pegR, 1);
      return { name: "ebene-" + (levelForName + 1) + "-stift-" + (++pegIdx),
               color, facets: traceMaskToFacets((c, r) => m[r * cols + c] === 1, cols, rows, pitch, pegH, T) };
    }).filter((p) => p.facets.length);
```

  In the plate loop, for `k === n - 1`, append back-plate pegs to `plateParts` BEFORE the rename?? NO — pegs are already fully named; append AFTER the rename loop but BEFORE the shift: `if (isBack) for (const pin of pinList) if (pin.lower === "back") plateParts.push(...pegParts(pin.spots, n - 1, window.hexToRgb(colors[n - 1])));`
  In the float emission (V2-4 block), replace the single-slab pieceParts with:

```js
      const holeSpots = pinList.filter((p) => p.upper === fl).flatMap((p) => p.spots);
      const baseName = "ebene-" + (fl.level + 1) + "-schwebeteil-" + pieceIdx;
      const color = window.hexToRgb(fl.el.color || "#000000");
      const pieceParts = [];
      if (holeSpots.length) {
        const bm = fl.mask.slice();
        for (const sp of holeSpots) window.__sbStampDisk(bm, cols, rows, sx, sy, sp.xMm, sp.yMm, holeR, 0);
        pieceParts.push({ name: baseName, color, facets: traceMaskToFacets((c, r) => bm[r * cols + c] === 1, cols, rows, pitch, holeDepth, 0) });
        pieceParts.push({ name: baseName + "-oben", color, facets: traceMaskToFacets((c, r) => fl.mask[r * cols + c] === 1, cols, rows, pitch, T - holeDepth, holeDepth) });
      } else {
        pieceParts.push({ name: baseName, color, facets: traceMaskToFacets((c, r) => fl.mask[r * cols + c] === 1, cols, rows, pitch, T, 0) });
      }
      for (const pin of pinList) if (pin.lower === fl) pieceParts.push(...pegParts(pin.spots, fl.level, color));
      const alive = pieceParts.filter((p) => p.facets.length);
      if (!alive.length) continue;
      [shift + push as in V2-4, using `alive`]
```

- [ ] **Step 4: GREEN full suite** (fresh port). Expect 339/0. **Step 5: Commit** — `feat(schaukasten): Montagestifte — Zapfen am hinteren Teil, Sackloch im vorderen, Rückwand verankert das tiefste Teil`

---

### Task V2-6: UI — Schaukasten-Art seg + Montagestifte toggle

**Files:**
- Modify: `index.html` (replace the „ragt hinein" checkbox inside `#sbLayerRow`; add „Montagestifte" row after the Ständer row in the accordion)
- Modify: `js/editor.js` (replace the `sbOverhangChk` binding with three seg bindings; sync seg state + pins checkbox; float mode hides the hinten option in `#sbLayerSel`)

**Interfaces:**
- Markup: inside `#sbLayerRow`, replace the `<label class="adv-label toggle" …><input type="checkbox" id="sbOverhangChk"> ragt hinein</label>` with:

```html
              <div id="sbModeSeg" class="seg-group seg-sm" style="width:100%;margin-top:4px">
                <button type="button" id="sbModePlate" class="seg seg-active" style="flex:1" title="Inhalt liegt auf der Platte und wird am Öffnungsrand beschnitten">Auf Platte</button>
                <button type="button" id="sbModeRim" class="seg" style="flex:1" title="Mit dem Rand verbunden und ragt eine Ebene nach vorn (wie die Wolken im Beispiel)">Mit Rand</button>
                <button type="button" id="sbModeFloat" class="seg" style="flex:1" title="Schwebt als eigenes Teil in der Öffnung — Kollision mit dem Rand wird abgeschnitten; Montagestifte verbinden gestapelte Teile">Schwebend</button>
              </div>
```

(Place the seg UNDER the select — make `#sbLayerRow`'s flex container wrap or stack; match the sibling layout idiom you find there.) Accordion addition after the Ständer `adv-field-row`:

```html
            <div class="adv-field">
              <label class="adv-label toggle">
                <input type="checkbox" id="sbPins" checked title="Zapfen und Sacklöcher zwischen gestapelten Schwebeteilen (und zur Rückwand) mitdrucken — hilft beim Ausrichten und Verkleben"> Montagestifte
              </label>
            </div>
```

- editor.js: `bindElementField` for the three buttons (`el.sbMode = "plate"|"rim"|"float"`; also clear the legacy flag: `el.sbOverhang = false;` when setting any mode). In `refreshAdvancedForSelection`'s sb block: toggle `seg-active` per `el.sbMode || (el.sbOverhang ? "rim" : "plate")`; when the effective mode is "float", rebuild `#sbLayerSel` WITHOUT the last (hinten) option and clamp the displayed value to `n-2` (extend `sbPopulateLayerSelect(excludeBack)`); switching mode away from float restores the full list. `initShadowboxControls`: `on("sbPins", "change", function () { sbState().pins.enabled = this.checked; sbChanged(); });` and `syncShadowboxControls` sets `document.getElementById("sbPins").checked = sb.pins ? sb.pins.enabled !== false : true;`.

- [ ] **Step 1: Implement markup + wiring.** editor.js/index.html are not test-loaded — no tokens.
- [ ] **Step 2: Smoke over http (FRESH port):** enable Schaukasten; add Rechteck; seg shows „Auf Platte" active; click „Mit Rand" → evaluate `doc.elements[0].sbMode === "rim"`; click „Schwebend" → sbMode "float" AND the Ebene select no longer offers the hinten option; add a second Rechteck on the adjacent level, overlap them → 3D shows pegs (screenshot → `.superpowers/sdd/sb-v2-task-6-screenshot.png`); untick „Montagestifte" → pegs disappear from 3D; Ctrl+Z restores; full suite on the same server: 339/0.
- [ ] **Step 3: Commit** — `feat(schaukasten): Schaukasten-Art im Inspektor (Auf Platte, Mit Rand, Schwebend) und Montagestifte-Schalter`

---

### Task V2-7: Finalize — counts, e2e, docs

- [ ] **Step 1:** Full suite (fresh port), record exact count (expect 339). Update README badge (line ~15) + tests table row (~319) from 327 → actual.
- [ ] **Step 2:** E2e smoke rebuilding the sample: 6 Ebenen; rim cloud on Ebene 2 near the rim; three floating shapes stacked on levels 4/3/2 with overlaps (wings/body/head stand-ins); verify in 3D (screenshot); export 3MF → "Fertig."; bed layout via evaluate: pieces right of the stand, pegs present, `-oben` sub-slabs exist; engraved text on the back plate still works (Vertieft floor part). No console errors.
- [ ] **Step 3:** Full suite once more (fresh port): fail 0.
- [ ] **Step 4:** Commit — `feat(schaukasten): Element-Arten abgeschlossen — Doku und Testzahlen aktualisiert`
