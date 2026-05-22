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
</style>
