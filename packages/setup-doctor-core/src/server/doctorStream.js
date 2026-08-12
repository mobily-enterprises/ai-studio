import { sendVibe64EventStream } from "@local/vibe64-core/server/eventStream";

async function runDoctorStep({
  emit,
  id,
  label,
  run
}) {
  emit("check.started", {
    id,
    label
  });

  try {
    const result = await run();
    emit("check.finished", {
      check: result,
      id: result?.id || id,
      label: result?.label || label,
      status: result?.status || "unknown"
    });
    return result;
  } catch (error) {
    emit("check.error", {
      error: String(error?.message || error || "Check failed."),
      id,
      label
    });
    throw error;
  }
}

async function sendDoctorEventStream(reply, run) {
  await sendVibe64EventStream(reply, async ({ emit }) => {
    const emitDoctorEvent = (event, payload = {}) => {
      emit(event, {
        ...payload,
        at: payload.at || new Date().toISOString()
      });
    };

    emitDoctorEvent("run.started");
    const status = await run({
      emit: emitDoctorEvent,
      runStep: (step) => runDoctorStep({
        emit: emitDoctorEvent,
        ...step
      })
    });
    emitDoctorEvent("run.finished", {
      status
    });
  }, {
    errorEvent: "run.error",
    errorPayload: (error) => ({
      at: new Date().toISOString(),
      error: String(error?.message || error || "Doctor stream failed.")
    }),
    retryMs: 600000
  });
}

export {
  runDoctorStep,
  sendDoctorEventStream
};
