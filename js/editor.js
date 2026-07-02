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
