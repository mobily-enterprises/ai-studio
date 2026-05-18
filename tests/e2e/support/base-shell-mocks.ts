import {
  abandonedArchiveSession,
  blockedAppSetupPayload,
  blockedBootstrapPayload,
  blockedTargetAppPayload,
  codexIssueCreatedPayload,
  codexIssueDraftedPayload,
  codexPlanPromptPayload,
  codexPromptSessionId,
  codexPromptSessionPayload,
  codexPromptStepDefinitions,
  codexThreadCommand,
  codexThreadId,
  codexThreadProbe,
  completedArchiveSession,
  currentAppPayload,
  readyAppSetupPayload,
  readyBootstrapPayload,
  readyTargetAppPayload,
  secondCodexPromptSessionPayload,
  targetScriptsPayload
} from "./base-shell-data";

function sseStatusPayload(status, itemsKey = "checks") {
  const items = Array.isArray(status?.[itemsKey]) ? status[itemsKey] : [];
  const events = [
    ["run.started", {}],
    ...items.flatMap((item) => [
      ["check.started", {
        id: item.id,
        label: item.label
      }],
      ["check.finished", {
        check: item,
        id: item.id,
        label: item.label,
        status: item.status
      }]
    ]),
    ["run.finished", {
      status
    }]
  ];

  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`)
    .join("\n")
    .concat("\n");
}

async function fulfillSse(route, status, itemsKey = "checks") {
  await route.fulfill({
    contentType: "text/event-stream",
    body: sseStatusPayload(status, itemsKey)
  });
}

function trackStudioApiRequests(page) {
  const requests: string[] = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/api/studio/")) {
      requests.push(pathname);
    }
  });

  return {
    count(pathname: string) {
      return requests.filter((requestPathname) => requestPathname === pathname).length;
    },
    requests
  };
}

function mockCodexThreadIdForSession(sessionId: string) {
  const suffix = String(sessionId || "")
    .replace(/\D/gu, "")
    .padEnd(12, "0")
    .slice(-12);
  return `019e1575-2458-7b93-bf9d-${suffix}`;
}

async function mockCodexTerminalWebSocket(page, {
  initialOutputBySessionId,
  terminalInputs
}: {
  initialOutputBySessionId: Record<string, string>;
  terminalInputs: Record<string, string[]> | string[];
}) {
  await page.exposeFunction("__recordStudioCodexTerminalInput", ({ sessionId, data }: {
    data: string;
    sessionId: string;
  }) => {
    if (Array.isArray(terminalInputs)) {
      terminalInputs.push(String(data || ""));
      return;
    }
    const terminalInputMap = terminalInputs as Record<string, string[]>;
    terminalInputMap[sessionId] ||= [];
    terminalInputMap[sessionId].push(String(data || ""));
  });
  await page.addInitScript((options) => {
    const inputsBySessionId: Record<string, string[]> = {};
    const socketsBySessionId: Record<string, any[]> = {};
    const studioWindow = window as unknown as {
      __studioFailCodexTerminal: (input: { error?: string; sessionId: string }) => void;
      __recordStudioCodexTerminalInput: (input: { data: string; sessionId: string }) => void;
      __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
      WebSocket: typeof WebSocket;
    };
    function sessionThreadId(sessionId) {
      const suffix = String(sessionId || "")
        .replace(/\D/gu, "")
        .padEnd(12, "0")
        .slice(-12);
      return `019e1575-2458-7b93-bf9d-${suffix}`;
    }
    class MockStudioWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState: number;
      sessionId: string;
      terminalSessionId: string;
      url: string;

      constructor(url) {
        super();
        this.url = String(url || "");
        this.readyState = MockStudioWebSocket.CONNECTING;
        const match = /\/sessions\/([^/]+)\/codex-terminal\/([^/]+)\/ws/u.exec(new URL(this.url).pathname);
        this.sessionId = match ? decodeURIComponent(match[1]) : "";
        this.terminalSessionId = match ? decodeURIComponent(match[2]) : "";
        inputsBySessionId[this.sessionId] ||= [];
        socketsBySessionId[this.sessionId] ||= [];
        socketsBySessionId[this.sessionId].push(this);
        window.setTimeout(() => {
          this.readyState = MockStudioWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.__emit({
            type: "snapshot",
            session: {
              ok: true,
              id: this.terminalSessionId,
              status: "running",
              commandPreview: "codex",
              output: options.initialOutputBySessionId[this.sessionId] || "Codex ready.",
              needsThreadCapture: true,
              threadProbe: options.codexThreadProbe
            }
          });
        }, 0);
      }

      send(rawMessage) {
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message.type !== "input") {
          return;
        }
        const data = String(message.data || "");
        inputsBySessionId[this.sessionId].push(data);
        studioWindow.__recordStudioCodexTerminalInput({
          data,
          sessionId: this.sessionId
        });
        if (data === "\r" && inputsBySessionId[this.sessionId].includes(options.codexThreadCommand)) {
          this.__emit({
            chunk: `\n${options.codexThreadProbe}\n${options.codexThreadIdBySessionId[this.sessionId] || sessionThreadId(this.sessionId)}\n`,
            type: "output"
          });
        }
      }

      close() {
        this.readyState = MockStudioWebSocket.CLOSED;
        socketsBySessionId[this.sessionId] = (socketsBySessionId[this.sessionId] || [])
          .filter((socket) => socket !== this);
        this.dispatchEvent(new CloseEvent("close"));
      }

      __emit(message) {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify(message)
        }));
      }
    }
    studioWindow.__studioPushCodexTerminalOutput = ({ sessionId, output }) => {
      for (const socket of socketsBySessionId[sessionId] || []) {
        socket.__emit({
          chunk: String(output || ""),
          type: "output"
        });
      }
    };
    studioWindow.__studioFailCodexTerminal = ({ sessionId, error }) => {
      for (const socket of [...socketsBySessionId[sessionId] || []]) {
        socket.__emit({
          error: String(error || "Terminal session not found."),
          type: "error"
        });
        socket.close();
      }
    };
    studioWindow.WebSocket = MockStudioWebSocket as unknown as typeof WebSocket;
  }, {
    codexThreadCommand,
    codexThreadIdBySessionId: {
      [codexPromptSessionId]: codexThreadId
    },
    codexThreadProbe,
    initialOutputBySessionId
  });
}

async function mockBootstrapBlocked(page) {
  await page.route("**/api/studio/studio-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(blockedBootstrapPayload)
    });
  });
  await page.route("**/api/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, blockedBootstrapPayload);
  });
}

async function mockTargetAppBlocked(page) {
  await page.route("**/api/studio/studio-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyBootstrapPayload)
    });
  });
  await page.route("**/api/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/adapter-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(blockedTargetAppPayload)
    });
  });
  await page.route("**/api/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, blockedTargetAppPayload);
  });
}

async function mockStudioReady(page) {
  await page.route("**/api/studio/studio-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyBootstrapPayload)
    });
  });
  await page.route("**/api/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/adapter-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyTargetAppPayload)
    });
  });
  await page.route("**/api/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/project-setup/stream", async (route) => {
    await fulfillSse(route, readyAppSetupPayload, "stages");
  });
  await page.route("**/api/studio/project-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyAppSetupPayload)
    });
  });
  await mockCurrentAppInspection(page);
}

async function mockCurrentAppInspection(page) {
  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
  await page.route("**/api/ai-studio/sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: 0
        },
        ok: true,
        sessions: [],
        stepDefinitions: []
      })
    });
  });
  await mockTargetScripts(page);
}

async function mockTargetScripts(page, {
  terminalInputs = [],
  terminalStarts = []
}: {
  terminalInputs?: string[];
  terminalStarts?: string[];
} = {}) {
  let currentPayload = JSON.parse(JSON.stringify(targetScriptsPayload));

  await page.exposeFunction("__recordStudioTargetScriptTerminalInput", ({ data }: { data: string }) => {
    terminalInputs.push(String(data || ""));
  });
  await page.addInitScript((options) => {
    const studioWindow = window as unknown as {
      __recordStudioTargetScriptTerminalInput: (input: { data: string }) => void;
      WebSocket: typeof WebSocket;
    };
    const OriginalWebSocket = studioWindow.WebSocket;

    class MockStudioWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState: number;
      terminalSessionId: string;
      url: string;

      constructor(url) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url).pathname;
        const match = /\/target-script-terminal\/([^/]+)\/ws/u.exec(pathname);
        if (!match) {
          return new OriginalWebSocket(url);
        }
        this.readyState = MockStudioWebSocket.CONNECTING;
        this.terminalSessionId = decodeURIComponent(match[1]);
        window.setTimeout(() => {
          const scriptId = this.terminalSessionId.replace(/^target-term-/u, "");
          this.readyState = MockStudioWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.__emit({
            type: "snapshot",
            session: {
              ok: true,
              id: this.terminalSessionId,
              status: "running",
              commandPreview: options.commandByScriptId[scriptId] || scriptId,
              output: `Started ${this.terminalSessionId}.`
            }
          });
        }, 0);
      }

      send(rawMessage) {
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message.type === "input") {
          studioWindow.__recordStudioTargetScriptTerminalInput({
            data: String(message.data || "")
          });
        }
      }

      close() {
        this.readyState = MockStudioWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }

      __emit(message) {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify(message)
        }));
      }
    }
    studioWindow.WebSocket = MockStudioWebSocket as unknown as typeof WebSocket;
  }, {
    commandByScriptId: Object.fromEntries(targetScriptsPayload.scripts.map((script) => [script.id, script.command]))
  });

  function applyStars(scriptIds: string[]) {
    const stars = new Set(scriptIds);
    currentPayload = {
      ...currentPayload,
      config: {
        exists: true,
        path: ".ai-studio/config/starred_scripts"
      },
      starredScriptIds: scriptIds,
      scripts: currentPayload.scripts.map((script) => ({
        ...script,
        starred: stars.has(script.id)
      }))
    };
  }

  await page.route("**/api/studio/current-app/target-scripts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentPayload)
    });
  });
  await page.route("**/api/studio/current-app/target-scripts/starred", async (route) => {
    if (route.request().method() === "DELETE") {
      currentPayload = JSON.parse(JSON.stringify(targetScriptsPayload));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentPayload)
      });
      return;
    }
    applyStars(route.request().postDataJSON().scriptIds || []);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentPayload)
    });
  });
  await page.route("**/api/studio/current-app/target-script-terminal", async (route) => {
    const scriptId = String(route.request().postDataJSON().scriptId || "");
    const script = currentPayload.scripts.find((item) => item.id === scriptId) || {};
    terminalStarts.push(scriptId);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: `target-term-${scriptId}`,
        status: "running",
        commandPreview: script.command || scriptId,
        output: ""
      })
    });
  });
  await page.route("**/api/studio/current-app/target-script-terminal/*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        closed: true,
        ok: true
      })
    });
  });
}

async function mockSessionHistoryArchives(page, archiveRequests = []) {
  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
  await page.route("**/api/ai-studio/sessions**", async (route) => {
    const url = new URL(route.request().url());
    const archive = url.searchParams.get("archive") || "active";
    archiveRequests.push(archive);
    const sessions = archive === "completed"
      ? [completedArchiveSession]
      : archive === "abandoned" ? [abandonedArchiveSession] : [];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: 0
        },
        ok: true,
        sessions,
        stepDefinitions: []
      })
    });
  });
  await mockTargetScripts(page);
}

async function mockCodexPromptHandoffRoute(page, sessionId: string) {
  await page.route(`**/api/ai-studio/sessions/${sessionId}/codex-prompt-handoff`, async (route) => {
    const payload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        codexPromptHandoffOutputStart: Number(payload.outputStart || 0),
        codexPromptHandoffSignature: payload.signature || "",
        ok: true
      })
    });
  });
}

async function mockCodexPromptSession(page, { stepPayloads = [], terminalInputs = [] } = {}) {
  let terminalOutput = "Codex ready.";
  let issueTitle = codexIssueDraftedPayload.issueTitle;
  let issueText = codexIssueDraftedPayload.issueText;
  let stepRequestCount = 0;
  await mockCodexTerminalWebSocket(page, {
    initialOutputBySessionId: {
      [codexPromptSessionId]: terminalOutput
    },
    terminalInputs
  });
  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
  await page.route("**/api/ai-studio/sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: 1
        },
        ok: true,
        sessions: [codexPromptSessionPayload],
        stepDefinitions: codexPromptStepDefinitions
      })
    });
  });
  await mockTargetScripts(page);
  await page.route(`**/api/ai-studio/sessions/${codexPromptSessionId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(codexPromptSessionPayload)
    });
  });
  await page.route(`**/api/ai-studio/sessions/${codexPromptSessionId}/step`, async (route) => {
    const payload = route.request().postDataJSON();
    stepPayloads.push(payload);
    stepRequestCount += 1;
    if (stepRequestCount === 1) {
      issueTitle = String(payload.issueTitle || "");
      issueText = String(payload.issue || "");
    }
    const draftedPayload = {
      ...codexIssueDraftedPayload,
      issueTitle,
      issueText
    };
    const createdPayload = {
      ...codexIssueCreatedPayload,
      issueTitle,
      issueText
    };
    const planPromptPayload = {
      ...codexPlanPromptPayload,
      issueTitle,
      issueText
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        stepRequestCount === 1
          ? draftedPayload
          : stepRequestCount === 2 ? createdPayload : planPromptPayload
      )
    });
  });
  await page.route(`**/api/ai-studio/sessions/${codexPromptSessionId}/codex-terminal`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: "term-1",
        status: "running",
        commandPreview: "codex",
        output: terminalOutput,
        needsThreadCapture: true,
        threadProbe: codexThreadProbe
      })
    });
  });
  await page.route(`**/api/ai-studio/sessions/${codexPromptSessionId}/codex-thread`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        codexThreadId: route.request().postDataJSON().threadId,
        ok: true
      })
    });
  });
  await mockCodexPromptHandoffRoute(page, codexPromptSessionId);
  return {
    async setTerminalOutput(output) {
      terminalOutput = String(output || "");
      await page.evaluate(({ output: nextOutput, sessionId }) => {
        (window as unknown as {
          __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
        }).__studioPushCodexTerminalOutput({
          output: nextOutput,
          sessionId
        });
      }, {
        output: terminalOutput,
        sessionId: codexPromptSessionId
      });
    },
    stepPayloads,
    terminalInputs
  };
}

