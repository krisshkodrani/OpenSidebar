import { ToolName, type ToolExecutionResult } from "../../../types";
import { DOM_MODIFYING_TOOLS } from "../../tools/metadata";
import type { ToolExecutionContext } from "../../tools/registry";
import { waitForDomReady } from "../../infrastructure/tab-ready";
import type { TraceRecorder } from "../trace";
import {
  pageDocumentStatesMatch,
  type PageStateCoordinator,
} from "./coordinator";
import type { ObservationBasis } from "./types";

export function stageGroundedAction(
  coordinator: PageStateCoordinator,
  actionId: string,
  modelBasis: ObservationBasis | null,
): ObservationBasis | null {
  const basis =
    modelBasis?.mutationEpoch !== undefined &&
    modelBasis.mutationEpoch >= 0 &&
    !modelBasis.documentInstanceId.startsWith("legacy:")
      ? modelBasis
      : null;
  if (basis) coordinator.stageAction(actionId, basis);
  return basis;
}

export function actionExecutionContext(
  basis: ObservationBasis | null,
  toolName: ToolName,
  enforceConsistency: boolean,
): ToolExecutionContext | undefined {
  if (!basis || !enforceConsistency) return undefined;
  return {
    observationBasis: {
      observationRevision: basis.observationRevision,
      documentInstanceId: basis.documentInstanceId,
      mutationEpoch: basis.mutationEpoch,
      url: basis.url,
      viewport: { ...basis.viewport },
      scroll: { ...basis.scroll },
      ...(toolName === "click_coordinates" ? { requireGeometryMatch: true } : {}),
    },
  };
}

const DIRECT_GROUNDED_TOOLS = new Set<ToolName>([
  ToolName.EXECUTE_JS,
  ToolName.APPLY_LIST_FILTER,
  ToolName.APPLY_LIST_SORT,
  ToolName.APPLY_LIST_ACTION,
  ToolName.CONFIGURE_CATALOG_ITEM,
  ToolName.CONFIGURE_SERVICENOW_FORM,
  ToolName.XRAY_PAGE,
]);

/**
 * Tools whose receipts require the observation captured after execution.
 * Navigation and tab tools are intentionally non-DOM tools in scheduling
 * metadata, but they still replace the page state observed by the agent.
 */
const OBSERVATION_SETTLED_TOOLS = new Set<ToolName>([
  ...DOM_MODIFYING_TOOLS,
  ToolName.NAVIGATE,
  ToolName.GO_BACK,
  ToolName.OPEN_SERVICENOW_MODULE,
  ToolName.PRESS_KEY,
  ToolName.CREATE_TAB,
  ToolName.CLOSE_TAB,
  ToolName.SWITCH_TAB,
]);

export async function preflightDirectPageAction(input: {
  coordinator: PageStateCoordinator;
  traceRecorder: TraceRecorder | null;
  actionId: string;
  toolName: ToolName;
  basis: ObservationBasis | null;
  enforceConsistency: boolean;
  tabId: number;
}): Promise<string | null> {
  if (
    !input.enforceConsistency ||
    !input.basis ||
    !DIRECT_GROUNDED_TOOLS.has(input.toolName)
  ) {
    return null;
  }
  const live = (await waitForDomReady(input.tabId, { timeoutMs: 50 }))
    .documentState;
  if (live && pageDocumentStatesMatch(input.basis, live)) return null;
  const result =
    "Error: Page state changed after this action was chosen. A fresh observation is required before retrying.";
  settleToolAction({
    ...input,
    execution: { result, errorCode: "stale_observation" },
  });
  return result;
}

function recordStaleAction(
  traceRecorder: TraceRecorder | null,
  actionId: string,
  toolName: ToolName,
  basis: ObservationBasis,
): void {
  traceRecorder?.recordEvent("stale_action_blocked", {
    toolCallId: actionId,
    toolName,
    observationRevision: basis.observationRevision,
  });
}

export function settleInspectAction(input: {
  coordinator: PageStateCoordinator;
  traceRecorder: TraceRecorder | null;
  actionId: string;
  toolName: ToolName;
  basis: ObservationBasis | null;
  result: string;
}): void {
  if (!input.basis) return;
  const stale = input.result.includes("fresh observation");
  input.coordinator.settleAction({
    actionId: input.actionId,
    status: stale ? "stale" : input.result.startsWith("Error:") ? "failed" : "executed",
    toolResultRef: `tool:${input.actionId}`,
    reason: stale ? "stale_observation" : undefined,
    after: input.coordinator.getCurrentObservation(),
  });
  if (stale) {
    recordStaleAction(
      input.traceRecorder,
      input.actionId,
      input.toolName,
      input.basis,
    );
  }
}

export function settleToolAction(input: {
  coordinator: PageStateCoordinator;
  traceRecorder: TraceRecorder | null;
  actionId: string;
  toolName: ToolName;
  basis: ObservationBasis | null;
  execution: ToolExecutionResult;
}): void {
  if (!input.basis) return;
  const stale = input.execution.errorCode === "stale_observation";
  const failed = input.execution.result.startsWith("Error:");
  input.coordinator.settleAction({
    actionId: input.actionId,
    status: stale ? "stale" : failed ? "failed" : "executed",
    toolResultRef: `tool:${input.actionId}`,
    reason: stale ? "stale_observation" : undefined,
    after: input.coordinator.getCurrentObservation(),
    deferUntilObservation:
      !stale && !failed && OBSERVATION_SETTLED_TOOLS.has(input.toolName),
  });
  if (stale) {
    recordStaleAction(
      input.traceRecorder,
      input.actionId,
      input.toolName,
      input.basis,
    );
  }
}
