import {
  invalidateVibe64LiveQueries
} from "/src/lib/vibe64LiveQueryRecovery.js";

function attachVibe64RealtimeQueryRecovery({ queryClient, realtime } = {}) {
  const socket = realtime?.socket;
  if (!socket || typeof socket.on !== "function") {
    throw new TypeError("Vibe64 realtime query recovery requires a realtime socket.");
  }

  const recoverQueries = () => invalidateVibe64LiveQueries(queryClient);
  socket.on("connect", recoverQueries);
  return () => socket.off?.("connect", recoverQueries);
}

export {
  attachVibe64RealtimeQueryRecovery,
  invalidateVibe64LiveQueries
};
