// Ukibori service worker — makes the app installable and fully offline.
// Strategy:
//   * App shell (HTML/CSS/JS, small vendor libs, icons) is precached on install
//     and served network-first: online you always get the latest code (index.html
//     ships no ?v= tokens), offline you get the cached shell.
//   * The large immutable binaries (three.js, onnxruntime wasm, u2netp model) are
//     cached first-use (cache-first) so the 26 MB AI stack never stalls install and,
//     once used online, works offline too.
//   * Requests under /tests/ are never intercepted — the browser test harness must
//     always hit the network so a stale cache can't mask edits.
// To force every client to re-fetch after a deploy, bump CACHE_VERSION.
"use strict";

const CACHE_VERSION = "ukibori-v1";

// Small, always-needed shell — precached atomically-ish (per-item so one bad
// path can't wipe offline support). Paths are relative to the SW scope (root).
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "favicon.svg",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
  "vendor/qrcode.js",
  "js/vendor/potrace.js",
  "vendor/three.min.js",
  "js/image-ops.js",
  "js/geometry.js",
  "js/trace.js",
  "js/sources.js",
  "js/arc-text.js",
  "js/path-text.js",
  "js/shape-edge.js",
  "js/bg-removal.js",
  "js/bookmark-model.js",
  "js/example-project.js",
  "js/geom-util.js",
  "js/view2d.js",
  "js/selection-ops.js",
  "js/transform-ops.js",
  "js/align-ops.js",
  "js/scatter.js",
  "js/pause-sheet.js",
  "js/bookmark-export.js",
  "js/shadowbox.js",
  "js/build-parts.js",
  "js/preview3d.js",
  "js/editor.js",
  "js/coachmarks.js",
];

// Heavy, immutable, optional-feature binaries → cache-first, cached on first use.
function isImmutableBinary(pathname) {
  return /\.(wasm|onnx)$/.test(pathname) || /\/vendor\/(ort|three)/.test(pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Per-item so a single missing/renamed asset degrades gracefully instead of
    // aborting the whole install (which would leave the app with no offline cache).
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // Last resort for a navigation with nothing cached: the app shell.
    if (request.mode === "navigate") {
      const shell = await cache.match("index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // cross-origin → default
  if (url.pathname.includes("/tests/")) return;        // never touch the test harness
  if (isImmutableBinary(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
