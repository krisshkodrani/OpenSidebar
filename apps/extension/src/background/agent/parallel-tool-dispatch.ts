import { AgentStep, ToolCall, ToolName } from "../../types";
import { resolveProfileFields } from "../infrastructure/backend-client";
import { DOM_MODIFYING_TOOLS } from "../tools/metadata";
import {
  hasRecentExactTextFieldRead,
  isFinalCommunicationClick,
} from "./action-exemption-policy";
import { assessAmbiguousChoiceClickGuard } from "./ambiguous-choice-policy";
import {
  assessCatalogOrderConfigurationClick,
  assessCatalogOrderPostConfirmationClick,
} from "./catalog-order-policy";
import { INVESTIGATION_TOOLS, TOOL_CACHE } from "./constants";
import {
  assessListDetailWorkflow,
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
import {
  recordFailedToolExecution,
  recordSuccessfulToolExecution,
  storeSuccessfulToolResult,
  toolProvidesPageGrounding,
  type AgentLoopToolHandlerHost,
} from "./loop-tool-handlers";
import type { PreToolDecision } from "./middleware";
import type { ParallelToolExecutionResult } from "./parallel-tool-execution";
import {
  assessProfileLiteralTextRewrite,
  collectProfileRecordSetsFromValues,
  getProfileLiteralFallbackFields,
} from "./profile-literal-guards";
import {
  actionMemoryKey,
  assessRepeatAction,
  rememberRepeatAction,
} from "./repeat-action-policy";
import { getPreToolDeniedReason } from "./sequential-pre-tool-gate";
import { formatStepLabel } from "./step-labels";
import {
  assessAutocompleteTextRewrite,
  assessInlineEditTextEntryRetarget,
  assessTextEntryClickGuard,
  validateTextEntryTarget,
} from "./text-entry-guards";
import { shouldCheckWorkflowTabRedirect } from "./workflow-tab-controller";

type ToolExecutionMode = "parallel" | "sequential";

export interface ParallelToolDispatchHost extends AgentLoopToolHandlerHost {
  getActiveToolProfileForStep(stepIndex: number): string | null | undefined;
  getWorkflowTabToolRedirect(params: {
    toolName: ToolName;
    args: Record<string, unknown>;
    currentTabId: number;
  }): Promise<string | null>;
  recordSkillToolSelection(toolName: ToolName, mode: ToolExecutionMode): void;
  selectedSkillId: string | null;
  listDetailOpenedTargets: Set<string>;
  listDetailReviewedTargets: Set<string>;
  listDetailVisibleActionCount: number;
}

export interface ParallelToolDispatchState {
  recentToolCalls: Array<{ tool: ToolName; argsKey: string }>;
  verifiedFinalClickBypassKeys: Set<string>;
  lastReadElementId: number | null;
  consecutiveReadElementSameId: number;
  blockedActions: BlockedAction[];
  recentSuccesses: RecentAction[];
  discoveredTagIds: Set<number>;
  orientationPhase: boolean;
  orientationToolsUsed: Set<string>;
  domModified: boolean;
  visuallyModified: boolean;
  lastDomAffectingToolName: string | null;
}

export interface ParallelToolDispatchOutput {
  results: ParallelToolExecutionResult[];
  state: ParallelToolDispatchState;
}

export async function executeParallelToolCalls(
  host: ParallelToolDispatchHost,
  params: {
    toolCalls: ToolCall[];
    tabId: number;
    state: ParallelToolDispatchState;
    repeatActionWindow: number;
    llmIntention: string | null | undefined;
  },
): Promise<ParallelToolDispatchOutput> {
  const { tabId, state } = params;
  const results = await Promise.all(
    params.toolCalls.map(async (toolCall) => {
      const toolName = toolCall.function.name as ToolName;
      const rawArgsKey = toolCall.function.arguments.slice(0, 100);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // Registry will handle parse error on execute.
      }
      const argsKey = actionMemoryKey(
        toolName,
        args,
        rawArgsKey,
        host.context.getSnapshot(),
      );
      host.recordSkillToolSelection(toolName, "parallel");

      const repeatActionExempt =
        isListDetailReturnControlRepeatExempt({
          selectedSkillId: host.selectedSkillId,
          toolName,
          args,
          snapshot: host.context.getSnapshot(),
        }) ||
        (host.selectedSkillId === "multi-tab-checklist-workflow" &&
          toolName === ToolName.SWITCH_TAB);
      const repeatDecision = assessRepeatAction({
        toolName,
        argsKey,
        recentToolCalls: state.recentToolCalls,
        isExempt: repeatActionExempt,
        allowFinalClickBypass: () =>
          !state.verifiedFinalClickBypassKeys.has(argsKey) &&
          hasRecentExactTextFieldRead(host.context.getMessages()) &&
          isFinalCommunicationClick({
            selectedSkillId: host.selectedSkillId,
            toolName,
            args,
            snapshot: host.context.getSnapshot(),
            originalQuery: host.originalQuery,
          }),
      });
      if (repeatDecision.action === "allow_final_click_bypass") {
        state.verifiedFinalClickBypassKeys.add(argsKey);
        host.log.info(
          "agent",
          "Repeat final communication click allowed after exact draft read",
          {
            turn: host.turnCount,
            tool: toolName,
            mode: "parallel",
          },
        );
        host.traceRecorder?.recordEvent("repeat_final_click_allowed", {
          turn: host.turnCount,
          tool: toolName,
          mode: "parallel",
        });
      } else if (repeatDecision.action === "block") {
        host.log.warn("agent", "Repeat action blocked", {
          turn: host.turnCount,
          tool: toolName,
          repeatCount: repeatDecision.repeatCount,
          mode: "parallel",
        });
        host.traceRecorder?.recordEvent("repeat_action_blocked", {
          turn: host.turnCount,
          tool: toolName,
          repeatCount: repeatDecision.repeatCount,
          mode: "parallel",
        });
        return { toolCall, result: repeatDecision.message, error: null };
      }
      if (repeatDecision.action !== "skip_tracking") {
        rememberRepeatAction(
          state.recentToolCalls,
          toolName,
          argsKey,
          params.repeatActionWindow,
        );
      }

      const readElementNudge = assessReadElementSameIdNudge({
        toolName,
        args,
        state: {
          lastReadElementId: state.lastReadElementId,
          consecutiveReadElementSameId: state.consecutiveReadElementSameId,
        },
      });
      state.lastReadElementId = readElementNudge.state.lastReadElementId;
      state.consecutiveReadElementSameId =
        readElementNudge.state.consecutiveReadElementSameId;
      if (readElementNudge.nudge) {
        host.log.warn("agent", "read_element same-ID nudge", {
          turn: host.turnCount,
          elementId: readElementNudge.nudge.elementId,
          consecutive: readElementNudge.nudge.consecutive,
        });
        host.traceRecorder?.recordEvent("read_element_same_id_nudge", {
          elementId: readElementNudge.nudge.elementId,
          consecutive: readElementNudge.nudge.consecutive,
        });
        return {
          toolCall,
          result: readElementNudge.nudge.message,
          error: null,
        };
      }

      const failedActionRepeat = assessFailedActionRepeat({
        blockedActions: state.blockedActions,
        tool: toolName,
        argsKey,
      });
      if (failedActionRepeat) {
        host.log.warn("agent", "Failed-action repeat blocked", {
          turn: host.turnCount,
          tool: toolName,
          priorTurn: failedActionRepeat.priorTurn,
          mode: "parallel",
        });
        return {
          toolCall,
          result: null,
          error: failedActionRepeat.message,
        };
      }

      const cacheLookup = assessToolCacheHit({
        toolName,
        args,
        snapshot: host.context.getSnapshot(),
        toolCache: host.toolCache,
      });
      const cacheType = cacheLookup.cacheType;
      if (cacheLookup.cachedResult !== null) {
        host.log.info("agent", "Tool cache hit", {
          turn: host.turnCount,
          tool: toolName,
          mode: "parallel",
        });
        host.traceRecorder?.recordEvent("tool_cache_hit", {
          tool: toolName,
          mode: "parallel",
        });
        return {
          toolCall,
          result: cacheLookup.cachedResult,
          error: null,
        };
      }

      const redundantSuccessBlock = assessRedundantSuccessBlock({
        recentSuccesses: state.recentSuccesses,
        toolName,
        argsKey,
        snapshot: host.context.getSnapshot(),
        blockThreshold: TOOL_CACHE.BLOCK_THRESHOLD,
      });
      if (redundantSuccessBlock) {
        host.log.info("agent", "Redundant action blocked", {
          turn: host.turnCount,
          tool: toolName,
          count: redundantSuccessBlock.count,
          mode: "parallel",
        });
        host.traceRecorder?.recordEvent("redundant_action_blocked", {
          tool: toolName,
          count: redundantSuccessBlock.count,
          mode: "parallel",
        });
        return {
          toolCall,
          result: redundantSuccessBlock.result,
          error: null,
        };
      }

      const idPreDispatch = assessElementIdPreDispatch({
        toolName,
        args,
        snapshot: host.context.getSnapshot(),
        discoveredIds: state.discoveredTagIds,
        currentUrl: host.context.getCurrentUrl(),
      });
      if (idPreDispatch.error) {
        host.log.warn("agent", "Invalid element ID pre-dispatch", {
          turn: host.turnCount,
          tool: toolName,
          args: idPreDispatch.logArgs,
          mode: "parallel",
        });
        host.traceRecorder?.recordEvent(
          "grounding_mismatch",
          idPreDispatch.traceData
            ? {
                turn: host.turnCount,
                ...idPreDispatch.traceData,
                mode: "parallel",
              }
            : {},
        );
        return {
          toolCall,
          result: null,
          error: idPreDispatch.error,
        };
      }

      const samePageAnchorClick = assessSamePageAnchorClick({
        toolName,
        args,
        snapshot: host.context.getSnapshot(),
        currentUrl: host.context.getCurrentUrl(),
      });
      if (samePageAnchorClick.error) {
        host.log.warn("agent", "Same-page anchor click blocked", {
          turn: host.turnCount,
          tool: toolName,
          targetUrl: samePageAnchorClick.targetUrl,
          mode: "parallel",
        });
        host.traceRecorder?.recordEvent("same_page_anchor_click_blocked", {
          tool: toolName,
          targetUrl: samePageAnchorClick.targetUrl,
          mode: "parallel",
        });
        return {
          toolCall,
          result: null,
          error: samePageAnchorClick.error,
        };
      }

      const preflight = assessPreflightElement({
        toolName,
        args,
        snapshot: host.context.getSnapshot(),
      });
      if (preflight.error) {
        host.log.warn("agent", "Preflight check failed", {
          turn: host.turnCount,
          tool: toolName,
          reason: preflight.error,
          mode: "parallel",
        });
        return { toolCall, result: null, error: preflight.error };
      }

      const currentSnapshot = host.context.getSnapshot();
      const listDetailWorkflow = assessListDetailWorkflow({
        selectedSkillId: host.selectedSkillId,
        query: host.originalQuery,
        toolName,
        args,
        snapshot: currentSnapshot,
        reviewedTargets: host.listDetailReviewedTargets,
        openedTargets: host.listDetailOpenedTargets,
        previousVisibleDetailActionCount: host.listDetailVisibleActionCount,
      });
      host.listDetailVisibleActionCount =
        listDetailWorkflow.visibleDetailActionCount;
      if (listDetailWorkflow.block) {
        host.log.warn("agent", "List-detail workflow tool blocked", {
          turn: host.turnCount,
          tool: toolName,
          mode: "parallel",
        });
        host.traceRecorder?.recordEvent("list_detail_workflow_tool_blocked", {
          turn: host.turnCount,
          tool: toolName,
          mode: "parallel",
          openedDetailCount: host.listDetailOpenedTargets.size,
          reviewedDetailCount: host.listDetailReviewedTargets.size,
          visibleDetailActionCount: host.listDetailVisibleActionCount,
        });
        return {
          toolCall,
          result: listDetailWorkflow.block,
          error: null,
        };
      }

      if (
        toolName === ToolName.TYPE_TEXT &&
        typeof args.id === "number" &&
        typeof args.text === "string"
      ) {
        const planStatus = host.context.getPlanStatusRaw();
        const currentStepIndex = planStatus?.currentIndex ?? -1;
        const inlineRetarget = assessInlineEditTextEntryRetarget({
          activeToolProfile: host.getActiveToolProfileForStep(currentStepIndex),
          snapshot: host.context.getSnapshot(),
          targetId: args.id,
        });
        if (inlineRetarget) {
          args.id = inlineRetarget.retargetedId;
          toolCall.function.arguments = JSON.stringify(args);
          host.context.addMessage({
            role: "user",
            content: inlineRetarget.reason,
          });
        }
        const snapshot = host.context.getSnapshot();
        const target = snapshot?.elements.find((el: any) => el.tag === args.id);
        const activeObjective =
          planStatus?.subtasks[currentStepIndex]?.description ??
          host.originalQuery;
        const targetError = validateTextEntryTarget(
          activeObjective,
          target,
          args.text,
        );
        if (targetError) {
          host.log.warn("agent", "Text entry target blocked", {
            turn: host.turnCount,
            tool: toolName,
            id: args.id,
            mode: "parallel",
          });
          return { toolCall, result: null, error: targetError };
        }
        let profileLiteralRewrite = assessProfileLiteralTextRewrite({
          selectedSkillId: host.selectedSkillId,
          messages: host.context.getMessages(),
          element: target,
          text: args.text,
        });
        if (!profileLiteralRewrite) {
          const fallbackFields = getProfileLiteralFallbackFields(target);
          if (fallbackFields.length > 0) {
            const resolvedProfile = await resolveProfileFields(fallbackFields);
            if (resolvedProfile) {
              profileLiteralRewrite = assessProfileLiteralTextRewrite({
                selectedSkillId: host.selectedSkillId,
                messages: [],
                recordSets: collectProfileRecordSetsFromValues(
                  resolvedProfile.values,
                ),
                element: target,
                text: args.text,
              });
            }
          }
        }
        if (profileLiteralRewrite) {
          args.text = profileLiteralRewrite.rewrittenText;
          toolCall.function.arguments = JSON.stringify(args);
          host.context.addMessage({
            role: "user",
            content: profileLiteralRewrite.reason,
          });
          host.log.info("agent", "Profile literal text rewrite applied", {
            turn: host.turnCount,
            tool: toolName,
            id: args.id,
            skillId: host.selectedSkillId,
            mode: "parallel",
          });
          host.traceRecorder?.recordEvent("profile_literal_text_rewrite", {
            turn: host.turnCount,
            tool: toolName,
            id: args.id,
            skillId: host.selectedSkillId ?? "unknown",
            mode: "parallel",
          });
        }
      }

      if (toolName === ToolName.CLICK_ELEMENT && typeof args.id === "number") {
        const snapshot = host.context.getSnapshot();
        const target = snapshot?.elements.find((el: any) => el.tag === args.id);
        const catalogConfirmationClickBlock =
          assessCatalogOrderPostConfirmationClick({
            selectedSkillId: host.selectedSkillId,
            toolName,
            args,
            snapshot,
          }) ||
          assessCatalogOrderConfigurationClick({
            selectedSkillId: host.selectedSkillId,
            toolName,
            args,
            snapshot,
            originalQuery: host.originalQuery,
          });
        if (catalogConfirmationClickBlock) {
          host.log.warn("agent", "Catalog confirmation drill-in click blocked", {
            turn: host.turnCount,
            tool: toolName,
            id: args.id,
            mode: "parallel",
          });
          host.traceRecorder?.recordEvent(
            "catalog_confirmation_drill_in_blocked",
            {
              turn: host.turnCount,
              tool: toolName,
              id: args.id,
              mode: "parallel",
            },
          );
          return {
            toolCall,
            result: null,
            error: catalogConfirmationClickBlock,
          };
        }
        const planStatus = host.context.getPlanStatusRaw();
        const activeObjective =
          planStatus?.subtasks[planStatus.currentIndex]?.description ??
          host.originalQuery;
        const textEntryClickGuard = assessTextEntryClickGuard({
          objectiveText: activeObjective,
          element: target,
          targetId: args.id,
        });
        if (textEntryClickGuard.blockReason) {
          host.log.warn("agent", "Text entry click blocked", {
            turn: host.turnCount,
            tool: toolName,
            id: args.id,
            explicitValue: textEntryClickGuard.explicitValue,
            mode: "parallel",
          });
          return {
            toolCall,
            result: null,
            error: textEntryClickGuard.blockReason,
          };
        }

        const ambiguousChoiceGuard = assessAmbiguousChoiceClickGuard({
          toolName,
          args,
          snapshot,
          originalQuery: host.originalQuery,
          activeObjective,
        });
        if (ambiguousChoiceGuard.blockReason) {
          host.log.warn("agent", "Ambiguous choice click blocked", {
            turn: host.turnCount,
            tool: toolName,
            id: args.id,
            targetLabel: ambiguousChoiceGuard.targetLabel,
            choiceKind: ambiguousChoiceGuard.choiceKind,
            mode: "parallel",
          });
          return {
            toolCall,
            result: null,
            error: ambiguousChoiceGuard.blockReason,
          };
        }
      }

      if (shouldCheckWorkflowTabRedirect(toolName)) {
        const workflowRedirect = await host.getWorkflowTabToolRedirect({
          toolName,
          args,
          currentTabId: tabId,
        });
        if (workflowRedirect) {
          host.log.info(
            "agent",
            "Workflow tab controller redirected tool call",
            {
              turn: host.turnCount,
              tool: toolName,
              mode: "parallel",
              skillId: host.selectedSkillId,
            },
          );
          return {
            toolCall,
            result: workflowRedirect,
            error: null,
          };
        }
      }

      let autocompleteRewriteReason: string | null = null;
      if (toolName === ToolName.TYPE_TEXT && args.id != null) {
        const snapshot = host.context.getSnapshot();
        const targetId = Number(args.id);
        const target = Number.isFinite(targetId)
          ? snapshot?.elements.find((el: any) => el.tag === targetId)
          : null;
        const planStatus = host.context.getPlanStatusRaw();
        const activeObjective =
          planStatus?.subtasks[planStatus.currentIndex]?.description ??
          host.originalQuery;
        const rewrite = assessAutocompleteTextRewrite({
          objectiveText: activeObjective,
          originalQuery: host.originalQuery,
          element: target,
          args,
        });
        if (rewrite) {
          args.text = rewrite.rewrittenText;
          toolCall.function.arguments = JSON.stringify(args);
          autocompleteRewriteReason = rewrite.reason;
        }
      }

      const preDecision = host.middleware.evaluatePreTool(
        toolName,
        args,
        host.turnCount,
      ) as PreToolDecision;

      const toolStep: AgentStep = {
        id: crypto.randomUUID(),
        type: "tool",
        label: formatStepLabel(toolName, args, host.elementResolver),
        detail: JSON.stringify(args),
        toolName,
        status: "running",
        timestamp: Date.now(),
      };
      host.stepHandler(toolStep, false);

      if (!preDecision.allowed) {
        const deniedReason = getPreToolDeniedReason(
          preDecision,
          `Tool ${toolName} denied by middleware`,
        );
        const toolMs = Date.now() - toolStep.timestamp;
        host.stepHandler(
          {
            ...toolStep,
            status: "error",
            durationMs: toolMs,
            errorMessage: deniedReason,
          },
          true,
        );
        return {
          toolCall,
          result: null,
          error: deniedReason,
        };
      }

      try {
        const preActionSnapshot = host.context.getSnapshot();
        let result = await host.executeToolCall(toolCall, tabId);
        if (autocompleteRewriteReason) {
          result = `${result}\n${autocompleteRewriteReason}`;
        }
        host.trackListDetailToolSuccess(toolName, args, preActionSnapshot);
        const toolMs = recordSuccessfulToolExecution(host, {
          toolCall,
          toolName,
          args,
          result,
          toolStep,
          preDecision,
          discoveredTagIds: state.discoveredTagIds,
          llmIntention: params.llmIntention,
          mode: "parallel",
        });

        if (
          DOM_MODIFYING_TOOLS.has(toolName) &&
          !result.includes("Click intercepted")
        ) {
          state.domModified = true;
          if (toolName !== ToolName.READ_PAGE) {
            state.visuallyModified = true;
            state.lastDomAffectingToolName = toolName;
          }
          host.lastDomStep = {
            ...toolStep,
            status: "done",
            durationMs: toolMs,
          };
        }

        if (toolProvidesPageGrounding(toolName)) {
          host.hasReadPage = true;
        }
        if (toolName === ToolName.READ_PAGE) {
          host.hasExplicitPageRead = true;
        }

        storeSuccessfulToolResult(host, { toolName, args, result, cacheType });

        if (state.orientationPhase && INVESTIGATION_TOOLS.has(toolName)) {
          state.orientationToolsUsed.add(toolName);
        }

        return { toolCall, result, error: null };
      } catch (toolError: any) {
        if (toolError.name === "AbortError") throw toolError;
        const errorMsg = toolError.message || String(toolError);
        recordFailedToolExecution(host, {
          toolCall,
          toolName,
          args,
          errorMsg,
          toolStep,
          preDecision,
          llmIntention: params.llmIntention,
          mode: "parallel",
        });
        return { toolCall, result: null, error: errorMsg };
      }
    }),
  );

  return { results, state };
}
