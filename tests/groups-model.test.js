"use strict";
(function () {
  test("groups: defaultDoc has empty groups; makeElementV2 seeds groupId null", () => {
    const d = defaultDoc();
    assert(Array.isArray(d.groups) && d.groups.length === 0, "groups []");
    assert(makeElementV2("text", {}).groupId === null, "groupId null");
  });
  test("groups: makeGroup shape", () => {
    const g = makeGroup({ name: "X" });
    assert(typeof g.id === "string", "id");
    assertEqual(g.name, "X"); assertEqual(g.collapsed, false); assertEqual(g.parentId, null);
  });
  test("groups: migration backfills groups[] and groupId on old saves", () => {
    const d = defaultDoc();
    d.elements = [makeElementV2("text", {})];
    delete d.groups; delete d.elements[0].groupId; // pre-feature save
    const m = migrateProject(JSON.parse(serializeProject(d)));
    assert(Array.isArray(m.groups), "groups restored");
    assert(m.elements[0].groupId === null, "groupId restored");
  });
})();
