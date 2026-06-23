"use strict";
window.__results = { pass: 0, fail: 0, failures: [] };
window.__pending = [];
function test(name, fn) {
  const run = async () => {
    try { await fn(); window.__results.pass++; }
    catch (e) { window.__results.fail++; window.__results.failures.push(name + ": " + (e && e.message || e)); }
  };
  window.__pending.push(run());
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg || "") + ` expected ${expected} got ${actual}`);
}
function assertClose(actual, expected, eps, msg) {
  const e = eps == null ? 1e-6 : eps;
  if (Math.abs(actual - expected) > e) throw new Error((msg || "") + ` expected ~${expected} got ${actual}`);
}
window.__ready = () => Promise.all(window.__pending).then(() => { window.__done = true; return window.__results; });
