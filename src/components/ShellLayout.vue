<script>
import { h } from "vue";
import PackageShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";

export default {
  name: "ShellLayout",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h(PackageShellLayout, attrs, {
      ...slots,
      "top-left": slots["top-left"] || (() => null)
    });
  }
};
</script>

<style>
:root {
  --studio-shell-primary-drawer-width: 220px;
}

[data-testid="jskit-shell-drawer"] {
  width: var(--studio-shell-primary-drawer-width) !important;
}

[data-testid="jskit-shell-drawer"] ~ .v-main {
  --v-layout-left: var(--studio-shell-primary-drawer-width) !important;
}

body.studio-shell-drawer-hidden [data-testid="jskit-shell-drawer"] {
  display: none !important;
  width: 0 !important;
}

body.studio-shell-drawer-hidden [data-testid="jskit-shell-drawer"] ~ .v-main {
  --v-layout-left: 0px !important;
}

body.studio-shell-drawer-hidden [aria-label="Toggle navigation menu"] {
  display: none !important;
}
</style>
