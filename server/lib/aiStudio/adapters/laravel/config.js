import {
  configOptionValues,
  configTextValue,
  defaultConfigFromFields,
  selectedConfigValue
} from "../../configValues.js";
import { deepFreeze } from "../../deepFreeze.js";
import {
  DEFAULT_NODE_PACKAGE_MANAGER,
  NODE_PACKAGE_MANAGER_OPTIONS,
  nodePackageManagerValueSet
} from "../../nodePackageManagers.js";
import {
  LARAVEL_AUTHENTICATION_CONFIG,
  LARAVEL_BOOST_CONFIG,
  LARAVEL_CUSTOM_STARTER_CONFIG,
  LARAVEL_DATABASE_RUNTIME_CONFIG,
  LARAVEL_LIVEWIRE_COMPONENTS_CONFIG,
  LARAVEL_PACKAGE_MANAGER_CONFIG,
  LARAVEL_STARTER_KIT_CONFIG,
  LARAVEL_TEAMS_CONFIG,
  LARAVEL_TESTING_CONFIG
} from "./constants.js";

const LARAVEL_PACKAGE_MANAGER_OPTIONS = NODE_PACKAGE_MANAGER_OPTIONS;
const LARAVEL_STARTER_KIT_OPTIONS = deepFreeze([
  {
    label: "None",
    value: "none"
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
    label: "Livewire",
    value: "livewire"
  },
  {
    label: "Custom package",
    value: "custom"
  }
]);
const LARAVEL_AUTHENTICATION_OPTIONS = deepFreeze([
  {
    label: "Laravel built-in",
    value: "laravel"
  },
  {
    label: "WorkOS AuthKit",
    value: "workos"
  },
  {
    label: "None",
    value: "none"
  }
]);
const LARAVEL_TEAMS_OPTIONS = deepFreeze([
  {
    label: "No teams",
    value: "none"
  },
  {
    label: "Teams",
    value: "teams"
  }
]);
const LARAVEL_LIVEWIRE_COMPONENT_OPTIONS = deepFreeze([
  {
    label: "Single-file",
    value: "single_file"
  },
  {
    label: "Class components",
    value: "class"
  }
]);
const LARAVEL_TESTING_FRAMEWORK_OPTIONS = deepFreeze([
  {
    label: "Pest",
    value: "pest"
  },
  {
    label: "PHPUnit",
    value: "phpunit"
  }
]);
const LARAVEL_BOOST_OPTIONS = deepFreeze([
  {
    label: "None",
    value: "none"
  },
  {
    label: "Install Boost",
    value: "boost"
  }
]);
const LARAVEL_PACKAGE_MANAGERS = nodePackageManagerValueSet();
const LARAVEL_AUTHENTICATION_VALUES = configOptionValues(LARAVEL_AUTHENTICATION_OPTIONS);
const LARAVEL_STARTER_KITS = configOptionValues(LARAVEL_STARTER_KIT_OPTIONS);
const LARAVEL_LIVEWIRE_COMPONENT_VALUES = configOptionValues(LARAVEL_LIVEWIRE_COMPONENT_OPTIONS);
const LARAVEL_TEAMS_VALUES = configOptionValues(LARAVEL_TEAMS_OPTIONS);
const LARAVEL_TESTING_FRAMEWORKS = configOptionValues(LARAVEL_TESTING_FRAMEWORK_OPTIONS);
const LARAVEL_BOOST_VALUES = configOptionValues(LARAVEL_BOOST_OPTIONS);

