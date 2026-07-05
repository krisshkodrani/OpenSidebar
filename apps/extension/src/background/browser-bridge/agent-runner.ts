/**
 * Orchestrator-backed AgentRunner (RFC LP-8, M2 Stage 2b).
 *
 * Bridges the thick-tool `AgentRunner` contract to the orchestrator, which is
 * fire-and-forget (`startTask` returns void) with event-driven completion. This
 * runner starts the task and resolves when the matching completion arrives.
 *
 * The orchestrator coupling is isolated behind `AgentTaskDriver` so this is
 * unit-testable; the real driver (calling `orchestrator.startTask` and listening
 * for the `TASK_COMPLETION` broadcast) is the small SW-startup seam that lives
 * next to the agent runtime / the in-flight WIP.
 */

import type {
  AgentRunOutcome,
  AgentRunner,
  AgentTask,
} from "./handler";

export interface AgentTaskDriver {
  /** Kick off a task (fire-and-forget). */
  startTask(task: AgentTask): Promise<void>;
  /** Register a one-shot completion listener; returns an unsubscribe fn. */
  onComplete(listener: (outcome: AgentRunOutcome) => void): () => void;
}

export class OrchestratorAgentRunner implements AgentRunner {
  constructor(private readonly driver: AgentTaskDriver) {}

  run(task: AgentTask): Promise<AgentRunOutcome> {
    return new Promise<AgentRunOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: AgentRunOutcome) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(outcome);
      };
      const unsubscribe = this.driver.onComplete(finish);
      this.driver.startTask(task).catch((error) => {
        finish({ status: "error", reason: (error as Error).message });
      });
    });
  }
}
