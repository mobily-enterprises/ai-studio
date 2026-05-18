import { computed, proxyRefs, reactive, ref, unref } from "vue";

const DEFAULT_POLL_INTERVAL_MS = 1000;

function useAccountAuthSessions(
  accounts,
  {
    accountRows,
    browserWindow = defaultBrowserWindow(),
    clearIntervalFn,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    setIntervalFn
  } = {}
) {
  const activeSessions = reactive({});
  const localError = ref("");
  const logoutAccountId = ref("");
  const openedUrls = new Set();
  const preparedBrowserWindows = new Map();
  const scheduler = createScheduler({
    browserWindow,
    clearIntervalFn,
    setIntervalFn
  });

  let pollTimer = null;

  const authBusy = computed(() => {
    return Object.values(activeSessions).some((session) => session?.status === "authenticating");
  });
  const logoutBusy = computed(() => Boolean(logoutAccountId.value));
  const errorMessage = computed(() => {
    if (localError.value || accounts.loadError) {
      return localError.value || accounts.loadError;
    }
    return accounts.startAuthCommand?.messageType === "error"
      ? accounts.startAuthCommand.message
      : "";
  });

  function activeSessionFor(accountId) {
    return activeSessions[accountId] || null;
  }

  function loginDisabled(account = {}) {
    return authBusy.value || logoutBusy.value || account.connected === true;
  }

  async function refreshStatus() {
    await accounts.refresh();
  }

  async function startBrowserAuth(accountId) {
    await startAuth(accountId, "browser");
  }

  async function startDeviceAuth() {
    await startAuth("codex", "device");
  }

  async function startAuth(accountId, mode = "browser") {
    localError.value = "";
    if (accountFor(accountId)?.connected === true) {
      return;
    }

    prepareBrowserWindow(accountId);
    try {
      const session = await accounts.startAuth(accountId, mode);
      if (!session?.id) {
        throw new Error("Login did not return an auth session.");
      }
      rememberAuthSession(session);
      startPolling();
    } catch (error) {
      closePreparedWindow(accountId);
      localError.value = String(error?.message || error || "Login could not start.");
    }
  }

  async function logoutAccount(accountId) {
    localError.value = "";
    logoutAccountId.value = String(accountId || "");
    try {
      await accounts.logout(accountId);
      await refreshStatus();
    } catch (error) {
      localError.value = String(error?.message || error || "Logout failed.");
    } finally {
      logoutAccountId.value = "";
    }
  }

  async function cancelSession(session = {}) {
    if (!session.id) {
      return;
    }
    await accounts.cancelAuthSession(session.id).catch(() => null);
    forgetSession(session);
    await refreshStatus();
    stopPollingIfIdle();
  }

  async function pollAuthSessions() {
    const sessions = Object.values(activeSessions).filter((session) => {
      return session?.id && session.status === "authenticating";
    });
    if (!sessions.length) {
      stopPolling();
      return;
    }

    for (const session of sessions) {
      const nextSession = await accounts.readAuthSession(session.id);
      rememberAuthSession(nextSession);
      if (nextSession.status === "connected") {
        forgetSession(nextSession);
        await refreshStatus();
      } else if (nextSession.status === "failed") {
        closePreparedWindow(nextSession.account?.id);
        await refreshStatus();
      }
    }

    stopPollingIfIdle();
  }

  function startPolling() {
    if (pollTimer) {
      return;
    }
    pollTimer = scheduler.setInterval(() => {
      void pollAuthSessions().catch((error) => {
        localError.value = String(error?.message || error || "Login polling failed.");
      });
    }, pollIntervalMs);
  }

  function stopPolling() {
    if (!pollTimer) {
      return;
    }
    scheduler.clearInterval(pollTimer);
    pollTimer = null;
  }

  function stopPollingIfIdle() {
    if (!Object.values(activeSessions).some((session) => session?.status === "authenticating")) {
      stopPolling();
    }
  }

  function accountFor(accountId) {
    const rows = Array.isArray(unref(accountRows)) ? unref(accountRows) : [];
    return rows.find((account) => account.id === accountId) || null;
  }

  function prepareBrowserWindow(accountId) {
    try {
      const preparedWindow = browserWindow?.open?.("about:blank", "_blank");
      if (preparedWindow) {
        preparedWindow.opener = null;
        preparedBrowserWindows.set(accountId, preparedWindow);
      }
    } catch {
      preparedBrowserWindows.delete(accountId);
    }
  }

  function openAuthUrl(session = {}) {
    const url = String(session.authUrl || "");
    if (!url) {
      return;
    }

    const accountId = session.account?.id || "";
    const openKey = `${session.id}:${url}`;
    const preparedWindow = preparedBrowserWindows.get(accountId);
    if (!openedUrls.has(openKey) && preparedWindow && !preparedWindow.closed) {
      preparedWindow.location.href = url;
      openedUrls.add(openKey);
      return;
    }
    if (!openedUrls.has(openKey)) {
      browserWindow?.open?.(url, "_blank", "noopener");
      openedUrls.add(openKey);
    }
  }

  function rememberAuthSession(session = {}) {
    const accountId = session.account?.id || session.account || "";
    if (!accountId || !session.id) {
      return;
    }
    activeSessions[accountId] = session;
    openAuthUrl(session);
  }

  function forgetSession(session = {}) {
    const accountId = session.account?.id || session.account || "";
    if (!accountId) {
      return;
    }
    delete activeSessions[accountId];
    preparedBrowserWindows.delete(accountId);
  }

  function closePreparedWindow(accountId) {
    const preparedWindow = preparedBrowserWindows.get(accountId);
    preparedWindow?.close?.();
    preparedBrowserWindows.delete(accountId);
  }

  return proxyRefs({
    activeSessionFor,
    authBusy,
    cancelSession,
    errorMessage,
    localError,
    loginDisabled,
    logoutAccount,
    logoutAccountId,
    logoutBusy,
    openAuthUrl,
    pollAuthSessions,
    refreshStatus,
    startBrowserAuth,
    startDeviceAuth,
    stopPolling
  });
}

function defaultBrowserWindow() {
  return typeof window === "undefined" ? null : window;
}

function createScheduler({
  browserWindow,
  clearIntervalFn,
  setIntervalFn
}) {
  return {
    clearInterval: clearIntervalFn || browserWindow?.clearInterval?.bind(browserWindow) || globalThis.clearInterval,
    setInterval: setIntervalFn || browserWindow?.setInterval?.bind(browserWindow) || globalThis.setInterval
  };
}

export { useAccountAuthSessions };
