import {
  createHash,
  randomUUID
} from "node:crypto";

import {
  vibe64Error
} from "@local/vibe64-core/server/core";

const SCHEMA_ARTIFACT_PATH = "database/schema.json";
const HISTORY_LIMIT = 50;
const SNIPPET_LIMIT = 100;
const LAYOUT_NODE_LIMIT = 2_000;
const writes = new Map();

function text(value = "") {
  return String(value ?? "").trim();
}

function actorIdentity(vibe64User = null) {
  return text(
    vibe64User?.username ||
    vibe64User?.id ||
    vibe64User?.email ||
    "local-owner"
  );
}

function actorKey(vibe64User = null) {
  return createHash("sha256")
    .update(`vibe64-database-user\u0000${actorIdentity(vibe64User)}`)
    .digest("hex")
    .slice(0, 20);
}

function layoutArtifactPath(vibe64User = null) {
  return `database/erd-layout-${actorKey(vibe64User)}.json`;
}

function workspaceArtifactPath(vibe64User = null) {
  return `database/workspace-${actorKey(vibe64User)}.json`;
}

function parseArtifact(value = "", label = "Database state") {
  const source = String(value || "").trim();
  if (!source) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    throw vibe64Error(
      `${label} is damaged and could not be read.`,
      "vibe64_database_session_state_invalid"
    );
  }
}

async function readSchemaSnapshot(store, sessionId = "") {
  return parseArtifact(
    await store.readArtifact(sessionId, SCHEMA_ARTIFACT_PATH),
    "The refreshed database schema"
  );
}

async function writeSchemaSnapshot(store, sessionId = "", schema = {}) {
  await store.writeJsonArtifact(sessionId, SCHEMA_ARTIFACT_PATH, schema);
  return schema;
}

function emptyWorkspace() {
  return {
    history: [],
    lookupDisplayColumns: {},
    snippets: [],
    version: 1
  };
}

function normalizedWorkspace(value = null) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    history: Array.isArray(record.history) ? record.history.slice(0, HISTORY_LIMIT) : [],
    lookupDisplayColumns: record.lookupDisplayColumns && typeof record.lookupDisplayColumns === "object" && !Array.isArray(record.lookupDisplayColumns)
      ? record.lookupDisplayColumns
      : {},
    snippets: Array.isArray(record.snippets) ? record.snippets.slice(0, SNIPPET_LIMIT) : [],
    version: 1
  };
}

async function readWorkspace(store, sessionId = "", vibe64User = null) {
  const value = parseArtifact(
    await store.readArtifact(sessionId, workspaceArtifactPath(vibe64User)),
    "The database workspace"
  );
  return value ? normalizedWorkspace(value) : emptyWorkspace();
}

function serializeWrite(key = "", operation) {
  const previous = writes.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  writes.set(key, current);
  return current.finally(() => {
    if (writes.get(key) === current) {
      writes.delete(key);
    }
  });
}

async function mutateWorkspace(store, sessionId = "", vibe64User = null, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("mutateWorkspace requires an operation.");
  }
  const path = workspaceArtifactPath(vibe64User);
  return serializeWrite(`${sessionId}\u0000${path}`, async () => {
    const workspace = await readWorkspace(store, sessionId, vibe64User);
    const next = normalizedWorkspace(await operation(workspace) || workspace);
    await store.writeJsonArtifact(sessionId, path, next);
    return next;
  });
}

async function recordQueryHistory(store, sessionId = "", vibe64User = null, entry = {}) {
  return mutateWorkspace(store, sessionId, vibe64User, (workspace) => ({
    ...workspace,
    history: [{
      affectedRows: Number(entry.affectedRows || 0),
      at: text(entry.at) || new Date().toISOString(),
      durationMs: Number(entry.durationMs || 0),
      id: randomUUID(),
      kind: text(entry.kind),
      ok: entry.ok !== false,
      readOnly: entry.readOnly !== false,
      sql: String(entry.sql || "")
    }, ...workspace.history].slice(0, HISTORY_LIMIT)
  }));
}

