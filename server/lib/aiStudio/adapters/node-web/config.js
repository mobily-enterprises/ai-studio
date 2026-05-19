import {
  configOptionValues,
  defaultConfigFromFields,
  selectedConfigValue
} from "../../configValues.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG
} from "./constants.js";

const GENERIC_NODE_WEB_CLIENT_LIBRARY_OPTIONS = deepFreeze([
  {
    label: "Auto-detect",
    value: "auto"
  },
  {
    label: "React",
    value: "react"
  },
  {
    label: "Vue",
    value: "vue"
  },
  {
    label: "Svelte",
    value: "svelte"
  },
  {
    label: "Lit",
    value: "lit"
  },
  {
    label: "Preact",
    value: "preact"
  },
  {
    label: "Solid",
    value: "solid"
  },
  {
    label: "Angular",
    value: "angular"
  },
  {
    label: "None or unknown",
    value: "none"
  }
]);

const GENERIC_NODE_WEB_CLIENT_LIBRARY_VALUES = configOptionValues(GENERIC_NODE_WEB_CLIENT_LIBRARY_OPTIONS);

const GENERIC_NODE_WEB_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "auto",
    description: "Client-side UI library used in generic prompts. Auto-detect uses package metadata and common project files.",
    id: GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG,
    label: "Client library",
    options: GENERIC_NODE_WEB_CLIENT_LIBRARY_OPTIONS,
    type: "select"
  }
]);

const GENERIC_NODE_WEB_DEFAULT_CONFIG = deepFreeze(defaultConfigFromFields(GENERIC_NODE_WEB_CONFIG_FIELDS));

function selectedGenericNodeWebClientLibrary(config = {}) {
  return selectedConfigValue(
    config,
    GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG,
    GENERIC_NODE_WEB_CLIENT_LIBRARY_VALUES,
    "auto"
  );
}

export {
  GENERIC_NODE_WEB_CONFIG_FIELDS,
  GENERIC_NODE_WEB_DEFAULT_CONFIG,
  selectedGenericNodeWebClientLibrary
};
