/**
 * Task messaging + handoff helpers (RFC LP-16 Phase 5). Append a node handoff
 * artifact, broadcast a task-completion message, and send a runtime message.
 * Pure — verbatim movement of Orchestrator helpers.
 */
import { logger } from "../../utils";
import { agentNotifications } from "../notifications";
import { chromeRuntimeMessagingPort } from "../environment/chrome";
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

/**
 * Broadcast an orchestrator message.
 *
 * Goes through the messaging port rather than `chrome.runtime.sendMessage`
 * directly: chrome skips the sending context, so anything observing agent
 * messages in-process (`createAgentRuntime`, and through it the browser bridge)
 * would never see these. The port delivers to both.
 */
export function sendMessage(message: {
  type: string;
  payload: unknown;
  workspaceId?: string | null;
}): void {
  try {
    chromeRuntimeMessagingPort.broadcast({
      ...message,
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
    });
  } catch (error) {
    logger.debug("orchestrator", "Failed to send runtime message", { error });
  }
}
