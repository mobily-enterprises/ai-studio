import { onBeforeUnmount, watchEffect } from "vue";

const DRAWER_HIDDEN_CLASS = "studio-shell-drawer-hidden";

function setDrawerHidden(hidden) {
  if (typeof document === "undefined") {
    return;
  }
  document.body.classList.toggle(DRAWER_HIDDEN_CLASS, Boolean(hidden));
}

export function useStudioShellDrawer({ hidden }) {
  watchEffect(() => {
    setDrawerHidden(typeof hidden === "function" ? hidden() : hidden);
  });

  onBeforeUnmount(() => {
    setDrawerHidden(false);
  });
}
