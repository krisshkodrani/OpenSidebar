import { AgentStatus, AgentStep, ToolCall, ToolName } from "../../types";
import { DOM_MODIFYING_TOOLS, CACHEABLE_TOOLS } from "../tools/metadata";
import { sanitizeUrl } from "../security";
import { workspaceManager } from "../workspaces/manager";
import { isUsableTabUrl } from "../infrastructure/tab-resolution";
import { formatStepLabel } from "../../utils/step-labels";
import { ToolResultCache } from "./tool-cache";
import type { CacheType } from "./tool-cache";
import type { PreToolDecision } from "./middleware";
import { STRING_LIMITS, INVESTIGATION_TOOLS } from "./constants";
import { ESCALATION_REFLECTION } from "./loop-prompts";
import {
  extractDiscoveredTagIds,
  getSnapshotFingerprint,
} from "./loop-helpers";
import {
  extractKnowledgeBaseAnswerCandidate,
  extractKnowledgeBaseAnswerFromText,
} from "./knowledge-search-routing";
import { assessMissingToolEscalation } from "./tool-capabilities";
import {
  buildTrustedReadAnswerCompletionCandidate,
  type TrustedCompletionCandidate,
} from "./completion-kernel";

function getTabUrl(tab: chrome.tabs.Tab): string {
  return tab.url || tab.pendingUrl || "";
}

function isControllableTab(tab: chrome.tabs.Tab): boolean {
  return isUsableTabUrl(getTabUrl(tab));
}

function formatTabLine(tab: chrome.tabs.Tab, currentTabId: number): string {
  return `Tab ${tab.id}: "${tab.title || "(untitled)"}" - ${getTabUrl(tab) || "about:blank"}${tab.id === currentTabId ? " [current]" : ""}`;
}

function formatTabListResult(
  tabs: chrome.tabs.Tab[],
  currentTabId: number,
  emptyMessage: string,
): string[] {
  const controllableTabs = tabs.filter(isControllableTab);
  const omittedCount = tabs.length - controllableTabs.length;

  if (controllableTabs.length === 0) {
    return omittedCount > 0
      ? [
          `${emptyMessage} Internal browser or extension tabs were omitted because page tools cannot run there.`,
        ]
      : [emptyMessage];
  }

  const lines = controllableTabs.map((tab) => formatTabLine(tab, currentTabId));
  if (omittedCount > 0) {
    lines.push(
      `Note: ${omittedCount} internal browser/extension tab${omittedCount === 1 ? "" : "s"} omitted because page tools cannot run there.`,
    );
  }
  return lines;
}

export function toolProvidesPageGrounding(toolName: ToolName): boolean {
  return (
    toolName === ToolName.READ_PAGE ||
    toolName === ToolName.XRAY_PAGE ||
    toolName === ToolName.INSPECT_CHART
  );
}

export interface AgentLoopToolHandlerHost {
  checkNavigateGuard(url: string): string | null;
  consecutiveAutoAdvances: number;
  context: any;
  disabledTools: Set<ToolName>;
  elementResolver: any;
  escalateModel(): void;
  executeToolCall(toolCall: ToolCall, tabId: number): Promise<string>;
  getWorkspaceTabIds(): Promise<number[] | null>;
  getActiveToolNamesForTurn?(): ToolName[];
  hasExplicitPageRead: boolean;
  hasReadPage: boolean;
  lastDomStep: AgentStep | null;
  llm: any;
  log: any;
  maxTurns: number;
  maybeAdvanceTrustedFormFillStep(params: any): void;
  maybeAutoSubmitTrustedServiceNowForm(params: any): Promise<{
    finalSummary: string;
    completionCandidate?: TrustedCompletionCandidate;
  } | null>;
  maybeCompleteTrustedFormSubmitStep(params: any): {
    finalSummary: string;
    completionCandidate?: TrustedCompletionCandidate;
  } | null;
  maybeCompleteTrustedListSortStep(params: any): {
    finalSummary: string;
    completionCandidate?: TrustedCompletionCandidate;
  } | null;
  maybeCompleteTrustedListFilterStep(params: any): {
    finalSummary: string;
    completionCandidate?: TrustedCompletionCandidate;
  } | null;
  maybeCompleteTrustedCatalogOrderSubmit(params: any): Promise<{
    finalSummary: string;
    completionCandidate?: TrustedCompletionCandidate;
  } | null>;
  maybeAutoSubmitConfiguredCatalogItem(params: any): Promise<void>;
  middleware: any;
  originalQuery: string;
  pendingInlineEditVerification: {
    stepIndex: number;
    reason: string;
  } | null;
  planSubtasks: Array<{ status: string; description: string }>;
  selectedSkillId?: string | null;
  recordMutationSensitiveAction(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
    preActionSnapshot?: unknown,
  ): void;
  recordCompletionToolEvidence?(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
    preActionSnapshot?: unknown,
  ): void;
  recordPartialProgressToolResult?(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
  ): void;
  refreshPerceptionAndTriage(tabId: number): Promise<void>;
  refreshSnapshotWithRetry(
    tabId: number,
    prevElementCount: number,
  ): Promise<number>;
  replayMutationSensitiveAction(
    toolCallId: string,
    toolName: ToolName,
    args: Record<string, unknown>,
  ): boolean;
  shouldBlockTabManagementTools(): boolean;
  statusHandler(status: AgentStatus, message: string): void;
  stepHandler(step: AgentStep, persist: boolean): void;
  toolCache: any;
  traceRecorder?: any;
  trackListDetailToolSuccess(
    toolName: ToolName,
    args: Record<string, unknown>,
    snapshot: unknown,
  ): void;
  turnCount: number;
  updateMoneyTableAggregate(result: string): string | null;
  workspaceId: string | null;
}

