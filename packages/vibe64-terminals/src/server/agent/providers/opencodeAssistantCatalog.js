import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_TRANSPORT_IDS
} from "@local/vibe64-runtime/shared";

const OPENCODE_CAPABILITY_PAGE_LIMIT = 25;
const OPENCODE_CAPABILITY_PAGE_LIMIT_MAXIMUM = 100;

function text(value = "") {
  return String(value ?? "").trim();
}

function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pageLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, OPENCODE_CAPABILITY_PAGE_LIMIT_MAXIMUM)
    : OPENCODE_CAPABILITY_PAGE_LIMIT;
}

function decodedCursor(value = "", kind = "providers", modelProviderId = "") {
  const cursor = text(value);
  if (!cursor) {
    return 0;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      decoded?.kind !== kind ||
      text(decoded?.modelProviderId) !== text(modelProviderId) ||
      !Number.isSafeInteger(decoded?.offset) ||
      decoded.offset < 0
    ) {
      throw new Error("cursor mismatch");
    }
    return decoded.offset;
  } catch {
    const error = new Error("The assistant catalog cursor is invalid for this request.");
    error.code = "vibe64_assistant_catalog_cursor_invalid";
    error.statusCode = 400;
    throw error;
  }
}

function encodedCursor(offset = 0, kind = "providers", modelProviderId = "") {
  return Buffer.from(JSON.stringify({
    kind,
    modelProviderId: text(modelProviderId),
    offset
  })).toString("base64url");
}

function normalizedConnections(value = null) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.connections) ? value.connections : [];
  return rows
    .map((connection) => typeof connection === "string"
      ? { fingerprint: "", id: text(connection) }
      : {
          fingerprint: text(connection?.fingerprint),
          id: text(connection?.modelProviderId || connection?.providerId || connection?.id),
          providerRevision: text(connection?.providerRevision)
        })
    .filter((connection) => connection.id);
}

function modelVariants(model = {}) {
  return Object.keys(record(model.variants))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({
      id,
      label: id.replaceAll("-", " ").replace(/^./u, (character) => character.toUpperCase())
    }));
}

function normalizedModel(model = {}) {
  const id = text(model.id);
  const status = text(model.status);
  return {
    capabilities: {
      attachment: model.capabilities?.attachment === true,
      input: { ...record(model.capabilities?.input) },
      output: { ...record(model.capabilities?.output) },
      reasoning: model.capabilities?.reasoning === true,
      toolcall: model.capabilities?.toolcall === true
    },
    description: [text(model.family), text(model.release_date)].filter(Boolean).join(" · "),
    id,
    label: text(model.name) || id,
    status: status === "deprecated" ? "unavailable" : "available",
    variants: modelVariants(model)
  };
}

function normalizedProvider(provider = {}, connectionById = new Map()) {
  const id = text(provider.id);
  const models = Object.values(record(provider.models))
    .map(normalizedModel)
    .filter((model) => model.id)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const definitionRevision = `sha256:${createHash("sha256").update(JSON.stringify({
    id,
    models: models.map((model) => ({
      capabilities: model.capabilities,
      id: model.id,
      status: model.status,
      variants: model.variants.map((variant) => variant.id)
    }))
  })).digest("hex")}`;
  const connection = connectionById.get(id);
  const stale = Boolean(connection && connection.providerRevision !== definitionRevision);
  return {
    connected: Boolean(connection) && !stale,
    connectionMessage: stale
      ? "This provider changed since its key was confirmed. Reconfirm the connection before use."
      : "",
    connectionStatus: stale ? "reconfirmation-required" : connection ? "connected" : "disconnected",
    definitionRevision,
    description: `OpenCode ${text(provider.source) || "API"} provider`,
    id,
    label: text(provider.name) || id,
    models
  };
}

function normalizedAgent(agent = {}) {
  const mode = text(agent.mode);
  if (agent.hidden === true || !["all", "primary"].includes(mode)) {
    return null;
  }
  return {
    description: text(agent.description),
    id: text(agent.name),
    label: text(agent.name).replaceAll("-", " ").replace(/^./u, (character) => character.toUpperCase()),
    mode,
    modelId: text(agent.model?.modelID),
    modelProviderId: text(agent.model?.providerID),
    variantId: text(agent.variant)
  };
}

function searchable(value = "", search = "") {
  return !search || String(value || "").toLocaleLowerCase().includes(search);
}

