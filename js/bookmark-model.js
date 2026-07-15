"use strict";
// Pure bookmark document model + project (de)serialization. No DOM.

let __bmId = 0;
function __nextId() { __bmId += 1; return String(__bmId); }

function defaultBookmark() {
  return {
    widthMm: 50, heightMm: 150, cornerRadiusMm: 4,
    thicknessMm: 3, layerHeightMm: 0.2, smooth: 0.5,
    colorStepLayers: 2, resolution: 1024, baseColor: "#000000",
    hole: { diameterMm: 5, marginTopMm: 8 },
    elements: [],
    fonts: {},
  };
}

function __baseElement(type, props) {
  return Object.assign({
    id: __nextId(), type,
    cxMm: 25, cyMm: 75, wMm: 30, hMm: 30, rotationDeg: 0,
    depthLayers: 2, cutout: false, colorMode: "solid",
  }, props);
}

function makeImageElement(props) {
  const e = __baseElement("image", props);
  if (e.color == null) e.color = "#ffffff";
  if (e.threshold == null) e.threshold = 128;
  if (e.invert == null) e.invert = false;
  if (e.reduce == null) e.reduce = { method: "palette", numColors: 8, levels: 4, remap: {} };
  if (e.reduce.remap == null) e.reduce.remap = {}; // extractedHex -> chosenHex
  if (e.src == null) e.src = "";
  e._img = null; // runtime-only decoded image; never serialized
  return e;
}

function makeTextElement(props) {
  const e = __baseElement("text", props);
  if (e.text == null) e.text = "Text";
  if (e.color == null) e.color = "#ffffff";
  if (e.fontFamily == null) e.fontFamily = "system-ui";
  if (e.fontWeight == null) e.fontWeight = "normal";
  e.colorMode = "solid"; // text is always solid
  return e;
}

function serializeProject(doc) {
  // Strip runtime-only fields (decoded image + cached display canvas).
  const drop = { _img: 1, _display: 1, _displayKey: 1 };
  return JSON.stringify(doc, (k, v) => (drop[k] ? undefined : v), 2);
}

function deserializeProject(text) {
  const doc = JSON.parse(text);
  for (const el of doc.elements || []) {
    if (el.type === "image") el._img = null;
    // Keep the id counter ahead of loaded ids — a fresh makeElementV2 after
    // Öffnen/Beispiel must never mint an id that already exists in the doc.
    const n = parseInt(el.id, 10);
    if (Number.isFinite(n) && n > __bmId) __bmId = n;
  }
  if (!doc.fonts) doc.fonts = {};
  return doc;
}

// === v2 unified document schema =========================================
// Additive: the live editor still uses the v1 functions above. migrateProject()
// (Task 2) bridges saved v1 projects to this shape; the UI merge phase will
// switch the editor over to defaultDoc()/migrateProject().
const DOC_VERSION = 2;

function defaultDepth(type) {
  return {
    mode: "solid",                 // text/qr are always solid; images may change later
    direction: "raised",
    heightMm: 1.0,
    heightOverrideMm: null,        // autoLayerHeights: manual per-element height (null = auto from color)
    stepLayers: 2,
    reduce: { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] },
    threshold: 128,
    invert: false,
    smooth: 0.5,
    baseFloorMm: 0,
    minIsland: 0,                  // pixels; 0 = off (Inseln entfernen disabled by default)
    flush: false,                  // legacy back-compat read: superseded by colorLayerStyle (kept for saved docs)
    colorLayerStyle: "stepped",    // colorLayers stacking: 'stepped' (rank heights) | 'flush' (one flat surface) | 'bands' (AMS)
  };
}

// Zierkante: ornamental plate edge (rect/circle plates). style 'none' keeps
// the classic outline; sizeMm = carve depth (wave/teeth) or hole Ø (perforation).
function defaultEdge() {
  return { style: "none", sizeMm: 2, periodMm: 8 };
}

// Zierlinie: contour-following decorative line (rect/circle plates). mode
// 'engraved' carves a groove into the plate top (epoxy/lacquer fill), 'raised'
// prints a slim ridge; count 1-3 lines, gap = 1.5 × width.
function defaultLine() {
  return { mode: "none", insetMm: 2.5, widthMm: 0.8, depthMm: 0.6, count: 1, color: "#000000" };
}

