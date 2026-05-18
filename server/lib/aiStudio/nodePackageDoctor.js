import {
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "../doctorCheckItems.js";
import {
  packageManagerAvailabilityScript
} from "./nodePackage.js";

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

function normalizePackageManager(value = "") {
  const name = String(value || "").trim().toLowerCase();
  return PACKAGE_MANAGERS.has(name) ? name : "npm";
}

function packageManagerDisplayName(packageManager = "npm") {
  return {
    bun: "Bun",
    npm: "npm",
    pnpm: "pnpm",
    yarn: "Yarn"
  }[normalizePackageManager(packageManager)];
}

async function checkNodePackageManagerToolchain(toolkit, {
  id = "node-package-manager-toolchain",
  label = "Package manager command",
  packageManager = "npm",
  targetRoot = ""
} = {}) {
  const name = normalizePackageManager(packageManager);
  const displayName = packageManagerDisplayName(name);
  const result = await toolkit.runToolchain([
    "bash",
    "-lc",
    packageManagerAvailabilityScript(name)
  ], {
    targetRoot,
    timeout: 30_000
  });

  if (!result.ok) {
    return failCheck({
      id,
      label,
      expected: `${displayName} is available inside the managed base toolchain image.`,
      observed: result.output || `${displayName} did not run.`,
      explanation: "AI Studio runs Node project setup, install, scripts, and launch-target commands inside the managed base toolchain image."
    });
  }

  return passCheck({
    id,
    label,
    expected: `${displayName} is available inside the managed base toolchain image.`,
    observed: result.output,
    explanation: "The selected Node package manager is available where Studio runs target commands."
  });
}

export {
  checkNodePackageManagerToolchain,
  normalizePackageManager,
  packageManagerDisplayName
};
