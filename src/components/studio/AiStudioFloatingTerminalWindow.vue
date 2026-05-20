<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ai-floating-terminal-window"
      :class="{
        'ai-floating-terminal-window--minimized': minimized
      }"
    >
      <div
        ref="floatingWindow"
        class="ai-floating-terminal-window__panel"
        :style="floatingWindowStyle"
      >
        <slot :start-drag="startDrag" />
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({
  minimized: {
    type: Boolean,
    default: false
  },
  visible: {
    type: Boolean,
    default: false
  }
});

const floatingWindow = ref(null);
const floatingWindowPosition = ref({
  left: 12,
  top: 12
});
let activeDrag = null;
let resizeObserver = null;
let trackingViewport = false;

const floatingWindowStyle = computed(() => {
  if (props.minimized) {
    return {};
  }

  return {
    left: `${Math.round(floatingWindowPosition.value.left)}px`,
    top: `${Math.round(floatingWindowPosition.value.top)}px`
  };
});

function viewportSize() {
  if (typeof window === "undefined") {
    return {
      height: 768,
      width: 1024
    };
  }

  return {
    height: window.innerHeight,
    width: window.innerWidth
  };
}

function floatingWindowSize() {
  const viewport = viewportSize();
  const element = floatingWindow.value;
  return {
    height: element?.offsetHeight || Math.min(viewport.height - 24, 704),
    width: element?.offsetWidth || Math.min(viewport.width - 24, 1152)
  };
}

function clampFloatingWindowPosition(position = {}) {
  const margin = 12;
  const viewport = viewportSize();
  const size = floatingWindowSize();
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);

  return {
    left: Math.min(Math.max(margin, Number(position.left || 0)), maxLeft),
    top: Math.min(Math.max(margin, Number(position.top || 0)), maxTop)
  };
}

function placeFloatingWindow() {
  if (!props.visible || props.minimized) {
    return;
  }

  const viewport = viewportSize();
  const size = floatingWindowSize();
  floatingWindowPosition.value = clampFloatingWindowPosition({
    left: (viewport.width - size.width) / 2,
    top: (viewport.height - size.height) / 2
  });
}

function startDrag(event) {
  if (props.minimized || event.button !== 0) {
    return;
  }

  event.preventDefault();
  activeDrag = {
    pointerId: event.pointerId,
    startLeft: floatingWindowPosition.value.left,
    startTop: floatingWindowPosition.value.top,
    startX: event.clientX,
    startY: event.clientY
  };
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);
}

function moveDrag(event) {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
    return;
  }

  floatingWindowPosition.value = clampFloatingWindowPosition({
    left: activeDrag.startLeft + event.clientX - activeDrag.startX,
    top: activeDrag.startTop + event.clientY - activeDrag.startY
  });
}

function stopDrag() {
  activeDrag = null;
  if (typeof window === "undefined") {
    return;
  }
  window.removeEventListener("pointermove", moveDrag);
  window.removeEventListener("pointerup", stopDrag);
  window.removeEventListener("pointercancel", stopDrag);
}

function clampCurrentPosition() {
  if (props.visible && !props.minimized) {
    floatingWindowPosition.value = clampFloatingWindowPosition(floatingWindowPosition.value);
  }
}

function startViewportTracking() {
  if (typeof window === "undefined" || trackingViewport) {
    return;
  }

  trackingViewport = true;
  window.addEventListener("resize", clampCurrentPosition);
}

function stopViewportTracking() {
  if (typeof window === "undefined" || !trackingViewport) {
    return;
  }

  trackingViewport = false;
  window.removeEventListener("resize", clampCurrentPosition);
}

function observePanelSize() {
  resizeObserver?.disconnect?.();
  resizeObserver = null;
  if (typeof ResizeObserver === "undefined" || !floatingWindow.value || props.minimized) {
    return;
  }

  resizeObserver = new ResizeObserver(clampCurrentPosition);
  resizeObserver.observe(floatingWindow.value);
}

watch(
  () => [props.visible, props.minimized],
  async ([visible, minimized]) => {
    stopDrag();
    if (!visible) {
      resizeObserver?.disconnect?.();
      resizeObserver = null;
      stopViewportTracking();
      return;
    }

    startViewportTracking();
    await nextTick();
    if (!minimized) {
      placeFloatingWindow();
    }
    observePanelSize();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  stopDrag();
  resizeObserver?.disconnect?.();
  resizeObserver = null;
  stopViewportTracking();
});
</script>

<style scoped>
.ai-floating-terminal-window {
  inset: 0;
  pointer-events: none;
  position: fixed;
  z-index: 2400;
}

.ai-floating-terminal-window__panel {
  height: min(72vh, 44rem);
  max-height: calc(100vh - 1.5rem);
  max-width: calc(100vw - 1.5rem);
  min-height: 18rem;
  min-width: min(28rem, calc(100vw - 1.5rem));
  overflow: hidden;
  pointer-events: auto;
  position: fixed;
  resize: both;
  width: min(92vw, 72rem);
}

.ai-floating-terminal-window__panel :deep(.ai-command-terminal) {
  box-shadow: 0 1rem 3rem rgba(13, 24, 42, 0.24);
  height: 100%;
}

.ai-floating-terminal-window--minimized {
  padding: 0;
}

.ai-floating-terminal-window--minimized .ai-floating-terminal-window__panel {
  bottom: 0.75rem;
  height: auto;
  max-width: calc(100vw - 1.5rem);
  min-height: 0;
  min-width: 0;
  position: fixed;
  right: 0.75rem;
  resize: none;
  width: min(44rem, calc(100vw - 1.5rem));
}

.ai-floating-terminal-window--minimized .ai-floating-terminal-window__panel :deep(.ai-command-terminal) {
  height: auto;
}

@media (max-width: 700px) {
  .ai-floating-terminal-window__panel {
    height: min(78vh, 42rem);
    width: calc(100vw - 1.5rem);
  }

  .ai-floating-terminal-window--minimized {
    padding: 0;
  }

  .ai-floating-terminal-window--minimized .ai-floating-terminal-window__panel {
    bottom: 0.75rem;
    left: 0.75rem;
    max-width: 100%;
    right: 0.75rem;
    width: auto;
  }
}
</style>
