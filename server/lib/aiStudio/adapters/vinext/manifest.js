import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  createVinextTargetAdapter
} from "./index.js";

const VINEXT_ADAPTER_MANIFEST = deepFreeze({
  createAdapter: createVinextTargetAdapter,
  enabled: true,
  id: "vinext",
  label: "Vinext"
});

export {
  VINEXT_ADAPTER_MANIFEST
};
