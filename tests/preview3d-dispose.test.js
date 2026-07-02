"use strict";
// Regression: the 3D preview leaked a BufferGeometry + Material per part on every
// rebuild()/show() because the previous scene was never disposed. Over a session
// (each edit -> rebuild) this exhausted GPU/tab memory -> WebGL context loss / OOM
// -> freeze + tab reload to the default doc. Fix: api.disposeScene(built) frees the
// prior scene's meshes; rebuild/show/hide call it. These tests use fake meshes so
// they need no THREE / WebGL (harness is GL-free).
(function () {
  function mkMesh() {
    return {
      isMesh: true,
      geometry: { disposed: false, dispose() { this.disposed = true; } },
      material: { disposed: false, dispose() { this.disposed = true; } },
    };
  }
  function mkBuilt(children) {
    return { scene: { children: children, traverse(cb) { this.children.forEach(cb); } } };
  }

  test("preview3d.disposeScene disposes every mesh geometry + material", function () {
    assert(typeof window.preview3d.disposeScene === "function", "disposeScene is exposed");
    const meshes = [mkMesh(), mkMesh(), mkMesh()];
    window.preview3d.disposeScene(mkBuilt(meshes.slice()));
    meshes.forEach(function (m, i) {
      assert(m.geometry.disposed, "geometry " + i + " disposed");
      assert(m.material.disposed, "material " + i + " disposed");
    });
  });

  test("preview3d.disposeScene handles array materials and skips non-meshes", function () {
    var n = 0;
    var built = mkBuilt([
      { isMesh: true, geometry: { dispose() {} }, material: [{ dispose() { n++; } }, { dispose() { n++; } }] },
      { isMesh: false /* a light — must be ignored, no geometry/material */ },
    ]);
    window.preview3d.disposeScene(built);
    assertEqual(n, 2, "both array materials disposed");
  });

  test("preview3d.disposeScene is safe on null / empty / malformed input", function () {
    window.preview3d.disposeScene(null);
    window.preview3d.disposeScene(undefined);
    window.preview3d.disposeScene({});
    window.preview3d.disposeScene({ scene: null });
    window.preview3d.disposeScene({ scene: {} }); // no traverse
    assert(true, "no throw on degenerate inputs");
  });
})();
