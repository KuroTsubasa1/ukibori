"use strict";
// Coach-marks / first-run tutorial. Implemented in Task 6.
(function () {
  if (window.coachmarks) return; // guard against double-load

  var SEEN_KEY = 'ukibori.coachmarksSeen';

  var STEPS = [
    {
      id: 'addImageBtn',
      text: 'Füge ein Bild, Text oder QR hinzu — für Lesezeichen, Untersetzer, Schlüsselanhänger u. v. m.'
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

  // --- Build the overlay DOM ---
  function buildDOM() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'cmOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Tour');

    spotlight = document.createElement('div');
    spotlight.id = 'cmSpotlight';

    bubble = document.createElement('div');
    bubble.id = 'cmBubble';

    bubbleText = document.createElement('p');
    bubbleText.id = 'cmBubbleText';

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
    if (overlay) {
      overlay.style.display = 'none';
    }
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
    // Tear down any existing state first to avoid orphaned resize listeners
    teardown();

    buildDOM();

    // Filter steps whose target elements are present in the DOM
    activeSteps = STEPS.filter(function (s) {
      return !!document.getElementById(s.id);
    });

    if (activeSteps.length === 0) {
      // Nothing to show; still mark seen
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ }
      return;
    }

    currentIdx = 0;
    overlay.style.display = 'block';
    showStep(0);

    // Resize listener (removed on close)
    resizeListener = function () { position(); };
    window.addEventListener('resize', resizeListener);
  }

  // --- Wire #tourBtn and auto-start on DOMContentLoaded ---
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('tourBtn');
    if (btn) {
      btn.addEventListener('click', function () { start(); });
    }
    try {
      var seen = localStorage.getItem(SEEN_KEY);
      if (seen) return;
      var isSimple = !document.body.classList.contains('mode-advanced');
      if (isSimple) {
        start();
      }
    } catch (e) { /* localStorage unavailable — fail silently */ }
  });

  // --- Expose API ---
  window.coachmarks = { start: start };
}());