export type GenericSequentialToolState = {
  prevElementCount: number;
  domModified: boolean;
  visuallyModified: boolean;
  lastDomAffectingToolName: string | null;
  breakLoop: boolean;
  completedSummary: string | null;
  completionCandidate?: TrustedCompletionCandidate;
};

function buildKnowledgeAnswerCompletionCandidate(
  loop: AgentLoopToolHandlerHost,
  params: {
    answer: string;
    result: string;
    source: "knowledge_base_search" | "page_read";
  },
): TrustedCompletionCandidate {
  const getCurrentUrl = loop.context?.getCurrentUrl;
  return buildTrustedReadAnswerCompletionCandidate({
    workflow: "search-answer-extraction",
    answer: params.answer,
    source: params.source,
    question: loop.originalQuery,
    evidenceText: params.result,
    turn: loop.turnCount,
    ...(typeof getCurrentUrl === "function"
      ? { url: getCurrentUrl.call(loop.context) }
      : {}),
  });
}

export function recordSuccessfulToolExecution(
  loop: AgentLoopToolHandlerHost,
  params: {
    toolCall: ToolCall;
    toolName: ToolName;
    args: Record<string, unknown>;
    result: string;
    toolStep: AgentStep;
    preDecision: PreToolDecision;
    discoveredTagIds: Set<number>;
    llmIntention: string | null | undefined;
    mode: "parallel" | "sequential";
  },
): number {
  const toolMs = Date.now() - params.toolStep.timestamp;
  for (const id of extractDiscoveredTagIds(params.toolName, params.result)) {
    params.discoveredTagIds.add(id);
  }
  loop.middleware.evaluatePostTool(
    params.toolName,
    params.result,
    null,
    toolMs,
    loop.turnCount,
  );
  loop.stepHandler(
    {
      ...params.toolStep,
      status: "done",
      durationMs: toolMs,
    },
    true,
  );
  loop.log.info("tools", `${params.toolName} OK`, {
    turn: loop.turnCount,
    tool: params.toolName,
    risk: params.preDecision.riskLevel,
    mode: params.mode,
    args: JSON.stringify(params.args).slice(0, STRING_LIMITS.ARGS_LOG),
    result: params.result.slice(0, STRING_LIMITS.RESULT_LOG),
    durationMs: toolMs,
    intention: params.llmIntention,
  });
  loop.traceRecorder?.recordToolExecution(
    params.toolCall.id,
    params.toolName,
    params.args,
    params.result,
    true,
    toolMs,
    params.preDecision.riskLevel,
  );
  loop.recordPartialProgressToolResult?.(
    params.toolName,
    params.args,
    params.result,
  );
  return toolMs;
}

export function recordFailedToolExecution(
  loop: AgentLoopToolHandlerHost,
  params: {
    toolCall: ToolCall;
    toolName: ToolName;
    args: Record<string, unknown>;
    errorMsg: string;
    toolStep: AgentStep;
    preDecision: PreToolDecision;
    llmIntention: string | null | undefined;
    mode: "parallel" | "sequential";
  },
): number {
  const toolMs = Date.now() - params.toolStep.timestamp;
  loop.middleware.evaluatePostTool(
    params.toolName,
    null,
    params.errorMsg,
    toolMs,
    loop.turnCount,
  );
  loop.log.error("tools", `${params.toolName} FAIL`, {
    turn: loop.turnCount,
    tool: params.toolName,
    risk: params.preDecision.riskLevel,
    mode: params.mode,
    args: JSON.stringify(params.args).slice(0, STRING_LIMITS.ARGS_LOG),
    error: params.errorMsg,
    durationMs: toolMs,
    intention: params.llmIntention,
  });
  loop.traceRecorder?.recordToolExecution(
    params.toolCall.id,
    params.toolName,
    params.args,
    params.errorMsg,
    false,
    toolMs,
    params.preDecision.riskLevel,
    params.errorMsg,
  );
  loop.stepHandler(
    {
      ...params.toolStep,
      status: "error",
      durationMs: toolMs,
      errorMessage: params.errorMsg,
    },
    true,
  );
  return toolMs;
}

export function storeSuccessfulToolResult(
  loop: AgentLoopToolHandlerHost,
  params: {
    toolName: ToolName;
    args: Record<string, unknown>;
    result: string;
    cacheType: CacheType | undefined;
  },
): void {
  if (!params.cacheType || params.result.startsWith("Error:")) return;

  const fp = getSnapshotFingerprint(loop.context.getSnapshot());
  loop.toolCache.set(
    ToolResultCache.key(params.toolName, params.args),
    params.result,
    fp,
    params.cacheType,
  );
}