// Rand-Rahmen (raised ring frame) default for rect/circle/free bodies.
// widthMm 0 = OFF (parity); heightMm = extrusion above the base top face.
function defaultFrame() {
  return { widthMm: 0, heightMm: 2, color: "#000000" };
}

function defaultDoc() {
  return {
    version: DOC_VERSION,
    body: {
      shape: "rect",
      widthMm: 50, heightMm: 150, cornerRadiusMm: 4,
      thicknessMm: 3, layerHeightMm: 0.2, baseColor: "#ffffff", borderMm: 2,
      // Solid base-plate floor thickness under engraved detail (0 = auto-derive from thickness).
      baseThicknessMm: 0,
      frame: defaultFrame(),
      edge: defaultEdge(),
      line: defaultLine(),
      autoSizeFromElementId: null, freeOutlineFromElementId: null,
    },
    // xMm/yMm = hole/loop CENTER (see migrateProject); yMm = marginMm + diameterMm/2.
    // ringThicknessMm = in-plane loop wall thickness; ringHeightMm = how far the loop
    // ring stands proud above the base top face (mm). Both used only when type === 'loop'.
    mount: { type: "none", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 },
    resolution: 1024, colorStepLayers: 2,
    // AMS shared filament palette: ordered UPPERCASE hex layers (index 0 = layer 1 = bottom,
    // darkest by default). Empty = not in use → legacy per-element bands behavior (parity).
    amsPalette: [],
    // When true, keep the surrounding plate a single solid base color in AMS bands mode
    // (don't split it into color bands); only the recessed inlay stays multicolor.
    amsSolidBase: false,
    // Einfarbig (solid) elements take their height from their COLOR, AMS-style: same color =
    // same layer, distinct colors stack in colorStepLayers*layerHeightMm steps, base-colored
    // elements stay flush with the plate. New docs default ON; pre-feature saves migrate OFF
    // so their geometry is unchanged (see migrateProject).
    autoLayerHeights: true,
    // Deckschicht: optional cover color for the auto-layer stack. Takes rank 0 (the
    // workpiece's face — engraved: topmost plate band; raised: full-face slab under the
    // motif stack), pushing element colors one step further. null = off.
    topLayerColor: null,
    elements: [], groups: [], fonts: {},
  };
}

function migrateElement(el, doc, layerHmm) {
  const isReduce = el.type === "image" && el.colorMode === "reduce";
  const depth = {
    mode: isReduce ? "colorLayers" : "solid",
    direction: "engraved",                       // v1 composer engraved colors into the front
    heightMm: (el.depthLayers != null ? el.depthLayers : 2) * layerHmm,
    heightOverrideMm: null,        // v1 had no auto layer heights → no override
    stepLayers: doc.colorStepLayers != null ? doc.colorStepLayers : 2,
    reduce: el.reduce
      ? { method: el.reduce.method || "palette", numColors: el.reduce.numColors || 8,
          levels: el.reduce.levels || 4, remap: el.reduce.remap || {}, order: el.reduce.order || [] }
      : { method: "palette", numColors: 8, levels: 4, remap: {}, order: [] },
    threshold: el.threshold != null ? el.threshold : 128,
    invert: !!el.invert,
    smooth: doc.smooth != null ? doc.smooth : 0.5,
    baseFloorMm: 0,
    minIsland: 0,                  // v1 had no island removal → fill with 0
    flush: false,                  // v1 had no flush surface → fill with false
    colorLayerStyle: "stepped",    // v1 colorLayers were always stepped
  };
  const out = {
    id: el.id, type: el.type,
    cxMm: el.cxMm, cyMm: el.cyMm, wMm: el.wMm, hMm: el.hMm, rotationDeg: el.rotationDeg || 0,
    flipH: false, flipV: false,
    cutout: !!el.cutout, color: el.color, groupId: el.groupId != null ? el.groupId : null, depth,
  };
  if (el.type === "image") { out.src = el.src; out._img = null; }
  if (el.type === "text") { out.text = el.text; out.fontFamily = el.fontFamily; out.fontWeight = el.fontWeight; out.arcDeg = el.arcDeg != null ? el.arcDeg : 0; }
  if (el.type === "qr") { out.qrData = el.qrData; out.qrEcLevel = el.qrEcLevel; }
  return out;
}

