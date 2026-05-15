import type { UserSettings } from "../../types";
import type { LaneBudgetPolicy, RuntimeLane } from "./lane-types";
import type { LanePolicyOverrides } from "./lane-supervisor";

export type LaneTopologyMode = "simple" | "standard" | "full";

export type LaneTopologyConfig = {
  mode: LaneTopologyMode;
  plannerDecomposition: "enabled" | "disabled";
  verifier: "enabled" | "disabled";
  maxWorkers?: number;
  lanePolicyOverrides?: Partial<Record<RuntimeLane, Partial<LaneBudgetPolicy>>>;
};

export const LANE_TOPOLOGIES: Record<LaneTopologyMode, LaneTopologyConfig> = {
  simple: {
    mode: "simple",
    plannerDecomposition: "disabled",
    verifier: "disabled",
    maxWorkers: 1,
    lanePolicyOverrides: {
      executor: { maxConcurrent: 1 },
    },
  },
  standard: {
    mode: "standard",
    plannerDecomposition: "enabled",
    verifier: "disabled",
  },
  full: {
    mode: "full",
    plannerDecomposition: "enabled",
    verifier: "enabled",
  },
};

export function resolveLaneTopology(
  mode?: LaneTopologyMode,
): LaneTopologyConfig {
  return LANE_TOPOLOGIES[mode ?? "full"] ?? LANE_TOPOLOGIES.full;
}

export function resolveLaneTopologyFromSettings(
  settings: Pick<UserSettings, "laneTopologyMode">,
): LaneTopologyConfig {
  return resolveLaneTopology(settings.laneTopologyMode);
}

export function mergeLaneTopologyPolicies(args: {
  topology: LaneTopologyConfig;
  overrides?: LanePolicyOverrides;
}): LanePolicyOverrides {
  return {
    ...(args.topology.lanePolicyOverrides ?? {}),
    ...(args.overrides ?? {}),
  };
}

export function shouldUsePlannerDecomposition(
  topology: LaneTopologyConfig,
): boolean {
  return topology.plannerDecomposition === "enabled";
}

export function shouldUseVerifier(topology: LaneTopologyConfig): boolean {
  return topology.verifier === "enabled";
}

export function isNodeParallelismKillSwitchEnabled(
  root: unknown = globalThis,
): boolean {
  const candidate = root as {
    __OPENSIDEBAR_DISABLE_NODE_PARALLELISM__?: unknown;
  };
  return candidate.__OPENSIDEBAR_DISABLE_NODE_PARALLELISM__ === true;
}

export function shouldRunExecutorNodesInParallel(
  topology: LaneTopologyConfig,
  root: unknown = globalThis,
): boolean {
  return topology.mode === "full" && !isNodeParallelismKillSwitchEnabled(root);
}

export function resolveExecutorNodeConcurrency(args: {
  topology: LaneTopologyConfig;
  maxWorkers: number;
  executorMaxConcurrent: number;
  root?: unknown;
}): number {
  if (!shouldRunExecutorNodesInParallel(args.topology, args.root)) return 1;
  return Math.max(1, Math.min(args.maxWorkers, args.executorMaxConcurrent));
}