export function updateInlineEditVerificationState(
  loop: AgentLoopToolHandlerHost,
  params: {
    toolName: ToolName;
    currentStepIndex: number;
    shouldArmInlineEditVerification: boolean;
  },
): void {
  if (
    loop.pendingInlineEditVerification &&
    loop.pendingInlineEditVerification.stepIndex === params.currentStepIndex &&
    [ToolName.READ_PAGE, ToolName.READ_ELEMENT, ToolName.FIND_ELEMENT].includes(
      params.toolName,
    )
  ) {
    loop.pendingInlineEditVerification = null;
    return;
  }

  if (params.shouldArmInlineEditVerification) {
    loop.pendingInlineEditVerification = {
      stepIndex: params.currentStepIndex,
      reason: "You likely just committed an inline edit on this step.",
    };
  }
}

export async function handleEscalateToolCall(
  loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  args: Record<string, unknown>,
  tabId: number,
  prevElementCount: number,
  escalationTier: number,
  plannerModelStartTurn: number,
  orientationPhase: boolean,
): Promise<{
  escalationTier: number;
  plannerModelStartTurn: number;
  orientationPhase: boolean;
  prevElementCount: number;
}> {
  const reason = (args.reason as string) || "";
  const capabilityAssessment = assessMissingToolEscalation({
    args,
    availableToolNames: loop.getActiveToolNamesForTurn?.() ?? [],
  });
  if (capabilityAssessment.decision === "reject") {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: capabilityAssessment.correction,
    });
    loop.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: "Escalation rejected: requested tool capability is available",
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );
    loop.log.info("agent", "ESCALATE rejected: capability available", {
      turn: loop.turnCount,
      reason,
      requiredCapability: capabilityAssessment.requiredCapability,
      matchedToolNames: capabilityAssessment.matchedToolNames,
    });
    loop.traceRecorder?.recordEvent("escalation_rejected", {
      turn: loop.turnCount,
      reason,
      rejectionReason: capabilityAssessment.reason,
      requiredCapability: capabilityAssessment.requiredCapability,
      matchedToolNames: capabilityAssessment.matchedToolNames,
    });
    return {
      escalationTier,
      plannerModelStartTurn,
      orientationPhase,
      prevElementCount,
    };
  }
  if (escalationTier < 1) {
    loop.escalateModel();
    escalationTier = 1;
    plannerModelStartTurn = loop.turnCount;
    orientationPhase = false; // Cancel plan-then-act handoff
    prevElementCount = await loop.refreshSnapshotWithRetry(
      tabId,
      prevElementCount,
    );
    await loop.refreshPerceptionAndTriage(tabId);
    loop.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: reason
          ? `Escalating: "${reason.slice(0, STRING_LIMITS.ESCALATION_REASON)}"`
          : "Escalating to smarter model",
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: ESCALATION_REFLECTION(reason || "voluntary escalation"),
    });
  } else {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Already using the most capable model (${loop.llm.getCurrentModel()}). Escalation won't help further. Try a fundamentally different approach:\n- Use read_page to force a fresh page perception\n- Try a completely different interaction strategy`,
    });
  }
  loop.log.info("agent", "ESCALATE called", {
    turn: loop.turnCount,
    reason,
    tier: escalationTier,
  });
  loop.traceRecorder?.recordEvent("escalation", {
    reason,
    voluntary: true,
  });

  return {
    escalationTier,
    plannerModelStartTurn,
    orientationPhase,
    prevElementCount,
  };
}

export function handleUpdateNotesToolCall(
  loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  toolName: ToolName,
  args: Record<string, unknown>,
): void {
  const note = (args.note as string) || "";
  loop.context.appendWorkingNote(note);
  loop.trackListDetailToolSuccess(toolName, args, loop.context.getSnapshot());
  loop.context.addMessage({
    role: "tool",
    tool_call_id: toolCallId,
    content: "Note saved.",
  });
  loop.log.info("agent", "UPDATE_NOTES saved", {
    turn: loop.turnCount,
    noteLength: note.length,
  });
}

