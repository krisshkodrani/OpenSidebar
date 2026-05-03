import { AgentStatus, AgentStep, ToolCall, ToolName } from "../../types";
import { DOM_MODIFYING_TOOLS, CACHEABLE_TOOLS } from "../tools/metadata";
import { sanitizeUrl } from "../security";
import { workspaceManager } from "../workspaces/manager";
import { formatStepLabel } from "./step-labels";
import { ToolResultCache } from "./tool-cache";
import type { PreToolDecision } from "./middleware";
import { STRING_LIMITS, INVESTIGATION_TOOLS } from "./constants";
import { ESCALATION_REFLECTION } from "./loop-prompts";
import { extractDiscoveredTagIds, getSnapshotFingerprint } from "./loop-helpers";

export interface AgentLoopToolHandlerHost {
  checkNavigateGuard(url: string): string | null;
  consecutiveAutoAdvances: number;
  context: any;
  disabledTools: Set<ToolName>;
  elementResolver: any;
  escalateModel(): void;
  executeToolCall(toolCall: ToolCall, tabId: number): Promise<string>;
  getWorkspaceTabIds(): Promise<number[] | null>;
  hasReadPage: boolean;
  lastDomStep: AgentStep | null;
  llm: any;
  log: any;
  maxTurns: number;
  maybeAdvanceTrustedFormFillStep(params: any): void;
  maybeAutoSubmitTrustedServiceNowForm(params: any): Promise<{
    finalSummary: string;
  } | null>;
  maybeCompleteTrustedFormSubmitStep(params: any): {
    finalSummary: string;
  } | null;
  middleware: any;
  originalQuery: string;
  pendingInlineEditVerification: {
    stepIndex: number;
    reason: string;
  } | null;
  planSubtasks: Array<{ status: string; description: string }>;
  recordMutationSensitiveAction(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
    preActionSnapshot?: unknown,
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
};

export async function handleEscalateToolCall(loop: AgentLoopToolHandlerHost,
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

export function handleUpdateNotesToolCall(loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  toolName: ToolName,
  args: Record<string, unknown>,
): void {
  const note = (args.note as string) || "";
  loop.context.appendWorkingNote(note);
  loop.trackListDetailToolSuccess(
    toolName,
    args,
    loop.context.getSnapshot(),
  );
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

export async function handleWaitToolCall(loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  toolName: ToolName,
  args: Record<string, unknown>,
  tabId: number,
  prevElementCount: number,
): Promise<number> {
  const seconds = Math.min(Math.max((args.seconds as number) || 2, 1), 10);
  const reason = (args.reason as string) || "";

  // Signal WAITING status so the UI activity indicator stays visible
  loop.statusHandler(
    AgentStatus.WAITING_FOR_PAGE_LOAD,
    `Waiting ${seconds}s…`,
  );
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
  parts.push(`\nReview the above → observe the page → decide your next action.`);

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

export function handleNavigateGuardToolCall(loop: AgentLoopToolHandlerHost,
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

export async function handleListTabsToolCall(loop: AgentLoopToolHandlerHost,
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
      tabLines = tabs.map(
        (t) =>
          `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.id === tabId ? " [current]" : ""}`,
      );
    }
  } else {
    // No workspace - show all tabs (fallback)
    const allTabs = await chrome.tabs.query({});
    tabLines = allTabs.map(
      (t: any) =>
        `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.id === tabId ? " [current]" : ""}`,
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

export async function handleSwitchTabToolCall(loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  args: Record<string, unknown>,
  tabId: number,
  prevElementCount: number,
): Promise<{ tabId: number; prevElementCount: number }> {
  if (loop.shouldBlockTabManagementTools()) {
    const blockedMessage =
      "Blocked: switch_tab requires explicit user instruction to manage tabs. " +
      "Stay on the current tab unless the user asks for tab switching. " +
      "Tab management tools disabled for this session.";
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: blockedMessage,
    });
    for (const tabTool of [
      ToolName.CREATE_TAB,
      ToolName.SWITCH_TAB,
      ToolName.CLOSE_TAB,
      ToolName.CREATE_WINDOW,
    ]) {
      loop.disabledTools.add(tabTool);
    }
    loop.log.warn(
      "agent",
      "switch_tab blocked - not explicitly requested, tab tools disabled",
      {
        turn: loop.turnCount,
        originalQuery: loop.originalQuery,
      },
    );
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

export async function handleCloseTabToolCall(loop: AgentLoopToolHandlerHost,
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
      "Blocked: close_tab requires explicit user instruction to manage tabs. " +
      "Tab management tools disabled for this session.";
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: blockedMessage,
    });
    for (const tabTool of [
      ToolName.CREATE_TAB,
      ToolName.SWITCH_TAB,
      ToolName.CLOSE_TAB,
      ToolName.CREATE_WINDOW,
    ]) {
      loop.disabledTools.add(tabTool);
    }
    loop.log.warn(
      "agent",
      "close_tab blocked - not explicitly requested, tab tools disabled",
      {
        turn: loop.turnCount,
        originalQuery: loop.originalQuery,
      },
    );
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

export async function handleCreateTabToolCall(loop: AgentLoopToolHandlerHost,
  toolCallId: string,
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<void> {
  if (loop.replayMutationSensitiveAction(toolCallId, toolName, args)) {
    return;
  }
  if (loop.shouldBlockTabManagementTools()) {
    const blockedMessage =
      "Blocked: create_tab requires explicit user instruction to open additional tabs. " +
      "Tab management tools disabled for this session.";
    loop.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: blockedMessage,
    });
    for (const tabTool of [
      ToolName.CREATE_TAB,
      ToolName.SWITCH_TAB,
      ToolName.CLOSE_TAB,
      ToolName.CREATE_WINDOW,
    ]) {
      loop.disabledTools.add(tabTool);
    }
    loop.log.warn(
      "agent",
      "create_tab blocked - not explicitly requested, tab tools disabled",
      {
        turn: loop.turnCount,
        originalQuery: loop.originalQuery,
      },
    );
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

export async function handleGenericSequentialToolCall(loop: AgentLoopToolHandlerHost,params: {
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
}): Promise<{
  prevElementCount: number;
  domModified: boolean;
  visuallyModified: boolean;
  lastDomAffectingToolName: string | null;
  breakLoop: boolean;
  completedSummary: string | null;
}> {
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
    const toolMs = Date.now() - toolStep.timestamp;
    // Track tag IDs discovered by find_element
    for (const id of extractDiscoveredTagIds(toolName, result)) {
      discoveredTagIds.add(id);
    }
    loop.middleware.evaluatePostTool(
      toolName,
      result,
      null,
      toolMs,
      loop.turnCount,
    );
    loop.stepHandler(
      {
        ...toolStep,
        status: "done",
        durationMs: toolMs,
      },
      true,
    );
    loop.log.info("tools", `${toolName} OK`, {
      turn: loop.turnCount,
      tool: toolName,
      risk: preDecision.riskLevel,
      mode: "sequential",
      args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
      result: result.slice(0, STRING_LIMITS.RESULT_LOG),
      durationMs: toolMs,
      intention: llmIntention,
    });
    loop.traceRecorder?.recordToolExecution(
      toolCall.id,
      toolName,
      args,
      result,
      true,
      toolMs,
      preDecision.riskLevel,
    );
    if (
      loop.pendingInlineEditVerification &&
      loop.pendingInlineEditVerification.stepIndex === currentStepIndex &&
      [ToolName.READ_PAGE, ToolName.READ_ELEMENT, ToolName.FIND_ELEMENT].includes(
        toolName,
      )
    ) {
      loop.pendingInlineEditVerification = null;
    } else if (shouldArmInlineEditVerification) {
      loop.pendingInlineEditVerification = {
        stepIndex: currentStepIndex,
        reason: "You likely just committed an inline edit on this step.",
      };
    }
    loop.recordMutationSensitiveAction(
      toolName,
      args,
      result,
      preActionSnapshot,
    );
  } catch (toolError: any) {
    if (toolError.name === "AbortError") throw toolError;
    const errorMsg = toolError.message || String(toolError);
    const toolMs = Date.now() - toolStep.timestamp;
    loop.middleware.evaluatePostTool(
      toolName,
      null,
      errorMsg,
      toolMs,
      loop.turnCount,
    );
    loop.log.error("tools", `${toolName} FAIL`, {
      turn: loop.turnCount,
      tool: toolName,
      risk: preDecision.riskLevel,
      mode: "sequential",
      args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
      error: errorMsg,
      durationMs: toolMs,
      intention: llmIntention,
    });
    loop.traceRecorder?.recordToolExecution(
      toolCall.id,
      toolName,
      args,
      errorMsg,
      false,
      toolMs,
      preDecision.riskLevel,
      errorMsg,
    );
    loop.stepHandler(
      {
        ...toolStep,
        status: "error",
        durationMs: toolMs,
        errorMessage: errorMsg,
      },
      true,
    );
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

  // Track read_page / xray_page for done() content verification guard
  if (toolName === ToolName.READ_PAGE || toolName === ToolName.XRAY_PAGE) {
    loop.hasReadPage = true;
  }
  if (toolName === ToolName.READ_PAGE) {
    const aggregateNote = loop.updateMoneyTableAggregate(result);
    if (aggregateNote) {
      result = `${result}\n\n${aggregateNote}`;
    }
  }

  // Cache store (Feature 1): cache successful results for cacheable tools
  if (cacheType && !result.startsWith("Error:")) {
    const fp = getSnapshotFingerprint(loop.context.getSnapshot());
    loop.toolCache.set(
      ToolResultCache.key(toolName, args),
      result,
      fp,
      cacheType,
    );
  }

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
    };
  }

  // Trigger B: Blind input detection — warn when type_text value has no evidence
  loop.maybeAdvanceTrustedFormFillStep({
    toolName,
    toolArgs: args,
    toolResult: result,
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
      loop.context.addMessage({
        role: "user",
        content: `${delta} new elements appeared after typing (autocomplete suggestions or dropdown detected). Snapshot refreshed. IMPORTANT: Do NOT type the full value — select the matching option from the dropdown by clicking it. Typing the complete value will not register as a selection.`,
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

