<template>
  <slot v-if="props.archived || state === 'ready' || onboarding?.available === false" />
  <section v-else class="project-onboarding" aria-label="Project setup" :aria-busy="pending">
    <template v-if="loadError">
      <h2>Project setup could not be read</h2>
      <p role="alert">{{ loadError }}</p>
      <v-btn variant="tonal" @click="resource.reload()">Try again</v-btn>
    </template>
    <v-skeleton-loader v-else-if="!onboarding" type="heading, paragraph, card" />
    <template v-else-if="state === 'new'">
      <p class="project-onboarding__eyebrow">Your starting point</p>
      <h2>What would you like to build with?</h2>
      <p>Choose a ready-made app, or describe your idea in the conversation.</p>
      <div v-for="group in groups" :key="group.technology" class="project-onboarding__group">
        <h3>{{ technologyLabel(group.technology) }}</h3>
        <div class="project-onboarding__choices">
          <button
            v-for="template in group.templates"
            :key="template.id"
            type="button"
            class="project-onboarding__choice"
            :disabled="disabled"
            @click="apply(template)"
          >
            <strong>{{ template.name }}</strong>
            <span>{{ template.description }}</span>
            <small v-if="groupsHaveMultipleSources">Source: {{ template.namespace }}</small>
            <span class="project-onboarding__choose">{{ applying === template.id ? 'Preparing your starter…' : 'Use this starter →' }}</span>
          </button>
        </div>
      </div>
      <p v-if="!groups.length">No starters are configured for this installation yet.</p>
      <v-btn :disabled="disabled || !props.canAsk" variant="text" @click="ask('create')">Start through conversation</v-btn>
    </template>
    <template v-else-if="state === 'adoption'">
      <p class="project-onboarding__eyebrow">Bring your project</p>
      <h2>Set up this existing project</h2>
      <p>Tell the AI what this project does and what you want to run. It will work out the setup from your code and preserve your source and Git history.</p>
      <v-textarea
        v-model="purpose"
        label="What is this project?"
        placeholder="For example: a Python tool that processes invoices. I want to run its command line."
        rows="3"
        auto-grow
        :disabled="disabled"
      />
      <div class="project-onboarding__actions">
        <v-btn :disabled="disabled || !props.canAsk || !purpose.trim()" color="primary" @click="ask('adopt')">Set up project</v-btn>
        <v-btn :disabled="disabled || !props.canAsk" variant="text" @click="ask('inspect')">Inspect it for me</v-btn>
      </div>
    </template>
    <template v-else>
      <h2>Project setup needs attention</h2>
      <p v-for="(diagnostic, index) in onboarding.inspection.diagnostics" :key="index">{{ diagnostic.message }}</p>
      <p v-if="onboarding.inspection.nextAction === 'update-genesis'">Use an installation with a newer Genesis version to continue.</p>
      <v-btn v-else :disabled="disabled || !props.canAsk" color="primary" @click="ask('repair')">Ask AI to update setup</v-btn>
    </template>
    <p v-if="pending" role="status">{{ applying ? 'Adding the starter to this session…' : 'Sending to the conversation…' }}</p>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { vibe64ResourceResponseError } from "@/lib/vibe64ApiResponses.js";