async function saveSnippet(store, sessionId = "", vibe64User = null, input = {}) {
  const sql = String(input.sql || "").trim();
  if (!sql) {
    throw vibe64Error("Snippet SQL is required.", "vibe64_database_snippet_sql_required");
  }
  const id = text(input.id) || randomUUID();
  const name = text(input.name) || "Untitled query";
  return mutateWorkspace(store, sessionId, vibe64User, (workspace) => ({
    ...workspace,
    snippets: [{
      id,
      name: name.slice(0, 120),
      sql,
      updatedAt: new Date().toISOString()
    }, ...workspace.snippets.filter((snippet) => snippet.id !== id)].slice(0, SNIPPET_LIMIT)
  }));
}

async function deleteSnippet(store, sessionId = "", vibe64User = null, snippetId = "") {
  const id = text(snippetId);
  return mutateWorkspace(store, sessionId, vibe64User, (workspace) => ({
    ...workspace,
    snippets: workspace.snippets.filter((snippet) => snippet.id !== id)
  }));
}

async function saveLookupDisplayColumn(store, sessionId = "", vibe64User = null, relationshipId = "", column = "") {
  const relationship = text(relationshipId);
  const displayColumn = text(column);
  if (!relationship || !displayColumn) {
    return readWorkspace(store, sessionId, vibe64User);
  }
  return mutateWorkspace(store, sessionId, vibe64User, (workspace) => ({
    ...workspace,
    lookupDisplayColumns: {
      ...workspace.lookupDisplayColumns,
      [relationship]: displayColumn
    }
  }));
}

function finiteCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate)
    ? Math.max(-10_000_000, Math.min(10_000_000, coordinate))
    : 0;
}

function normalizedDiagram(value = null) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  if (nodes.length > LAYOUT_NODE_LIMIT) {
    throw vibe64Error("The ERD layout contains too many nodes.", "vibe64_database_erd_layout_too_large");
  }
  return {
    nodes: nodes.map((node) => ({
      collapsed: node?.collapsed === true,
      expanded: node?.expanded === true,
      pinned: node?.pinned === true,
      group: text(node?.group).slice(0, 80),
      hidden: node?.hidden === true,
      table: text(node?.table).slice(0, 512),
      x: finiteCoordinate(node?.x),
      y: finiteCoordinate(node?.y)
    })).filter((node) => node.table),
    columnMode: record.columnMode === "all" ? "all" : "keys",
    focusTable: text(record.focusTable).slice(0, 512),
    activeGroup: text(record.activeGroup).slice(0, 524),
    groups: (Array.isArray(record.groups) ? record.groups : []).slice(0, 50)
      .map((group) => ({ id: text(group?.id).slice(0, 80), name: text(group?.name).slice(0, 80) }))
      .filter((group) => group.id && group.name),
    viewport: {
      x: finiteCoordinate(record.viewport?.x),
      y: finiteCoordinate(record.viewport?.y),
      zoom: Math.max(0.08, Math.min(1.8, Number(record.viewport?.zoom) || 1))
    }
  };
}

function normalizedLayout(value = null) {
  return {
    ...normalizedDiagram(value),
    views: (Array.isArray(value?.views) ? value.views : []).slice(0, 20).map((view) => ({
      ...normalizedDiagram(view),
      id: text(view?.id).slice(0, 80),
      name: text(view?.name).slice(0, 80)
    })).filter((view) => view.id && view.name),
    updatedAt: text(value?.updatedAt),
    version: 1
  };
}

async function readErdLayout(store, sessionId = "", vibe64User = null) {
  const value = parseArtifact(
    await store.readArtifact(sessionId, layoutArtifactPath(vibe64User)),
    "The database ERD layout"
  );
  return normalizedLayout(value);
}

async function saveErdLayout(store, sessionId = "", vibe64User = null, layout = {}) {
  const normalized = normalizedLayout({
    ...layout,
    updatedAt: new Date().toISOString()
  });
  const path = layoutArtifactPath(vibe64User);
  await serializeWrite(`${sessionId}\u0000${path}`, () => store.writeJsonArtifact(sessionId, path, normalized));
  return normalized;
}

export {
  HISTORY_LIMIT,
  LAYOUT_NODE_LIMIT,
  SCHEMA_ARTIFACT_PATH,
  SNIPPET_LIMIT,
  actorKey,
  deleteSnippet,
  layoutArtifactPath,
  mutateWorkspace,
  readErdLayout,
  readSchemaSnapshot,
  readWorkspace,
  recordQueryHistory,
  saveErdLayout,
  saveLookupDisplayColumn,
  saveSnippet,
  workspaceArtifactPath,
  writeSchemaSnapshot
};
