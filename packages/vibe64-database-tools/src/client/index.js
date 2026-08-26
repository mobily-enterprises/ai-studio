export {
  useVibe64DatabaseTools
} from "./composables/useVibe64DatabaseTools.js";

async function loadVibe64DatabaseWorkspace() {
  const module = await import("./components/Vibe64DatabaseWorkspace.vue");
  return module.default;
}

export {
  loadVibe64DatabaseWorkspace
};