const LARAVEL_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: DEFAULT_NODE_PACKAGE_MANAGER,
    description: "Node package manager used when Studio seeds Laravel frontend assets.",
    id: LARAVEL_PACKAGE_MANAGER_CONFIG,
    label: "Frontend package manager",
    options: LARAVEL_PACKAGE_MANAGER_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "sqlite",
    description: "Database runtime used by seeded Laravel .env values and setup checks.",
    id: LARAVEL_DATABASE_RUNTIME_CONFIG,
    label: "Database runtime",
    options: [
      {
        label: "SQLite",
        value: "sqlite"
      },
      {
        label: "PostgreSQL",
        value: "postgres"
      },
      {
        label: "MySQL",
        value: "mysql"
      },
      {
        label: "MariaDB",
        value: "mariadb"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "none",
    description: "Starter kit passed to the Laravel installer when Studio seeds a new app.",
    id: LARAVEL_STARTER_KIT_CONFIG,
    label: "Starter kit",
    options: LARAVEL_STARTER_KIT_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "",
    description: "Packagist package or repository passed to laravel new --using when the custom starter kit is selected.",
    id: LARAVEL_CUSTOM_STARTER_CONFIG,
    label: "Custom starter",
    type: "string"
  },
  {
    defaultValue: "laravel",
    description: "Authentication scaffolding selected when Studio seeds an official Laravel starter kit.",
    id: LARAVEL_AUTHENTICATION_CONFIG,
    label: "Authentication",
    options: LARAVEL_AUTHENTICATION_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "none",
    description: "Whether Studio asks the Laravel installer to add team support to official starter kits.",
    id: LARAVEL_TEAMS_CONFIG,
    label: "Teams",
    options: LARAVEL_TEAMS_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "single_file",
    description: "Livewire component style used when Studio seeds the official Livewire starter kit.",
    id: LARAVEL_LIVEWIRE_COMPONENTS_CONFIG,
    label: "Livewire components",
    options: LARAVEL_LIVEWIRE_COMPONENT_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "pest",
    description: "Testing framework selected when Studio seeds a Laravel app.",
    id: LARAVEL_TESTING_CONFIG,
    label: "Testing",
    options: LARAVEL_TESTING_FRAMEWORK_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "none",
    description: "Whether Studio asks the Laravel installer to add Laravel Boost during seeding.",
    id: LARAVEL_BOOST_CONFIG,
    label: "Laravel Boost",
    options: LARAVEL_BOOST_OPTIONS,
    type: "select"
  }
]);

const LARAVEL_DEFAULT_CONFIG = deepFreeze(defaultConfigFromFields(LARAVEL_CONFIG_FIELDS));

function selectedLaravelPackageManager(config = {}) {
  return selectedConfigValue(config, LARAVEL_PACKAGE_MANAGER_CONFIG, LARAVEL_PACKAGE_MANAGERS, DEFAULT_NODE_PACKAGE_MANAGER);
}

function selectedLaravelAuthentication(config = {}) {
  return selectedConfigValue(config, LARAVEL_AUTHENTICATION_CONFIG, LARAVEL_AUTHENTICATION_VALUES, "laravel");
}

function selectedLaravelStarterKit(config = {}) {
  return selectedConfigValue(config, LARAVEL_STARTER_KIT_CONFIG, LARAVEL_STARTER_KITS, "none");
}

function selectedLaravelLivewireComponents(config = {}) {
  return selectedConfigValue(config, LARAVEL_LIVEWIRE_COMPONENTS_CONFIG, LARAVEL_LIVEWIRE_COMPONENT_VALUES, "single_file");
}

function selectedLaravelTeams(config = {}) {
  return selectedConfigValue(config, LARAVEL_TEAMS_CONFIG, LARAVEL_TEAMS_VALUES, "none");
}

function selectedLaravelTestingFramework(config = {}) {
  return selectedConfigValue(config, LARAVEL_TESTING_CONFIG, LARAVEL_TESTING_FRAMEWORKS, "pest");
}

function selectedLaravelBoostOption(config = {}) {
  return selectedConfigValue(config, LARAVEL_BOOST_CONFIG, LARAVEL_BOOST_VALUES, "none");
}

function selectedLaravelCustomStarter(config = {}) {
  return configTextValue(config, LARAVEL_CUSTOM_STARTER_CONFIG);
}

export {
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_DEFAULT_CONFIG,
  selectedLaravelAuthentication,
  selectedLaravelBoostOption,
  selectedLaravelCustomStarter,
  selectedLaravelLivewireComponents,
  selectedLaravelPackageManager,
  selectedLaravelStarterKit,
  selectedLaravelTeams,
  selectedLaravelTestingFramework
};
