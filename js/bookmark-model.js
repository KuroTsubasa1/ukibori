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
  };
}

function defaultDoc() {
  return {
    version: DOC_VERSION,
    body: {
      shape: "rect",
      widthMm: 50, heightMm: 150, cornerRadiusMm: 4,
      thicknessMm: 3, layerHeightMm: 0.2, baseColor: "#000000",
      autoSizeFromElementId: null, freeOutlineFromElementId: null,
    },
    // xMm/yMm = hole/loop CENTER (see migrateProject); yMm = marginMm + diameterMm/2.
    mount: { type: "none", xMm: 25, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, marginMm: 8 },
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
  if (!doc || doc.version === DOC_VERSION) return doc;
  const layerH = doc.layerHeightMm != null ? doc.layerHeightMm : 0.2;
  const hole = doc.hole || null;
  return {
    version: DOC_VERSION,
    body: {
      shape: "rect",
      widthMm: doc.widthMm, heightMm: doc.heightMm,
      cornerRadiusMm: doc.cornerRadiusMm != null ? doc.cornerRadiusMm : 0,
      thicknessMm: doc.thicknessMm, layerHeightMm: layerH,
      baseColor: doc.baseColor || "#000000",
      autoSizeFromElementId: null, freeOutlineFromElementId: null,
    },
    // mount.xMm/yMm are the hole/loop CENTER (matches js/geometry.js roundedRectHoleField:
    // holeCx = widthMm/2, holeCy = marginTopMm + diameterMm/2). marginMm keeps the original
    // top-margin UI value so the editor can still present a "distance from top" control.
    mount: hole
      ? { type: "hole", xMm: doc.widthMm / 2, yMm: hole.marginTopMm + hole.diameterMm / 2,
          diameterMm: hole.diameterMm, ringThicknessMm: 0, marginMm: hole.marginTopMm }
      : { type: "none", xMm: (doc.widthMm || 0) / 2, yMm: 10.5, diameterMm: 5, ringThicknessMm: 0, marginMm: 8 },
    resolution: doc.resolution != null ? doc.resolution : 1024,
    colorStepLayers: doc.colorStepLayers != null ? doc.colorStepLayers : 2,
    elements: (doc.elements || []).map(el => migrateElement(el, doc, layerH)),
    fonts: doc.fonts || {},
  };
}

window.defaultBookmark = defaultBookmark;
window.makeImageElement = makeImageElement;
window.makeTextElement = makeTextElement;
window.serializeProject = serializeProject;
window.deserializeProject = deserializeProject;
window.DOC_VERSION = DOC_VERSION;
window.defaultDepth = defaultDepth;
window.defaultDoc = defaultDoc;
window.migrateProject = migrateProject;
