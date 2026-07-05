/**
 * Agent runtime composition root (RFC LP-15, Phase 5).
 *
 * `createAgentRuntime(env)` is the single library API both clients drive:
 * the sidepanel (via background.ts) and OpenClaw (via the browser bridge)
 * become literal peers instead of each re-solving how to start a task and
 * observe its completion.
 *
 * The completion seam runs entirely over the injected RuntimeMessagingPort, so
 * it is testable and headless (no chrome). Task dispatch currently delegates to
 * the orchestrator singleton; threading the full environment through the
 * orchestrator/loop internals is the remaining Phase 5 work.
 */

import { orchestrator as defaultOrchestrator } from "./orchestrator";
import type { OrchestratorStartInput } from "./orchestrator/types";
import type { RuntimeEnvironment } from "./environment/types";
import type { CompletionPayload } from "./browser-bridge/orchestrator-driver";

export interface TaskCompletionMessage {
  type: "TASK_COMPLETION";
  workspaceId: string;
  payload?: CompletionPayload;
}

export interface AgentRuntime {
  /** Start an agent task. */
  startTask(input: OrchestratorStartInput): Promise<void>;
  /** Observe task completions, correlated by workspaceId. Returns unsubscribe. */
  onTaskCompletion(
    listener: (workspaceId: string, payload: CompletionPayload) => void,
  ): () => void;
  /** Tear down all subscriptions this runtime created. */
  dispose(): void;
}

export interface AgentRuntimeDeps {
  orchestrator?: Pick<typeof defaultOrchestrator, "startTask">;
}

export function createAgentRuntime(
  env: RuntimeEnvironment,
  deps: AgentRuntimeDeps = {},
): AgentRuntime {
  const orchestrator = deps.orchestrator ?? defaultOrchestrator;
  const unsubscribers = new Set<() => void>();

  return {
    startTask(input) {
      return orchestrator.startTask(input);
    },
    onTaskCompletion(listener) {
      const off = env.messaging.onMessage((message) => {
        const m = message as Partial<TaskCompletionMessage>;
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