function migrateProject(doc) {
  if (!doc) return doc;
  if (doc.version === DOC_VERSION) {
    // Already v2: fill fields added after the v2 schema shipped (older saves lack them).
    if (doc.body && doc.body.frame == null) doc.body.frame = defaultFrame();
    if (doc.body && doc.body.edge == null) doc.body.edge = defaultEdge();
    if (doc.body && doc.body.line == null) doc.body.line = defaultLine();
    // AMS shared palette: backfill if missing, else normalize (uppercase / dedup / drop invalid)
    // so a hand-edited or older save can't feed the engine a lowercase or malformed layer color.
    if (!Array.isArray(doc.amsPalette)) doc.amsPalette = [];
    else if (doc.amsPalette.length) setAmsPalette(doc, doc.amsPalette);
    if (doc.amsSolidBase == null) doc.amsSolidBase = false;
    // Auto layer heights shipped after these saves existed → keep their manual heights.
    if (doc.autoLayerHeights == null) doc.autoLayerHeights = false;
    if (doc.topLayerColor === undefined) doc.topLayerColor = null;
    if (doc.body && doc.body.baseThicknessMm == null) doc.body.baseThicknessMm = 0;
    if (!Array.isArray(doc.groups)) doc.groups = [];
    for (const el of doc.elements || []) {
      if (el.flipH == null) el.flipH = false;
      if (el.flipV == null) el.flipV = false;
      if (el.depth && el.depth.flush == null) el.depth.flush = false;
      if (el.depth && el.depth.heightOverrideMm === undefined) el.depth.heightOverrideMm = null;
      // colorLayerStyle added in T14: derive from legacy flush when absent
      // (post-T13 flush=true meant bands / AMS).
      if (el.depth && el.depth.colorLayerStyle == null) {
        el.depth.colorLayerStyle = el.depth.flush ? "bands" : "stepped";
      }
      if (el.type === "shape" && el.shape == null) el.shape = "rect";
      if (el.type === "shape" && el.edge == null) el.edge = { style: "none", sizeMm: 1.5, periodMm: 6 };
      if (el.type === "text" && el.arcDeg == null) el.arcDeg = 0;
      if (el.type === "text" && el.textPath === undefined) el.textPath = null;
      if (el.groupId === undefined) el.groupId = null;
    }
    return doc;
  }
  const layerH = doc.layerHeightMm != null ? doc.layerHeightMm : 0.2;
  const hole = doc.hole || null;
  return {
    version: DOC_VERSION,
    body: {
      shape: "rect",
      widthMm: doc.widthMm, heightMm: doc.heightMm,
      cornerRadiusMm: doc.cornerRadiusMm != null ? doc.cornerRadiusMm : 0,
      thicknessMm: doc.thicknessMm, layerHeightMm: layerH,
      baseColor: doc.baseColor || "#000000", borderMm: 2,
      baseThicknessMm: 0,
      frame: defaultFrame(),
      edge: defaultEdge(),
      line: defaultLine(),
      autoSizeFromElementId: null, freeOutlineFromElementId: null,
    },
    // mount.xMm/yMm are the hole/loop CENTER (matches js/geometry.js roundedRectHoleField:
    // holeCx = widthMm/2, holeCy = marginTopMm + diameterMm/2). marginMm keeps the original
    // top-margin UI value so the editor can still present a "distance from top" control.
    mount: hole
      ? { type: "hole", xMm: doc.widthMm / 2, yMm: hole.marginTopMm + hole.diameterMm / 2,
          diameterMm: hole.diameterMm, ringThicknessMm: 0, ringHeightMm: 2, marginMm: hole.marginTopMm }
      : { type: "none", xMm: (doc.widthMm || 0) / 2, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 },
    resolution: doc.resolution != null ? doc.resolution : 1024,
    colorStepLayers: doc.colorStepLayers != null ? doc.colorStepLayers : 2,
    amsPalette: [], amsSolidBase: false,
    autoLayerHeights: false, topLayerColor: null, // v1 saves predate the feature: keep manual heights
    elements: (doc.elements || []).map(el => migrateElement(el, doc, layerH)),
    groups: [],
    fonts: doc.fonts || {},
  };
}

