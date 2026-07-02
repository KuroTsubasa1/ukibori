"use strict";
// Unified editor controller. Owns the v2 doc; renders the 2D canvas; manages the
// Simple/Advanced view. Ported from bookmark-editor.js draw/hit/drag, adapted to
// the v2 doc shape (body.shape, mount, makeElementV2). Phase 3 Tasks 2+.
(function () {
  const VIEW_KEY = "ukibori.view";
  const doc = window.defaultDoc();
  const cv = document.getElementById("canvas2d");

  // Module-local interaction state (scale = px per mm; ox/oy reserved for future pan).
  const state = { selectedId: null, scale: 1, ox: 0, oy: 0 };

  // ---- View toggle (Task 1, preserved) ----
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

  // ---- 3D rebuild (debounced, 120 ms) ----
  let _rebuild3DTimer = null;
  function scheduleRebuild3D() {
    if (!window.preview3d || !window.preview3d.isActive()) return;
    clearTimeout(_rebuild3DTimer);
    _rebuild3DTimer = setTimeout(function () { window.preview3d.rebuild(); }, 120);
  }

  // ---- Canvas fit scale ----
  // Returns px-per-mm to fit doc.body.widthMm × heightMm into the preview element.
  function fitScale() {
    const pad = 24;
    const preview = document.getElementById("preview");
    const availW = (preview ? preview.clientWidth : 600) - pad;
    const availH = (preview ? preview.clientHeight : 700) - pad;
    const body = doc.body;
    const s = Math.max(1, Math.min(availW / body.widthMm, availH / body.heightMm));
    state.scale = s;
    cv.width = Math.round(body.widthMm * s);
    cv.height = Math.round(body.heightMm * s);
  }

  // ---- Plate paths ----
  // Rounded-rect path for body.shape === 'rect'.
  function bodyPath(ctx, s) {
    const body = doc.body;
    const w = body.widthMm * s, h = body.heightMm * s;
    const rr = Math.min((body.cornerRadiusMm || 0) * s, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(rr, 0); ctx.arcTo(w, 0, w, h, rr); ctx.arcTo(w, h, 0, h, rr);
    ctx.arcTo(0, h, 0, 0, rr); ctx.arcTo(0, 0, w, 0, rr); ctx.closePath();
  }

  // ---- Draw element ----
  function drawElement(ctx, el, s) {
    ctx.save();
    ctx.translate(el.cxMm * s, el.cyMm * s);
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    const w = el.wMm * s, h = el.hMm * s;
    if (el.type === "text") {
      ctx.fillStyle = el.color || "#ffffff";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${el.fontWeight || "normal"} ${Math.max(1, Math.round(h))}px ${el.fontFamily || "system-ui"}`;
      ctx.fillText(el.text || "", 0, 0);
    } else if (el.type === "image") {
      if (el._img) {
        ctx.drawImage(el._img, -w / 2, -h / 2, w, h);
      } else {
        // Placeholder when image hasn't loaded yet.
        ctx.fillStyle = "#888"; ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = "#ccc"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "12px system-ui"; ctx.fillText("Bild", 0, 0);
      }
    }
    ctx.restore();
  }

  // ---- Selection handles ----
  function drawSelection(ctx, el, s) {
    ctx.save();
    ctx.translate(el.cxMm * s, el.cyMm * s);
    ctx.rotate((el.rotationDeg || 0) * Math.PI / 180);
    const w = el.wMm * s, h = el.hMm * s;
    ctx.strokeStyle = "#6b4fb0"; ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = "#6b4fb0";
    for (const [hx, hy] of [[-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]]) {
      ctx.beginPath(); ctx.rect(hx - 5, hy - 5, 10, 10); ctx.fill();
    }
    // Rotation handle: line + circle above the top edge.
    ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 - 22); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -h / 2 - 22, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---- Main render (exported as render2D) ----
  function render2D() {
    fitScale();
    const s = state.scale;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);

    const body = doc.body;
    const shape = body.shape || "rect";

    if (shape === "rect") {
      // Rounded-rect plate.
      bodyPath(ctx, s);
      ctx.fillStyle = body.baseColor || "#000000"; ctx.fill();
      // Clip elements inside the body outline.
      ctx.save(); bodyPath(ctx, s); ctx.clip();
      for (const el of doc.elements) drawElement(ctx, el, s);
      ctx.restore();
      // Outline.
      bodyPath(ctx, s); ctx.strokeStyle = "#3a3a44"; ctx.lineWidth = 1; ctx.stroke();
    } else if (shape === "circle") {
      // Circle plate.
      const r = Math.min(body.widthMm, body.heightMm) / 2 * s;
      const cx = body.widthMm / 2 * s, cy = body.heightMm / 2 * s;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = body.baseColor || "#000000"; ctx.fill();
      // Clip to circle.
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      for (const el of doc.elements) drawElement(ctx, el, s);
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "#3a3a44"; ctx.lineWidth = 1; ctx.stroke();
    } else {
      // free shape: draw elements only (no plate frame in 2D).
      // NOTE: true free-shape plate outline only shown in 3D/export (2D simplification).
      for (const el of doc.elements) drawElement(ctx, el, s);
    }

    // Mount guide: dashed circle if mount is not 'none'.
    const mount = doc.mount;
    if (mount && mount.type !== "none") {
      const mr = (mount.diameterMm / 2) * s;
      const mx = mount.xMm * s, my = mount.yMm * s;
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.strokeStyle = "#888"; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]); ctx.stroke();
      ctx.restore();
    }

    // Selection handles on top.
    const sel = doc.elements.find(e => e.id === state.selectedId) || null;
    if (sel) drawSelection(ctx, sel, s);
  }

  // ---- Hit test: pointer canvas-px → element/handle ----
  function elemToLocal(el, px, py, s) {
    const dx = px - el.cxMm * s, dy = py - el.cyMm * s;
    const a = -(el.rotationDeg || 0) * Math.PI / 180;
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  }

  function hitTest(px, py) {
    const s = state.scale;
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const el = doc.elements[i];
      const [lx, ly] = elemToLocal(el, px, py, s);
      const w = el.wMm * s, h = el.hMm * s;
      // Rotation handle (circle above top edge).
      if (Math.hypot(lx, ly + h / 2 + 22) <= 9) return { id: el.id, handle: "rotate" };
      // Corner scale handles.
      const corners = { nw: [-w/2, -h/2], ne: [w/2, -h/2], se: [w/2, h/2], sw: [-w/2, h/2] };
      for (const k in corners) {
        if (Math.hypot(lx - corners[k][0], ly - corners[k][1]) <= 9) return { id: el.id, handle: k };
      }
      // Body.
      if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return { id: el.id, handle: "move" };
    }
    return null;
  }

  // ---- Pointer handlers (move / scale / rotate) ----
  let drag = null;

  cv.addEventListener("pointerdown", function (e) {
    const rect = cv.getBoundingClientRect();
    const scaleC = cv.width / rect.width;
    const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
    const hit = hitTest(px, py);
    if (!hit) { state.selectedId = null; render2D(); return; }
    state.selectedId = hit.id;
    const el = doc.elements.find(el => el.id === hit.id);
    drag = {
      handle: hit.handle, px, py,
      start: { cx: el.cxMm, cy: el.cyMm, w: el.wMm, h: el.hMm, rot: el.rotationDeg || 0 },
    };
    cv.setPointerCapture(e.pointerId);
    render2D();
  });

  cv.addEventListener("pointermove", function (e) {
    if (!drag) return;
    const rect = cv.getBoundingClientRect();
    const scaleC = cv.width / rect.width, s = state.scale;
    const px = (e.clientX - rect.left) * scaleC, py = (e.clientY - rect.top) * scaleC;
    const el = doc.elements.find(el => el.id === state.selectedId);
    if (!el) return;
    if (drag.handle === "move") {
      el.cxMm = drag.start.cx + (px - drag.px) / s;
      el.cyMm = drag.start.cy + (py - drag.py) / s;
    } else if (drag.handle === "rotate") {
      const ang = Math.atan2(py - el.cyMm * s, px - el.cxMm * s) * 180 / Math.PI + 90;
      el.rotationDeg = Math.round(ang);
    } else {
      // Corner handle: scale width/height symmetrically.
      const [lx, ly] = elemToLocal(el, px, py, s);
      el.wMm = Math.max(2, Math.abs(lx) * 2 / s);
      el.hMm = Math.max(2, Math.abs(ly) * 2 / s);
    }
    render2D();
  });

  function endDrag() {
    if (!drag) return;
    drag = null;
    scheduleRebuild3D();
    render2D();
  }
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);

  // ---- Add image from data URL ----
  function addImageFromDataURL(dataURL) {
    const img = new Image();
    img.onload = function () {
      const body = doc.body;
      const maxMm = Math.min(body.widthMm * 0.8, body.heightMm * 0.4);
      const ar = img.naturalWidth / img.naturalHeight || 1;
      const wMm = ar >= 1 ? maxMm : maxMm * ar;
      const hMm = ar >= 1 ? maxMm / ar : maxMm;
      const el = window.makeElementV2("image", {
        src: dataURL, _img: img,
        cxMm: body.widthMm / 2, cyMm: body.heightMm / 2,
        wMm, hMm,
      });
      doc.elements.push(el);
      state.selectedId = el.id;
      scheduleRebuild3D();
      render2D();
    };
    img.src = dataURL;
  }

  // ---- Drop handler on canvas/preview ----
  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const rd = new FileReader();
    rd.onload = function () { addImageFromDataURL(rd.result); };
    rd.readAsDataURL(file);
  }
  function handleDragOver(e) { e.preventDefault(); }

  cv.addEventListener("dragover", handleDragOver);
  cv.addEventListener("drop", handleDrop);
  const previewEl = document.getElementById("preview");
  if (previewEl) {
    previewEl.addEventListener("dragover", handleDragOver);
    previewEl.addEventListener("drop", handleDrop);
  }

  // ---- Hidden file input (#addImageInput) ----
  const addImageInput = document.getElementById("addImageInput");
  if (addImageInput) {
    addImageInput.addEventListener("change", function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () { addImageFromDataURL(rd.result); };
      rd.readAsDataURL(f);
      addImageInput.value = "";
    });
  }

  // ---- Single resize listener: 2D re-render; 3D resize is handled by preview3d ----
  window.addEventListener("resize", function () {
    if (!window.preview3d || !window.preview3d.isActive()) render2D();
  });

  // ---- 2D/3D toggle ----
  function getPartsFn() { return { parts: window.buildParts(doc) }; }

  document.getElementById("view3dBtn").addEventListener("click", function () {
    document.getElementById("canvas2d").hidden = true;
    document.getElementById("preview3dCanvas").hidden = false;
    document.getElementById("view3dBtn").classList.add("seg-active");
    document.getElementById("view2dBtn").classList.remove("seg-active");
    window.preview3d.show(document.getElementById("preview3dCanvas"), getPartsFn);
  });

  document.getElementById("view2dBtn").addEventListener("click", function () {
    window.preview3d.hide();
    document.getElementById("canvas2d").hidden = false;
    document.getElementById("preview3dCanvas").hidden = true;
    document.getElementById("view2dBtn").classList.add("seg-active");
    document.getElementById("view3dBtn").classList.remove("seg-active");
    render2D();
  });

  // ---- Export dialog ----
  function exportFileName() {
    const n = (document.getElementById("exportName").value || "").trim();
    return n || "ukibori";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function setExportStatus(msg) {
    document.getElementById("exportStatus").textContent = msg;
  }

  document.getElementById("exportBtn").addEventListener("click", function () {
    document.getElementById("exportModal").removeAttribute("hidden");
    setExportStatus("");
  });

  document.getElementById("exportClose").addEventListener("click", function () {
    document.getElementById("exportModal").setAttribute("hidden", "");
  });

  document.getElementById("exportMf").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      const parts = window.buildParts(doc);
      const blob = window.build3MF(parts);
      downloadBlob(blob, exportFileName() + ".3mf");
      setExportStatus("Fertig.");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });

  document.getElementById("exportStl").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      const parts = window.buildParts(doc);
      const facets = parts.flatMap(function (p) { return p.facets; });
      const u8 = window.facetsToBinarySTL(facets);
      const blob = new Blob([u8], { type: "application/octet-stream" });
      downloadBlob(blob, exportFileName() + ".stl");
      setExportStatus("Fertig.");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });

  document.getElementById("exportPng").addEventListener("click", function () {
    try {
      setExportStatus("Exportiere …");
      const name = exportFileName();
      document.getElementById("canvas2d").toBlob(function (b) {
        if (!b) { setExportStatus("Fehler: PNG konnte nicht erstellt werden."); return; }
        downloadBlob(b, name + ".png");
        setExportStatus("Fertig.");
      }, "image/png");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });

  document.getElementById("exportSvg").addEventListener("click", function () {
    setExportStatus("SVG folgt – Format noch nicht verfügbar.");
  });

  // ---- View toggle wiring (Task 1, preserved) ----
  document.getElementById("viewSimple").addEventListener("click", function () { setView("simple"); });
  document.getElementById("viewAdvanced").addEventListener("click", function () { setView("advanced"); });
  setView((function () { try { return localStorage.getItem(VIEW_KEY) || "simple"; } catch (e) { return "simple"; } })());

  // Initial render.
  render2D();

  // Public interface. Expose state so tests can inspect/mutate selection.
  window.editor = { doc, setView, getView, render2D };
  // Expose for Playwright smoke tests.
  window.__editorState = state;
  window.__editorHitTest = hitTest;
})();
