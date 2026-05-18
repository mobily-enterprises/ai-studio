import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { useAccountAuthSessions } from "../../src/composables/useAccountAuthSessions.js";

describe("account auth sessions", () => {
  it("starts browser auth, reuses the prepared browser window, and records the active session", async () => {
    const accounts = fakeAccounts({
      startAuth: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        authUrl: "https://github.com/login/device",
        id: "auth-1",
        status: "authenticating",
        terminalStatus: "running"
      })
    });
    const browserWindow = fakeBrowserWindow();
    const scheduler = fakeScheduler();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "github"
        }
      ]),
      browserWindow,
      clearIntervalFn: scheduler.clearInterval,
      setIntervalFn: scheduler.setInterval
    });

    await authSessions.startBrowserAuth("github");

    expect(accounts.startAuth).toHaveBeenCalledWith("github", "browser");
    expect(browserWindow.open).toHaveBeenCalledTimes(1);
    expect(browserWindow.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(browserWindow.openedWindows[0].location.href).toBe("https://github.com/login/device");
    expect(authSessions.activeSessionFor("github")?.id).toBe("auth-1");
    expect(authSessions.authBusy).toBe(true);
    expect(scheduler.setInterval).toHaveBeenCalledTimes(1);
  });

  it("refreshes status and removes an auth session after it connects", async () => {
    const accounts = fakeAccounts({
      readAuthSession: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        status: "connected"
      }),
      startAuth: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        status: "authenticating"
      })
    });
    const scheduler = fakeScheduler();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "github"
        }
      ]),
      browserWindow: fakeBrowserWindow(),
      clearIntervalFn: scheduler.clearInterval,
      setIntervalFn: scheduler.setInterval
    });

    await authSessions.startBrowserAuth("github");
    await authSessions.pollAuthSessions();

    expect(accounts.readAuthSession).toHaveBeenCalledWith("auth-1");
    expect(accounts.refresh).toHaveBeenCalledTimes(1);
    expect(authSessions.activeSessionFor("github")).toBeNull();
    expect(authSessions.authBusy).toBe(false);
  });

  it("keeps failed auth sessions visible and stops polling them", async () => {
    const accounts = fakeAccounts({
      readAuthSession: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        output: "GitHub login failed because the token expired.",
        status: "failed",
        terminalStatus: "exited"
      }),
      startAuth: async () => ({
        account: {
          id: "github",
          label: "GitHub"
        },
        id: "auth-1",
        status: "authenticating"
      })
    });
    const scheduler = fakeScheduler();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "github"
        }
      ]),
      browserWindow: fakeBrowserWindow(),
      clearIntervalFn: scheduler.clearInterval,
      setIntervalFn: scheduler.setInterval
    });

    await authSessions.startBrowserAuth("github");
    await authSessions.pollAuthSessions();
    await authSessions.pollAuthSessions();

    expect(accounts.readAuthSession).toHaveBeenCalledTimes(1);
    expect(accounts.refresh).toHaveBeenCalledTimes(1);
    expect(authSessions.activeSessionFor("github")).toMatchObject({
      id: "auth-1",
      output: "GitHub login failed because the token expired.",
      status: "failed"
    });
    expect(authSessions.authBusy).toBe(false);
    expect(scheduler.clearInterval).toHaveBeenCalledWith(1001);
  });

  it("does not start login for an already connected account", async () => {
    const accounts = fakeAccounts();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: true,
          id: "github"
        }
      ]),
      browserWindow: fakeBrowserWindow()
    });

    await authSessions.startBrowserAuth("github");

    expect(accounts.startAuth).not.toHaveBeenCalled();
  });

  it("surfaces start failures and closes the prepared browser window", async () => {
    const accounts = fakeAccounts({
      startAuth: async () => {
        throw new Error("GitHub refused login.");
      }
    });
    const browserWindow = fakeBrowserWindow();
    const authSessions = useAccountAuthSessions(accounts, {
      accountRows: ref([
        {
          connected: false,
          id: "github"
        }
      ]),
      browserWindow
    });

    await authSessions.startBrowserAuth("github");

    expect(authSessions.errorMessage).toBe("GitHub refused login.");
    expect(browserWindow.openedWindows[0].close).toHaveBeenCalledTimes(1);
  });
});

function fakeAccounts(overrides = {}) {
  const accounts = {
    cancelAuthSession: vi.fn(async () => ({})),
    loadError: "",
    logout: vi.fn(async () => ({})),
    readAuthSession: vi.fn(async () => ({})),
    refresh: vi.fn(async () => ({})),
    startAuth: vi.fn(async () => ({})),
    startAuthCommand: {
      message: "",
      messageType: ""
    }
  };
  for (const [key, value] of Object.entries(overrides)) {
    accounts[key] = typeof value === "function" ? vi.fn(value) : value;
  }
  return accounts;
}

function fakeBrowserWindow() {
  const openedWindows = [];
  return {
    openedWindows,
    open: vi.fn((url, target, features) => {
      const preparedWindow = {
        closed: false,
        close: vi.fn(function closeWindow() {
          this.closed = true;
        }),
        features,
        location: {
          href: String(url || "")
        },
        opener: {},
        target
      };
      openedWindows.push(preparedWindow);
      return preparedWindow;
    })
  };
}

function fakeScheduler() {
  return {
    clearInterval: vi.fn(),
    setInterval: vi.fn(() => 1001)
  };
}
