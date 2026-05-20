function browserLocalStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function readLocalStorageJson(storageKey = "", fallback = null) {
  const key = String(storageKey || "");
  if (!key) {
    return fallback;
  }
  try {
    const value = browserLocalStorage()?.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson(storageKey = "", value = null) {
  const key = String(storageKey || "");
  const storage = browserLocalStorage();
  if (!key || !storage) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser storage can be unavailable in private or constrained contexts.
  }
}

function stableLocalStorageKeyPart(value = "") {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export {
  browserLocalStorage,
  readLocalStorageJson,
  stableLocalStorageKeyPart,
  writeLocalStorageJson
};
