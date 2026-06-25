"use strict";
// Persists control state to localStorage and manages named presets. Operates
// purely through the shared `els` map from app.js. Wrapped in an IIFE to avoid
// re-declaring `els` (already a const in app.js's script scope).
(function () {
  const els = window.els;

  const PRESET_CONTROLS = [
    'keepAlpha', 'thresh', 'island', 'invert', 'numColors', 'levels',
    'colorIsland', 'smooth', 'circleEnable', 'circleSize', 'circleThickness',
    'circleColor', 'modelWidth', 'thickBlack', 'thickWhite', 'ringThick',
    'frameWidth', 'baseThick', 'bodyColor', 'modelRes', 'modelSmooth',
  ];
  window.PRESET_CONTROLS = PRESET_CONTROLS;

  function captureState() {
    const s = {};
    for (const id of PRESET_CONTROLS) {
      const el = els[id];
      if (!el) continue;
      s[id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return s;
  }
  window.captureState = captureState;

  function applyState(state) {
    for (const id of PRESET_CONTROLS) {
      const el = els[id];
      if (!el || !(id in state)) continue;
      if (el.type === 'checkbox') el.checked = !!state[id];
      else el.value = state[id];
      el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
    }
  }
  window.applyState = applyState;

  const LAST_KEY = 'ukibori:last', PRESETS_KEY = 'ukibori:presets';

  function saveLastState() {
    try { localStorage.setItem(LAST_KEY, JSON.stringify(captureState())); } catch (e) {}
  }
  window.saveLastState = saveLastState;

  function restoreLastState() {
    try {
      const raw = localStorage.getItem(LAST_KEY);
      if (!raw) return false;
      applyState(JSON.parse(raw));
      return true;
    } catch (e) { return false; }
  }
  window.restoreLastState = restoreLastState;

  function listPresets() {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}'); } catch (e) { return {}; }
  }
  window.listPresets = listPresets;

  function savePreset(name) {
    const all = listPresets();
    all[name] = captureState();
    localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
  }
  window.savePreset = savePreset;

  function loadPreset(name) {
    const all = listPresets();
    if (!all[name]) return false;
    applyState(all[name]);
    return true;
  }
  window.loadPreset = loadPreset;

  function deletePreset(name) {
    const all = listPresets();
    delete all[name];
    localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
  }
  window.deletePreset = deletePreset;

  // Built-in presets seeded once if no presets exist yet.
  const BUILTIN_PRESETS = {
    'Untersetzer': { circleEnable: true, circleThickness: 12, ringThick: 4, baseThick: 2, thickBlack: 2.5, thickWhite: 2.5 },
    'Schild': { circleEnable: false, frameWidth: 40, ringThick: 4, baseThick: 2, thickBlack: 3, thickWhite: 3 },
    'Magnet': { circleEnable: false, frameWidth: 0, ringThick: 0, baseThick: 0, thickBlack: 2, thickWhite: 2 },
  };

  function seedBuiltinPresets() {
    if (Object.keys(listPresets()).length) return;
    const all = {};
    for (const [name, partial] of Object.entries(BUILTIN_PRESETS)) {
      const base = captureState();
      all[name] = Object.assign(base, partial);
    }
    localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
  }
  window.seedBuiltinPresets = seedBuiltinPresets;

  if (window.initPresets) window.initPresets();
}());
