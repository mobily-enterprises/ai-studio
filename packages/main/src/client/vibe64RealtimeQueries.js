import { registerRealtimeClientListener } from "@jskit-ai/realtime/client/listeners";
import {
  invalidateVibe64LiveQueries
} from "/src/lib/vibe64LiveQueryRecovery.js";

const VIBE64_LIVE_QUERY_RECOVERY_LISTENER = "local.main.vibe64-live-query-recovery-listener";

function registerVibe64RealtimeListeners(app) {
  registerRealtimeClientListener(app, VIBE64_LIVE_QUERY_RECOVERY_LISTENER, () => ({
    listenerId: VIBE64_LIVE_QUERY_RECOVERY_LISTENER,
    event: "connect",
    handle({ app: runtimeApp }) {
      return invalidateVibe64LiveQueries(runtimeApp);
    }
  }));
}

export {
  VIBE64_LIVE_QUERY_RECOVERY_LISTENER,
  invalidateVibe64LiveQueries,
  registerVibe64RealtimeListeners
};
