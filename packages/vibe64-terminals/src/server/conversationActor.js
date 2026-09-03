import {
  currentActorUser
} from "@local/vibe64-execution/server";

function cleanText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

async function conversationActorMetadata({
  actorUser = currentActorUser,
  personalProfileStore = null,
  vibe64User = null
} = {}) {
  const authenticated = vibe64User && typeof vibe64User === "object" && !Array.isArray(vibe64User)
    ? vibe64User
    : null;
  const localProfile = !authenticated && typeof personalProfileStore?.read === "function"
    ? await personalProfileStore.read()
    : {};
  const source = authenticated || actorUser();
  const preferredName = cleanText(
    authenticated ? source.preferredName : localProfile.preferredName
  );
  return {
    actorDisplayName: preferredName || cleanText(
      source.displayName || source.name || source.username || source.email
    ),
    actorId: cleanText(source.username || source.id || source.email)
  };
}

export { conversationActorMetadata };