export async function handleWaitToolCall(
  loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  toolName: ToolName,
  args: Record<string, unknown>,
  tabId: number,
  prevElementCount: number,
): Promise<number> {
  const seconds = Math.min(Math.max((args.seconds as number) || 2, 1), 10);
  const reason = (args.reason as string) || "";

  // Signal WAITING status so the UI activity indicator stays visible
  loop.statusHandler(AgentStatus.WAITING_FOR_PAGE_LOAD, `Waiting ${seconds}s…`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  loop.statusHandler(AgentStatus.THINKING, "Analyzing…");

  // Refresh DOM snapshot for fresh context
  prevElementCount = await loop.refreshSnapshotWithRetry(
    tabId,
    prevElementCount,
  );

  // Build re-orientation response
  const snapshot = loop.context.getSnapshot();
  const parts: string[] = [`--- RE-ORIENTATION (waited ${seconds}s) ---`];
  if (reason) parts.push(`Reason: ${reason}`);
  parts.push(`\nOriginal task: "${loop.originalQuery}"`);

  if (loop.planSubtasks.length > 0) {
    const planLines = loop.planSubtasks.map(
      (s: { status: string; description: string }, i: number) => {
        const marker =
          s.status === "completed"
            ? "[done]"
            : s.status === "running"
              ? "[NOW]"
              : "[pending]";
        return `  ${i + 1}. ${marker} ${s.description}`;
      },
    );
    parts.push(`\nPlan progress:\n${planLines.join("\n")}`);
  }

  parts.push(
    `\nCurrent page: "${snapshot?.title || "unknown"}" — ${snapshot?.url || "unknown"}`,
  );
  parts.push(`Turn: ${loop.turnCount} / ${loop.maxTurns}`);
  parts.push(
    `\nReview the above → observe the page → decide your next action.`,
  );

  loop.context.addMessage({
    role: "tool",
    tool_call_id: toolCallId,
    content: parts.join("\n"),
  });

  loop.stepHandler(
    {
      id: crypto.randomUUID(),
      type: "tool",
      label: formatStepLabel(toolName, args, loop.elementResolver),
      toolName,
      status: "done",
      timestamp: Date.now(),
    },
    false,
  );

  loop.log.info("agent", "WAIT_REORIENT", {
    turn: loop.turnCount,
    seconds,
    reason: reason.slice(0, 100),
  });
  loop.traceRecorder?.recordEvent("wait_reorient", {
    seconds,
    reason,
  });

  return prevElementCount;
}

export function handleNavigateGuardToolCall(
  loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  args: Record<string, unknown>,
): boolean {
  if (!args.url) return false;

  const blockMessage = loop.checkNavigateGuard(args.url as string);
  if (!blockMessage) return false;

  loop.log.warn("agent", "Navigate blocked by guard", {
    turn: loop.turnCount,
    targetUrl: (args.url as string).slice(0, 120),
  });
  loop.traceRecorder?.recordEvent("navigate_blocked", {
    targetUrl: args.url,
  });
  loop.context.addMessage({
    role: "tool",
    tool_call_id: toolCallId,
    content: blockMessage,
  });
  loop.stepHandler(
    {
      id: crypto.randomUUID(),
      type: "info",
      label: "Navigate blocked — would undo progress",
      status: "done",
      timestamp: Date.now(),
    },
    false,
  );
  return true;
}

export async function handleListTabsToolCall(
  loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  tabId: number,
): Promise<void> {
  const wsTabIds = await loop.getWorkspaceTabIds();
  let tabLines: string[];
  if (wsTabIds) {
    // Filter to workspace tabs only
    const tabs: chrome.tabs.Tab[] = [];
    for (const id of wsTabIds) {
      try {
        tabs.push(await chrome.tabs.get(id));
      } catch {
        // Tab may have been closed externally
      }
    }
    if (tabs.length === 0) {
      tabLines = ["No open tabs in this workspace."];
    } else {
      tabLines = formatTabListResult(
        tabs,
        tabId,
        "No controllable web tabs in this workspace.",
      );
    }
  } else {
    // No workspace - show all tabs (fallback)
    const allTabs = await chrome.tabs.query({});
    tabLines = formatTabListResult(
      allTabs,
      tabId,
      "No controllable web tabs are open.",
    );
  }
  loop.context.addMessage({
    role: "tool",
    tool_call_id: toolCallId,
    content: tabLines.join("\n") || "No open tabs.",
  });
  loop.log.info("agent", "LIST_TABS", {
    turn: loop.turnCount,
    count: tabLines.length,
    workspaceScoped: wsTabIds !== null,
  });
}

export async function handleSwitchTabToolCall(
  loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  args: Record<string, unknown>,
  tabId: number,
  prevElementCount: number,
): Promise<{ tabId: number; prevElementCount: number }> {
  if (loop.shouldBlockTabManagementTools()) {
    const blockedMessage =
      "Blocked: switch_tab requires explicit user instruction to manage tabs. " +
      "Stay on the current tab unless the user asks for tab switching.";
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: blockedMessage,
    });
    // Block only this call. The tab-management gate is re-evaluated every turn,
    // so a plan that later legitimately requires tabs can still recover — we do
    // not latch the tools off for the rest of the session.
    loop.log.warn("agent", "switch_tab blocked - not explicitly requested", {
      turn: loop.turnCount,
      originalQuery: loop.originalQuery,
    });
    return { tabId, prevElementCount };
  }

  // Normalize: LLMs sometimes send "id" instead of "tabId", or strings instead of ints
  const rawId = args.tabId ?? args.id;
  const targetTabId =
    typeof rawId === "string" ? parseInt(rawId, 10) : (rawId as number);
  if (!targetTabId || isNaN(targetTabId)) {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Error: Invalid tab ID. Use switch_tab({"tabId": <integer>}) with the numeric tab ID from create_tab or list_tabs.`,
    });
    return { tabId, prevElementCount };
  }
  const wsTabIds = await loop.getWorkspaceTabIds();

  if (wsTabIds && !wsTabIds.includes(targetTabId)) {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Error: Tab ${targetTabId} is not in this workspace. Available tabs: ${wsTabIds.join(", ")}`,
    });
    loop.log.warn("agent", "switch_tab blocked — outside workspace", {
      turn: loop.turnCount,
      targetTabId,
      workspaceTabs: wsTabIds,
    });
    return { tabId, prevElementCount };
  }

  try {
    const targetTab = await chrome.tabs.get(targetTabId);
    if (!isControllableTab(targetTab)) {
      const targetUrl = getTabUrl(targetTab) || "about:blank";
      loop.context.addMessage({
        role: "tool",
        tool_call_id: toolCallId,
        content:
          `Error: Cannot switch to tab ${targetTabId} (${targetUrl}) for this web task. ` +
          "Browser, extension, blank, and internal pages cannot run page tools. Use a controllable web tab from list_tabs or navigate the current page instead.",
      });
      loop.log.warn("agent", "switch_tab blocked - unsupported internal tab", {
        turn: loop.turnCount,
        targetTabId,
        targetUrl,
      });
      loop.traceRecorder?.recordEvent("unsupported_tab_switch_blocked", {
        tool: ToolName.SWITCH_TAB,
        targetTabId,
        targetUrl,
      });
      return { tabId, prevElementCount };
    }

    await chrome.tabs.update(targetTabId, { active: true });
    tabId = targetTabId;

    // Refresh snapshot for new tab
    prevElementCount = await loop.refreshSnapshotWithRetry(
      tabId,
      prevElementCount,
    );

    // Warm start: pre-run perception so next turn already has page interpretation
    await loop.refreshPerceptionAndTriage(tabId);

    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Switched to tab ${targetTabId}. Fresh page snapshot is available.`,
    });
  } catch (e: any) {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Error switching to tab ${targetTabId}: ${e.message}`,
    });
  }
  loop.log.info("agent", "SWITCH_TAB", {
    turn: loop.turnCount,
    targetTabId,
    newTabId: tabId,
  });

  return { tabId, prevElementCount };
}

