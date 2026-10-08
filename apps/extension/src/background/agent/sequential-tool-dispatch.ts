import { RiskLevel, ToolCall, ToolName } from "../../types";
import {
  hasRecentExactTextFieldRead,
  isFinalCommunicationClick,
} from "./action-exemption-policy";
import { assessAmbiguousChoiceClickGuard } from "./ambiguous-choice-policy";
import { assessConsequentialFinalActionBlock } from "./consequential-action-policy";
import {
  toForwardedApprovalDryRun,
  type DryRunClassification,
} from "./mutation-dry-run-policy";
import type { ForwardedApprovalDryRun } from "@shared-types/browser-bridge";
import {
  resolveToolApprovalRequest,
  TOOL_APPROVAL_DENIED_MESSAGE,
} from "./approval-enforcement";
import { TOOL_BATCH_LIMITS, TOOL_CACHE } from "./constants";
import {
  buildGroundingAbortStub,
  GroundingRejectionAbortTracker,
} from "./tool-batch-policy";
import {
  isListDetailReturnControlRepeatExempt,
} from "./list-detail-policy";
import {
  assessElementIdPreDispatch,
  assessFailedActionRepeat,
  assessPreflightElement,
  assessReadElementSameIdNudge,
  assessRedundantSuccessBlock,
  assessSamePageAnchorClick,
  assessToolCacheHit,
  type BlockedAction,
  type RecentAction,
} from "./loop-helpers";
import { applyFieldReReadTracking } from "./fill-checklist-policy";
import {
  handleCloseTabToolCall,
  handleComposeTextToolCall,
  handleCreateTabToolCall,
  handleEscalateToolCall,
  handleGenericSequentialToolCall,
  handleListTabsToolCall,
  handleSwitchTabToolCall,
  handleUpdateNotesToolCall,
  handleWaitToolCall,
  type AgentLoopToolHandlerHost,
  type GenericSequentialToolCallParams,
} from "./loop-tool-handlers";
import { isAuthoredProse, isFreeTextField } from "./writer-handoff";
import {
  advanceCompletedSubtasks,
  type AgentLoopPlanProgressHost,
} from "./loop-plan-progress";
import {
  collectTrailingToolResultMessages,
  handleSequentialVerificationGate,
} from "./parallel-tool-execution";
import {
  actionMemoryKey,
  assessRepeatAction,
  rememberRepeatAction,
} from "./repeat-action-policy";
import {
  buildApprovalBypassedStep,
  getPreToolDeniedMessage,
  shouldReportApprovalBypass,
} from "./sequential-pre-tool-gate";
import { mergeGenericSequentialToolState } from "./sequential-tool-state";
import { formatStepLabel } from "../../utils/step-labels";
import {
  assessInlineEditNavigationGuard,
  assessInlineEditTextEntryRetarget,
  assessTextEntryClickGuard,
  validateTextEntryTarget,
} from "./text-entry-guards";
import type { TrustedCompletionCandidate } from "./completion-kernel";

export interface SequentialToolDispatchHost extends AgentLoopToolHandlerHost {
  broadcastTaskProgress(currentIndex: number): void;
  ensureToolApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    riskLevel: RiskLevel,
    forceApproval: boolean,
    dryRun?: ForwardedApprovalDryRun,
  ): Promise<boolean>;
  getActiveToolProfileForStep(stepIndex: number): string | null | undefined;
  getConsequentialActionTaskText(): string;
  getPendingInlineEditVerificationBlock(
    toolName: ToolName,
    currentStepIndex: number,
  ): string | null;
  getUncommittedInlineEditDoneRejection(stepIndex: number): string | null;
  handleClarifyToolCall(
    toolCallId: string,
    args: Record<string, unknown>,
  ): Promise<void>;
  handleDoneToolCall(
    toolCallId: string,
    summary: string,
    tabId: number,
  ): Promise<boolean>;
  isRunning: boolean;
  recordSkillToolSelection(
    toolName: ToolName,
    mode: "parallel" | "sequential",
  ): void;
  requiresConsequentialActionApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
  ): boolean;
  runFormSubmitDryRun(
    toolName: ToolName,
    args: Record<string, unknown>,
    tabId: number,
  ): Promise<DryRunClassification>;
  selectedSkillId: string | null;
  syncPlanStatus(
    currentIndex: number,
    reason: "step_advanced_by_gate",
    data?: Record<string, unknown>,
  ): void;
  throwIfGracefulStopRequested(): void;
}

