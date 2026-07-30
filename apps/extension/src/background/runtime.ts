/**
 * Agent runtime composition root (RFC LP-15, Phase 5).
 *
 * `createAgentRuntime(env)` is the single library API both clients drive:
 * the sidepanel (via background.ts) and external brains like pi (via the browser bridge)
 * become literal peers instead of each re-solving how to start a task and
 * observe its completion.
 *
 * The completion seam runs entirely over the injected RuntimeMessagingPort, so
 * it is testable and headless (no chrome). Task dispatch currently delegates to
 * the orchestrator singleton; threading the full environment through the
 * orchestrator/loop internals is the remaining Phase 5 work.
 */

import { orchestrator as defaultOrchestrator } from "./orchestrator";
import { setDisabledSkillIds } from "./orchestrator/skills";
import type { OrchestratorStartInput } from "./orchestrator/types";
import type { RuntimeEnvironment } from "./environment/types";
import type { TaskCompletionMessage, TaskPausedMessage } from "../types";

/**
 * The completion payload exactly as broadcast on TASK_COMPLETION — including
 * `partialHandoff`, `subtaskResults`, `metrics` and `terminationReason`.
 *
 * Sourced from the shared contract rather than a local narrowing: the previous
 * `{status?, summary?}` shape lived in `browser-bridge/` and pointed this module
 * at a consumer of its own API (deleting the bridge would have broken the
 * runtime), and silently dropped everything a caller needs to continue a run.
 */
export type TaskCompletionPayload = TaskCompletionMessage["payload"];

/**
 * Envelope this module guards for on the messaging port. `Partial` on the
 * payload is deliberate — the port yields `unknown`, so a well-formed payload is
 * something we check for, not something we can assume.
 */
interface TaskCompletionEnvelope {
  type: "TASK_COMPLETION";
  workspaceId: string;
  payload?: Partial<TaskCompletionPayload>;
}

interface TaskPausedEnvelope {
  type: "TASK_PAUSED";
  workspaceId: string;
  payload?: TaskPausedPayload;
}

/** A task paused for a user interaction (approval), for bridge forwarding. */
export type TaskPausedPayload = TaskPausedMessage["payload"];

export interface AgentRuntime {
  /** Start an agent task. */
  startTask(input: OrchestratorStartInput): Promise<void>;
  /** Stop a running task by workspace; stops every task when omitted. */
  stopTask(workspaceId?: string): Promise<void>;
  /**
   * Answer a forwarded approval, resuming the paused task (or refusing the
   * action when `approved` is false). Returns false if no matching pending
   * approval exists (unknown/expired/already-answered).
   */
  resolveApproval(
    workspaceId: string,
    payload: { approvalId: string; approved: boolean },
  ): boolean;
  resolveClarification(
    workspaceId: string,
    payload: { clarificationId: string; answer: string },
  ): boolean;
  /** Observe task pauses (approvals), correlated by workspaceId. Returns unsubscribe. */
  onTaskPaused(
    listener: (workspaceId: string, payload: TaskPausedPayload) => void,
  ): () => void;
  /** Observe task completions, correlated by workspaceId. Returns unsubscribe. */
  onTaskCompletion(
    listener: (
      workspaceId: string,
      payload: Partial<TaskCompletionPayload>,
    ) => void,
  ): () => void;
  /** Tear down all subscriptions this runtime created. */
  dispose(): void;
}

export interface AgentRuntimeDeps {
  orchestrator?: Pick<
    typeof defaultOrchestrator,
    | "startTask"
    | "stopTask"
    | "resolveApprovalResponse"
    | "resolveClarificationResponse"
  >;
}

export function createAgentRuntime(
  env: RuntimeEnvironment,
  deps: AgentRuntimeDeps = {},
): AgentRuntime {
  const orchestrator = deps.orchestrator ?? defaultOrchestrator;
  const unsubscribers = new Set<() => void>();

  return {
    startTask(input) {
      // Ablation switch (2026-07-23 skills audit): every skill-selection path
      // honors the module-level disabled set. Set here — outside the guarded
      // orchestrator landmine — before the task begins selecting skills.
      setDisabledSkillIds(input.settings.disabledSkillIds);
      return orchestrator.startTask(input);
    },
    stopTask(workspaceId) {
      return orchestrator.stopTask(workspaceId);
    },
    resolveApproval(workspaceId, payload) {
      return orchestrator.resolveApprovalResponse(payload, workspaceId);
    },
    resolveClarification(workspaceId, payload) {
      return orchestrator.resolveClarificationResponse(payload, workspaceId);
    },
    onTaskPaused(listener) {
      const off = env.messaging.onMessage((message) => {
        const m = message as Partial<TaskPausedEnvelope>;
        if (m?.type === "TASK_PAUSED" && typeof m.workspaceId === "string" && m.payload) {
          listener(m.workspaceId, m.payload);
        }
      });
      const wrapped = () => {
        off();
        unsubscribers.delete(wrapped);
      };
      unsubscribers.add(wrapped);
      return wrapped;
    },
    onTaskCompletion(listener) {
      const off = env.messaging.onMessage((message) => {
        const m = message as Partial<TaskCompletionEnvelope>;
        if (m?.type === "TASK_COMPLETION" && typeof m.workspaceId === "string") {
          listener(m.workspaceId, m.payload ?? {});
        }
      });
      const wrapped = () => {
        off();
        unsubscribers.delete(wrapped);
      };
      unsubscribers.add(wrapped);
      return wrapped;
    },
    dispose() {
      for (const off of [...unsubscribers]) off();
      unsubscribers.clear();
    },
  };
}
