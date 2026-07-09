/**
 * Lane types, error classes, and default policies for orchestrator lane management
 */

import { AgentLoop } from "../agent";
import { EscalationDecisionMessage } from "../../types";
import type { LLMClientOptions } from "../llm";
import { WorkerInstance } from "./types";
import { OrchestratorPlanner } from "./planner";
import { OrchestratorVerifier } from "./verifier";
import { workspaceManager } from "../workspaces/manager";

export type AgentLoopCallbacksArg = ConstructorParameters<typeof AgentLoop>[1];
export type AgentLoopOptionsArg = ConstructorParameters<typeof AgentLoop>[2];
export type RuntimeLane = "planner" | "executor" | "verifier";
export type EscalationDecisionPayload = EscalationDecisionMessage["payload"];

export type LaneBudgetPolicy = {
  maxConcurrent: number;
  maxFailuresBeforeIsolation: number;
  isolationCooldownMs: number;
  maxCallMs: number;
};

export type LaneRuntimeState = {
  lane: RuntimeLane;
  activeCalls: number;
  totalCalls: number;
  failures: number;
  totalDurationMs: number;
  isolatedUntilMs: number;
  lastError?: string;
  policy: LaneBudgetPolicy;
};

export type LaneOperationInstance = {
  operationId: string;
  lane: Exclude<RuntimeLane, "executor">;
  taskId: string;
  workspaceId: string;
  startedAt: number;
  timeoutMs: number;
  label: string;
  nodeId?: string;
};

export type QueuedLaneOperation = {
  operationId: string;
  taskId: string;
  workspaceId: string;
  label: string;
  nodeId?: string;
  enqueuedAt: number;
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export type LaneSupervisorState = {
  lane: RuntimeLane;
  queue: QueuedLaneOperation[];
  active: number;
  draining: boolean;
  restartCount: number;
  consecutiveCrashes: number;
  circuitOpenUntilMs: number;
  lastCrashAtMs?: number;
  lastCrashError?: string;
  resumeTimer: ReturnType<typeof setTimeout> | null;
};

export type WorkspaceLanePools = {
  planner: Map<string, LaneOperationInstance>;
  executor: Map<string, WorkerInstance>;
  verifier: Map<string, LaneOperationInstance>;
};

export class LaneIsolationError extends Error {
  readonly lane: RuntimeLane;
  readonly remainingMs: number;
  readonly lastError?: string;

  constructor(lane: RuntimeLane, remainingMs: number, lastError?: string) {
    super(
      `${lane} lane is isolated for ${remainingMs}ms (lastError=${lastError || "unknown"})`,
    );
    this.name = "LaneIsolationError";
    this.lane = lane;
    this.remainingMs = remainingMs;
    this.lastError = lastError;
  }
}

export class LaneTimeoutError extends Error {
  readonly lane: RuntimeLane;
  readonly timeoutMs: number;

  constructor(lane: RuntimeLane, timeoutMs: number) {
    super(`${lane} lane timeout (${timeoutMs}ms)`);
    this.name = "LaneTimeoutError";
    this.lane = lane;
    this.timeoutMs = timeoutMs;
  }
}

export type PlannerLike = Pick<
  OrchestratorPlanner,
  "buildNodes" | "expandNode"
> &
  Partial<Pick<OrchestratorPlanner, "setUsageCallback" | "planNextHorizon">>;
export type VerifierLike = Pick<OrchestratorVerifier, "verifyNode"> &
  Partial<Pick<OrchestratorVerifier, "advise" | "judgeGate">>;

export type CreateAgentLoopInput = {
  openRouterApiKey: string;
  callbacks?: AgentLoopCallbacksArg;
  options?: AgentLoopOptionsArg;
};

export type OrchestratorDeps = {
  createPlanner?: (
    openRouterApiKey: string,
    modelOverrides?: LLMClientOptions,
  ) => PlannerLike;
  createVerifier?: (
    openRouterApiKey: string,
    modelOverrides?: LLMClientOptions,
  ) => VerifierLike;
  createAgentLoop?: (input: CreateAgentLoopInput) => AgentLoop;
  workspaceManager?: Pick<
    typeof workspaceManager,
    "getWorkspaceById" | "getWorkspaces" | "addTabToWorkspace"
  >;
  waitForContentScriptReady?: (
    tabId: number,
    timeoutMs?: number,
  ) => Promise<void | boolean>;
  lanePolicies?: Partial<Record<RuntimeLane, Partial<LaneBudgetPolicy>>>;
};

export const DEFAULT_LANE_POLICIES: Record<RuntimeLane, LaneBudgetPolicy> = {
  planner: {
    maxConcurrent: 1,
    maxFailuresBeforeIsolation: 2,
    isolationCooldownMs: 20_000,
    // GLM-5.2 planner calls average ~6.6s but the tail collides with a 20s
    // budget, and blowing it silently swaps in the context-blind fallback node
    // builder — the create-incident "filled but never submitted" root cause.
    // 45s costs nothing on the fast path and prevents that downgrade.
    maxCallMs: 45_000,
  },
  executor: {
    maxConcurrent: 8,
    maxFailuresBeforeIsolation: 6,
    isolationCooldownMs: 10_000,
    maxCallMs: 5 * 60_000,
  },
  verifier: {
    maxConcurrent: 8,
    maxFailuresBeforeIsolation: 3,
    isolationCooldownMs: 15_000,
    maxCallMs: 20_000,
  },
};
