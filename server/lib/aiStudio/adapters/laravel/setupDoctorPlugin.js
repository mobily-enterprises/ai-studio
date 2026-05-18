import {
  blockedDoctorCheck as blockedCheck,
  createDoctorRepair,
  failDoctorCheck as failCheck,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "../../../doctorCheckItems.js";
import {
  createDoctorPluginToolkit
} from "../../../doctorPluginToolkit.js";
import {
  shellQuote
} from "../../../shellCommands.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE
} from "../../../studioRuntimeIdentity.js";
import {
  adapterToolchainBuildRepair,
  adapterToolchainBuildScript,
  checkAdapterToolchainImage,
  missingAdapterToolchainCheck
} from "../../adapterToolchains.js";
import {
  writableHostUserDockerArgs
} from "../../dockerRuntime.js";
import {
  createRuntimeContainerDoctorEntries
} from "../../runtimeContainers.js";
import {
  checkExactEnvValues,
  envValuesFromLines
} from "../../adapterHelpers/setupEnvFiles.js";
import {
  checkNodePackageManagerToolchain
} from "../../nodePackageDoctor.js";
import {
  selectedNodePackageManager
} from "../../adapterHelpers/setupNodeWebChecks.js";
import {
  composerDependencyNames,
  hasComposerDependency
} from "./composerPackage.js";
import {
  selectedLaravelAuthentication as selectedAuthentication,
  selectedLaravelBoostOption as selectedBoostOption,
  selectedLaravelCustomStarter as selectedCustomStarter,
  selectedLaravelLivewireComponents as selectedLivewireComponents,
  selectedLaravelPackageManager as selectedPackageManager,
  selectedLaravelStarterKit as selectedStarterKit,
  selectedLaravelTeams as selectedTeams,
  selectedLaravelTestingFramework as selectedTestingFramework
} from "./config.js";
import {
  createLaravelRuntimeContainers,
  laravelDatabaseEnvLines,
  laravelDatabaseEnvWriteScript,
  laravelRuntimeDockerArgs,
  selectedLaravelDatabaseRuntime,
  startLaravelRuntimeRepair
} from "./databaseRuntime.js";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const LARAVEL_TOOLCHAIN_DOCKERFILE = "tooling/adapters/laravel/Dockerfile";
const LARAVEL_TOOLCHAIN_CONTEXT = "tooling/adapters/laravel";
const LARAVEL_MARKERS = Object.freeze([
  "artisan",
  "bootstrap/app.php",
  "composer.json",
  "public/index.php",
  "routes/web.php"
]);
const LARAVEL_WRITABLE_DOCKER_ENV = Object.freeze({
  COMPOSER_CACHE_DIR: "/tmp/composer-cache",
  npm_config_cache: "/tmp/npm-cache"
});

function officialLaravelStarterKit(config = {}) {
  return !["none", "custom"].includes(selectedStarterKit(config));
}

function laravelSeedConfigError(config = {}) {
  if (selectedStarterKit(config) === "custom" && !selectedCustomStarter(config)) {
    return "laravel_custom_starter must be set when the Laravel starter kit is custom.";
  }
  const [starterOptionProblem = ""] = starterOptionProblems(config);
  if (starterOptionProblem) {
    return starterOptionProblem;
  }
  return "";
}

function buildLaravelToolchainRepair() {
  return adapterToolchainBuildRepair({
    actionId: "build-laravel-toolchain",
    baseImage: STUDIO_BASE_TOOLCHAIN_IMAGE,
    context: LARAVEL_TOOLCHAIN_CONTEXT,
    dockerfile: LARAVEL_TOOLCHAIN_DOCKERFILE,
    image: LARAVEL_TOOLCHAIN_IMAGE,
    label: "Build Laravel toolchain"
  });
}

function buildLaravelToolchainScript() {
  return adapterToolchainBuildScript({
    baseImage: STUDIO_BASE_TOOLCHAIN_IMAGE,
    context: LARAVEL_TOOLCHAIN_CONTEXT,
    dockerfile: LARAVEL_TOOLCHAIN_DOCKERFILE,
    image: LARAVEL_TOOLCHAIN_IMAGE
  });
}

