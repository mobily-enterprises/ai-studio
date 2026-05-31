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
body.studio-shell-drawer-hidden [aria-label="Toggle navigation menu"] {
  display: none !important;
}

body.studio-shell-drawer-hidden .shell-layout__content {
  padding-inline: 0.75rem;
}
</style>
