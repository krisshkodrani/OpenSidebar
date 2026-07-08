/**
 * Status/step emission helpers (RFC LP-16 Phase 5). Emit lane-isolation and
 * verifier steps and broadcast an agent status update. Pure — verbatim
 * movement of Orchestrator helpers.
 */
import { AgentStatus } from "../../types";
import type { AgentStep } from "../../types";
import type { LaneRuntimeState } from "./lane-types";
import { updateTabGroupAppearance } from "../workspaces/tab-group-appearance";
import { sendMessage } from "./task-messaging";

export function emitLaneIsolationStep(
  workspaceId: string,
  state: LaneRuntimeState,
  detail: string,
): void {
  sendMessage({
    type: "AGENT_STEP",
    workspaceId,
    payload: {
      step: {
        id: crypto.randomUUID(),
        type: "warning",
        label: `${state.lane} lane isolated`,
        detail,
        status: "done",
        timestamp: Date.now(),
      },
      update: false,
    },
  });
}

export function emitVerifierStep(
  workspaceId: string,
  nodeId: string,
  reason: string,
): void {
  const step: AgentStep = {
    id: crypto.randomUUID(),
    type: "info",
    label: `Verifier: checked node ${nodeId.slice(0, 6)}`,
    detail: reason,
    status: "done",
    timestamp: Date.now(),
  };
  sendMessage({
    type: "AGENT_STEP",
    workspaceId,
    payload: { step, update: false },
  });
}

export function sendStatus(
  workspaceId: string,
  status: AgentStatus,
  detail: string,
  completionStatus?: "completed" | "partial" | "failed" | "stopped",
): void {
  sendMessage({
    type: "AGENT_STATUS",
    workspaceId,
    payload: { status, detail, completionStatus },
  });
  updateTabGroupAppearance(workspaceId, { status, completionStatus });
}
