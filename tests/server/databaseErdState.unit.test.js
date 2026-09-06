import assert from "node:assert/strict";
import test from "node:test";
import { readErdLayout, saveErdLayout } from "../../packages/vibe64-database-tools/src/server/sessionState.js";

function stateStore() {
  const records = new Map();
  return {
    async readArtifact(session, path) { return records.get(`${session}:${path}`) || ""; },
    async writeJsonArtifact(session, path, value) { records.set(`${session}:${path}`, JSON.stringify(value)); }
  };
}
test("ERD views, groups, pins and focus round-trip inside the user's session", async () => {
  const store = stateStore();
  const actor = { username: "owner" };
  const diagram = {
    nodes: [{ table: "public.orders", x: 240, y: 160, pinned: true, expanded: true, group: "sales" }],
    groups: [{ id: "sales", name: "Sales" }], columnMode: "all", focusTable: "public.orders", activeGroup: "sales",
    viewport: { x: -25, y: 15, zoom: 0.7 }
  };
  const saved = await saveErdLayout(store, "session", actor, { ...diagram, views: [{ ...diagram, id: "overview", name: "Sales overview" }] });
  assert.deepEqual(await readErdLayout(store, "session", actor), saved);
  assert.equal(saved.nodes[0].pinned, true);
  assert.equal(saved.views[0].nodes[0].expanded, true);
  assert.equal(saved.views[0].groups[0].name, "Sales");
  assert.equal(saved.views[0].viewport.zoom, 0.7);
  assert.equal((await readErdLayout(store, "session", { username: "other" })).views.length, 0);
  assert.equal((await readErdLayout(store, "other-session", actor)).nodes.length, 0);
});
test("ERD normalization bounds stored fields and uses keys mode for an empty workspace", async () => {
  const store = stateStore();
  assert.equal((await readErdLayout(store)).columnMode, "keys");
  const saved = await saveErdLayout(store, "session", null, { nodes: [{ table: "t", x: Infinity, y: -Infinity }], views: [{ id: "a", name: "a", viewport: { zoom: 100 } }], columnMode: "invalid" });
  assert.equal(saved.nodes[0].x, 0);
  assert.equal(saved.nodes[0].y, 0);
  assert.equal(saved.views[0].viewport.zoom, 1.8);
  assert.equal(saved.columnMode, "keys");
  const longGroup = `erd-auto:${"schema_name.".repeat(10)}table`;
  assert.equal((await saveErdLayout(store, "session", null, { activeGroup: longGroup })).activeGroup, longGroup);
  await assert.rejects(saveErdLayout(store, "session", null, { nodes: Array.from({ length: 2001 }, () => ({ table: "t" })) }), { code: "vibe64_database_erd_layout_too_large" });
});
