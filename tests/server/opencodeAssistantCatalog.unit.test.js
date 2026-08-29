import assert from "node:assert/strict";
import test from "node:test";

import {
  openCodeAssistantCapabilities
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js";

function provider(id, {
  modelCount = 2,
  name = id
} = {}) {
  return {
    id,
    models: Object.fromEntries(Array.from({ length: modelCount }, (_, index) => {
      const modelId = `${id}-model-${String(index + 1).padStart(2, "0")}`;
      return [modelId, {
        capabilities: {
          attachment: index === 0,
          reasoning: true,
          toolcall: true
        },
        family: `${id} family`,
        id: modelId,
        name: `${name} Model ${index + 1}`,
        status: index === modelCount - 1 && modelCount > 2 ? "deprecated" : "active",
        variants: {
          high: {},
          low: {}
        }
      }];
    })),
    name,
    source: "env"
  };
}

const agents = [
  {
    description: "Make changes",
    hidden: false,
    mode: "primary",
    name: "build"
  },
  {
    description: "Provider-specific agent",
    hidden: false,
    mode: "all",
    model: {
      modelID: "deepseek-model-01",
      providerID: "deepseek"
    },
    name: "deepseek-build",
    variant: "high"
  },
  {
    hidden: true,
    mode: "primary",
    name: "vibe64-economy"
  },
  {
    hidden: false,
    mode: "subagent",
    name: "explore"
  }
];

test("OpenCode catalog searches and pages providers without exposing hidden agents", () => {
  const all = Array.from({ length: 31 }, (_, index) => provider(
    `provider-${String(index + 1).padStart(2, "0")}`,
    { name: `Provider ${String(index + 1).padStart(2, "0")}` }
  ));
  const first = openCodeAssistantCapabilities({
    agents,
    input: { limit: 10 },
    providers: { all, default: {} }
  });
  assert.equal(first.page.total, 31);
  assert.equal(first.modelProviders.length, 10);
  assert.equal(first.page.hasMore, true);
  assert.ok(first.page.nextCursor);
  assert.deepEqual(first.agents.map(({ id }) => id), ["build", "deepseek-build"]);

  const second = openCodeAssistantCapabilities({
    agents,
    input: { cursor: first.page.nextCursor, limit: 10 },
    providers: { all, default: {} }
  });
  assert.equal(second.modelProviders[0].id, "provider-11");

  const searched = openCodeAssistantCapabilities({
    agents,
    input: { search: "provider 29" },
    providers: { all, default: {} }
  });
  assert.deepEqual(searched.modelProviders.map(({ id }) => id), ["provider-29"]);
  assert.throws(
    () => openCodeAssistantCapabilities({
      agents,
      input: { cursor: first.page.nextCursor, modelProviderId: "provider-01" },
      providers: { all, default: {} }
    }),
    (error) => error?.code === "vibe64_assistant_catalog_cursor_invalid"
  );
});

test("OpenCode catalog can page only providers with current connections", () => {
  const all = Array.from({ length: 31 }, (_, index) => provider(
    `provider-${String(index + 1).padStart(2, "0")}`,
    { name: `Provider ${String(index + 1).padStart(2, "0")}` }
  ));
  const definitions = openCodeAssistantCapabilities({
    agents,
    input: { limit: 100 },
    providers: { all, default: {} }
  });
  const connectedIds = ["provider-02", "provider-31"];
  const connections = connectedIds.map((id) => ({
    modelProviderId: id,
    providerRevision: definitions.modelProviders.find((candidate) => candidate.id === id).definitionRevision
  }));

  const connected = openCodeAssistantCapabilities({
    agents,
    connections,
    input: { connectedOnly: "true", limit: 1 },
    providers: { all, default: {} }
  });
  const next = openCodeAssistantCapabilities({
    agents,
    connections,
    input: {
      connectedOnly: "true",
      cursor: connected.page.nextCursor,
      limit: 1
    },
    providers: { all, default: {} }
  });

  assert.equal(connected.page.total, 2);
  assert.deepEqual(connected.modelProviders.map(({ id }) => id), ["provider-02"]);
  assert.deepEqual(next.modelProviders.map(({ id }) => id), ["provider-31"]);
});

test("OpenCode catalog requires reconfirmation when a live provider definition changes", () => {
  const deepseek = provider("deepseek", { modelCount: 3, name: "DeepSeek" });
  const providerResult = {
    all: [deepseek],
    default: { deepseek: "deepseek-model-01" }
  };
  const disconnected = openCodeAssistantCapabilities({
    agents,
    providers: providerResult
  });
  const definitionRevision = disconnected.modelProviders[0].definitionRevision;
  const connected = openCodeAssistantCapabilities({
    agents,
    connections: [{
      fingerprint: "sha256:key-a",
      modelProviderId: "deepseek",
      providerRevision: definitionRevision
    }],
    providers: providerResult
  });
  assert.equal(connected.health.status, "ready");
  assert.equal(connected.modelProviders[0].connected, true);
  assert.deepEqual(connected.defaults, {
    agentId: "build",
    modelId: "deepseek-model-01",
    modelProviderId: "deepseek",
    variantId: "high"
  });

  const changedProviderResult = {
    all: [provider("deepseek", { modelCount: 4, name: "DeepSeek" })],
    default: { deepseek: "deepseek-model-01" }
  };
  const stale = openCodeAssistantCapabilities({
    agents,
    connections: [{
      fingerprint: "sha256:key-a",
      modelProviderId: "deepseek",
      providerRevision: definitionRevision
    }],
    providers: changedProviderResult
  });
  assert.equal(stale.health.status, "unavailable");
  assert.equal(stale.modelProviders[0].connected, false);
  assert.equal(stale.modelProviders[0].connectionStatus, "reconfirmation-required");
  assert.notEqual(stale.modelProviders[0].definitionRevision, definitionRevision);
  assert.notEqual(stale.revision, connected.revision);
});

test("OpenCode catalog pages and searches one provider's live model list", () => {
  const deepseek = provider("deepseek", { modelCount: 30, name: "DeepSeek" });
  const initial = openCodeAssistantCapabilities({
    agents,
    input: { modelProviderId: "deepseek", limit: 7 },
    providers: { all: [deepseek], default: {} }
  });
  assert.equal(initial.page.kind, "models");
  assert.equal(initial.page.total, 30);
  assert.equal(initial.modelProviders[0].models.length, 7);
  assert.equal(initial.page.hasMore, true);

  const searched = openCodeAssistantCapabilities({
    agents,
    input: {
      modelProviderId: "deepseek",
      search: "model 24"
    },
    providers: { all: [deepseek], default: {} }
  });
  assert.deepEqual(
    searched.modelProviders[0].models.map(({ id }) => id),
    ["deepseek-model-24"]
  );
});
