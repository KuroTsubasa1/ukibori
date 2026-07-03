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
  for (const el of doc.elements || []) if (el.type === "image") el._img = null;
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

// Rand-Rahmen (raised ring frame) default for rect/circle bodies.
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
      thicknessMm: 3, layerHeightMm: 0.2, baseColor: "#000000", borderMm: 2,
      frame: defaultFrame(),
      autoSizeFromElementId: null, freeOutlineFromElementId: null,
    },
    // xMm/yMm = hole/loop CENTER (see migrateProject); yMm = marginMm + diameterMm/2.
    // ringThicknessMm = in-plane loop wall thickness; ringHeightMm = how far the loop
    // ring stands proud above the base top face (mm). Both used only when type === 'loop'.
    mount: { type: "none", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, ringHeightMm: 2, marginMm: 8 },
    resolution: 1024, colorStepLayers: 2,
    elements: [], fonts: {},
  };
}

function migrateElement(el, doc, layerHmm) {
  const isReduce = el.type === "image" && el.colorMode === "reduce";
  const depth = {
    mode: isReduce ? "colorLayers" : "solid",
    direction: "engraved",                       // v1 composer engraved colors into the front
    heightMm: (el.depthLayers != null ? el.depthLayers : 2) * layerHmm,
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
    cutout: !!el.cutout, color: el.color, depth,
  };
  if (el.type === "image") { out.src = el.src; out._img = null; }
  if (el.type === "text") { out.text = el.text; out.fontFamily = el.fontFamily; out.fontWeight = el.fontWeight; }
  if (el.type === "qr") { out.qrData = el.qrData; out.qrEcLevel = el.qrEcLevel; }
  return out;
}

function migrateProject(doc) {
  if (!doc) return doc;
  if (doc.version === DOC_VERSION) {
    // Already v2: fill fields added after the v2 schema shipped (older saves lack them).
    if (doc.body && doc.body.frame == null) doc.body.frame = defaultFrame();
    for (const el of doc.elements || []) {
      if (el.depth && el.depth.flush == null) el.depth.flush = false;
      // colorLayerStyle added in T14: derive from legacy flush when absent
      // (post-T13 flush=true meant bands / AMS).
      if (el.depth && el.depth.colorLayerStyle == null) {
        el.depth.colorLayerStyle = el.depth.flush ? "bands" : "stepped";
      }
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
      frame: defaultFrame(),
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
    elements: (doc.elements || []).map(el => migrateElement(el, doc, layerH)),
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
    cutout: false, color: "#ffffff",
    depth: defaultDepth(type),
  }, props);
  if (type === "image") { if (e.src == null) e.src = ""; e._img = e._img || null; }
  if (type === "text") { if (e.text == null) e.text = "Text"; if (e.fontFamily == null) e.fontFamily = "system-ui"; if (e.fontWeight == null) e.fontWeight = "normal"; }
  return e;
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
window.defaultDoc = defaultDoc;
window.migrateProject = migrateProject;
window.makeElementV2 = makeElementV2;
window.mergeReduceColors = mergeReduceColors;
window.unmergeReduceColor = unmergeReduceColor;
window.resolveMergeRoots = resolveMergeRoots;
window.pruneReduceMerges = pruneReduceMerges;