const props = defineProps({
  active: Boolean,
  archived: Boolean,
  busy: Boolean,
  canAsk: Boolean,
  sendMessage: { type: Function, required: true },
  sessionId: { type: String, required: true }
});
const projectSlug = useVibe64ProjectSlug();
const purpose = ref("");
const applying = ref("");
const asking = ref(false);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const enabled = computed(() => props.active && !props.archived && Boolean(props.sessionId));
const resource = useEndpointResource({
  enabled,
  path: computed(() => resolveStudioRequestUrl("/api/vibe64/onboarding")),
  readQuery: computed(() => ({ sessionId: props.sessionId })),
  queryKey: computed(() => ["vibe64", "project-onboarding", projectSlug.value, props.sessionId]),
  queryOptions: { refetchOnMount: "always", refetchOnWindowFocus: true },
  realtime: {
    events: ["vibe64.project.changed"],
    matches: ({ payload = {} } = {}) => !payload.projectSlug || payload.projectSlug === projectSlug.value
  },
  refreshOnPull: true,
  fallbackLoadError: "Project setup could not be read."
});
const command = useCommand({
  access: "never",
  apiSuffix: "vibe64",
  buildCommandOptions: () => ({ method: "POST", path: resolveStudioRequestUrl("/api/vibe64/templates/apply") }),
  buildRawPayload: (_model, { context }) => ({ sessionId: context.sessionId, templateId: context.templateId }),
  fallbackRunError: "The starter could not be applied. Your existing work was preserved.",
  messages: { success: "Starter added to this session. Use Save to keep it in the project.", error: "The starter could not be applied." },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.project.templates.apply",
  surfaceId: "app",
  writeMethod: "POST"
});
const onboarding = computed(() => resource.data.value?.ok === true ? resource.data.value : null);
const state = computed(() => onboarding.value?.inspection?.state || "");
const loadError = computed(() => vibe64ResourceResponseError(resource.data.value) || resource.loadError.value);
const pending = computed(() => Boolean(applying.value || asking.value));
const disabled = computed(() => pending.value || props.busy || !enabled.value);
const groups = computed(() => {
  const grouped = new Map();
  for (const template of onboarding.value?.templates || []) {
    if (!grouped.has(template.technology)) grouped.set(template.technology, []);
    grouped.get(template.technology).push(template);
  }
  return [...grouped].map(([technology, templates]) => ({ technology, templates }));
});
const groupsHaveMultipleSources = computed(() => new Set((onboarding.value?.templates || []).map(({ namespace }) => namespace)).size > 1);

function technologyLabel(technology) {
  return technology === "jskit" ? "JSKIT" : technology;
}

async function apply(template) {
  if (disabled.value) return;
  const sessionId = props.sessionId;
  applying.value = template.id;
  try {
    try {
      await command.run({ sessionId, templateId: template.id });
    } catch {
      // The command already reports this failure through shared action feedback.
      return;
    }
    if (disposed || props.sessionId !== sessionId || !enabled.value) return;
    await resource.reload();
  } finally {
    applying.value = "";
  }
}

async function ask(kind) {
  if (disabled.value || !props.canAsk) return;
  const requests = {
    create: "Help me start this project through conversation. Ask what I want to build, use answers I have already given, and help me choose a suitable Stack. I have not selected a starter.",
    adopt: `Set up this existing project for guided editing. What this project is and what I want to run: ${purpose.value.trim()}. Inspect its current implementation and work backwards into Genesis Blueprint, Stack, and Program, including its actual setup and run outputs. Preserve its source and Git history.`,
    inspect: "Set up this existing project for guided editing. Inspect it for me to identify what it does and its run targets. Ask me only where the evidence is ambiguous. Work backwards into Genesis Blueprint, Stack, and Program while preserving the implementation and Git history.",
    repair: `Inspect and update this project's Genesis setup. The opening inspection reports: ${onboarding.value?.inspection?.diagnostics.map(({ message }) => message).join(" ")}. Use the appropriate migration or repair, preserve source and Git history, and explain the specific change.`
  };
  asking.value = true;
  try { await props.sendMessage({ message: requests[kind] }); }
  finally { asking.value = false; }
}

watch(() => props.sessionId, () => { purpose.value = ""; });
watch(() => props.busy, (busy, previous) => {
  if (previous && !busy && enabled.value) void resource.reload();
});
</script>

<style scoped>
.project-onboarding { width: min(100%, 52rem); margin: auto; padding: clamp(1rem, 3vw, 2.5rem); overflow-y: auto; }
.project-onboarding h2 { font-size: 1.6rem; line-height: 1.25; margin-bottom: 1rem; }
.project-onboarding p { margin-bottom: 1.25rem; line-height: 1.6; }
.project-onboarding__eyebrow { font-size: .8rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .65; }
.project-onboarding__group { margin-block: 1.5rem; }
.project-onboarding__group h3 { margin-bottom: .75rem; }
.project-onboarding__choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: 1rem; }
.project-onboarding__choice { display: flex; flex-direction: column; gap: .7rem; text-align: left; padding: 1.25rem; border: 1px solid rgba(var(--v-theme-on-surface), .16); border-radius: 1rem; background: rgb(var(--v-theme-surface)); color: inherit; }
.project-onboarding__choice:not(:disabled):hover { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), .05); }
.project-onboarding__choice:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }
.project-onboarding__choice:disabled { opacity: .55; }
.project-onboarding__choice span { font-size: .9rem; line-height: 1.5; }
.project-onboarding__choose { margin-top: auto; padding-top: .5rem; color: rgb(var(--v-theme-primary)); font-weight: 600; }
.project-onboarding__actions { display: flex; flex-wrap: wrap; gap: .75rem; }
</style>
