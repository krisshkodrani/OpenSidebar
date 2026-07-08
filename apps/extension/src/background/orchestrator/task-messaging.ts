/**
 * Task messaging + handoff helpers (RFC LP-16 Phase 5). Append a node handoff
 * artifact, broadcast a task-completion message, and send a runtime message.
 * Pure — verbatim movement of Orchestrator helpers.
 */
import { logger } from "../../utils";
import { agentNotifications } from "../notifications";
import { MessageSource } from "../../types";
import type { TaskCompletionMessage } from "../../types";
import type { NodeHandoffArtifact, TaskNode } from "./types";
import type { OrchestratorTask } from "./types";

export function appendHandoffArtifact(
  node: TaskNode,
  artifact: Omit<NodeHandoffArtifact, "timestamp">,
): void {
  const entry: NodeHandoffArtifact = {
    ...artifact,
    timestamp: Date.now(),
  };
  node.handoffArtifacts.push(entry);
  logger.debug("orchestrator", "Handoff artifact appended", {
    nodeId: node.id,
    role: entry.role,
    phase: entry.phase,
    note: entry.note.slice(0, 180),
  });
}

export function notifyTaskCompletion(
  task: OrchestratorTask,
  payload: TaskCompletionMessage["payload"],
): void {
  if (task.status === "stopped") return;
  void agentNotifications.notifyTaskCompletion({
    workspaceId: task.workspaceId,
    tabId: task.rootTabId,
    payload,
  });
}

export function sendMessage(message: {
  type: string;
  payload: any;
  workspaceId?: string | null;
}): void {
  chrome.runtime
    .sendMessage({
      ...message,
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
    } as any)
    .catch((error) => {
      logger.debug("orchestrator", "Failed to send runtime message", {
        error,
      });
    });
}