export async function handleCloseTabToolCall(
  loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  toolName: ToolName,
  args: Record<string, unknown>,
  tabId: number,
): Promise<void> {
  if (loop.replayMutationSensitiveAction(toolCallId, toolName, args)) {
    return;
  }
  if (loop.shouldBlockTabManagementTools()) {
    const blockedMessage =
      "Blocked: close_tab requires explicit user instruction to manage tabs.";
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: blockedMessage,
    });
    // Block only this call; the gate re-evaluates each turn (see switch_tab).
    loop.log.warn("agent", "close_tab blocked - not explicitly requested", {
      turn: loop.turnCount,
      originalQuery: loop.originalQuery,
    });
    return;
  }

  // Normalize: LLMs sometimes send "id" instead of "tabId", or strings instead of ints
  const rawCloseId = args.tabId ?? args.id;
  const parsedCloseId =
    typeof rawCloseId === "string"
      ? parseInt(rawCloseId, 10)
      : (rawCloseId as number);
  const targetTabId =
    parsedCloseId && !isNaN(parsedCloseId) ? parsedCloseId : tabId;

  if (targetTabId === tabId) {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Error: Cannot close the current tab (${tabId}). Use switch_tab to move to another tab first.`,
    });
    return;
  }

  const wsTabIds = await loop.getWorkspaceTabIds();
  if (wsTabIds && !wsTabIds.includes(targetTabId)) {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Error: Tab ${targetTabId} is not in this workspace. Available tabs: ${wsTabIds.join(", ")}`,
    });
    loop.log.warn("agent", "close_tab blocked — outside workspace", {
      turn: loop.turnCount,
      targetTabId,
      workspaceTabs: wsTabIds,
    });
    return;
  }

  try {
    await chrome.tabs.remove(targetTabId);
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Closed tab ${targetTabId}.`,
    });
    loop.recordMutationSensitiveAction(
      toolName,
      args,
      `Closed tab ${targetTabId}.`,
    );
  } catch (e: any) {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Error closing tab ${targetTabId}: ${e.message}`,
    });
  }
  loop.log.info("agent", "CLOSE_TAB", {
    turn: loop.turnCount,
    targetTabId,
  });
}

export async function handleCreateTabToolCall(
  loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<void> {
  if (loop.replayMutationSensitiveAction(toolCallId, toolName, args)) {
    return;
  }
  if (loop.shouldBlockTabManagementTools()) {
    const blockedMessage =
      "Blocked: create_tab requires explicit user instruction to open additional tabs.";
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: blockedMessage,
    });
    // Block only this call; the gate re-evaluates each turn (see switch_tab).
    loop.log.warn("agent", "create_tab blocked - not explicitly requested", {
      turn: loop.turnCount,
      originalQuery: loop.originalQuery,
    });
    return;
  }

  const url = args.url as string;
  const urlResult = sanitizeUrl(url);
  if (!urlResult.ok) {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Error: ${urlResult.error}`,
    });
    return;
  }

  try {
    const newTab = await chrome.tabs.create({
      url: urlResult.value,
    });
    if (newTab.id && loop.workspaceId && loop.workspaceId !== "default") {
      await workspaceManager.addTabToWorkspace(newTab.id, loop.workspaceId);
    }

    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Created new tab (ID: ${newTab.id}) with URL: ${urlResult.value}. Use switch_tab to make it the active tab.`,
    });
    loop.recordMutationSensitiveAction(
      toolName,
      args,
      `Created new tab (ID: ${newTab.id}) with URL: ${urlResult.value}. Use switch_tab to make it the active tab.`,
    );
    loop.log.info("agent", "CREATE_TAB", {
      turn: loop.turnCount,
      newTabId: newTab.id,
      url: urlResult.value,
      workspaceId: loop.workspaceId,
    });
  } catch (e: any) {
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `Error creating tab: ${e.message}`,
    });
  }
}

