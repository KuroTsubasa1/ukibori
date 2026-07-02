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

  // Default depth direction for newly created elements.
  let defaultDirection = "raised";

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
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
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
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "#3a3a44"; ctx.lineWidth = 1; ctx.stroke();
    } else {
      // free shape: draw elements only (no plate frame in 2D).
      // NOTE: true free-shape plate outline only shown in 3D/export (2D simplification).
      for (const el of doc.elements) { if (!el._hidden) drawElement(ctx, el, s); }
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
    if (!hit) { state.selectedId = null; refreshAdvancedForSelection(); renderAdvancedLayers(); render2D(); return; }
    state.selectedId = hit.id;
    const el = doc.elements.find(el => el.id === hit.id);
    drag = {
      handle: hit.handle, px, py,
      start: { cx: el.cxMm, cy: el.cyMm, w: el.wMm, h: el.hMm, rot: el.rotationDeg || 0 },
    };
    cv.setPointerCapture(e.pointerId);
    refreshAdvancedForSelection();
    renderAdvancedLayers();
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
    refreshAdvancedForSelection();
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
      el.depth.direction = defaultDirection;
      doc.elements.push(el);
      state.selectedId = el.id;
      refreshAdvancedForSelection();
      renderAdvancedLayers();
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
    Promise.resolve(window.preview3d.show(document.getElementById("preview3dCanvas"), getPartsFn)).catch(function (err) {
      if (window.__errs) window.__errs.push(String(err && err.message || err));
    });
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
        try {
          if (!b) { setExportStatus("Fehler: PNG konnte nicht erstellt werden."); return; }
          downloadBlob(b, name + ".png");
          setExportStatus("Fertig.");
        } catch (e) {
          setExportStatus("Fehler: " + e.message);
        }
      }, "image/png");
    } catch (e) {
      setExportStatus("Fehler: " + e.message);
    }
  });


  // ---- Simple panel wiring (Task 4a) ----

  // -- Helpers --
  function setSegActive(groupId, activeId) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.querySelectorAll(".seg").forEach(function (btn) {
      btn.classList.toggle("seg-active", btn.id === activeId);
    });
  }

  // Depth: Erhaben / Vertieft
  function applyDepth(direction) {
    defaultDirection = direction;
    for (var i = 0; i < doc.elements.length; i++) {
      doc.elements[i].depth.direction = direction;
    }
    setSegActive("depthSeg", direction === "raised" ? "depthRaised" : "depthEngraved");
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("depthRaised").addEventListener("click", function () { applyDepth("raised"); });
  document.getElementById("depthEngraved").addEventListener("click", function () { applyDepth("engraved"); });

  // Shape: Rechteck / Kreis / Frei
  function applyShape(shape) {
    doc.body.shape = shape;
    setSegActive("shapeSeg", shape === "rect" ? "shapeRect" : shape === "circle" ? "shapeCircle" : "shapeFree");
    document.getElementById("borderField").hidden = (shape !== "free");
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("shapeRect").addEventListener("click", function () { applyShape("rect"); });
  document.getElementById("shapeCircle").addEventListener("click", function () { applyShape("circle"); });
  document.getElementById("shapeFree").addEventListener("click", function () { applyShape("free"); });

  // Border (shown only for Free)
  document.getElementById("borderMm").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0) {
      doc.body.borderMm = v;
      scheduleRebuild3D();
    }
  });

  // Mount: Keine / Loch / Öse
  function applyMount(type) {
    doc.mount.type = type;
    setSegActive("mountSeg", type === "none" ? "mountNone" : type === "hole" ? "mountHole" : "mountLoop");
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("mountNone").addEventListener("click", function () { applyMount("none"); });
  document.getElementById("mountHole").addEventListener("click", function () { applyMount("hole"); });
  document.getElementById("mountLoop").addEventListener("click", function () { applyMount("loop"); });

  // Size W/H
  document.getElementById("sizeW").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 5) {
      doc.body.widthMm = v;
      render2D();
      scheduleRebuild3D();
    }
  });
  document.getElementById("sizeH").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 5) {
      doc.body.heightMm = v;
      render2D();
      scheduleRebuild3D();
    }
  });

  // Add Text
  document.getElementById("addTextBtn").addEventListener("click", function () {
    var el = window.makeElementV2("text", {
      cxMm: doc.body.widthMm / 2,
      cyMm: doc.body.heightMm / 2,
      wMm: Math.min(40, doc.body.widthMm * 0.6),
      hMm: 12,
    });
    el.depth.direction = defaultDirection;
    doc.elements.push(el);
    state.selectedId = el.id;
    refreshAdvancedForSelection();
    renderAdvancedLayers();
    render2D();
    scheduleRebuild3D();
  });

  // Add Image (trigger hidden file input)
  document.getElementById("addImageBtn").addEventListener("click", function () {
    var inp = document.getElementById("addImageInput");
    if (inp) inp.click();
  });

  // Add QR
  document.getElementById("addQrBtn").addEventListener("click", function () {
    var data = prompt("QR-Inhalt:");
    if (!data || !data.trim()) return;
    var imgData;
    try {
      imgData = window.qrToImageData({ text: data, ecLevel: "M" });
    } catch (err) {
      alert("QR-Fehler: " + (err && err.message || err));
      return;
    }
    // Rasterize the ImageData to a canvas → dataURL → Image onload.
    var tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = imgData.width;
    tmpCanvas.height = imgData.height;
    tmpCanvas.getContext("2d").putImageData(imgData, 0, 0);
    var dataURL = tmpCanvas.toDataURL("image/png");
    var img = new Image();
    img.onload = function () {
      var sz = Math.min(doc.body.widthMm * 0.7, doc.body.heightMm * 0.7, 40);
      var el = window.makeElementV2("image", {
        src: dataURL, _img: img,
        cxMm: doc.body.widthMm / 2,
        cyMm: doc.body.heightMm / 2,
        wMm: sz, hMm: sz,
      });
      el.qrData = data;
      el.depth.direction = defaultDirection;
      el.depth.threshold = 256;
      doc.elements.push(el);
      state.selectedId = el.id;
      refreshAdvancedForSelection();
      renderAdvancedLayers();
      render2D();
      scheduleRebuild3D();
    };
    img.src = dataURL;
  });

  // Initialize Simple panel UI from doc on load.
  (function initSimpleUI() {
    // Shape
    applyShape(doc.body.shape || "rect");
    // Mount
    applyMount(doc.mount.type || "none");
    // Size
    document.getElementById("sizeW").value = doc.body.widthMm;
    document.getElementById("sizeH").value = doc.body.heightMm;
    // Border
    document.getElementById("borderMm").value = doc.body.borderMm != null ? doc.body.borderMm : 2;
    // Depth (defaultDirection already 'raised'; reflect it)
    setSegActive("depthSeg", defaultDirection === "raised" ? "depthRaised" : "depthEngraved");
  }());

  // ---- Advanced panel (Task 4b) ----

  // -- Layers list --
  function renderAdvancedLayers() {
    var list = document.getElementById("advLayers");
    var empty = document.getElementById("advLayersEmpty");
    if (!list) return;
    list.innerHTML = "";
    var els = doc.elements;
    if (!els || els.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    // Render back-to-front (last index = topmost layer)
    for (var idx = els.length - 1; idx >= 0; idx--) {
      (function (i) {
        var el = els[i];
        var li = document.createElement("li");
        if (el.id === state.selectedId) li.classList.add("adv-sel");
        if (el._hidden) li.classList.add("adv-hidden");

        var nameSpan = document.createElement("span");
        nameSpan.className = "adv-lname";
        var typeLabel = el.type === "text" ? "Text" : el.type === "image" ? "Bild" : el.type === "qr" ? "QR" : el.type;
        nameSpan.textContent = typeLabel + " " + (i + 1);
        if (el.type === "text" && el.text) nameSpan.textContent = "„" + el.text + "“";

        var vis = document.createElement("button");
        vis.className = "adv-lbtn";
        vis.textContent = el._hidden ? "🙈" : "👁";
        vis.title = el._hidden ? "Einblenden" : "Ausblenden";

        var up = document.createElement("button");
        up.className = "adv-lbtn";
        up.textContent = "▲";
        up.title = "Nach oben";

        var dn = document.createElement("button");
        dn.className = "adv-lbtn";
        dn.textContent = "▼";
        dn.title = "Nach unten";

        var del = document.createElement("button");
        del.className = "adv-lbtn";
        del.textContent = "🗑";
        del.title = "Löschen";

        li.append(nameSpan, vis, up, dn, del);

        li.addEventListener("click", function (e) {
          if (e.target.classList.contains("adv-lbtn")) return;
          state.selectedId = el.id;
          refreshAdvancedForSelection();
          renderAdvancedLayers();
          render2D();
        });

        vis.addEventListener("click", function (e) {
          e.stopPropagation();
          el._hidden = !el._hidden;
          renderAdvancedLayers();
          render2D();
          scheduleRebuild3D();
        });

        up.addEventListener("click", function (e) {
          e.stopPropagation();
          var elsCopy = doc.elements;
          if (i < elsCopy.length - 1) {
            var tmp = elsCopy[i]; elsCopy[i] = elsCopy[i + 1]; elsCopy[i + 1] = tmp;
            renderAdvancedLayers();
            render2D();
            scheduleRebuild3D();
          }
        });

        dn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (i > 0) {
            var tmp = doc.elements[i]; doc.elements[i] = doc.elements[i - 1]; doc.elements[i - 1] = tmp;
            renderAdvancedLayers();
            render2D();
            scheduleRebuild3D();
          }
        });

        del.addEventListener("click", function (e) {
          e.stopPropagation();
          doc.elements.splice(i, 1);
          if (state.selectedId === el.id) state.selectedId = null;
          refreshAdvancedForSelection();
          renderAdvancedLayers();
          render2D();
          scheduleRebuild3D();
        });

        list.appendChild(li);
      }(idx));
    }
  }

  // -- Selection refresh hook --
  function refreshAdvancedForSelection() {
    var adv = document.getElementById("sidebarAdvanced");
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; }) || null;
    var disabled = !el;

    var threshold = document.getElementById("advThreshold");
    var thresholdVal = document.getElementById("advThresholdVal");
    var invert = document.getElementById("advInvert");
    var numColors = document.getElementById("advNumColors");
    if (threshold) { threshold.disabled = disabled; threshold.value = el ? (el.depth.threshold != null ? el.depth.threshold : 128) : 128; }
    if (thresholdVal) thresholdVal.textContent = el ? (el.depth.threshold != null ? el.depth.threshold : 128) : 128;
    if (invert) { invert.disabled = disabled; invert.checked = el ? !!el.depth.invert : false; }
    if (numColors) { numColors.disabled = disabled; numColors.value = el ? (el.depth.reduce && el.depth.reduce.numColors != null ? el.depth.reduce.numColors : 8) : 8; }

    var modeSolid = document.getElementById("modeSolid");
    var modeColorLayers = document.getElementById("modeColorLayers");
    var modeHeightmap = document.getElementById("modeHeightmap");
    if (modeSolid) modeSolid.disabled = disabled;
    if (modeColorLayers) modeColorLayers.disabled = disabled;
    if (modeHeightmap) modeHeightmap.disabled = disabled;
    if (el) {
      var m = el.depth.mode || "solid";
      if (modeSolid) modeSolid.classList.toggle("seg-active", m === "solid");
      if (modeColorLayers) modeColorLayers.classList.toggle("seg-active", m === "colorLayers");
      if (modeHeightmap) modeHeightmap.classList.toggle("seg-active", m === "heightmap");
    } else {
      if (modeSolid) modeSolid.classList.add("seg-active");
      if (modeColorLayers) modeColorLayers.classList.remove("seg-active");
      if (modeHeightmap) modeHeightmap.classList.remove("seg-active");
    }

    var advColor = document.getElementById("advColor");
    var advCx = document.getElementById("advCx");
    var advCy = document.getElementById("advCy");
    var advW = document.getElementById("advW");
    var advH = document.getElementById("advH");
    var advRot = document.getElementById("advRot");
    var advRotVal = document.getElementById("advRotVal");
    var advCutout = document.getElementById("advCutout");
    [advColor, advCx, advCy, advW, advH, advRot, advCutout].forEach(function (inp) { if (inp) inp.disabled = disabled; });
    if (el) {
      if (advColor) advColor.value = el.color || "#ffffff";
      if (advCx) advCx.value = (el.cxMm != null ? el.cxMm : 25).toFixed(1);
      if (advCy) advCy.value = (el.cyMm != null ? el.cyMm : 75).toFixed(1);
      if (advW) advW.value = (el.wMm != null ? el.wMm : 30).toFixed(1);
      if (advH) advH.value = (el.hMm != null ? el.hMm : 30).toFixed(1);
      if (advRot) advRot.value = Math.round(el.rotationDeg || 0);
      if (advRotVal) advRotVal.textContent = Math.round(el.rotationDeg || 0) + "°";
      if (advCutout) advCutout.checked = !!el.cutout;
    }
  }

  // -- Depth mode buttons --
  function applyDepthMode(mode) {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    el.depth.mode = mode;
    var modeSolid = document.getElementById("modeSolid");
    var modeColorLayers = document.getElementById("modeColorLayers");
    var modeHeightmap = document.getElementById("modeHeightmap");
    if (modeSolid) modeSolid.classList.toggle("seg-active", mode === "solid");
    if (modeColorLayers) modeColorLayers.classList.toggle("seg-active", mode === "colorLayers");
    if (modeHeightmap) modeHeightmap.classList.toggle("seg-active", mode === "heightmap");
    render2D();
    scheduleRebuild3D();
  }
  document.getElementById("modeSolid").addEventListener("click", function () { applyDepthMode("solid"); });
  document.getElementById("modeColorLayers").addEventListener("click", function () { applyDepthMode("colorLayers"); });
  document.getElementById("modeHeightmap").addEventListener("click", function () { applyDepthMode("heightmap"); });

  // -- Umwandlung inputs --
  document.getElementById("advThreshold").addEventListener("input", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    var v = Number(this.value);
    el.depth.threshold = v;
    var badge = document.getElementById("advThresholdVal");
    if (badge) badge.textContent = v;
    render2D();
    scheduleRebuild3D();
  });

  document.getElementById("advInvert").addEventListener("change", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    el.depth.invert = this.checked;
    render2D();
    scheduleRebuild3D();
  });

  document.getElementById("advNumColors").addEventListener("input", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    var v = Number(this.value);
    if (!isNaN(v) && v >= 2) {
      el.depth.reduce.numColors = v;
      scheduleRebuild3D();
    }
  });

  // -- Element inputs --
  document.getElementById("advColor").addEventListener("input", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    el.color = this.value;
    render2D();
    scheduleRebuild3D();
  });

  document.getElementById("advCx").addEventListener("input", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    var v = parseFloat(this.value);
    if (!isNaN(v)) { el.cxMm = v; render2D(); scheduleRebuild3D(); }
  });

  document.getElementById("advCy").addEventListener("input", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    var v = parseFloat(this.value);
    if (!isNaN(v)) { el.cyMm = v; render2D(); scheduleRebuild3D(); }
  });

  document.getElementById("advW").addEventListener("input", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0.5) { el.wMm = v; render2D(); scheduleRebuild3D(); }
  });

  document.getElementById("advH").addEventListener("input", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0.5) { el.hMm = v; render2D(); scheduleRebuild3D(); }
  });

  document.getElementById("advRot").addEventListener("input", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    var v = Number(this.value);
    el.rotationDeg = v;
    var badge = document.getElementById("advRotVal");
    if (badge) badge.textContent = v + "°";
    render2D();
    scheduleRebuild3D();
  });

  document.getElementById("advCutout").addEventListener("change", function () {
    var el = doc.elements.find(function (e) { return e.id === state.selectedId; });
    if (!el) return;
    el.cutout = this.checked;
    render2D();
    scheduleRebuild3D();
  });

  // -- 3D / Export doc-level inputs --
  document.getElementById("advThickness").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0.5) { doc.body.thicknessMm = v; scheduleRebuild3D(); }
  });

  document.getElementById("advLayerHeight").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isNaN(v) && v >= 0.01) { doc.body.layerHeightMm = v; scheduleRebuild3D(); }
  });

  document.getElementById("advResolution").addEventListener("input", function () {
    var v = Number(this.value);
    if (!isNaN(v) && v >= 64) { doc.resolution = v; scheduleRebuild3D(); }
  });

  document.getElementById("advColorStep").addEventListener("input", function () {
    var v = Number(this.value);
    if (!isNaN(v) && v >= 1) { doc.colorStepLayers = v; scheduleRebuild3D(); }
  });

  // -- Init Advanced panel doc-level values --
  (function initAdvancedUI() {
    var t = document.getElementById("advThickness");
    if (t) t.value = doc.body.thicknessMm != null ? doc.body.thicknessMm : 3;
    var lh = document.getElementById("advLayerHeight");
    if (lh) lh.value = doc.body.layerHeightMm != null ? doc.body.layerHeightMm : 0.2;
    var res = document.getElementById("advResolution");
    if (res) res.value = doc.resolution != null ? doc.resolution : 1024;
    var cs = document.getElementById("advColorStep");
    if (cs) cs.value = doc.colorStepLayers != null ? doc.colorStepLayers : 2;
    refreshAdvancedForSelection();
    renderAdvancedLayers();
  }());

  // ---- View toggle wiring (Task 1, preserved) ----
  document.getElementById("viewSimple").addEventListener("click", function () { setView("simple"); });
  document.getElementById("viewAdvanced").addEventListener("click", function () {
    setView("advanced");
    refreshAdvancedForSelection();
    renderAdvancedLayers();
  });
  setView((function () { try { return localStorage.getItem(VIEW_KEY) || "simple"; } catch (e) { return "simple"; } })());

  // Initial render.
  render2D();

  // Public interface. Expose state so tests can inspect/mutate selection.
  window.editor = { doc, setView, getView, render2D, refreshAdvancedForSelection, renderAdvancedLayers };
  // Expose for Playwright smoke tests.
  window.__editorState = state;
  window.__editorHitTest = hitTest;
})();
