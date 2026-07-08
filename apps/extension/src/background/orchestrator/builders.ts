/**
 * Small pure orchestrator builders (RFC LP-16 Phase 5): the run manifest, a
 * synthetic pending-interaction summary, and the subtask-results projection.
 * Verbatim movement of Orchestrator helpers.
 */
import { listPromptDescriptors } from "../../prompts";
import type { RunManifest } from "../../utils";
import type { SubtaskResult } from "../../types";
import type { PendingUserInteraction } from "../agent/loop-types";
import { isUserSkippedNode } from "./utils";
import type { OrchestratorStartInput, OrchestratorTask } from "./types";

export function buildTaskManifest(
  task: OrchestratorTask,
  _input: OrchestratorStartInput,
): RunManifest {
  const promptSet = listPromptDescriptors([
    "orchestrator.verifier.system",
    "orchestrator.advisory.system",
  ]);
  return {
    runId: task.runId || task.id,
    correlationId: task.runId || task.id,
    environment: "production",
    startedAt: new Date().toISOString(),
    source: "background.orchestrator",
    promptSet,
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}

export function buildSyntheticPendingInteractionSummary(
  interaction: PendingUserInteraction,
): string {
  if (interaction.kind === "approval") {
    return interaction.approved
      ? `E2E synthetic approval recovered and approved for ${interaction.toolName}.`
      : `E2E synthetic approval recovered and denied for ${interaction.toolName}.`;
  }
  const answer = String(interaction.answer || "").trim();
  return answer
    ? `E2E synthetic clarification recovered and answered: ${answer}`
    : "E2E synthetic clarification recovered without an answer.";
}

export function buildSubtaskResults(task: OrchestratorTask): SubtaskResult[] {
  const taskStopped = task.status === "stopped" || task.status === "stopping";
  return task.nodes.map((node) => ({
    description: node.description,
    status:
      node.status === "completed"
        ? "completed"
        : isUserSkippedNode(node)
          ? "skipped"
          : taskStopped &&
              (node.status !== "failed" ||
                /(?:stopped|cancelled) by user/i.test(
                  `${node.result || ""}\n${node.error || ""}`,
                ))
            ? "stopped"
            : "failed",
    turnsUsed: 0,
    result: node.result || node.error || "",
  }));
}
