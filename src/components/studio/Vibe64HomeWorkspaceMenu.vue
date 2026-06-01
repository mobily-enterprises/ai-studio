<template>
  <v-menu
    v-model="menuOpen"
    location="bottom end"
    transition="scale-transition"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        :append-icon="mdiChevronDown"
        :prepend-icon="mdiMenu"
        size="small"
        type="button"
        variant="tonal"
      >
        Menu
      </v-btn>
    </template>

    <v-list
      class="vibe64-home-workspace-menu"
      density="comfortable"
      nav
    >
      <v-list-item
        v-for="item in menuItems"
        :key="item.id"
        :active="itemActive(item)"
        :prepend-icon="item.icon"
        :subtitle="item.description"
        :title="item.label"
        @click="selectItem(item)"
      />
    </v-list>
  </v-menu>
</template>

<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiChevronDown,
  mdiCogOutline,
  mdiHistory,
  mdiMenu,
  mdiMonitorDashboard,
  mdiPlayBoxMultipleOutline,
  mdiTune
} from "@mdi/js";

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

const isHomeRoute = computed(() => route.path === "/home" || route.path === "/home/");
const isAutopilotHome = computed(() => Boolean(
  isHomeRoute.value &&
  route.query.configure !== "project"
));
const activePane = computed(() => normalizePane(route.query.pane));
const menuItems = computed(() => {
  if (isAutopilotHome.value) {
    return [
      {
        description: "Show the running app.",
        icon: mdiMonitorDashboard,
        id: "preview",
        label: "Preview"
      },
      ...sharedItems()
    ];
  }
  return [
    {
      description: "Return to the active session workspace.",
      icon: mdiMonitorDashboard,
      id: "workspace",
      label: "Workspace"
    },
    ...sharedItems()
  ];
});

function sharedItems() {
  return [
    {
      description: "Check local tools and project readiness.",
      icon: mdiTune,
      id: "setup",
      label: "Setup"
    },
    {
      description: "Edit Vibe64 project settings.",
      icon: mdiCogOutline,
      id: "configure",
      label: "Configure"
    },
    {
      description: "Run target project scripts.",
      icon: mdiPlayBoxMultipleOutline,
      id: "run",
      label: "Run"
    },
    {
      description: "Review completed and abandoned sessions.",
      icon: mdiHistory,
      id: "history",
      label: "Session History"
    }
  ];
}

function normalizePane(value = "") {
  return ["configure", "history", "preview", "run", "setup"].includes(value)
    ? value
    : "preview";
}

function autopilotQueryForPane(pane = "preview") {
  const query = { ...route.query };
  delete query.configure;
  delete query.mode;
  if (pane === "preview") {
    delete query.pane;
  } else {
    query.pane = pane;
  }
  return query;
}

function itemRoute(item = {}) {
  if (item.id !== "workspace") {
    if (item.id === "setup") {
      return { path: "/setup", query: {} };
    }
    if (item.id === "history") {
      return { path: "/home/history", query: {} };
    }
    return {
      path: "/home",
      query: autopilotQueryForPane(item.id)
    };
  }
  return {
    path: "/home",
    query: autopilotQueryForPane("preview")
  };
}

function itemActive(item = {}) {
  if (isAutopilotHome.value) {
    return activePane.value === item.id;
  }
  if (item.id === "workspace") {
    return isHomeRoute.value && route.query.configure !== "project";
  }
  if (item.id === "configure") {
    return isHomeRoute.value && activePane.value === "configure";
  }
  if (item.id === "history") {
    return route.path === "/home/history";
  }
  if (item.id === "run") {
    return isHomeRoute.value && activePane.value === "run";
  }
  if (item.id === "setup") {
    return route.path === "/setup";
  }
  return false;
}

function selectItem(item = {}) {
  menuOpen.value = false;
  void router.push(itemRoute(item));
}
</script>

<style scoped>
.vibe64-home-workspace-menu {
  max-width: min(24rem, calc(100vw - 2rem));
  min-width: min(18rem, calc(100vw - 2rem));
}
</style>
