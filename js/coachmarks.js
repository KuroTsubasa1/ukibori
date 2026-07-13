"use strict";
// Coach-marks / first-run tutorial. Implemented in Task 6.
(function () {
  if (window.coachmarks) return; // guard against double-load

  var SEEN_KEY = 'ukibori.coachmarksSeen';

  var STEPS = [
    {
      id: 'heroExampleBtn',
      // Only while the stage is empty — the hero card (and this button) hides
      // as soon as the project has elements.
      when: function () {
        var h = document.getElementById('stageHero');
        return !!h && !h.hidden;
      },
      text: 'Neu hier? Öffne das Beispiel — eine fertige Untersetzer-Münze zum Anschauen, Verändern und Exportieren.'
    },
    {
      id: 'addImageBtn',
      text: 'Füge ein Bild, Text, QR oder eine Form (Rechteck/Kreis) hinzu — für Lesezeichen, Untersetzer, Schlüsselanhänger u. v. m.'
    },
    {
      id: 'depthRaised',
      text: 'Wähle die Tiefe: Erhaben (steht hervor) oder Vertieft (eingraviert).'
    },
    {
      id: 'shapeRect',
      text: 'Wähle Form und Größe deines Objekts — Rechteck für Lesezeichen oder Untersetzer, Kreis für Untersetzer oder Schlüsselanhänger.'
    },
    {
      id: 'advAutoHeights',
      text: 'Höhe je Farbe stapelt deine Ebenen wie AMS-Filamentschichten: jede Farbe wird eine massive Druckschicht. Dazu Deckschicht und AMS-Palette für die Schicht-Reihenfolge.'
    },
    {
      id: 'exportBtn',
      text: 'Fertig? Exportiere als 3MF/STL für den 3D-Druck.'
    }
  ];

  // --- DOM references (created once) ---
  var overlay = null;
  var spotlight = null;
  var bubble = null;
  var bubbleText = null;
  var bubbleCounter = null;
  var nextBtn = null;
  var skipBtn = null;

  // --- State ---
  var activeSteps = [];   // filtered steps whose target elements exist
  var currentIdx = 0;
  var resizeListener = null;
  var keyListener = null;
  var lastFocused = null;

  // --- Build the overlay DOM ---
  function buildDOM() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'cmOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Tour');
    overlay.setAttribute('aria-describedby', 'cmBubbleText');

    spotlight = document.createElement('div');
    spotlight.id = 'cmSpotlight';

    bubble = document.createElement('div');
    bubble.id = 'cmBubble';

    bubbleText = document.createElement('p');
    bubbleText.id = 'cmBubbleText';
    bubbleText.setAttribute('aria-live', 'polite');

    var footer = document.createElement('div');
    footer.id = 'cmBubbleFooter';

    bubbleCounter = document.createElement('span');
    bubbleCounter.id = 'cmCounter';

    var actions = document.createElement('div');
    actions.id = 'cmActions';

    skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.id = 'cmSkipBtn';
    skipBtn.textContent = 'Überspringen';
    skipBtn.addEventListener('click', function () { close(true); });

    nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.id = 'cmNextBtn';
    nextBtn.textContent = 'Weiter';
    nextBtn.addEventListener('click', advance);

    actions.appendChild(skipBtn);
    actions.appendChild(nextBtn);
    footer.appendChild(bubbleCounter);
    footer.appendChild(actions);
    bubble.appendChild(bubbleText);
    bubble.appendChild(footer);

    overlay.appendChild(spotlight);
    overlay.appendChild(bubble);
    document.body.appendChild(overlay);
  }

  // --- Position spotlight + bubble for current step ---
  function position() {
    if (!activeSteps[currentIdx]) return;
    var step = activeSteps[currentIdx];
    var el = document.getElementById(step.id);
    if (!el) return;

    var rect = el.getBoundingClientRect();
    // Target vanished mid-tour (e.g. step 1 invites clicking the hero button,
    // which hides the hero card) → move on instead of spotlighting (0,0).
    if (!rect.width && !rect.height) { advance(); return; }
    var pad = 8;

    // Spotlight ring
    spotlight.style.top  = (rect.top  - pad) + 'px';
    spotlight.style.left = (rect.left - pad) + 'px';
    spotlight.style.width  = (rect.width  + pad * 2) + 'px';
    spotlight.style.height = (rect.height + pad * 2) + 'px';

    // Bubble: try to place below, fall back to above
    var bw = Math.min(280, window.innerWidth - 32);
    bubble.style.width = bw + 'px';

    // Force layout so we can read bubble height
    bubble.style.visibility = 'hidden';
    bubble.style.display = 'block';
    var bh = bubble.offsetHeight;
    bubble.style.visibility = '';

    var spaceBelow = window.innerHeight - rect.bottom - pad;
    var spaceAbove = rect.top - pad;
    var top;
    if (spaceBelow >= bh + 12 || spaceBelow >= spaceAbove) {
      top = rect.bottom + pad + 8;
    } else {
      top = rect.top - bh - pad - 8;
    }

    // Horizontal: centre over spotlight, clamp to viewport
    var left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));

    bubble.style.top  = top  + 'px';
    bubble.style.left = left + 'px';
  }

  // --- Show a step ---
  function showStep(idx) {
    currentIdx = idx;
    var step = activeSteps[idx];
    bubbleText.textContent = step.text;
    bubbleCounter.textContent = (idx + 1) + '/' + activeSteps.length;
    nextBtn.textContent = idx === activeSteps.length - 1 ? 'Fertig' : 'Weiter';
    position();
  }

  // --- Advance to next step or finish ---
  function advance() {
    if (currentIdx < activeSteps.length - 1) {
      showStep(currentIdx + 1);
    } else {
      close(true);
    }
  }

  // --- Tear down resize listener and hide overlay (does NOT set seen-flag) ---
  function teardown() {
    if (resizeListener) {
      window.removeEventListener('resize', resizeListener);
      resizeListener = null;
    }
    if (keyListener) {
      document.removeEventListener('keydown', keyListener, true);
      keyListener = null;
    }
    if (overlay) {
      overlay.style.display = 'none';
    }
    // Restore focus to the element that was active before the tour opened
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (e) { /* element may be gone */ }
    }
    lastFocused = null;
  }

  // --- Close the overlay ---
  function close(setFlag) {
    teardown();
    if (setFlag) {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ }
    }
  }

  // --- Public: start the tour (always from step 1, regardless of seen-flag) ---
  function start() {
    // Capture focus origin BEFORE teardown resets lastFocused
    var triggerEl = document.activeElement;

    // Tear down any existing state first to avoid orphaned resize/key listeners
    teardown();

    // Restore the captured trigger (teardown nulled lastFocused, so stash it now)
    lastFocused = triggerEl;

    buildDOM();

    // Filter steps whose target elements are present in the DOM (and whose
    // optional `when` predicate holds — e.g. the hero button on an empty stage).
    activeSteps = STEPS.filter(function (s) {
      if (!document.getElementById(s.id)) return false;
      return !s.when || s.when();
    });

    if (activeSteps.length === 0) {
      // Nothing to show; still mark seen
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ }
      return;
    }

    currentIdx = 0;
    overlay.style.display = 'block';
    showStep(0);

    // Move focus into the dialog
    nextBtn.focus();

    // Resize listener (removed on close)
    resizeListener = function () { position(); };
    window.addEventListener('resize', resizeListener);

    // Keyboard listener: Esc closes, Tab stays trapped in the bubble (capture phase)
    keyListener = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key === 'Tab') {
        // Trap focus between the two buttons in the bubble.
        var focusable = [skipBtn, nextBtn];
        var idx = focusable.indexOf(document.activeElement);
        if (idx === -1) { e.preventDefault(); nextBtn.focus(); return; }
        if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable[focusable.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === focusable[focusable.length - 1]) { e.preventDefault(); focusable[0].focus(); }
      }
    };
    document.addEventListener('keydown', keyListener, true);
  }

  // --- Wire #tourBtn and auto-start on DOMContentLoaded ---
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('tourBtn');
    if (btn) {
      btn.addEventListener('click', function () { start(); });
    }
    try {
      var seen = localStorage.getItem(SEEN_KEY);
      if (!seen) start();
    } catch (e) { /* localStorage unavailable — fail silently */ }
  });

  // --- Public: re-evaluate the current spotlight (advances past a target
  // that disappeared, e.g. after the hero example button was clicked). ---
  function refresh() {
    if (!overlay || overlay.style.display !== 'block') return;
    position();
  }

  // --- Expose API ---
  window.coachmarks = { start: start, refresh: refresh };
}());