export interface SequentialToolDispatchState {
  tabId: number;
  prevElementCount: number;
  escalationTier: number;
  plannerModelStartTurn: number;
  orientationPhase: boolean;
  recentToolCalls: Array<{ tool: ToolName; argsKey: string }>;
  verifiedFinalClickBypassKeys: Set<string>;
  lastReadElementId: number | null;
  consecutiveReadElementSameId: number;
  blockedActions: BlockedAction[];
  recentSuccesses: RecentAction[];
  discoveredTagIds: Set<number>;
  orientationToolsUsed: Set<string>;
  domModified: boolean;
  visuallyModified: boolean;
  lastDomAffectingToolName: string | null;
  doneSignaled: boolean;
  doneSummary: string;
}

export type SequentialToolDispatchOutput = SequentialToolDispatchState;

export async function executeSequentialToolCalls(
  this: SequentialToolDispatchHost,
  params: {
    toolCalls: ToolCall[];
    repeatActionWindow: number;
    llmIntention: string | null | undefined;
    state: SequentialToolDispatchState;
    signalCompletedResult: (
      summary: string,
      options?: {
        saveCheckpoint?: boolean;
        completionCandidate?: TrustedCompletionCandidate;
      },
    ) => void;
  },
): Promise<SequentialToolDispatchOutput> {
  let {
    tabId,
    prevElementCount,
    escalationTier,
    plannerModelStartTurn,
    orientationPhase,
    lastReadElementId,
    consecutiveReadElementSameId,
    domModified,
    visuallyModified,
    lastDomAffectingToolName,
    doneSignaled,
    doneSummary,
  } = params.state;
  const {
    recentToolCalls,
    verifiedFinalClickBypassKeys,
    blockedActions,
    recentSuccesses,
    discoveredTagIds,
    orientationToolsUsed,
  } = params.state;

  const signalCompletedResult = (
    summary: string,
    options?: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    },
  ) => {
    doneSummary = summary;
    doneSignaled = true;
    params.signalCompletedResult(summary, options);
  };
  if (doneSignaled) {
    this.traceRecorder?.recordEvent(
      "sequential_tools_skipped_after_completion",
      {
        queuedToolCount: params.toolCalls.length,
        mode: "sequential",
      },
    );
    return params.state;
  }
  const sameResponseClickKeys = new Set<string>();
  const groundingAbort = new GroundingRejectionAbortTracker(
    TOOL_BATCH_LIMITS.GROUNDING_ABORT_CONSECUTIVE,
  );
  for (const [batchIndex, requestedToolCall] of params.toolCalls.entries()) {
    // Adapt dispatch inputs without rewriting the model request in history.
    const toolCall = structuredClone(requestedToolCall);
    if (!this.isRunning) break;
    this.throwIfGracefulStopRequested();

    // Parse args for risk classification and done detection
    const toolName = toolCall.function.name as ToolName;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      // Registry will handle parse error on execute
    }
    const rawArgsKey = toolCall.function.arguments.slice(0, 100);
    const argsKey = actionMemoryKey(
      toolName,
      args,
      rawArgsKey,
      this.context.getSnapshot(),
    );
    this.recordSkillToolSelection(toolName, "sequential");

    if (toolName === ToolName.CLICK_ELEMENT) {
      if (sameResponseClickKeys.has(argsKey)) {
        const message =
          "BLOCKED: duplicate click_element with the same target in one response. " +
          "Clicking can change the DOM and invalidate element IDs; call read_page before retrying the same click.";
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          content: message,
        });
        this.log.warn("agent", "Duplicate same-response click blocked", {
          turn: this.turnCount,
          tool: toolName,
          mode: "sequential",
        });
        this.traceRecorder?.recordEvent("same_response_click_blocked", {
          turn: this.turnCount,
          tool: toolName,
          mode: "sequential",
        });
        continue;
      }
      sameResponseClickKeys.add(argsKey);
    }

    const repeatActionExempt =
      isListDetailReturnControlRepeatExempt({
        selectedSkillId: this.selectedSkillId,
        toolName,
        args,
        snapshot: this.context.getSnapshot(),
      }) ||
      (this.selectedSkillId === "multi-tab-checklist-workflow" &&
        toolName === ToolName.SWITCH_TAB);
    const repeatDecision = assessRepeatAction({
      toolName,
      argsKey,
      recentToolCalls,
      isExempt: repeatActionExempt,
      allowFinalClickBypass: () =>
        !verifiedFinalClickBypassKeys.has(argsKey) &&
        hasRecentExactTextFieldRead(this.context.getMessages()) &&
        isFinalCommunicationClick({
          selectedSkillId: this.selectedSkillId,
          toolName,
          args,
          snapshot: this.context.getSnapshot(),
          originalQuery: this.originalQuery,
        }),
    });
    if (repeatDecision.action === "allow_final_click_bypass") {
      verifiedFinalClickBypassKeys.add(argsKey);
      this.log.info(
        "agent",
        "Repeat final communication click allowed after exact draft read",
        {
          turn: this.turnCount,
          tool: toolName,
          mode: "sequential",
        },
      );
      this.traceRecorder?.recordEvent("repeat_final_click_allowed", {
        turn: this.turnCount,
        tool: toolName,
        mode: "sequential",
      });
    } else if (repeatDecision.action === "block") {
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: repeatDecision.message,
      });
      this.log.warn("agent", "Repeat action blocked", {
        turn: this.turnCount,
        tool: toolName,
        repeatCount: repeatDecision.repeatCount,
        mode: "sequential",
      });
      this.traceRecorder?.recordEvent("repeat_action_blocked", {
        turn: this.turnCount,
        tool: toolName,
        repeatCount: repeatDecision.repeatCount,
        mode: "sequential",
      });
      continue;
    }
    if (repeatDecision.action !== "skip_tracking") {
      rememberRepeatAction(
        recentToolCalls,
        toolName,
        argsKey,
        params.repeatActionWindow,
      );
    }

    const readElementNudge = assessReadElementSameIdNudge({
      toolName,
      args,
      state: {
        lastReadElementId,
        consecutiveReadElementSameId,
      },
    });
    lastReadElementId = readElementNudge.state.lastReadElementId;
    consecutiveReadElementSameId =
      readElementNudge.state.consecutiveReadElementSameId;
    if (readElementNudge.nudge) {
      this.log.warn("agent", "read_element same-ID nudge", {
        turn: this.turnCount,
        elementId: readElementNudge.nudge.elementId,
        consecutive: readElementNudge.nudge.consecutive,
      });
      this.traceRecorder?.recordEvent("read_element_same_id_nudge", {
        elementId: readElementNudge.nudge.elementId,
        consecutive: readElementNudge.nudge.consecutive,
      });
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: readElementNudge.nudge.message,
      });
      continue;
    }

    // Failed-action memory: block exact repeat of a previously failed tool call
    const failedActionRepeat = assessFailedActionRepeat({
      blockedActions,
      tool: toolName,
      argsKey,
    });
    if (failedActionRepeat) {
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: failedActionRepeat.message,
      });
      this.log.warn("agent", "Failed-action repeat blocked", {
        turn: this.turnCount,
        tool: toolName,
        priorTurn: failedActionRepeat.priorTurn,
        mode: "sequential",
      });
      continue;
    }

    const cacheLookup = assessToolCacheHit({
      toolName,
      args,
      snapshot: this.context.getSnapshot(),
      toolCache: this.toolCache,
    });
    const cacheType = cacheLookup.cacheType;
    if (cacheLookup.cachedResult !== null) {
      this.log.info("agent", "Tool cache hit", {
        turn: this.turnCount,
        tool: toolName,
        mode: "sequential",
      });
      this.traceRecorder?.recordEvent("tool_cache_hit", {
        tool: toolName,
        mode: "sequential",
      });
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        // LP-17: a redundant re-read usually lands here (cache hit) — the
        // fill-checklist note must ride along or the model never sees it.
        content: applyFieldReReadTracking({
          toolName,
          args,
          result: cacheLookup.cachedResult,
          snapshot: this.context.getSnapshot(),
          ledger: this.context.getFieldReadLedger(),
          turn: this.turnCount,
        }),
      });
      continue;
    }

    const redundantSuccessBlock = assessRedundantSuccessBlock({
      recentSuccesses,
      toolName,
      argsKey,
      snapshot: this.context.getSnapshot(),
      blockThreshold: TOOL_CACHE.BLOCK_THRESHOLD,
    });
    if (redundantSuccessBlock) {
      this.log.info("agent", "Redundant action blocked", {
        turn: this.turnCount,
        tool: toolName,
        count: redundantSuccessBlock.count,
        mode: "sequential",
      });
      this.traceRecorder?.recordEvent("redundant_action_blocked", {
        tool: toolName,
        count: redundantSuccessBlock.count,
        mode: "sequential",
      });
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: redundantSuccessBlock.result,
      });
      continue;
    }

    const idPreDispatch = assessElementIdPreDispatch({
      toolName,
      args,
      snapshot: this.context.getSnapshot(),
      discoveredIds: discoveredTagIds,
      currentUrl: this.context.getCurrentUrl(),
    });
    if (idPreDispatch.error) {
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: idPreDispatch.error,
      });
      this.log.warn("agent", "Invalid element ID pre-dispatch", {
        turn: this.turnCount,
        tool: toolName,
        args: idPreDispatch.logArgs,
        mode: "sequential",
      });
      this.traceRecorder?.recordEvent(
        "grounding_mismatch",
        idPreDispatch.traceData
          ? {
              turn: this.turnCount,
              ...idPreDispatch.traceData,
              mode: "sequential",
            }
          : {},
      );
      if (groundingAbort.recordRejection()) {
        // Remaining calls are already recorded on the assistant message, so
        // each needs a tool reply before the batch stops.
        const remaining = params.toolCalls.slice(batchIndex + 1);
        for (const skipped of remaining) {
          this.context.addMessage({
            role: "tool",
            tool_call_id: skipped.id,
            content: buildGroundingAbortStub(
              TOOL_BATCH_LIMITS.GROUNDING_ABORT_CONSECUTIVE,
            ),
          });
        }
        const abortData = {
          turn: this.turnCount,
          consecutiveRejections: groundingAbort.consecutiveRejections,
          skippedCalls: remaining.length,
          mode: "sequential",
        };
        this.log.warn("agent", "Grounding rejection batch abort", abortData);
        this.traceRecorder?.recordEvent(
          "grounding_rejection_batch_abort",
          abortData,
        );
        break;
      }
      continue;
    }
    groundingAbort.recordPass();

    const samePageAnchorClick = assessSamePageAnchorClick({
      toolName,
      args,
      snapshot: this.context.getSnapshot(),
      currentUrl: this.context.getCurrentUrl(),
    });
    if (samePageAnchorClick.error) {
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: samePageAnchorClick.error,
      });
      this.log.warn("agent", "Same-page anchor click blocked", {
        turn: this.turnCount,
        tool: toolName,
        targetUrl: samePageAnchorClick.targetUrl,
        mode: "sequential",
      });
      this.traceRecorder?.recordEvent("same_page_anchor_click_blocked", {
        tool: toolName,
        targetUrl: samePageAnchorClick.targetUrl,
        mode: "sequential",
      });
      continue;
    }

    const preflight = assessPreflightElement({
      toolName,
      args,
      snapshot: this.context.getSnapshot(),
    });
    if (preflight.error) {
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: preflight.error,
      });
      this.log.warn("agent", "Preflight check failed", {
        turn: this.turnCount,
        tool: toolName,
        reason: preflight.error,
        mode: "sequential",
      });
      continue;
    }
    if (preflight.warning) {
      // Soft warning: inject as context but don't block execution
      this.context.addMessage({
        role: "user",
        content: preflight.warning,
      });
    }

    const planStatus = this.context.getPlanStatusRaw();
    const currentStepIndex = planStatus?.currentIndex ?? -1;
    if (toolName === ToolName.PRESS_KEY && typeof args.key === "string") {
      const activeObjective =
        planStatus?.subtasks[currentStepIndex]?.description ??
        this.originalQuery;
      const inlineNavigationBlock = assessInlineEditNavigationGuard({
        activeToolProfile: this.getActiveToolProfileForStep(currentStepIndex),
        selectedSkillId: this.selectedSkillId,
        snapshot: this.context.getSnapshot(),
        objectiveText: activeObjective,
        key: args.key,
      });
      if (inlineNavigationBlock) {
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          content: inlineNavigationBlock,
        });
        this.log.warn("agent", "Inline edit navigation blocked", {
          turn: this.turnCount,
          tool: toolName,
          key: args.key,
          step: currentStepIndex,
          mode: "sequential",
        });
        continue;
      }
    }

    const inlineVerificationBlock = this.getPendingInlineEditVerificationBlock(
      toolName,
      currentStepIndex,
    );
    if (inlineVerificationBlock) {
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: inlineVerificationBlock,
      });
      this.log.warn("agent", "Inline edit verification required", {
        turn: this.turnCount,
        tool: toolName,
        step: currentStepIndex,
        mode: "sequential",
      });
      continue;
    }

    if (
      toolName === ToolName.TYPE_TEXT &&
      typeof args.id === "number" &&
      typeof args.text === "string"
    ) {
      const planStatus = this.context.getPlanStatusRaw();
      const inlineRetarget = assessInlineEditTextEntryRetarget({
        activeToolProfile: this.getActiveToolProfileForStep(currentStepIndex),
        snapshot: this.context.getSnapshot(),
        targetId: args.id,
      });
      if (inlineRetarget) {
        args.id = inlineRetarget.retargetedId;
        toolCall.function.arguments = JSON.stringify(args);
        this.context.addMessage({
          role: "user",
          content: inlineRetarget.reason,
        });
      }
      const snapshot = this.context.getSnapshot();
      const target = snapshot?.elements.find((el: any) => el.tag === args.id);
      const activeObjective =
        planStatus?.subtasks[currentStepIndex]?.description ??
        this.originalQuery;
      const targetError = validateTextEntryTarget(
        activeObjective,
        target,
        args.text,
      );
      if (targetError) {
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          content: targetError,
        });
        this.log.warn("agent", "Text entry target blocked", {
          turn: this.turnCount,
          tool: toolName,
          id: args.id,
          mode: "sequential",
        });
        continue;
      }
    }

    if (toolName === ToolName.CLICK_ELEMENT && typeof args.id === "number") {
      const snapshot = this.context.getSnapshot();
      const target = snapshot?.elements.find((el: any) => el.tag === args.id);
      const planStatus = this.context.getPlanStatusRaw();
      const activeObjective =
        planStatus?.subtasks[planStatus.currentIndex]?.description ??
        this.originalQuery;
      const consequentialFinalActionBlock = assessConsequentialFinalActionBlock(
        {
          toolName,
          args,
          taskText: this.getConsequentialActionTaskText(),
          actionLabel: formatStepLabel(toolName, args, this.elementResolver),
        },
      );
      if (consequentialFinalActionBlock) {
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          content: consequentialFinalActionBlock,
        });
        this.log.warn("agent", "Consequential final action blocked", {
          turn: this.turnCount,
          tool: toolName,
          id: args.id,
          mode: "sequential",
        });
        this.traceRecorder?.recordEvent("consequential_final_action_blocked", {
          turn: this.turnCount,
          tool: toolName,
          id: args.id,
          mode: "sequential",
        });
        continue;
      }
      const textEntryClickGuard = assessTextEntryClickGuard({
        objectiveText: activeObjective,
        element: target,
        targetId: args.id,
      });
      if (textEntryClickGuard.blockReason) {
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          content: textEntryClickGuard.blockReason,
        });
        this.log.warn("agent", "Text entry click blocked", {
          turn: this.turnCount,
          tool: toolName,
          id: args.id,
          mode: "sequential",
        });
        continue;
      }

      const ambiguousChoiceGuard = assessAmbiguousChoiceClickGuard({
        toolName,
        args,
        snapshot,
        originalQuery: this.originalQuery,
        activeObjective,
      });
      if (ambiguousChoiceGuard.blockReason) {
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          content: ambiguousChoiceGuard.blockReason,
        });
        this.log.warn("agent", "Ambiguous choice click blocked", {
          turn: this.turnCount,
          tool: toolName,
          id: args.id,
          targetLabel: ambiguousChoiceGuard.targetLabel,
          choiceKind: ambiguousChoiceGuard.choiceKind,
          mode: "sequential",
        });
        continue;
      }
    }

    if (
      toolName === ToolName.CONFIGURE_CATALOG_ITEM &&
      this.selectedSkillId === "catalog-order-workflow" &&
      args.submit === true &&
      args.continueToCheckout !== true &&
      /\b(order|request|cart|checkout)\b/i.test(this.originalQuery)
    ) {
      args.continueToCheckout = true;
      toolCall.function.arguments = JSON.stringify(args);
      this.traceRecorder?.recordEvent("catalog_cart_handoff_enabled", {
        turn: this.turnCount,
        mode: "sequential",
        selectedSkillId: this.selectedSkillId,
      });
    }

    const preDecision = this.middleware.evaluatePreTool(
      toolName,
      args,
      this.turnCount,
    );
    if (!preDecision.allowed) {
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: getPreToolDeniedMessage(preDecision),
      });
      continue;
    }
    if (shouldReportApprovalBypass(preDecision)) {
      this.stepHandler(
        buildApprovalBypassedStep({
          id: crypto.randomUUID(),
          label: formatStepLabel(toolName, args, this.elementResolver),
          timestamp: Date.now(),
          toolName,
        }),
        false,
      );
    }
    const forceConsequentialActionApproval =
      this.requiresConsequentialActionApproval(toolName, args);

    // Dry-run gate (RFC LP-15 Phase 8): for a consequential form submit, capture
    // the live form and diff it against the approved draft, then ENRICH the
    // human approval with the result. It never bypasses approval — a clean
    // values-diff does not answer "should this be submitted at all", which is
    // exactly what the consequential-action approval exists to ask.
    let forwardedDryRun: ForwardedApprovalDryRun | undefined;
    if (forceConsequentialActionApproval) {
      const dryRun = await this.runFormSubmitDryRun(toolName, args, tabId);
      forwardedDryRun = toForwardedApprovalDryRun(dryRun);
      if (dryRun.kind === "clean") {
        this.stepHandler(
          {
            id: crypto.randomUUID(),
            type: "info",
            label: "Form dry-run: matches the intended values",
            status: "done",
            timestamp: Date.now(),
          },
          false,
        );
      } else if (dryRun.kind === "unexpected") {
        this.context.addMessage({
          role: "user",
          content:
            "FORM SUBMIT DRY-RUN — the form does not match the values you set out to submit:\n" +
            dryRun.rendered +
            "\nApprove only if these changes are intended; otherwise fix the form first.",
        });
      }
    }

    const approvalRequest = resolveToolApprovalRequest(
      preDecision,
      forceConsequentialActionApproval,
    );
    if (approvalRequest.requiresApproval) {
      const approved = await this.ensureToolApproval(
        toolName,
        args,
        approvalRequest.riskLevel,
        approvalRequest.forceApproval,
        forwardedDryRun,
      );
      if (!approved) {
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          content: TOOL_APPROVAL_DENIED_MESSAGE,
        });
        continue;
      }
    }

    // DONE tool — planner-validated exit
    const shouldArmInlineEditVerification =
      currentStepIndex >= 0 &&
      this.getActiveToolProfileForStep(currentStepIndex) === "edit_surface" &&
      ((toolName === ToolName.PRESS_KEY &&
        typeof args.key === "string" &&
        ["enter", "tab"].includes(String(args.key).toLowerCase()) &&
        this.getUncommittedInlineEditDoneRejection(currentStepIndex) !==
          null) ||
        (toolName === ToolName.TYPE_TEXT &&
          args.pressEnter === true &&
          this.getUncommittedInlineEditDoneRejection(currentStepIndex) !==
            null));
    if (toolName === ToolName.DONE) {
      const summary = (args.summary as string) || "Task completed.";

      if (!(await this.handleDoneToolCall(toolCall.id, summary, tabId))) {
        continue;
      }

      doneSummary = summary;
      doneSignaled = true;
      break;
    }

    // ESCALATE tool — voluntary model upgrade (de-escalates after progress)
    if (toolName === ToolName.ESCALATE) {
      const escalateState = await handleEscalateToolCall(
        this as unknown as AgentLoopToolHandlerHost,
        toolCall.id,
        args,
        tabId,
        prevElementCount,
        escalationTier,
        plannerModelStartTurn,
        orientationPhase,
      );
      escalationTier = escalateState.escalationTier;
      plannerModelStartTurn = escalateState.plannerModelStartTurn;
      orientationPhase = escalateState.orientationPhase;
      prevElementCount = escalateState.prevElementCount;
      continue;
    }

    // CLARIFY tool — ask the user a question mid-execution
    if (toolName === ToolName.CLARIFY) {
      await this.handleClarifyToolCall(toolCall.id, args);
      continue;
    }

    // COMPOSE_TEXT tool — delegate prose to the Writer specialist
    if (toolName === ToolName.COMPOSE_TEXT) {
      prevElementCount = await handleComposeTextToolCall(
        this as unknown as AgentLoopToolHandlerHost,
        toolCall.id,
        args,
        tabId,
        prevElementCount,
      );
      continue;
    }

    // Writer guard — when a Writer specialist is configured, reroute substantial
    // free-text prose typed via type_text to the Writer so it's preferred even if
    // the executor didn't call compose_text itself.
    if (
      toolName === ToolName.TYPE_TEXT &&
      typeof this.llm.hasWriterModel === "function" &&
      this.llm.hasWriterModel()
    ) {
      const fieldId = Number(args.id);
      const el =
        this.context
          .getSnapshot()
          ?.elements?.find((e: { tag: number }) => e.tag === fieldId) ?? null;
      if (
        Number.isFinite(fieldId) &&
        isFreeTextField(el) &&
        isAuthoredProse(args.text)
      ) {
        this.log.info("agent", "Rerouting type_text prose to Writer", {
          turn: this.turnCount,
          field: fieldId,
          chars: String(args.text).length,
        });
        prevElementCount = await handleComposeTextToolCall(
          this as unknown as AgentLoopToolHandlerHost,
          toolCall.id,
          { id: fieldId, executorDraft: String(args.text) },
          tabId,
          prevElementCount,
        );
        continue;
      }
    }

    // UPDATE_NOTES tool - save a note to the current run scratchpad
    if (toolName === ToolName.UPDATE_NOTES) {
      handleUpdateNotesToolCall(
        this as unknown as AgentLoopToolHandlerHost,
        toolCall.id,
        toolName,
        args,
      );
      continue;
    }

    // WAIT tool — re-orientation mechanism
    if (toolName === ToolName.WAIT) {
      prevElementCount = await handleWaitToolCall(
        this as unknown as AgentLoopToolHandlerHost,
        toolCall.id,
        toolName,
        args,
        tabId,
        prevElementCount,
      );
      continue;
    }

    // LIST_TABS — workspace-scoped
    if (toolName === ToolName.LIST_TABS) {
      await handleListTabsToolCall(
        this as unknown as AgentLoopToolHandlerHost,
        toolCall.id,
        tabId,
      );
      continue;
    }

    // SWITCH_TAB — workspace-scoped, updates loop tabId
    if (toolName === ToolName.SWITCH_TAB) {
      const switchTabState = await handleSwitchTabToolCall(
        this as unknown as AgentLoopToolHandlerHost,
        toolCall.id,
        args,
        tabId,
        prevElementCount,
      );
      tabId = switchTabState.tabId;
      prevElementCount = switchTabState.prevElementCount;
      continue;
    }

    // CLOSE_TAB — workspace-scoped, prevents closing current tab
    if (toolName === ToolName.CLOSE_TAB) {
      await handleCloseTabToolCall(
        this as unknown as AgentLoopToolHandlerHost,
        toolCall.id,
        toolName,
        args,
        tabId,
      );
      continue;
    }

    if (toolName === ToolName.CREATE_TAB) {
      await handleCreateTabToolCall(
        this as unknown as AgentLoopToolHandlerHost,
        toolCall.id,
        toolName,
        args,
        tabId,
      );
      continue;
    }

    const genericToolParams: GenericSequentialToolCallParams = {
      toolCall,
      toolName,
      args,
      tabId,
      prevElementCount,
      discoveredTagIds,
      preDecision,
      llmIntention: params.llmIntention,
      currentStepIndex,
      shouldArmInlineEditVerification,
      cacheType,
      orientationPhase,
      orientationToolsUsed,
      domModified,
      visuallyModified,
      lastDomAffectingToolName,
    };
    const genericToolState = await handleGenericSequentialToolCall(
      this as unknown as AgentLoopToolHandlerHost,
      genericToolParams,
    );
    const mergedSequentialState = mergeGenericSequentialToolState(
      {
        prevElementCount,
        domModified,
        visuallyModified,
        lastDomAffectingToolName,
      },
      genericToolState,
    );
    prevElementCount = mergedSequentialState.prevElementCount;
    domModified = mergedSequentialState.domModified;
    visuallyModified = mergedSequentialState.visuallyModified;
    lastDomAffectingToolName = mergedSequentialState.lastDomAffectingToolName;
    if (genericToolState.breakLoop) {
      signalCompletedResult(genericToolState.completedSummary || "", {
        completionCandidate: genericToolState.completionCandidate,
      });
      break;
    }
  }

  // Post-sequential verification gate check
  if (!doneSignaled) {
    handleSequentialVerificationGate({
      planStatus: this.context.getPlanStatusRaw(),
      toolResults: collectTrailingToolResultMessages(
        this.context.getMessages(),
      ),
      currentUrl: this.context.getCurrentUrl(),
      host: {
        advanceCompletedSubtasks: () =>
          advanceCompletedSubtasks(
            this as unknown as AgentLoopPlanProgressHost,
          ),
        resetConsecutiveAutoAdvances: () => {
          this.consecutiveAutoAdvances = 0;
        },
        syncPlanStatus: (currentIndex, reason, data) =>
          this.syncPlanStatus(currentIndex, reason, data),
        broadcastTaskProgress: (currentIndex) =>
          this.broadcastTaskProgress(currentIndex),
        addUserMessage: (content) =>
          this.context.addMessage({ role: "user", content }),
        logVerificationGate: (data) =>
          this.log.info("agent", "Verification gate triggered (sequential)", {
            turn: this.turnCount,
            ...data,
          }),
        recordVerificationGate: (data) =>
          this.traceRecorder?.recordEvent("verification_gate_triggered", data),
      },
    });
  }
  return {
    tabId,
    prevElementCount,
    escalationTier,
    plannerModelStartTurn,
    orientationPhase,
    recentToolCalls,
    verifiedFinalClickBypassKeys,
    lastReadElementId,
    consecutiveReadElementSameId,
    blockedActions,
    recentSuccesses,
    discoveredTagIds,
    orientationToolsUsed,
    domModified,
    visuallyModified,
    lastDomAffectingToolName,
    doneSignaled,
    doneSummary,
  };
}
