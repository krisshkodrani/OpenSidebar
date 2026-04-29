import type { PerceptionRuntimeMode, UserSettings } from "../types";

type ProviderMode = UserSettings["providerMode"];

export function resolvePerceptionRuntimeMode(args: {
  perceptionMode?: PerceptionRuntimeMode;
  useVLExecutor?: boolean;
  providerMode?: ProviderMode;
}): Exclude<PerceptionRuntimeMode, "auto"> {
  if (args.perceptionMode === "structured") return "structured";
  return "unified_vl";
}