function isOpenMockSession(session) {
  return !["abandoned", "finished"].includes(String(session.status || ""));
}

async function mockCodexPromptSessions(page, sessionPayloads) {
  let visibleSessionPayloads = [...sessionPayloads];
  const terminalStarts = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, 0]));
  const terminalDeletes = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, 0]));
  const terminalInputs = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, []])) as Record<string, string[]>;
  const payloadsBySessionId = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, session]));
  await mockCodexTerminalWebSocket(page, {
    initialOutputBySessionId: Object.fromEntries(sessionPayloads.map((session) => [
      session.sessionId,
      `Codex ready for ${session.sessionId}.`
    ])),
    terminalInputs
  });

  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(currentAppPayload)
    });
  });
  await page.route("**/api/ai-studio/sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: visibleSessionPayloads.filter(isOpenMockSession).length
        },
        ok: true,
        sessions: visibleSessionPayloads,
        stepDefinitions: codexPromptStepDefinitions
      })
    });
  });
  await mockTargetScripts(page);

  for (const sessionId of Object.keys(payloadsBySessionId)) {
    await page.route(`**/api/ai-studio/sessions/${sessionId}`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(payloadsBySessionId[sessionId])
      });
    });
    await page.route(`**/api/ai-studio/sessions/${sessionId}/abandon`, async (route) => {
      terminalDeletes[sessionId] += 1;
      payloadsBySessionId[sessionId] = {
        ...payloadsBySessionId[sessionId],
        codex: null,
        currentStep: "",
        status: "abandoned"
      };
      visibleSessionPayloads = visibleSessionPayloads.filter((session) => session.sessionId !== sessionId);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(payloadsBySessionId[sessionId])
      });
    });
    await page.route(`**/api/ai-studio/sessions/${sessionId}/codex-terminal`, async (route) => {
      terminalStarts[sessionId] += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          id: `term-${sessionId}`,
          status: "running",
          commandPreview: "codex",
          output: `Codex ready for ${sessionId}.`,
          needsThreadCapture: true,
          threadProbe: codexThreadProbe
        })
      });
    });
    await page.route(`**/api/ai-studio/sessions/${sessionId}/codex-thread`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          codexThreadId: route.request().postDataJSON().threadId,
          ok: true
        })
      });
    });
    await mockCodexPromptHandoffRoute(page, sessionId);
    await page.route(
      `**/api/ai-studio/sessions/${sessionId}/codex-terminal/term-${sessionId}`,
      async (route) => {
        if (route.request().method() === "DELETE") {
          terminalDeletes[sessionId] += 1;
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              closed: true,
              ok: true
            })
          });
          return;
        }
        await route.fulfill({
          contentType: "application/json",
          status: 410,
          body: JSON.stringify({
            ok: false,
            error: "HTTP terminal read fallback is not available in tests."
          })
        });
      }
    );
  }

  return {
    terminalDeletes,
    terminalInputs,
    terminalStarts
  };
}

async function mockTwoCodexPromptSessions(page) {
  return mockCodexPromptSessions(page, [
    codexPromptSessionPayload,
    secondCodexPromptSessionPayload
  ]);
}

async function mockAppSetupBlocked(page) {
  await page.route("**/api/studio/studio-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyBootstrapPayload)
    });
  });
  await page.route("**/api/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/adapter-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(readyTargetAppPayload)
    });
  });
  await page.route("**/api/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/project-setup", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(blockedAppSetupPayload)
    });
  });
  await page.route("**/api/studio/project-setup/stream", async (route) => {
    await fulfillSse(route, blockedAppSetupPayload, "stages");
  });
}

export {
  trackStudioApiRequests,
  mockCodexThreadIdForSession,
  mockCodexTerminalWebSocket,
  mockBootstrapBlocked,
  mockTargetAppBlocked,
  mockStudioReady,
  mockCurrentAppInspection,
  mockTargetScripts,
  mockSessionHistoryArchives,
  mockCodexPromptHandoffRoute,
  mockCodexPromptSession,
  isOpenMockSession,
  mockCodexPromptSessions,
  mockTwoCodexPromptSessions,
  mockAppSetupBlocked
};
