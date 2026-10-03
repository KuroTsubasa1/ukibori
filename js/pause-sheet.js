"use strict";
// Pausen-Spickzettel: derive the manual filament-swap schedule from built
// parts, for printers WITHOUT an AMS. Because Ukibori stacks colors as full
// single-color z-bands, the pause heights are exact, not estimated. Pure math
// over buildParts() output — no DOM.

const __PAUSE_EPS = 1e-4;

function __pauseHex(color) {
  const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return ("#" + h(color[0]) + h(color[1]) + h(color[2])).toUpperCase();
}

function __pauseZRange(facets) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < facets.length; i++) {
    const t = facets[i];
    for (let k = 0; k < 3; k++) {
      const z = t[k][2];
      if (z < mn) mn = z;
      if (z > mx) mx = z;
    }
  }
  return { mn, mx };
}

// parts: buildParts() output [{name, color:[r,g,b], facets}].
// layerHeightMm: print layer height (doc.body.layerHeightMm).
// Returns {
//   slabs:  [{z0, z1, colors:[hex…]}]  merged z-intervals with a constant color set,
//   swaps:  [{zMm, layer, color, offGrid}]  first entry = starting filament (zMm 0,
//           layer 1); later entries = pause BEFORE printing `layer`,
//   mixed:  slabs holding >1 color at once (not printable via pause-swap),
//   totalHeightMm, layers
// }.
function buildPauseSheet(parts, layerHeightMm) {
  const lh = layerHeightMm > 0 ? layerHeightMm : 0.2;
  const items = (parts || [])
    .map(p => Object.assign({ hex: __pauseHex(p.color) }, __pauseZRange(p.facets)))
    .filter(it => isFinite(it.mn) && it.mx - it.mn > __PAUSE_EPS);
  if (!items.length) return { slabs: [], swaps: [], mixed: [], totalHeightMm: 0, layers: 0 };

  let zs = [];
  items.forEach(it => { zs.push(it.mn, it.mx); });
  zs = Array.from(new Set(zs.map(z => Math.round(z / __PAUSE_EPS) * __PAUSE_EPS))).sort((a, b) => a - b);

  const slabs = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i], z1 = zs[i + 1];
    if (z1 - z0 <= __PAUSE_EPS) continue;
    const mid = (z0 + z1) / 2;
    const colors = [];
    items.forEach(it => {
      if (it.mn - __PAUSE_EPS < mid && mid < it.mx + __PAUSE_EPS && colors.indexOf(it.hex) === -1) colors.push(it.hex);
    });
    if (!colors.length) continue; // vertical gap between parts
    colors.sort();
    const prev = slabs[slabs.length - 1];
    if (prev && Math.abs(prev.z1 - z0) < __PAUSE_EPS && prev.colors.join() === colors.join()) prev.z1 = z1;
    else slabs.push({ z0, z1, colors });
  }

  const totalHeightMm = zs[zs.length - 1];
  const swaps = [];
  const mixed = slabs.filter(s => s.colors.length > 1);
  let cur = null;
  slabs.forEach(s => {
    if (s.colors.length !== 1) return; // mixed slabs are reported separately
    const c = s.colors[0];
    if (c === cur) return;
    const layer = swaps.length === 0 ? 1 : Math.round(s.z0 / lh) + 1;
    const offGrid = swaps.length === 0 ? false : Math.abs(s.z0 / lh - Math.round(s.z0 / lh)) > 1e-3;
    swaps.push({ zMm: swaps.length === 0 ? 0 : s.z0, layer, color: c, offGrid });
    cur = c;
  });

  return { slabs, swaps, mixed, totalHeightMm, layers: Math.ceil(totalHeightMm / lh - 1e-6) };
}

// Renders the sheet as a German plain-text file body.
function formatPauseSheet(sheet, opts) {
  const o = opts || {};
  const lh = o.layerHeightMm > 0 ? o.layerHeightMm : 0.2;
  const de = n => n.toFixed(2).replace(".", ",");
  const lines = [];
  lines.push("Ukibori — Pausen-Spickzettel (manueller Farbwechsel ohne AMS)");
  if (o.name) lines.push("Projekt: " + o.name);
  lines.push("Schichthöhe: " + de(lh) + " mm · Gesamthöhe: " + de(sheet.totalHeightMm) + " mm (" + sheet.layers + " Schichten)");
  lines.push("");
  if (!sheet.swaps.length) {
    lines.push("Keine druckbaren Farbschichten gefunden.");
  } else {
    lines.push("Start: Filament " + sheet.swaps[0].color + " einlegen (ab Schicht 1).");
    for (let i = 1; i < sheet.swaps.length; i++) {
      const s = sheet.swaps[i];
      lines.push("Pause VOR Schicht " + s.layer + " (Z = " + de(s.zMm) + " mm) → wechseln zu " + s.color +
        (s.offGrid ? "  [! Grenze liegt nicht auf dem Schichtraster]" : ""));
    }
    if (sheet.swaps.length === 1 && !sheet.mixed.length) {
      lines.push("Nur eine Farbe — keine Pausen nötig.");
    }
  }
  if (sheet.mixed.length) {
    lines.push("");
    lines.push("ACHTUNG — nicht per Pausen-Wechsel druckbar:");
    sheet.mixed.forEach(m => {
      lines.push("  Z " + de(m.z0) + "–" + de(m.z1) + " mm enthält mehrere Farben gleichzeitig (" +
        m.colors.join(", ") + "). Diese Zone braucht AMS/Mehrfarbdruck.");
    });
  }
  lines.push("");
  lines.push("So geht's im Slicer (Bambu Studio / OrcaSlicer / PrusaSlicer):");
  lines.push("  Nach dem Slicen im Vorschau-Tab den Schieberegler auf die genannte Schicht ziehen");
  lines.push("  und dort per Rechtsklick/„+“ eine Pause einfügen. Beim Halt Filament wechseln.");
  return lines.join("\n") + "\n";
}

window.buildPauseSheet = buildPauseSheet;
window.formatPauseSheet = formatPauseSheet;
