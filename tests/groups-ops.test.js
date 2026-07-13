"use strict";
(function () {
  function docWith(ids) {
    const d = defaultDoc();
    d.elements = ids.map(function (id) { const e = makeElementV2("shape", { shape: "rect" }); e.id = id; return e; });
    return d;
  }
  const orderIds = function (d) { return d.elements.map(function (e) { return e.id; }).join(""); };

  test("groups: groupElements sets groupId and keeps members contiguous", () => {
    const d = docWith(["a", "b", "c", "d"]);
    const gid = groupElements(d, ["a", "c"]);
    const a = d.elements.find(e => e.id === "a"), c = d.elements.find(e => e.id === "c");
    assertEqual(a.groupId, gid); assertEqual(c.groupId, gid);
    // a and c must be adjacent in doc.elements now
    const ids = d.elements.map(e => e.id);
    assert(Math.abs(ids.indexOf("a") - ids.indexOf("c")) === 1, "contiguous: " + ids.join(","));
  });

  test("groups: grouping two full groups nests them under a new parent", () => {
    const d = docWith(["a", "b", "c", "d"]);
    const g1 = groupElements(d, ["a", "b"]);
    const g2 = groupElements(d, ["c", "d"]);
    const parent = groupElements(d, ["a", "b", "c", "d"]);
    const G1 = d.groups.find(g => g.id === g1), G2 = d.groups.find(g => g.id === g2);
    assertEqual(G1.parentId, parent); assertEqual(G2.parentId, parent);
    // leaves still belong to their own groups (nesting, not flattening)
    assertEqual(d.elements.find(e => e.id === "a").groupId, g1);
  });

  test("groups: descendant leaves resolve through nested groups", () => {
    const d = docWith(["a", "b", "c"]);
    const g1 = groupElements(d, ["a", "b"]);
    const parent = groupElements(d, ["a", "b", "c"]);
    const leaves = groupDescendantLeafIds(d, parent).sort().join("");
    assertEqual(leaves, "abc");
  });

  test("groups: ungroup reparents children to the group's parent", () => {
    const d = docWith(["a", "b", "c"]);
    const g1 = groupElements(d, ["a", "b"]);
    const parent = groupElements(d, ["a", "b", "c"]);
    ungroupGroup(d, parent);
    assert(!d.groups.find(g => g.id === parent), "parent gone");
    assertEqual(d.groups.find(g => g.id === g1).parentId, null, "g1 back to top");
  });

  test("groups: flattenGroupForest reflects the hierarchy in stacking order", () => {
    const d = docWith(["a", "b", "c"]);
    const g1 = groupElements(d, ["a", "b"]);
    const forest = flattenGroupForest(d);
    // top level: one group (g1) + element c, both present
    const kinds = forest.map(n => n.type).sort().join(",");
    assertEqual(kinds, "element,group");
    const grp = forest.find(n => n.type === "group");
    assertEqual(grp.children.length, 2);
  });
})();
