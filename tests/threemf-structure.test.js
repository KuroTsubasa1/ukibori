"use strict";
(function () {
  // Helper: extract a named file's text content from an uncompressed (STORE) ZIP blob.
  // ZIP local-file headers are: signature 0x04034b50, then fixed fields, then
  // filename, then extra field, then file data. Since it's STORE (no compression),
  // the data bytes are verbatim. We scan the ArrayBuffer for each local-file header
  // and match by filename.
  async function extractZipEntry(blob, entryName) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const nameBytes = new TextEncoder().encode(entryName);
    // Scan for PK\x03\x04 local file header signatures
    for (let i = 0; i < bytes.length - 30; i++) {
      if (bytes[i] !== 0x50 || bytes[i+1] !== 0x4b || bytes[i+2] !== 0x03 || bytes[i+3] !== 0x04) continue;
      const fnLen = bytes[i+26] | (bytes[i+27] << 8);
      const exLen = bytes[i+28] | (bytes[i+29] << 8);
      if (fnLen !== nameBytes.length) continue;
      let match = true;
      for (let j = 0; j < fnLen; j++) {
        if (bytes[i + 30 + j] !== nameBytes[j]) { match = false; break; }
      }
      if (!match) continue;
      const dataStart = i + 30 + fnLen + exLen;
      const compSize = (bytes[i+18]) | (bytes[i+19] << 8) | (bytes[i+20] << 16) | (bytes[i+21] << 24);
      return new TextDecoder().decode(bytes.slice(dataStart, dataStart + compSize));
    }
    throw new Error("Entry not found in zip: " + entryName);
  }

  // Minimal fake parts: two parts at different z ranges (simulates z-stacked color layers).
  function makeFakeParts() {
    // Part 0: red, z in [0, 2]
    const redFacets = [
      [[0,0,0],[1,0,0],[0,1,0]],
      [[1,0,0],[1,1,0],[0,1,0]],
      [[0,0,2],[0,1,2],[1,0,2]],
      [[1,0,2],[0,1,2],[1,1,2]],
      [[0,0,0],[0,0,2],[1,0,0]],
      [[1,0,0],[0,0,2],[1,0,2]],
      [[1,0,0],[1,0,2],[1,1,0]],
      [[1,1,0],[1,0,2],[1,1,2]],
      [[1,1,0],[1,1,2],[0,1,0]],
      [[0,1,0],[1,1,2],[0,1,2]],
      [[0,1,0],[0,1,2],[0,0,0]],
      [[0,0,0],[0,1,2],[0,0,2]],
    ];
    // Part 1: blue, z in [2, 4] (sits on top of red layer)
    const blueFacets = redFacets.map(tri => tri.map(([x,y,z]) => [x, y, z + 2]));
    return [
      { name: "red-layer",  color: [255, 0, 0],   facets: redFacets  },
      { name: "blue-layer", color: [0, 0, 255],   facets: blueFacets },
    ];
  }

  test("3MF structure: exactly ONE <item> in <build> pointing at parent id", async () => {
    const blob = build3MF(makeFakeParts());
    const model = await extractZipEntry(blob, "3D/3dmodel.model");
    const buildSection = model.slice(model.indexOf("<build>"), model.indexOf("</build>") + 8);
    const itemMatches = buildSection.match(/<item /g) || [];
    assertEqual(itemMatches.length, 1, "build should have exactly 1 item, got " + itemMatches.length);
    // Parent id = parts.length + 2 = 4
    assert(buildSection.includes('objectid="4"'), "build item should point at parent id=4, got: " + buildSection);
  });

  test("3MF structure: parent object has N components, one per part, no transform", async () => {
    const parts = makeFakeParts();
    const blob = build3MF(parts);
    const model = await extractZipEntry(blob, "3D/3dmodel.model");
    // Parent object id = parts.length + 2 = 4
    const parentIdx = model.indexOf('id="4"');
    assert(parentIdx !== -1, "parent object id=4 should exist");
    const parentChunk = model.slice(parentIdx, model.indexOf("</object>", parentIdx) + 9);
    assert(parentChunk.includes("<components>"), "parent object should have <components>");
    const compMatches = parentChunk.match(/<component /g) || [];
    assertEqual(compMatches.length, parts.length, "one component per part");
    // Each component should reference mesh ids 2 and 3
    assert(parentChunk.includes('objectid="2"'), "component for mesh id=2");
    assert(parentChunk.includes('objectid="3"'), "component for mesh id=3");
    // No transform attribute on any component
    assert(!parentChunk.includes("transform="), "components must NOT have a transform attribute");
  });

  test("3MF structure: mesh objects have correct pid/pindex, basematerials unchanged", async () => {
    const parts = makeFakeParts();
    const blob = build3MF(parts);
    const model = await extractZipEntry(blob, "3D/3dmodel.model");
    // basematerials should have exactly 2 <base> entries
    const bmStart = model.indexOf("<basematerials");
    const bmEnd = model.indexOf("</basematerials>");
    assert(bmStart !== -1, "basematerials element should exist");
    const bmChunk = model.slice(bmStart, bmEnd + 16);
    const baseMatches = bmChunk.match(/<base /g) || [];
    assertEqual(baseMatches.length, parts.length, "one <base> per part");
    // Mesh object id=2: pid="1" pindex="0"
    assert(model.includes('id="2" name="red-layer" type="model" pid="1" pindex="0"'), "mesh 2: pid=1 pindex=0");
    // Mesh object id=3: pid="1" pindex="1"
    assert(model.includes('id="3" name="blue-layer" type="model" pid="1" pindex="1"'), "mesh 3: pid=1 pindex=1");
  });

  test("3MF structure: z-values in blue-layer mesh are only in [2,4] (heights preserved)", async () => {
    const parts = makeFakeParts();
    const blob = build3MF(parts);
    const model = await extractZipEntry(blob, "3D/3dmodel.model");
    // Find the blue-layer object (id=3) and extract its vertices
    const obj3Start = model.indexOf('id="3" name="blue-layer"');
    assert(obj3Start !== -1, "blue-layer object should be present");
    const obj3End = model.indexOf("</object>", obj3Start);
    const obj3 = model.slice(obj3Start, obj3End);
    // Extract all z="..." values from vertices in this object
    const zVals = [...obj3.matchAll(/z="([^"]+)"/g)].map(m => parseFloat(m[1]));
    assert(zVals.length > 0, "blue-layer mesh should have vertices");
    for (const z of zVals) {
      assert(z >= 2.0 && z <= 4.0001, "blue-layer z values should be in [2,4], got: " + z);
    }
  });

  test("3MF model_settings.config: one parent <object> with per-part <part> entries and extruder metadata", async () => {
    const parts = makeFakeParts();
    const blob = build3MF(parts);
    const cfg = await extractZipEntry(blob, "Metadata/model_settings.config");
    // Should have exactly one top-level <object> element
    const objMatches = cfg.match(/<object /g) || [];
    assertEqual(objMatches.length, 1, "model_settings.config should have exactly 1 <object>");
    // That object should have id = parent id = 4
    assert(cfg.includes('id="4"'), "model_settings.config object id should be parent id=4");
    // Should have one <part> per part
    const partMatches = cfg.match(/<part /g) || [];
    assertEqual(partMatches.length, parts.length, "one <part> per mesh part");
    // Part entries reference mesh ids 2 and 3
    assert(cfg.includes('id="2"'), "part for mesh id=2");
    assert(cfg.includes('id="3"'), "part for mesh id=3");
    // Each part should have extruder metadata
    const extruderMatches = cfg.match(/key="extruder"/g) || [];
    assertEqual(extruderMatches.length, parts.length, "each part should have extruder metadata");
    // Red and blue are distinct colors -> extruders 1 and 2
    assert(cfg.includes('value="1"'), "extruder 1 should be assigned");
    assert(cfg.includes('value="2"'), "extruder 2 should be assigned");
    // No top-level <object id="2"> or <object id="3"> (old per-mesh objects)
    assert(!cfg.includes('<object id="2"'), "should NOT have per-mesh object entry id=2");
    assert(!cfg.includes('<object id="3"'), "should NOT have per-mesh object entry id=3");
  });
})();