function openCodeAssistantCapabilities({
  agents: agentRows = [],
  connections = [],
  input = {},
  providers: providerResult = {}
} = {}) {
  const normalizedConnectionRows = normalizedConnections(connections);
  const connectionById = new Map(normalizedConnectionRows.map((connection) => [connection.id, connection]));
  const providers = (Array.isArray(providerResult?.all) ? providerResult.all : [])
    .map((provider) => normalizedProvider(provider, connectionById))
    .filter((provider) => provider.id)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const agents = (Array.isArray(agentRows) ? agentRows : [])
    .map(normalizedAgent)
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const requestedProviderId = text(input.modelProviderId);
  const connectedOnly = text(input.connectedOnly).toLowerCase() === "true";
  const search = text(input.search).toLocaleLowerCase();
  const kind = requestedProviderId ? "models" : "providers";
  const limit = pageLimit(input.limit);
  const offset = decodedCursor(input.cursor, kind, requestedProviderId);
  const defaultProvider = providers.find((provider) => provider.connected) || null;
  const upstreamDefaultModelId = text(providerResult?.default?.[defaultProvider?.id]);
  const defaultModel = defaultProvider?.models.find((model) => (
    model.id === upstreamDefaultModelId && model.status === "available"
  )) || defaultProvider?.models.find((model) => model.status === "available") || null;
  const defaultAgent = agents.find((agent) => (
    (!agent.modelProviderId || agent.modelProviderId === defaultProvider?.id) &&
    (!agent.modelId || agent.modelId === defaultModel?.id)
  )) || null;
  const selectableProviders = connectedOnly
    ? providers.filter((provider) => provider.connected)
    : providers;

  let pageProviders;
  let total;
  if (requestedProviderId) {
    const provider = selectableProviders.find((candidate) => candidate.id === requestedProviderId);
    const requestedModelId = text(input.modelId);
    const filteredModels = (provider?.models || []).filter((model) => (
      (!requestedModelId || model.id === requestedModelId) &&
      searchable(`${model.label}\n${model.id}\n${model.description}`, search)
    ));
    total = filteredModels.length;
    pageProviders = provider ? [{
      ...provider,
      models: filteredModels.slice(offset, offset + limit)
    }] : [];
  } else {
    const filteredProviders = selectableProviders.filter((provider) => searchable(
      `${provider.label}\n${provider.id}\n${provider.description}`,
      search
    ));
    total = filteredProviders.length;
    pageProviders = filteredProviders.slice(offset, offset + limit).map((provider) => ({
      ...provider,
      models: provider.id === defaultProvider?.id ? provider.models.slice(0, limit) : []
    }));
  }

  const revisionSource = {
    agents,
    connections: normalizedConnectionRows
      .map((connection) => `${connection.id}:${connection.fingerprint}:${connection.providerRevision}`)
      .sort(),
    providers: providers.map((provider) => ({
      id: provider.id,
      models: provider.models.map((model) => ({
        capabilities: model.capabilities,
        id: model.id,
        status: model.status,
        variants: model.variants.map((variant) => variant.id)
      }))
    }))
  };
  const revision = `sha256:${createHash("sha256").update(JSON.stringify(revisionSource)).digest("hex")}`;
  const nextOffset = offset + pageProviders.reduce((count, provider) => (
    count + (kind === "models" ? provider.models.length : 1)
  ), 0);
  const hasMore = nextOffset < total;
  return {
    agents,
    authentication: {
      management: "account-owner",
      modes: ["api-key"]
    },
    defaults: {
      agentId: defaultAgent?.id || "",
      modelId: defaultModel?.id || "",
      modelProviderId: defaultProvider?.id || "",
      variantId: defaultAgent?.variantId || ""
    },
    engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    health: {
      message: providers.some((provider) => provider.connected)
        ? ""
        : "Connect an API-key provider before starting an OpenCode session.",
      status: providers.some((provider) => provider.connected) ? "ready" : "unavailable"
    },
    label: "OpenCode",
    modelProviders: pageProviders,
    page: {
      cursor: text(input.cursor),
      hasMore,
      kind,
      limit,
      nextCursor: hasMore ? encodedCursor(nextOffset, kind, requestedProviderId) : "",
      search: text(input.search),
      total
    },
    revision,
    transportId: VIBE64_ASSISTANT_TRANSPORT_IDS.OPENCODE_SERVER
  };
}

export {
  OPENCODE_CAPABILITY_PAGE_LIMIT,
  OPENCODE_CAPABILITY_PAGE_LIMIT_MAXIMUM,
  openCodeAssistantCapabilities
};
