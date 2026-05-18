import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  createNextjsTargetAdapter
} from "./index.js";

const NEXTJS_ADAPTER_MANIFEST = deepFreeze({
  createAdapter: createNextjsTargetAdapter,
  enabled: true,
  id: "nextjs",
  label: "Next.js"
});

export {
  NEXTJS_ADAPTER_MANIFEST
};
