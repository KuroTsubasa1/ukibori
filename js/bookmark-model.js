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
  if (e.reduce == null) e.reduce = { method: "palette", numColors: 8, levels: 4 };
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
  return JSON.stringify(doc, (k, v) => (k === "_img" ? undefined : v), 2);
}

function deserializeProject(text) {
  const doc = JSON.parse(text);
  for (const el of doc.elements || []) if (el.type === "image") el._img = null;
  if (!doc.fonts) doc.fonts = {};
  return doc;
}

window.defaultBookmark = defaultBookmark;
window.makeImageElement = makeImageElement;
window.makeTextElement = makeTextElement;
window.serializeProject = serializeProject;
window.deserializeProject = deserializeProject;