function laravelNewPackageManagerFlag(packageManager = "npm") {
  return {
    bun: "--bun",
    npm: "--npm",
    pnpm: "--pnpm",
    yarn: "--yarn"
  }[packageManager] || "--npm";
}

function laravelNewStarterFlags(config = {}) {
  const starter = selectedStarterKit(config);
  if (starter === "custom") {
    const customStarter = selectedCustomStarter(config);
    return customStarter ? ["--using", customStarter] : [];
  }
  if (starter === "none") {
    return [];
  }
  return [`--${starter}`];
}

function laravelNewStarterOptionFlags(config = {}) {
  if (!officialLaravelStarterKit(config)) {
    return [];
  }

  const authentication = selectedAuthentication(config);
  return [
    authentication === "workos" ? "--workos" : "",
    authentication === "none" ? "--no-authentication" : "",
    selectedTeams(config) === "teams" ? "--teams" : "",
    selectedStarterKit(config) === "livewire" && selectedLivewireComponents(config) === "class"
      ? "--livewire-class-components"
      : ""
  ].filter(Boolean);
}

function laravelNewFlags(config = {}) {
  const testing = selectedTestingFramework(config);
  return [
    "--no-interaction",
    "--no-ansi",
    "--database=sqlite",
    testing === "phpunit" ? "--phpunit" : "--pest",
    laravelNewPackageManagerFlag(selectedPackageManager(config)),
    selectedBoostOption(config) === "boost" ? "--boost" : "--no-boost",
    ...laravelNewStarterFlags(config),
    ...laravelNewStarterOptionFlags(config)
  ];
}

function laravelNewCommand({
  appDir = "$app_dir",
  config = {}
} = {}) {
  const seedConfigError = laravelSeedConfigError(config);
  if (seedConfigError) {
    return `printf '%s\\n' ${shellQuote(seedConfigError)} >&2; exit 2`;
  }
  const appDirArg = appDir === "$app_dir" ? "\"$app_dir\"" : shellQuote(appDir);
  const flags = laravelNewFlags(config).map(shellQuote).join(" ");
  return `laravel new ${appDirArg} ${flags}`;
}

function createLaravelAppScript(config = {}, {
  targetRoot = ""
} = {}) {
  return [
    "set -e",
    "set -x",
    "tmp_dir=\"$(mktemp -d)\"",
    "app_dir=\"$tmp_dir/app\"",
    "cleanup() { rm -rf \"$tmp_dir\"; }",
    "trap cleanup EXIT",
    laravelNewCommand({
      config
    }),
    "cp -a \"$app_dir/.\" .",
    laravelDatabaseEnvWriteScript({
      config,
      targetRoot
    })
  ].join("\n");
}

function createLaravelAppRepair(config = {}) {
  return createDoctorRepair({
    actionId: "terminal-create-laravel-app",
    autoRun: true,
    command: laravelNewCommand({
      appDir: "<temporary-directory>/app",
      config
    }),
    kind: "terminal",
    label: "Create Laravel app"
  });
}

async function readTargetComposerJson(toolkit, targetRoot) {
  const result = await toolkit.readTargetJson("composer.json", {
    targetRoot
  });
  return result.ok ? result.value : null;
}

