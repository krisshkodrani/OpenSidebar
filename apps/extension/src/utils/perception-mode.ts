import type { PerceptionRuntimeMode, UserSettings } from "../types";

type ProviderMode = UserSettings["providerMode"];

function usesUnifiedVlByDefault(providerMode?: ProviderMode): boolean {
  return providerMode === "fireworks" || providerMode === "moonshot";
}

export function resolvePerceptionRuntimeMode(args: {
  perceptionMode?: PerceptionRuntimeMode;
  useVLExecutor?: boolean;
  providerMode?: ProviderMode;
}): Exclude<PerceptionRuntimeMode, "auto"> {
  if (args.perceptionMode === "unified_vl") return "unified_vl";
  if (args.perceptionMode === "structured") return "structured";
  if (args.perceptionMode === "auto") {
    return usesUnifiedVlByDefault(args.providerMode)
      ? "unified_vl"
      : "structured";
  }
  if (typeof args.useVLExecutor === "boolean") {
    return args.useVLExecutor ? "unified_vl" : "structured";
  }
  return usesUnifiedVlByDefault(args.providerMode)
    ? "unified_vl"
    : "structured";
}
