import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  createNextjsTargetAdapter
} from "./index.js";

const NEXTJS_ADAPTER_MANIFEST = deepFreeze({
  bestFor: "General-purpose React products, SaaS apps, dashboards, content sites, and greenfield projects that should stay close to the standard Next.js ecosystem.",
  createAdapter: createNextjsTargetAdapter,
  description: "Next.js is the React framework for App Router and Pages Router applications. The adapter understands package managers, router layout, database/runtime choices, seed options, launch modes, and framework checks.",
  enabled: true,
  id: "nextjs",
  label: "Next.js",
  outcome: "Studio can seed or inspect a Next.js app, configure TypeScript or JavaScript, Tailwind, Prisma or Drizzle, PostgreSQL or MySQL, then drive Codex with prompts tailored to that stack.",
  projectUrl: "https://nextjs.org",
  projectUrlLabel: "Open Next.js project",
  summary: "The mainstream React framework for full-stack web applications.",
  techStack: [
    "React",
    "Next.js",
    "App Router",
    "TypeScript",
    "Tailwind CSS",
    "Prisma or Drizzle"
  ]
});

export {
  NEXTJS_ADAPTER_MANIFEST
};