async function existingLaravelMarkers(toolkit, targetRoot) {
  const markers = await Promise.all(LARAVEL_MARKERS.map(async (relativePath) => {
    return await toolkit.targetFileExists(relativePath, {
      targetRoot
    }) ? relativePath : "";
  }));
  return markers.filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function composerUsesLaravel(composerJson = {}) {
  return hasComposerDependency(composerJson, "laravel/framework") ||
    Object.values(composerJson?.scripts || {}).some((script) => /\bartisan\b/u.test(String(script || "")));
}

async function checkLaravelToolchainImage(toolkit) {
  return checkAdapterToolchainImage(toolkit, {
    buildRepair: buildLaravelToolchainRepair(),
    explanation: "Build the Laravel adapter toolchain before running PHP, Composer, Laravel setup, target scripts, or launch targets.",
    id: "laravel-toolchain-image",
    image: LARAVEL_TOOLCHAIN_IMAGE,
    label: "Laravel toolchain image"
  });
}

async function setupPackageManager(toolkit, targetRoot, config = {}) {
  return selectedNodePackageManager(toolkit, targetRoot, {
    fallback: selectedPackageManager(config)
  });
}

async function checkPackageManagerToolchain(toolkit, targetRoot, config = {}) {
  return checkNodePackageManagerToolchain(toolkit, {
    id: "laravel-package-manager-toolchain",
    image: LARAVEL_TOOLCHAIN_IMAGE,
    label: "Package manager command",
    packageManager: await setupPackageManager(toolkit, targetRoot, config),
    targetRoot
  });
}

function missingLaravelToolchainCheck({
  expected = "",
  id = "",
  label = ""
} = {}) {
  return missingAdapterToolchainCheck({
    buildRepair: buildLaravelToolchainRepair(),
    expected,
    id,
    label
  });
}

function checkCustomStarterConfig(config = {}) {
  if (selectedStarterKit(config) !== "custom") {
    return passCheck({
      id: "laravel-custom-starter",
      label: "Custom starter",
      expected: "A custom starter package is required only when the custom starter kit is selected.",
      observed: "Official Laravel starter kit or no starter kit selected.",
      explanation: "Laravel seeding can use the selected starter kit without extra package input."
    });
  }
  const customStarter = selectedCustomStarter(config);
  if (customStarter) {
    return passCheck({
      id: "laravel-custom-starter",
      label: "Custom starter",
      expected: "A Packagist package or repository is configured for laravel new --using.",
      observed: customStarter,
      explanation: "Laravel seeding can pass the custom starter package to the installer."
    });
  }
  return failCheck({
    id: "laravel-custom-starter",
    label: "Custom starter",
    expected: "laravel_custom_starter contains the package or repository for laravel new --using.",
    observed: "laravel_starter_kit is custom, but laravel_custom_starter is blank.",
    explanation: "Studio will not silently seed a plain Laravel app when the selected configuration asks for a custom starter."
  });
}

function starterOptionProblems(config = {}) {
  const starter = selectedStarterKit(config);
  const authentication = selectedAuthentication(config);
  const livewireComponents = selectedLivewireComponents(config);
  const teams = selectedTeams(config);
  const officialStarter = officialLaravelStarterKit(config);
  return [
    authentication !== "laravel" && !officialStarter
      ? "Authentication provider selection requires an official React, Vue, Svelte, or Livewire starter kit."
      : "",
    teams === "teams" && !officialStarter
      ? "Team support requires an official React, Vue, Svelte, or Livewire starter kit."
      : "",
    teams === "teams" && authentication === "none"
      ? "Team support requires authentication scaffolding."
      : "",
    livewireComponents === "class" && starter !== "livewire"
      ? "Livewire class components require the Livewire starter kit."
      : "",
    livewireComponents === "class" && authentication !== "laravel"
      ? "Livewire class components require Laravel built-in authentication."
      : ""
  ].filter(Boolean);
}

function checkStarterOptionsConfig(config = {}) {
  const problems = starterOptionProblems(config);
  if (problems.length) {
    return failCheck({
      id: "laravel-starter-options",
      label: "Starter options",
      expected: "Starter option config is compatible with the selected Laravel starter kit.",
      observed: problems.join("\n"),
      explanation: "Studio will not pass Laravel installer flags that the selected starter kit cannot apply cleanly."
    });
  }
  return passCheck({
    id: "laravel-starter-options",
    label: "Starter options",
    expected: "Starter option config is compatible with the selected Laravel starter kit.",
    observed: "Starter option config is compatible.",
    explanation: "Laravel seeding can pass the selected authentication, teams, and Livewire component options."
  });
}

async function checkComposerJson(toolkit, targetRoot, context = {}) {
  const result = await toolkit.readTargetJson("composer.json", {
    targetRoot
  });
  if (!result.ok) {
    const nonGitEntries = (context.nonGitEntries || []).filter((entry) => entry !== "vendor" && entry !== "node_modules");
    if (nonGitEntries.length) {
      return hardStopCheck({
        id: "laravel-composer-json",
        label: "composer.json",
        expected: "A composer.json exists or the target has no app-owned files.",
        observed: `composer.json is missing, but files exist:\n${nonGitEntries.join("\n")}`,
        explanation: "Studio will not run laravel new over existing app files because it cannot know their ownership."
      });
    }
    return blockedCheck({
      id: "laravel-composer-json",
      label: "composer.json",
      expected: "A readable composer.json exists in the target project.",
      observed: result.missing ? "composer.json is missing." : result.error,
      explanation: "Seed a Laravel app before installing dependencies or running workflow commands.",
      repair: createLaravelAppRepair(context.config)
    });
  }
  return passCheck({
    id: "laravel-composer-json",
    label: "composer.json",
    expected: "A readable composer.json exists in the target project.",
    observed: result.path,
    explanation: "The target has Composer metadata for Laravel setup."
  });
}

async function checkLaravelMarkers(toolkit, targetRoot) {
  const markers = await existingLaravelMarkers(toolkit, targetRoot);
  if (!markers.includes("artisan") || !markers.includes("bootstrap/app.php")) {
    return failCheck({
      id: "laravel-markers",
      label: "Laravel files",
      expected: "artisan, bootstrap/app.php, composer.json, public/index.php, and routes/web.php exist.",
      observed: markers.length ? markers.join(", ") : "No Laravel markers were found.",
      explanation: "Laravel projects expose the Artisan entrypoint and framework bootstrap files."
    });
  }
  return passCheck({
    id: "laravel-markers",
    label: "Laravel files",
    expected: "artisan, bootstrap/app.php, composer.json, public/index.php, and routes/web.php exist.",
    observed: markers.join(", "),
    explanation: "The target has the expected Laravel project shape."
  });
}

async function checkLaravelDependency(toolkit, targetRoot) {
  const composerJson = await readTargetComposerJson(toolkit, targetRoot);
  if (!composerJson) {
    return failCheck({
      id: "laravel-dependency",
      label: "Laravel dependency",
      expected: "composer.json declares laravel/framework or an Artisan script.",
      observed: "composer.json is missing.",
      explanation: "Seed or restore composer.json before Laravel dependency checks run."
    });
  }
  if (composerUsesLaravel(composerJson)) {
    return passCheck({
      id: "laravel-dependency",
      label: "Laravel dependency",
      expected: "composer.json declares laravel/framework or an Artisan script.",
      observed: "Laravel dependency or Artisan script is present.",
      explanation: "The target is configured for Laravel commands."
    });
  }
  return failCheck({
    id: "laravel-dependency",
    label: "Laravel dependency",
    expected: "composer.json declares laravel/framework or an Artisan script.",
    observed: `Dependencies: ${composerDependencyNames(composerJson).join(", ") || "none"}`,
    explanation: "This Composer package is not recognisable as a Laravel project."
  });
}

function seedDatabaseEnvRepair(targetRoot, config, toolkit) {
  return toolkit.shellTerminalAction({
    actionId: "terminal-seed-laravel-db-env",
    autoRun: true,
    commandPreview: "write Laravel database defaults",
    cwd: targetRoot,
    label: "Seed database .env",
    script: () => laravelDatabaseEnvWriteScript({
      config,
      targetRoot
    })
  }).repair({
    config,
    targetRoot
  });
}

async function checkDatabaseEnv(toolkit, targetRoot, config = {}) {
  const expectedLines = laravelDatabaseEnvLines({
    config,
    targetRoot
  });
  const seedRepair = seedDatabaseEnvRepair(targetRoot, config, toolkit);
  return checkExactEnvValues(toolkit, {
    expected: ".env declares Laravel DB_* values for the selected database runtime.",
    expectedValues: envValuesFromLines(expectedLines),
    explanation: "Laravel reads database settings from .env; Studio needs those values to match the selected managed runtime.",
    id: "laravel-database-env",
    label: "Database environment",
    passObserved: "Laravel database environment matches the selected runtime.",
    relativePath: ".env",
    repair: seedRepair,
    repairs: [
      seedRepair,
      startLaravelRuntimeRepair({
        config,
        targetRoot
      })
    ].filter(Boolean),
    targetRoot
  });
}

function runtimeContainerEntries(toolkit, context = {}, fallbackTargetRoot = "") {
  const targetRoot = context.targetRoot || fallbackTargetRoot;
  return createRuntimeContainerDoctorEntries(toolkit, createLaravelRuntimeContainers({
    config: context.config || {},
    targetRoot
  }), {
    adapterId: "laravel",
    targetRoot
  });
}

function migrationRepair(targetRoot, config, toolkit) {
  return toolkit.toolchainTerminalAction({
    actionId: "terminal-laravel-migrate",
    autoRun: true,
    commandArgs: ["bash", "-lc", "php artisan migrate --force --no-interaction --no-ansi"],
    commandPreview: "php artisan migrate --force --no-interaction --no-ansi",
    extraArgs: [
      ...writableHostUserDockerArgs({
        env: LARAVEL_WRITABLE_DOCKER_ENV
      }),
      ...laravelRuntimeDockerArgs({
        config,
        targetRoot
      })
    ],
    image: LARAVEL_TOOLCHAIN_IMAGE,
    label: "Run Laravel migrations",
    targetRoot
  }).repair({
    config,
    targetRoot
  });
}

async function checkMigrations(toolkit, targetRoot, config = {}) {
  if (selectedLaravelDatabaseRuntime(config) === "sqlite") {
    if (!await toolkit.targetFileExists("database/database.sqlite", {
      targetRoot
    })) {
      return blockedCheck({
        id: "laravel-database-migrations",
        label: "Database migrations",
        expected: "database/database.sqlite exists for the selected SQLite runtime.",
        observed: "database/database.sqlite is missing.",
        explanation: "Laravel's SQLite setup needs the database file before migrations, tests, and launch targets can use local persistence.",
        repair: seedDatabaseEnvRepair(targetRoot, config, toolkit)
      });
    }
    return passCheck({
      id: "laravel-database-migrations",
      label: "Database migrations",
      expected: "database/database.sqlite exists for the selected SQLite runtime.",
      observed: "database/database.sqlite exists.",
      explanation: "Laravel's installer creates and migrates SQLite by default."
    });
  }
  const result = await toolkit.runToolchain([
    "bash",
    "-lc",
    "php artisan migrate:status --no-interaction --no-ansi"
  ], {
    extraArgs: [
      ...writableHostUserDockerArgs({
        env: LARAVEL_WRITABLE_DOCKER_ENV
      }),
      ...laravelRuntimeDockerArgs({
        config,
        targetRoot
      })
    ],
    image: LARAVEL_TOOLCHAIN_IMAGE,
    targetRoot,
    timeout: 30_000
  });
  if (!result.ok || /Migration table not found|^\s*No\s+/imu.test(result.output)) {
    return blockedCheck({
      id: "laravel-database-migrations",
      label: "Database migrations",
      expected: "Laravel migrations have been applied to the selected managed database.",
      observed: result.output || "Migration status could not be proven.",
      explanation: "After Studio rewrites .env for a managed database, Laravel's default schema must be migrated into that database.",
      repair: migrationRepair(targetRoot, config, toolkit)
    });
  }
  return passCheck({
    id: "laravel-database-migrations",
    label: "Database migrations",
    expected: "Laravel migrations have been applied to the selected managed database.",
    observed: result.output,
    explanation: "The selected database has Laravel's migration table and schema state."
  });
}

function createLaravelSetupDoctorPlugin({
  configEnvironment = {},
  runCommand,
  startTerminalSession,
  studioRoot = "",
  targetRoot = "",
  terminalNamespace = ""
} = {}) {
  const toolkit = createDoctorPluginToolkit({
    runCommand,
    startTerminalSession,
    studioRoot,
    targetRoot,
    terminalEnv: configEnvironment,
    terminalNamespace
  });
  const buildToolchainTerminal = toolkit.shellTerminalAction({
    actionId: "build-laravel-toolchain",
    autoRun: true,
    commandPreview: () => buildLaravelToolchainRepair().commandPreview,
    cwd: studioRoot,
    label: "Build Laravel toolchain",
    script: buildLaravelToolchainScript
  });
  const createLaravelAppTerminal = toolkit.toolchainTerminalAction({
    actionId: "terminal-create-laravel-app",
    autoRun: true,
    commandArgs: (context = {}) => ["bash", "-lc", createLaravelAppScript(context.config, {
      targetRoot: context.targetRoot || targetRoot
    })],
    commandPreview: (context = {}) => createLaravelAppRepair(context.config).commandPreview,
    extraArgs: (context = {}) => [
      ...writableHostUserDockerArgs({
        env: LARAVEL_WRITABLE_DOCKER_ENV
      }),
      ...laravelRuntimeDockerArgs({
        config: context.config || {},
        targetRoot: context.targetRoot || targetRoot
      })
    ],
    image: LARAVEL_TOOLCHAIN_IMAGE,
    label: "Create Laravel app",
    targetRoot: ({ targetRoot: contextTargetRoot = "" } = {}) => contextTargetRoot || targetRoot
  });

  return toolkit.plugin({
    id: "laravel-target-runtime",
    label: "Laravel target runtime",
    checks(context = {}) {
      const checkTargetRoot = context.targetRoot || targetRoot;
      const containers = runtimeContainerEntries(toolkit, context, targetRoot);
      let toolchainReady = false;
      return [
        {
          expected: `${LARAVEL_TOOLCHAIN_IMAGE} exists locally.`,
          id: "laravel-toolchain-image",
          label: "Laravel toolchain image",
          async run() {
            const result = await checkLaravelToolchainImage(toolkit);
            toolchainReady = result.status === "pass";
            return result;
          }
        },
        {
          expected: "The selected package manager runs inside the Laravel toolchain.",
          id: "laravel-package-manager-toolchain",
          label: "Package manager command",
          run: () => toolchainReady
            ? checkPackageManagerToolchain(toolkit, checkTargetRoot, context.config || {})
            : missingLaravelToolchainCheck({
                expected: "The selected package manager runs inside the Laravel toolchain.",
                id: "laravel-package-manager-toolchain",
                label: "Package manager command"
              })
        },
        {
          expected: "PHP runs inside the Laravel toolchain.",
          id: "laravel-php-toolchain",
          label: "PHP",
          run: () => toolchainReady
            ? toolkit.toolchainCommandCheck({
                commandArgs: ["php", "--version"],
                expected: "PHP runs inside the Laravel toolchain.",
                explanation: "Laravel setup, Artisan commands, tests, and launch targets require PHP.",
                id: "laravel-php-toolchain",
                image: LARAVEL_TOOLCHAIN_IMAGE,
                label: "PHP",
                repair: buildLaravelToolchainRepair(),
                validate: (output) => /^PHP\s+/u.test(output.trim())
              }).run()
            : missingLaravelToolchainCheck({
                expected: "PHP runs inside the Laravel toolchain.",
                id: "laravel-php-toolchain",
                label: "PHP"
              })
        },
        {
          expected: "Composer runs inside the Laravel toolchain.",
          id: "laravel-composer-toolchain",
          label: "Composer",
          run: () => toolchainReady
            ? toolkit.toolchainCommandCheck({
                commandArgs: ["composer", "--version"],
                expected: "Composer runs inside the Laravel toolchain.",
                explanation: "Laravel setup and dependency installation require Composer.",
                id: "laravel-composer-toolchain",
                image: LARAVEL_TOOLCHAIN_IMAGE,
                label: "Composer",
                repair: buildLaravelToolchainRepair(),
                validate: (output) => /Composer/iu.test(output)
              }).run()
            : missingLaravelToolchainCheck({
                expected: "Composer runs inside the Laravel toolchain.",
                id: "laravel-composer-toolchain",
                label: "Composer"
              })
        },
        {
          expected: "Laravel installer runs inside the Laravel toolchain.",
          id: "laravel-installer-toolchain",
          label: "Laravel installer",
          run: () => toolchainReady
            ? toolkit.toolchainCommandCheck({
                commandArgs: ["laravel", "--version"],
                expected: "Laravel installer runs inside the Laravel toolchain.",
                explanation: "Laravel setup seeds empty target directories through laravel new.",
                id: "laravel-installer-toolchain",
                image: LARAVEL_TOOLCHAIN_IMAGE,
                label: "Laravel installer",
                repair: buildLaravelToolchainRepair(),
                validate: (output) => /Laravel Installer/iu.test(output)
              }).run()
            : missingLaravelToolchainCheck({
                expected: "Laravel installer runs inside the Laravel toolchain.",
                id: "laravel-installer-toolchain",
                label: "Laravel installer"
              })
        },
        {
          expected: "The custom starter package is set when the custom starter kit is selected.",
          id: "laravel-custom-starter",
          label: "Custom starter",
          run: () => checkCustomStarterConfig(context.config || {})
        },
        {
          expected: "Starter option config is compatible with the selected Laravel starter kit.",
          id: "laravel-starter-options",
          label: "Starter options",
          run: () => checkStarterOptionsConfig(context.config || {})
        },
        ...containers.checks,
        {
          expected: "A readable composer.json exists in the target project.",
          id: "laravel-composer-json",
          label: "composer.json",
          run: () => checkComposerJson(toolkit, checkTargetRoot, context)
        },
        {
          expected: "artisan and Laravel bootstrap files exist.",
          id: "laravel-markers",
          label: "Laravel files",
          run: () => checkLaravelMarkers(toolkit, checkTargetRoot)
        },
        {
          expected: "composer.json declares laravel/framework or an Artisan script.",
          id: "laravel-dependency",
          label: "Laravel dependency",
          run: () => checkLaravelDependency(toolkit, checkTargetRoot)
        },
        {
          expected: "Laravel database environment matches the selected runtime.",
          id: "laravel-database-env",
          label: "Database environment",
          run: () => checkDatabaseEnv(toolkit, checkTargetRoot, context.config || {})
        },
        {
          expected: "Laravel database migrations are applied when a managed database is selected.",
          id: "laravel-database-migrations",
          label: "Database migrations",
          run: () => checkMigrations(toolkit, checkTargetRoot, context.config || {})
        }
      ];
    },
    terminalActions(context = {}) {
      return [
        buildToolchainTerminal,
        createLaravelAppTerminal,
        toolkit.shellTerminalAction({
          actionId: "terminal-seed-laravel-db-env",
          autoRun: true,
          commandPreview: "write Laravel database defaults",
          cwd: context.targetRoot || targetRoot,
          env: configEnvironment,
          label: "Seed database .env",
          script: () => laravelDatabaseEnvWriteScript({
            config: context.config || {},
            targetRoot: context.targetRoot || targetRoot
          })
        }),
        toolkit.toolchainTerminalAction({
          actionId: "terminal-laravel-migrate",
          autoRun: true,
          commandArgs: ["bash", "-lc", "php artisan migrate --force --no-interaction --no-ansi"],
          commandPreview: "php artisan migrate --force --no-interaction --no-ansi",
          extraArgs: [
            ...writableHostUserDockerArgs({
              env: LARAVEL_WRITABLE_DOCKER_ENV
            }),
            ...laravelRuntimeDockerArgs({
              config: context.config || {},
              targetRoot: context.targetRoot || targetRoot
            })
          ],
          image: LARAVEL_TOOLCHAIN_IMAGE,
          label: "Run Laravel migrations",
          targetRoot: context.targetRoot || targetRoot
        }),
        ...runtimeContainerEntries(toolkit, context, targetRoot).terminalActions
      ];
    }
  });
}

export {
  buildLaravelToolchainScript,
  createLaravelAppRepair,
  createLaravelAppScript,
  createLaravelSetupDoctorPlugin,
  laravelNewCommand
};
