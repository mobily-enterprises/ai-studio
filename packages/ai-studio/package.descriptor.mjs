export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns the AI Studio workflow, sessions, artifacts, adapters, and terminals.",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "feature.ai-studio"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AiStudioProvider.js",
          export: "AiStudioProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/registerRoutes",
          summary: "Registers AI Studio project type, session, artifact, and terminal routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns AI Studio workflow orchestration and terminal lifecycle behavior."
        }
      ],
      containerTokens: {
        server: [
          "feature.ai-studio.service"
        ],
        client: []
      }
    },
    jskit: {
      scaffoldShape: "feature-server-v1",
      scaffoldMode: "orchestrator",
      lane: "default"
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: []
  }
});