// === v2 element factory =====================================================
// Creates a v2-shaped element (uses v2 doc's depth/color fields, not v1
// colorMode/depthLayers). Additive — does not change existing v1 factories.
function makeElementV2(type, props) {
  const e = Object.assign({
    id: __nextId(), type,
    cxMm: 25, cyMm: 75, wMm: 30, hMm: 30, rotationDeg: 0,
    flipH: false, flipV: false,
    cutout: false, color: "#000000", groupId: null,
    depth: defaultDepth(type),
  }, props);
  if (type === "image") { if (e.src == null) e.src = ""; e._img = e._img || null; }
  if (type === "text") { if (e.text == null) e.text = "Text"; if (e.fontFamily == null) e.fontFamily = "system-ui"; if (e.fontWeight == null) e.fontWeight = "normal"; if (e.arcDeg == null) e.arcDeg = 0; if (e.textPath === undefined) e.textPath = null; }
  if (type === "shape") {
    if (e.shape == null) e.shape = "rect"; // 'rect' | 'circle' (ellipse when wMm ≠ hMm)
    if (e.edge == null) e.edge = { style: "none", sizeMm: 1.5, periodMm: 6 }; // Zierkante für Formen
  }
  return e;
}

function makeGroup(props) {
  return Object.assign({ id: __nextId(), name: "Gruppe", collapsed: false, parentId: null }, props || {});
}

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

// === Color merge (Farbe zusammenführen) =====================================
// Fold one natural palette color into another so both print at the SAME color/height
// (flattens noisy images). Stored lazily as reduce.merges { fromNaturalHex: toNaturalHex },
// hex keys/values UPPERCASE to match the engine's palette-hex formatting. The engine resolves
// merges → root before applying remap, so merged pixels collapse into a single region/layer
// and follow the target's later recolor. merges absent/empty ⇒ no-op (byte-identical parity).
function mergeReduceColors(reduce, fromNat, toNat) {
  if (!reduce || !fromNat || !toNat) return reduce;
  fromNat = String(fromNat).toUpperCase();
  toNat = String(toNat).toUpperCase();
  if (fromNat === toNat) return reduce;
  if (!reduce.merges) reduce.merges = {};
  // Resolve the requested target to its own root (it may itself already be merged).
  const rootOf = (h) => { const seen = {}; let t = String(h).toUpperCase(); while (reduce.merges[t] && !seen[t]) { seen[t] = 1; t = String(reduce.merges[t]).toUpperCase(); } return t; };
  const tgt = rootOf(toNat);
  if (tgt === fromNat) return reduce; // would create a cycle → ignore
  // Redirect colors previously merged INTO fromNat so they follow to the new target.
  for (const k in reduce.merges) if (String(reduce.merges[k]).toUpperCase() === fromNat) reduce.merges[k] = tgt;
  reduce.merges[fromNat] = tgt;
  // Keep fromNat in reduce.order: once merged it carries no pixels (emits no geometry), and
  // preserving its position restores the original color rank if the user later un-merges it.
  return reduce;
}

function unmergeReduceColor(reduce, fromNat) {
  if (!reduce || !reduce.merges || !fromNat) return reduce;
  delete reduce.merges[String(fromNat).toUpperCase()];
  return reduce;
}

// Drop merge entries referencing a hex no longer in the current palette (e.g. after the color
// count / method changed), so a merge can never leave a color hidden-but-unrecoverable in the UI.
function pruneReduceMerges(reduce, paletteHexes) {
  if (!reduce || !reduce.merges) return reduce;
  const inPal = {};
  (paletteHexes || []).forEach(h => { inPal[String(h).toUpperCase()] = 1; });
  for (const k in reduce.merges) {
    if (!inPal[String(k).toUpperCase()] || !inPal[String(reduce.merges[k]).toUpperCase()]) delete reduce.merges[k];
  }
  return reduce;
}

