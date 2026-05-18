import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  createLaravelTargetAdapter
} from "./index.js";

const LARAVEL_ADAPTER_MANIFEST = deepFreeze({
  bestFor: "Full-stack PHP products, admin systems, API backends, CRUD-heavy business apps, and Laravel teams that want conventional framework structure.",
  createAdapter: createLaravelTargetAdapter,
  description: "Laravel is a PHP web application framework with Composer, Artisan, Eloquent, Blade, Vite, and official starter kits. The adapter understands Laravel setup, PHP toolchains, database runtime choices, Composer scripts, and Artisan launch commands.",
  enabled: true,
  id: "laravel",
  label: "Laravel",
  outcome: "Studio can seed or inspect a Laravel app, configure SQLite, PostgreSQL, MySQL, or MariaDB, select official starter kits and test framework, then drive Codex with Laravel-specific prompts.",
  projectUrl: "https://laravel.com",
  projectUrlLabel: "Open Laravel project",
  summary: "The mainstream PHP framework for full-stack web applications and API backends.",
  techStack: [
    "PHP",
    "Laravel",
    "Composer",
    "Artisan",
    "Eloquent",
    "Vite"
  ]
});

export {
  LARAVEL_ADAPTER_MANIFEST
};
