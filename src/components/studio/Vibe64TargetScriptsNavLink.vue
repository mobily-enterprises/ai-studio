<script setup>
import SurfaceAwareMenuLinkItem from "@/components/menus/SurfaceAwareMenuLinkItem.vue";
</script>

<template>
  <SurfaceAwareMenuLinkItem
    label="Target Scripts"
    icon="mdi-view-list-outline"
    surface="home"
    scoped-suffix="/target-scripts"
    unscoped-suffix="/target-scripts"
    exact
  />
</template>