// === AMS shared filament palette (doc.amsPalette) ==================================
// An ordered list of UPPERCASE hex layers shared by the whole print. When non-empty, bands
// (AMS) elements quantize to it and share layer heights, and the base plate bands follow it.
function __amsNormHex(h) {
  if (h == null) return null;
  var s = String(h).trim();
  if (s[0] !== '#') s = '#' + s;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  return s.toUpperCase();
}
function __amsLum(hex) {
  var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
// Populate an empty amsPalette from `hexes` (dedup, normalize, default order darkest→lightest).
// No-op if the palette is already seeded — user edits/order are preserved.
function seedAmsPalette(doc, hexes) {
  if (!doc) return doc;
  if (Array.isArray(doc.amsPalette) && doc.amsPalette.length) return doc;
  var seen = {}, out = [];
  (hexes || []).forEach(function (h) { var H = __amsNormHex(h); if (H && !seen[H]) { seen[H] = 1; out.push(H); } });
  out.sort(function (a, b) { return __amsLum(a) - __amsLum(b); });
  doc.amsPalette = out;
  return doc;
}
function addAmsColor(doc, hex) {
  var H = __amsNormHex(hex); if (!doc || !H) return doc;
  if (!Array.isArray(doc.amsPalette)) doc.amsPalette = [];
  if (doc.amsPalette.indexOf(H) === -1) doc.amsPalette.push(H);
  return doc;
}
function removeAmsColor(doc, hex) {
  var H = __amsNormHex(hex); if (!doc || !H || !Array.isArray(doc.amsPalette)) return doc;
  doc.amsPalette = doc.amsPalette.filter(function (h) { return h !== H; });
  return doc;
}
// Replace the palette with a validated, deduped, normalized array (used by drag-reorder).
function setAmsPalette(doc, arr) {
  if (!doc) return doc;
  var seen = {}, out = [];
  (arr || []).forEach(function (h) { var H = __amsNormHex(h); if (H && !seen[H]) { seen[H] = 1; out.push(H); } });
  doc.amsPalette = out;
  return doc;
}
// Nearest palette hex to an [r,g,b] (Euclidean), or null if the palette is empty.
function nearestAmsColor(amsPalette, r, g, b) {
  if (!amsPalette || !amsPalette.length) return null;
  var best = null, bestD = Infinity;
  for (var i = 0; i < amsPalette.length; i++) {
    var h = amsPalette[i];
    var pr = parseInt(h.slice(1, 3), 16), pg = parseInt(h.slice(3, 5), 16), pb = parseInt(h.slice(5, 7), 16);
    var d = (pr - r) * (pr - r) + (pg - g) * (pg - g) + (pb - b) * (pb - b);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

// Flatten reduce.merges to a { naturalHex: rootHex } map (chains resolved, cycles guarded).
function resolveMergeRoots(merges) {
  const out = {};
  if (!merges) return out;
  const root = (h) => { const seen = {}; let t = String(h).toUpperCase(); while (merges[t] && !seen[t]) { seen[t] = 1; t = String(merges[t]).toUpperCase(); } return t; };
  for (const k in merges) out[String(k).toUpperCase()] = root(k);
  return out;
}

window.defaultBookmark = defaultBookmark;
window.makeImageElement = makeImageElement;
window.makeTextElement = makeTextElement;
window.serializeProject = serializeProject;
window.deserializeProject = deserializeProject;
window.DOC_VERSION = DOC_VERSION;
window.defaultDepth = defaultDepth;
window.defaultFrame = defaultFrame;
window.defaultEdge = defaultEdge;
window.defaultLine = defaultLine;
window.defaultDoc = defaultDoc;
window.migrateProject = migrateProject;
window.makeElementV2 = makeElementV2;
window.makeGroup = makeGroup;
window.childGroupIds = childGroupIds;
window.groupDescendantLeafIds = groupDescendantLeafIds;
window.flattenGroupForest = flattenGroupForest;
window.reindexContiguous = reindexContiguous;
window.groupElements = groupElements;
window.ungroupGroup = ungroupGroup;
window.mergeReduceColors = mergeReduceColors;
window.unmergeReduceColor = unmergeReduceColor;
window.resolveMergeRoots = resolveMergeRoots;
window.pruneReduceMerges = pruneReduceMerges;
window.seedAmsPalette = seedAmsPalette;
window.addAmsColor = addAmsColor;
window.removeAmsColor = removeAmsColor;
window.setAmsPalette = setAmsPalette;
window.nearestAmsColor = nearestAmsColor;
