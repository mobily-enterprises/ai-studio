<template>
  <Vibe64Terminal
    :close-label="closeLabel"
    :collapsible="false"
    :command-preview="commandPreview"
    :error="error"
    :error-title="errorTitle"
    :expanded="true"
    :fill="fill"
    :height="height"
    mobile-takeover
    :presentation="presentation"
    :show-close="showClose"
    :show-copy="showCopy"
    :show-interrupt="showInterrupt"
    :stage="stage"
    :status="status"
    :subtitle="subtitle"
    :terminal="terminal"
    :title="title"
    :visible="visible"
    @close="$emit('close')"
    @copy="$emit('copy', $event)"
    @interrupt="$emit('interrupt')"
    @retry="$emit('retry')"
  >
    <template v-for="slotName in forwardedSlots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </Vibe64Terminal>
</template>

<script setup>
import { unref, watch } from "vue";
import Vibe64Terminal from "@/components/studio/Vibe64Terminal.vue";

const props = defineProps({
  closeLabel: {
    default: "Close terminal",
    type: String
  },
  closeOnCleanExit: {
    default: true,
    type: Boolean
  },
  commandPreview: {
    default: "",
    type: String
  },
  error: {
    default: "",
    type: String
  },
  errorTitle: {
    default: "Terminal needs attention",
    type: String
  },
  fill: {
    default: true,
    type: Boolean
  },
  height: {
    default: "100%",
    type: String
  },
  presentation: {
    default: "inline",
    type: String
  },
  showClose: {
    default: true,
    type: Boolean
  },
  showCopy: {
    default: true,
    type: Boolean
  },
  showInterrupt: {
    default: true,
    type: Boolean
  },
  stage: {
    default: "",
    type: String
  },
  status: {
    default: "",
    type: String
  },
  subtitle: {
    default: "",
    type: String
  },
  terminal: {
    required: true,
    type: Object
  },
  title: {
    default: "Interactive terminal",
    type: String
  },
  visible: {
    default: false,
    type: Boolean
  }
});

const emit = defineEmits([
  "clean-exit",
  "close",
  "copy",
  "interrupt",
  "retry"
]);

const forwardedSlots = [
  "actions-after",
  "actions-before",
  "before-terminal",
  "error-actions",
  "footer",
  "heading",
  "overlay"
];

function terminalValue(name, fallback = null) {
  const value = unref(props.terminal?.[name]);
  return typeof value === "undefined" ? fallback : value;
}

watch(
  () => [
    String(terminalValue("terminalSessionId", "")),
    String(terminalValue("terminalStatus", props.status) || ""),
    terminalValue("terminalExitCode", null)
  ],
  ([terminalSessionId, status, exitCode], previous = []) => {
    const previousStatus = String(previous[1] || "");
    if (
      props.closeOnCleanExit &&
      terminalSessionId &&
      status === "exited" &&
      ["closing", "running"].includes(previousStatus) &&
      (exitCode === null || Number(exitCode) === 0)
    ) {
      emit("clean-exit", { terminalSessionId });
    }
  }
);
</script>
