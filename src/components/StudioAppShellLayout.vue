<template>
  <v-app-bar
    border
    class="shell-layout__app-bar bg-surface"
    density="comfortable"
    elevation="0"
    data-testid="jskit-shell-app-bar"
  >
    <slot name="top-left" />
    <v-spacer />
    <div class="studio-app-shell-layout__top-right">
      <ShellOutlet target="shell-layout:top-right" />
      <slot name="top-right" />
    </div>
  </v-app-bar>

  <v-main class="bg-background">
    <v-container
      fluid
      class="shell-layout__content studio-app-shell-layout__content"
    >
      <slot />
    </v-container>
  </v-main>
</template>

<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
</script>

<style scoped>
:global(body.studio-home-shell-active) {
  overflow: hidden;
}

:global(body.studio-home-shell-active .v-application),
:global(body.studio-home-shell-active .v-application__wrap) {
  height: 100dvh;
  min-height: 100dvh;
  overflow: hidden;
}

:global(body.studio-home-shell-active .v-main) {
  min-height: 0;
  overflow: hidden;
}

:global(body.studio-home-shell-active .shell-layout__content) {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px));
  min-height: 0;
  overflow: hidden;
  padding-bottom: 0;
  padding-left: 0;
  padding-right: 0;
  padding-top: 0.35rem;
}

:global(body.studio-home-shell-active .shell-error-host__banners) {
  left: auto;
  right: 0;
  width: min(30rem, 100vw);
}

:global(body.studio-home-shell-active .shell-error-host__banner-stack) {
  width: 100%;
}

.studio-app-shell-layout__content {
  padding: 0.75rem 0.75rem 0;
}

.studio-app-shell-layout__top-right {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.25rem;
  min-width: 0;
}
</style>