export interface GenericSequentialToolCallParams {
  toolCall: ToolCall;
  toolName: ToolName;
  args: Record<string, unknown>;
  tabId: number;
  prevElementCount: number;
  autocompleteRewriteReason: string | null;
  discoveredTagIds: Set<number>;
  preDecision: PreToolDecision;
  llmIntention?: string | null;
  currentStepIndex: number;
  shouldArmInlineEditVerification: boolean;
  cacheType: ReturnType<typeof CACHEABLE_TOOLS.get>;
  orientationPhase: boolean;
  orientationToolsUsed: Set<string>;
  domModified: boolean;
  visuallyModified: boolean;
  lastDomAffectingToolName: string | null;
}

export async function handleGenericSequentialToolCall(
  loop: AgentLoopToolHandlerHost,
  params: GenericSequentialToolCallParams,
): Promise<GenericSequentialToolState> {
  const {
    toolCall,
    toolName,
    args,
    tabId,
    autocompleteRewriteReason,
    discoveredTagIds,
    preDecision,
    llmIntention,
    currentStepIndex,
    shouldArmInlineEditVerification,
    cacheType,
    orientationPhase,
    orientationToolsUsed,
  } = params;
  let {
    prevElementCount,
    domModified,
    visuallyModified,
    lastDomAffectingToolName,
  } = params;

  // Idempotency guard: prevent re-execution of mutation-sensitive actions
  // within the same plan step. Checks the durable step mutation ledger first
  // (survives SW restart), then the ephemeral turn cache.
  if (loop.replayMutationSensitiveAction(toolCall.id, toolName, args)) {
    return {
      prevElementCount,
      domModified,
      visuallyModified,
      lastDomAffectingToolName,
      breakLoop: false,
      completedSummary: null,
    };
  }

  const toolStepId = crypto.randomUUID();
  const toolStep: AgentStep = {
    id: toolStepId,
    type: "tool",
    label: formatStepLabel(toolName, args, loop.elementResolver),
    detail: JSON.stringify(args),
    toolName,
    status: "running",
    timestamp: Date.now(),
  };
  loop.stepHandler(toolStep, false);

  let result: string;
  try {
    const preActionSnapshot = loop.context.getSnapshot();
    result = await loop.executeToolCall(toolCall, tabId);
    if (autocompleteRewriteReason) {
      result = `${result}\n${autocompleteRewriteReason}`;
    }
    loop.trackListDetailToolSuccess(toolName, args, preActionSnapshot);
    loop.recordCompletionToolEvidence?.(
      toolName,
      args,
      result,
      preActionSnapshot,
    );
    recordSuccessfulToolExecution(loop, {
      toolCall,
      toolName,
      args,
      result,
      toolStep,
      preDecision,
      discoveredTagIds,
      llmIntention,
      mode: "sequential",
    });
    updateInlineEditVerificationState(loop, {
      toolName,
      currentStepIndex,
      shouldArmInlineEditVerification,
    });
    loop.recordMutationSensitiveAction(
      toolName,
      args,
      result,
      preActionSnapshot,
    );
  } catch (toolError: any) {
    if (toolError.name === "AbortError") throw toolError;
    const errorMsg = toolError.message || String(toolError);
    recordFailedToolExecution(loop, {
      toolCall,
      toolName,
      args,
      errorMsg,
      toolStep,
      preDecision,
      llmIntention,
      mode: "sequential",
    });
    // Add error to conversation history so the LLM can recover
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCall.id,
      content: `Error: ${errorMsg}`,
    });
    return {
      prevElementCount,
      domModified,
      visuallyModified,
      lastDomAffectingToolName,
      breakLoop: false,
      completedSummary: null,
    };
  }

  if (
    DOM_MODIFYING_TOOLS.has(toolName) &&
    !result.includes("Click intercepted")
  ) {
    domModified = true;
    loop.consecutiveAutoAdvances = 0;
    if (toolName !== ToolName.READ_PAGE) {
      visuallyModified = true;
      lastDomAffectingToolName = toolName;
    }
    loop.lastDomStep = {
      ...toolStep,
      status: "done",
      durationMs: Date.now() - toolStep.timestamp,
    };
  }

  // Track page evidence for done() content verification guard.
  if (toolProvidesPageGrounding(toolName)) {
    loop.hasReadPage = true;
  }
  if (toolName === ToolName.READ_PAGE) {
    loop.hasExplicitPageRead = true;
    const aggregateNote = loop.updateMoneyTableAggregate(result);
    if (aggregateNote) {
      result = `${result}\n\n${aggregateNote}`;
    }
  }

  storeSuccessfulToolResult(loop, { toolName, args, result, cacheType });

  // Track investigation tools during orientation for adaptive tier allocation
  if (orientationPhase && INVESTIGATION_TOOLS.has(toolName)) {
    orientationToolsUsed.add(toolName);
  }

  // Add Tool Result to History
  loop.context.addMessage({
    role: "tool",
    content: result,
    tool_call_id: toolCall.id,
  });

  if (toolName === ToolName.CONFIGURE_SERVICENOW_FORM) {
    const missingFieldLabels = [
      ...new Set(
        result
          .split(/\r?\n/)
          .map((line) => line.match(/^\s*-\s+(.+?):\s*field not found\b/i))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .map((match) => match[1].replace(/\s+/g, " ").trim())
          .filter((label) => label.length > 0),
      ),
    ].filter((label) =>
      new RegExp(
        `\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ).test(loop.originalQuery),
    );
    if (
      missingFieldLabels.length > 0 &&
      (loop.selectedSkillId === "servicenow-record-form" ||
        /\bServiceNow\b/i.test(loop.originalQuery))
    ) {
      const quoted = missingFieldLabels.map((label) => `"${label}"`);
      const summary =
        missingFieldLabels.length === 1
          ? `I cannot complete this because the requested field ${quoted[0]} is not available on this ServiceNow form.`
          : `I cannot complete this because the requested fields ${quoted.join(", ")} are not available on this ServiceNow form.`;
      loop.traceRecorder?.recordEvent(
        "servicenow_record_missing_field_configure_completed",
        {
          turn: loop.turnCount,
          fields: missingFieldLabels,
          mode: "sequential",
        },
      );
      return {
        prevElementCount,
        domModified,
        visuallyModified,
        lastDomAffectingToolName,
        breakLoop: true,
        completedSummary: summary,
      };
    }
  }

  if (
    loop.selectedSkillId === "search-answer-extraction" &&
    toolName === ToolName.SEARCH_KNOWLEDGE_BASE
  ) {
    const answerCandidate =
      extractKnowledgeBaseAnswerCandidate(result) ??
      extractKnowledgeBaseAnswerFromText(result, loop.originalQuery);
    if (answerCandidate) {
      loop.log.info("agent", "Knowledge answer extracted from tool evidence", {
        turn: loop.turnCount,
        answerCandidate: answerCandidate.slice(0, 80),
      });
      loop.traceRecorder?.recordEvent("knowledge_answer_extracted", {
        answerCandidate: answerCandidate.slice(0, 120),
      });
      return {
        prevElementCount,
        domModified,
        visuallyModified,
        lastDomAffectingToolName,
        breakLoop: true,
        completedSummary: answerCandidate,
        completionCandidate: buildKnowledgeAnswerCompletionCandidate(loop, {
          answer: answerCandidate,
          result,
          source: "knowledge_base_search",
        }),
      };
    }
  }

  if (
    loop.selectedSkillId === "search-answer-extraction" &&
    toolName === ToolName.READ_PAGE
  ) {
    const answerCandidate = extractKnowledgeBaseAnswerFromText(
      result,
      loop.originalQuery,
    );
    if (answerCandidate) {
      loop.log.info("agent", "Knowledge answer extracted from page evidence", {
        turn: loop.turnCount,
        answerCandidate: answerCandidate.slice(0, 80),
      });
      loop.traceRecorder?.recordEvent("knowledge_answer_extracted_from_page", {
        answerCandidate: answerCandidate.slice(0, 120),
      });
      return {
        prevElementCount,
        domModified,
        visuallyModified,
        lastDomAffectingToolName,
        breakLoop: true,
        completedSummary: answerCandidate,
        completionCandidate: buildKnowledgeAnswerCompletionCandidate(loop, {
          answer: answerCandidate,
          result,
          source: "page_read",
        }),
      };
    }
  }

  const trustedSubmitCompletion = loop.maybeCompleteTrustedFormSubmitStep({
    toolName,
    toolArgs: args,
    toolResult: result,
    mode: "sequential",
  });
  if (trustedSubmitCompletion) {
    return {
      prevElementCount,
      domModified,
      visuallyModified,
      lastDomAffectingToolName,
      breakLoop: true,
      completedSummary: trustedSubmitCompletion.finalSummary,
      completionCandidate: trustedSubmitCompletion.completionCandidate,
    };
  }

  // Trigger B: Blind input detection — warn when type_text value has no evidence
  loop.maybeAdvanceTrustedFormFillStep({
    toolName,
    toolArgs: args,
    toolResult: result,
    mode: "sequential",
  });

  const trustedListSortCompletion = loop.maybeCompleteTrustedListSortStep({
    toolName,
    toolArgs: args,
    toolResult: result,
    mode: "sequential",
  });
  if (trustedListSortCompletion) {
    return {
      prevElementCount,
      domModified,
      visuallyModified,
      lastDomAffectingToolName,
      breakLoop: true,
      completedSummary: trustedListSortCompletion.finalSummary,
      completionCandidate: trustedListSortCompletion.completionCandidate,
    };
  }

  const trustedListFilterCompletion = loop.maybeCompleteTrustedListFilterStep({
    toolName,
    toolArgs: args,
    toolResult: result,
    mode: "sequential",
  });
  if (trustedListFilterCompletion) {
    return {
      prevElementCount,
      domModified,
      visuallyModified,
      lastDomAffectingToolName,
      breakLoop: true,
      completedSummary: trustedListFilterCompletion.finalSummary,
      completionCandidate: trustedListFilterCompletion.completionCandidate,
    };
  }

  const trustedCatalogOrderCompletion =
    await loop.maybeCompleteTrustedCatalogOrderSubmit({
      toolName,
      toolArgs: args,
      toolResult: result,
      tabId,
      mode: "sequential",
    });
  if (trustedCatalogOrderCompletion) {
    return {
      prevElementCount,
      domModified,
      visuallyModified,
      lastDomAffectingToolName,
      breakLoop: true,
      completedSummary: trustedCatalogOrderCompletion.finalSummary,
      completionCandidate: trustedCatalogOrderCompletion.completionCandidate,
    };
  }

  await loop.maybeAutoSubmitConfiguredCatalogItem({
    toolName,
    toolArgs: args,
    toolResult: result,
    tabId,
    mode: "sequential",
  });

  const trustedAutoSubmitCompletion =
    await loop.maybeAutoSubmitTrustedServiceNowForm({
      toolName,
      toolArgs: args,
      toolResult: result,
      tabId,
      mode: "sequential",
    });
  if (trustedAutoSubmitCompletion) {
    return {
      prevElementCount,
      domModified,
      visuallyModified,
      lastDomAffectingToolName,
      breakLoop: true,
      completedSummary: trustedAutoSubmitCompletion.finalSummary,
      completionCandidate: trustedAutoSubmitCompletion.completionCandidate,
    };
  }

  if (toolName === ToolName.TYPE_TEXT) {
    const typedValue = String(args.text || "");
    if (typedValue.length > 3) {
      const snap = loop.context.getSnapshot();
      const pageText = snap?.pageContent || snap?.visibleContent || "";
      const originalQuery = loop.originalQuery || "";
      // Check if typed value appears in any recent tool result
      let hasEvidence = false;
      if (pageText.includes(typedValue) || originalQuery.includes(typedValue)) {
        hasEvidence = true;
      } else {
        const recentMsgs = loop.context.getMessages();
        const lookback = Math.min(20, recentMsgs.length);
        for (
          let ri = recentMsgs.length - 1;
          ri >= recentMsgs.length - lookback && ri >= 0;
          ri--
        ) {
          const m = recentMsgs[ri];
          if (
            m.role === "tool" &&
            typeof m.content === "string" &&
            m.content.includes(typedValue)
          ) {
            hasEvidence = true;
            break;
          }
        }
      }
      if (!hasEvidence) {
        loop.log.warn("agent", "Blind input detected", {
          turn: loop.turnCount,
          typedValue: typedValue.slice(0, 50),
        });
        loop.traceRecorder?.recordEvent("blind_input_detected", {
          typedValue: typedValue.slice(0, 50),
        });
        loop.context.addMessage({
          role: "user",
          content: `WARNING: You typed "${typedValue.slice(0, 50)}" but this value doesn't appear in any page content, tool result, or the user's query. Use investigation tools first (inspect_hidden, execute_js, read_element) to find the correct value before typing.`,
        });
      }
    }
  }

  // Post-type_text DOM settle: detect autocomplete/dropdown appearance
  if (
    !args.pressEnter &&
    !result.includes("ServiceNow reference value committed")
  ) {
    const preCount = loop.context.getSnapshot()?.elements.length ?? 0;
    await new Promise((r) => setTimeout(r, 400));
    prevElementCount = await loop.refreshSnapshotWithRetry(tabId, preCount);
    if (prevElementCount > preCount + 2) {
      const delta = prevElementCount - preCount;
      const content =
        loop.selectedSkillId === "multi-step-form-wizard"
          ? `${delta} new elements appeared after typing or a form choice in this turn. Snapshot refreshed. Treat this as current-step state; if these are conditional fields, fill them before advancing. Do not assume they are autocomplete suggestions unless a matching option list is visible.`
          : `${delta} new elements appeared after typing (autocomplete suggestions or dropdown detected). Snapshot refreshed. IMPORTANT: Do NOT type the full value - select the matching option from the dropdown by clicking it. Typing the complete value will not register as a selection.`;
      loop.context.addMessage({
        role: "user",
        content,
      });
      loop.log.info("agent", "Post-type DOM settle: new elements detected", {
        turn: loop.turnCount,
        preCount,
        postCount: prevElementCount,
        delta,
      });
    }
  }

  return {
    prevElementCount,
    domModified,
    visuallyModified,
    lastDomAffectingToolName,
    breakLoop: false,
    completedSummary: null,
  };
}
