import type { PerceptionRuntimeMode, UserSettings } from "../types";

type ProviderMode = UserSettings["providerMode"];

export function resolvePerceptionRuntimeMode(args: {
  perceptionMode?: PerceptionRuntimeMode;
  useVLExecutor?: boolean;
  providerMode?: ProviderMode;
}): Exclude<PerceptionRuntimeMode, "auto"> {
  if (args.perceptionMode === "unified_vl") return "unified_vl";
  if (args.perceptionMode === "structured") return "structured";
  if (args.perceptionMode === "auto") {
    return args.providerMode === "fireworks" ? "unified_vl" : "structured";
  }
  if (typeof args.useVLExecutor === "boolean") {
    return args.useVLExecutor ? "unified_vl" : "structured";
  }
  return args.providerMode === "fireworks" ? "unified_vl" : "structured";
}
