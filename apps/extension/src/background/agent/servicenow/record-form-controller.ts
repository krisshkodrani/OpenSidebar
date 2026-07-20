/**
 * ServiceNow record-form controller (quarantined adapter; extracted from
 * loop.ts — the LP-15 "SN behavior in agent/loop.ts" residue).
 *
 * The trusted fill → verify → submit → retry workflow for ServiceNow record
 * forms, plus the intent/workflow classifiers and the missing-field
 * infeasibility assessment it gates on. Extracted verbatim from AgentLoop via
 * the dispatch-host idiom — every host member is a real AgentLoop
 * field/method, so the loop passes `this`; behavior-preserving. Grounded in
 * stable platform semantics (record-form and module-navigation vocabulary),
 * never task ids or seeds.
 */

import {
  AgentStatus,
  AgentStep,
  RiskLevel,
  SessionMetrics,
  SubtaskSummary,
  ToolCall,
  ToolName,
} from "../../../types";
import type { logger, SessionScopedLogger } from "../../../utils";
import { waitForDomReady } from "../../tab-ready";
import type { ContextManager } from "../context";
import type { LLMClient } from "../../llm";
import { TraceRecorder } from "../trace";
import type { PlanStep } from "../planner";
import type { LoopResult } from "../loop-types";
import type { TurnToolOutcomeRecord } from "../turn-tool-outcomes";
import type {
  CompletionEnvelope,
  TrustedCompletionCandidate,
} from "../completion-kernel";
import { extractFieldValuePairs } from "../task-contract";
import {
  detectTrustedFormFillStepCompletion,
} from "../loop-helpers";
import {
  buildServiceNowMissingFieldInfeasibleSummary,
  extractServiceNowFormMissingFieldLabels,
  extractServiceNowModuleRequest,
  resolveServiceNowCreateRecordUrlFromCurrentList,
  serviceNowFieldSearchTokens,
  type ServiceNowMissingFieldSearchEvidence,
} from "./trusted-workflow-adapter";
import {
  buildServiceNowSubmitDeferralMessage,
  isServiceNowSubmitHardRejected,
  isServiceNowSubmitRejected,
  isServiceNowSubmitStayedOnCreateForm,
} from "./submit-diagnostics-policy";

function isNegativeFindElementResult(result: string): boolean {
  return /\bText ".+?" not found on this page\./i.test(result);
}

function isNegativeInspectHiddenResult(result: string): boolean {
  return /\bNo hidden elements found matching\b/i.test(result);
}

/**
 * The AgentLoop surface the record-form controller drives. Every member is a
 * real AgentLoop field/method; the loop passes `this`.
 */
export interface ServiceNowRecordFormHost {
  turnCount: number;
  readonly originalQuery: string;
  readonly selectedSkillId: string | null;
  readonly planSteps: PlanStep[];
  readonly planSubtasks: SubtaskSummary[];
  readonly context: ContextManager;
  readonly llm: LLMClient;
  readonly traceRecorder: TraceRecorder | null;
  readonly log: typeof logger | SessionScopedLogger;
  readonly completedResult: {
    outcome: "completed";
    summary: string;
    completionEnvelope?: CompletionEnvelope;
  } | null;
  statusHandler: (status: AgentStatus, detail: string) => void;
  stepHandler: (step: AgentStep, update: boolean) => void;
  executeToolCall(toolCall: ToolCall, tabId: number): Promise<string>;
  completeTaskResult(
    summary: string,
    options?: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    },
  ): void;
  getMetrics(): SessionMetrics;
  maybeAdvanceTrustedFormFillStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): boolean;
  maybeCompleteTrustedFormSubmitStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): {
    finalSummary: string;
    newIndex: number;
    completionCandidate: TrustedCompletionCandidate;
  } | null;
}

export function hasTrustedServiceNowSubmitIntent(
  host: ServiceNowRecordFormHost,
  text?: string,
): boolean {
  const intentText =
    text ??
    `${host.originalQuery}\n${host.planSteps
      .map((step) => `${step.objective}\n${step.successCriteria ?? ""}`)
      .join("\n")}`;
  if (
    /\b(?:do not submit|not submit|ready to submit|submit action has not been clicked|has not been submitted)\b/i.test(
      intentText,
    )
  ) {
    return false;
  }
  if (
    /\b(?:submit the form|form submission completes|submitted record|created record|created\/updated record|confirmation|resulting item page)\b/i.test(
      intentText,
    )
  ) {
    return true;
  }
  return /\bcreate\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:incident|change request|problem|record|user|hardware asset|asset)\b/i.test(
    intentText,
  );
}

export function hasTaskLevelServiceNowSubmitIntent(
  host: ServiceNowRecordFormHost,
): boolean {
  const text = `${host.originalQuery}\n${host.planSteps
    .map((step) => `${step.objective}\n${step.successCriteria ?? ""}`)
    .join("\n")}`;
  if (
    /\b(?:submit the form|form submission completes|submitted record|created record|created\/updated record|confirmation|resulting item page)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:do not submit|not submit|ready to submit|submit action has not been clicked|has not been submitted)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return /\bcreate\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:incident|change request|problem|record|user|hardware asset|asset)\b/i.test(
    text,
  );
}

function currentServiceNowPlanStepForbidsSubmit(
  host: ServiceNowRecordFormHost,
): boolean {
  const plan = host.context.getPlanStatusRaw();
  if (
    !plan ||
    plan.currentIndex < 0 ||
    plan.currentIndex >= plan.subtasks.length
  ) {
    return false;
  }
  const currentSubtask = plan.subtasks[plan.currentIndex];
  const currentStep = host.planSteps[plan.currentIndex];
  const localText = [
    currentSubtask?.description,
    currentStep?.objective,
    currentStep?.successCriteria,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return /\b(?:do not submit|not submit|submit action has not been clicked|has not been submitted)\b/i.test(
    localText,
  );
}

export function isTaskLevelServiceNowRecordWorkflow(
  host: ServiceNowRecordFormHost,
): boolean {
  const text = getServiceNowRecordWorkflowText(host);
  if (
    host.selectedSkillId === "servicenow-record-form" &&
    /\bObjective:\s*Complete the workflow for the original request\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (extractFieldValuePairs(text).length === 0) return false;
  const hasRecordIntent =
    /\b(?:create|new|submit|submitted|created record|confirmation)\b/i.test(
      text,
    );
  const hasRecordLanguage =
    /\b(?:ServiceNow|incident|change request|problem|record|user|hardware asset|asset)\b/i.test(
      text,
    );
  if (!hasRecordIntent || !hasRecordLanguage) return false;
  if (host.selectedSkillId === "servicenow-record-form") return true;

  const snapshot = host.context.getSnapshot();
  const groundedInServiceNow =
    /service-now\.com|servicenow\.com/i.test(
      `${host.context.getCurrentUrl() ?? ""}\n${snapshot?.url ?? ""}`,
    ) ||
    /\b(?:Create|New record)\b[\s\S]{0,80}\b(?:Incident|Problem|Change Request|User|Hardware Asset)\b/i.test(
      `${snapshot?.title ?? ""}\n${snapshot?.pageContent ?? ""}`,
    );
  if (!groundedInServiceNow) return false;

  return !/\b(?:service catalog|catalog item|request item|cart|checkout|list filter|sort list|dashboard|chart)\b/i.test(
    text,
  );
}

function isLikelyServiceNowRecordFieldWorkflow(
  host: ServiceNowRecordFormHost,
): boolean {
  const text = getServiceNowRecordWorkflowText(host);
  if (extractFieldValuePairs(text).length === 0) return false;
  if (
    host.selectedSkillId === "servicenow-record-form" &&
    isTaskLevelServiceNowRecordWorkflow(host)
  ) {
    return true;
  }

  const snapshot = host.context.getSnapshot();
  const url = `${host.context.getCurrentUrl() ?? ""}\n${snapshot?.url ?? ""}`;
  const pageText = [
    snapshot?.title,
    snapshot?.visibleContent,
    snapshot?.pageContent,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  const hasRecordIntent =
    /\b(?:create|new|submit|submitted|created record|confirmation)\b/i.test(
      text,
    );
  const hasServiceNowGrounding =
    /\bServiceNow\b/i.test(text) ||
    /service-now\.com|servicenow\.com/i.test(url) ||
    /\b(?:User|Incident|Problem|Change Request)\b/i.test(pageText);

  return hasRecordIntent && hasServiceNowGrounding;
}

function getServiceNowRecordWorkflowText(
  host: ServiceNowRecordFormHost,
): string {
  return [
    host.originalQuery,
    ...host.planSteps.flatMap((step) => [
      step.objective,
      step.successCriteria ?? "",
    ]),
    ...host.planSubtasks.map((subtask) => subtask.description),
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

export function isRetryableServiceNowModuleControllerMiss(
  result: string,
): boolean {
  return (
    /^Error:/i.test(result) &&
    /\b(?:lookup_timeout|metadata_unavailable|navigator_candidate_not_found|snapshot_[a-z_]*not_found|bridge|content script|timeout)\b/i.test(
      result,
    )
  );
}

async function executeServiceNowRecordControllerTool(
  host: ServiceNowRecordFormHost,
  params: {
    tabId: number;
    args: Record<string, unknown>;
    label: string;
    eventName: string;
  },
): Promise<{ toolCall: ToolCall; result: string; ok: boolean }> {
  const traceArgs = JSON.parse(JSON.stringify(params.args)) as Record<
    string,
    unknown
  >;
  const toolCall: ToolCall = {
    id: `controller_${crypto.randomUUID()}`,
    type: "function",
    function: {
      name: ToolName.CONFIGURE_SERVICENOW_FORM,
      arguments: JSON.stringify(traceArgs),
    },
  } as ToolCall;
  const toolStep: AgentStep = {
    id: crypto.randomUUID(),
    type: "tool",
    label: params.label,
    detail: JSON.stringify(traceArgs),
    toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
    status: "running",
    timestamp: Date.now(),
  };

  host.stepHandler(toolStep, false);
  host.traceRecorder?.recordEvent(params.eventName, {
    turn: host.turnCount,
    trustedTool: ToolName.CONFIGURE_SERVICENOW_FORM,
    fieldCount: Array.isArray(traceArgs.fields) ? traceArgs.fields.length : 0,
    submit: traceArgs.submit === true,
  });

  const startedAt = Date.now();
  let result = "";
  let ok = false;
  try {
    result = await host.executeToolCall(toolCall, params.tabId);
    ok = !result.startsWith("Error:");
  } catch (error) {
    result = `Error: ${error instanceof Error ? error.message : String(error)}`;
    ok = false;
  }
  const durationMs = Date.now() - startedAt;

  host.stepHandler(
    {
      ...toolStep,
      status: ok ? "done" : "error",
      durationMs,
      ...(ok ? {} : { errorMessage: result }),
    },
    true,
  );
  host.traceRecorder?.recordToolExecution(
    toolCall.id,
    ToolName.CONFIGURE_SERVICENOW_FORM,
    traceArgs,
    result,
    ok,
    durationMs,
    RiskLevel.MEDIUM,
    ok ? undefined : result,
  );
  host.context.addMessage({
    role: "tool",
    content: result,
    tool_call_id: toolCall.id,
  });

  return { toolCall, result, ok };
}

function isServiceNowRecordFormLoadMiss(result: string): boolean {
  return /could not find a servicenow record form|no servicenow record form|record form .*not.*found/i.test(
    result,
  );
}

export function assessServiceNowMissingFieldInfeasibility(
  host: ServiceNowRecordFormHost,
  toolOutcomes: TurnToolOutcomeRecord[],
  searchEvidence: Map<string, ServiceNowMissingFieldSearchEvidence>,
): string | null {
  if (!isLikelyServiceNowRecordFieldWorkflow(host)) return null;
  if (!hasTaskLevelServiceNowSubmitIntent(host)) return null;

  const fields = extractFieldValuePairs(
    getServiceNowRecordWorkflowText(host),
  );
  if (fields.length === 0) return null;

  for (const field of fields) {
    const label = field.field.replace(/\s+/g, " ").trim();
    if (!label) continue;
    const evidence =
      searchEvidence.get(label) ??
      ({
        findMisses: 0,
        hiddenFullLabelMiss: false,
        hiddenMissTokens: new Set<string>(),
        configureFieldMissing: false,
      } satisfies ServiceNowMissingFieldSearchEvidence);
    const tokens = serviceNowFieldSearchTokens(label);

    for (const outcome of toolOutcomes) {
      if (outcome.toolName === ToolName.CONFIGURE_SERVICENOW_FORM) {
        if (
          extractServiceNowFormMissingFieldLabels(outcome.resultContent)
            .map((missing) => missing.toLowerCase())
            .includes(label.toLowerCase())
        ) {
          evidence.configureFieldMissing = true;
        }
        continue;
      }

      if (outcome.toolName === ToolName.FIND_ELEMENT) {
        const text =
          typeof outcome.args.text === "string" ? outcome.args.text : "";
        if (
          text.trim().toLowerCase() === label.toLowerCase() &&
          isNegativeFindElementResult(outcome.resultContent)
        ) {
          evidence.findMisses += 1;
        }
        continue;
      }

      if (outcome.toolName === ToolName.INSPECT_HIDDEN) {
        const pattern =
          typeof outcome.args.pattern === "string"
            ? outcome.args.pattern.trim().toLowerCase()
            : "";
        if (
          pattern === label.toLowerCase() &&
          isNegativeInspectHiddenResult(outcome.resultContent)
        ) {
          evidence.hiddenFullLabelMiss = true;
          continue;
        }
        if (
          pattern &&
          tokens.includes(pattern) &&
          isNegativeInspectHiddenResult(outcome.resultContent)
        ) {
          evidence.hiddenMissTokens.add(pattern);
        }
      }
    }

    searchEvidence.set(label, evidence);
    const hiddenSearchCovered =
      tokens.length > 0 &&
      tokens.every((token) => evidence.hiddenMissTokens.has(token));
    if (
      evidence.configureFieldMissing ||
      (evidence.hiddenFullLabelMiss && evidence.hiddenMissTokens.size > 0) ||
      (evidence.hiddenFullLabelMiss && hiddenSearchCovered) ||
      (evidence.findMisses > 0 &&
        (hiddenSearchCovered ||
          evidence.hiddenFullLabelMiss ||
          evidence.hiddenMissTokens.size > 0)) ||
      evidence.findMisses >= 2
    ) {
      return buildServiceNowMissingFieldInfeasibleSummary([label]);
    }
  }

  return null;
}

export function getServiceNowMissingFieldAdmissionSummary(
  host: ServiceNowRecordFormHost,
  text: string | null,
): string | null {
  if (!text) return null;
  if (!isLikelyServiceNowRecordFieldWorkflow(host)) return null;
  if (!hasTaskLevelServiceNowSubmitIntent(host)) return null;

  const lower = text.toLowerCase();
  const hasStrongMissingFieldAdmission =
    /\bfield (?:doesn't|does not|didn't|did not) exist\b/.test(lower) ||
    /\b(?:couldn't|could not|cannot|can't) find\b[\s\S]{0,120}\bfield\b/.test(
      lower,
    ) ||
    /\bfield\b[\s\S]{0,80}\bnot found\b[\s\S]{0,80}\bform\b/.test(lower) ||
    /\bhelper\b[\s\S]{0,120}\b(?:couldn't|could not|cannot|can't) find\b/.test(
      lower,
    );
  if (!hasStrongMissingFieldAdmission) return null;

  const fields = extractFieldValuePairs(
    getServiceNowRecordWorkflowText(host),
  );
  const missing = fields.find((field) =>
    lower.includes(field.field.toLowerCase()),
  );
  return missing
    ? buildServiceNowMissingFieldInfeasibleSummary([missing.field])
    : null;
}

export function startServiceNowRecordControllerTraceTurn(
  host: ServiceNowRecordFormHost,
  fieldCount: number,
): void {
  if (!host.traceRecorder) return;

  const messages = host.context.getPrompt();
  const metrics = host.context.getPromptMetricsFrom(messages);
  const snap = host.context.getSnapshot();
  const systemContent =
    messages.length > 0 && messages[0].role === "system"
      ? typeof messages[0].content === "string"
        ? messages[0].content
        : ""
      : "";
  const cachedPrefixLength = systemContent.indexOf("## Page Context");
  const droppedMessageCount = Math.max(
    0,
    host.context.getHistoryLength() - (messages.length - 1),
  );

  host.traceRecorder.startTurn(
    host.turnCount,
    {
      url: snap?.url || "",
      title: snap?.title || "",
      elementCount: metrics.elementCount,
      visibleContentLength: snap?.visibleContent?.length || 0,
      pageContentLength: snap?.pageContent?.length || 0,
      scrollY: snap?.scroll?.y || 0,
    },
    snap?.elements || [],
    metrics.systemTokens + metrics.historyTokens,
    1,
    host.llm.getCurrentModel(),
    metrics.compressionLevel,
    TraceRecorder.toTraceMessages(messages),
    {
      systemTokens: metrics.systemTokens,
      historyTokens: metrics.historyTokens,
      totalTokens: metrics.totalTokens,
      maxTokens: metrics.maxTokens,
      utilization: metrics.utilization,
      droppedMessageCount,
      compressionLevel: metrics.compressionLevel,
      cachedPrefixLength: cachedPrefixLength >= 0 ? cachedPrefixLength : 0,
    },
    host.llm.isPlannerTier() ? "planner" : "executor",
  );
  host.traceRecorder.recordEvent("servicenow_record_controller_started", {
    turn: host.turnCount,
    fieldCount,
    trustedTool: ToolName.CONFIGURE_SERVICENOW_FORM,
  });
}

export async function maybeRunServiceNowRecordFormController(
  host: ServiceNowRecordFormHost,
  tabId: number,
): Promise<LoopResult | null> {
  if (!isTaskLevelServiceNowRecordWorkflow(host)) return null;
  if (!hasTaskLevelServiceNowSubmitIntent(host)) return null;
  if (currentServiceNowPlanStepForbidsSubmit(host)) return null;

  const workflowText = getServiceNowRecordWorkflowText(host);
  const fields = extractFieldValuePairs(workflowText);
  if (fields.length === 0) return null;
  const moduleRequest = extractServiceNowModuleRequest(workflowText);

  host.statusHandler(AgentStatus.ACTING, "Configuring ServiceNow form...");
  host.log.info("agent", "ServiceNow record form controller started", {
    turn: host.turnCount,
    fieldCount: fields.length,
  });

  host.turnCount++;
  startServiceNowRecordControllerTraceTurn(host, fields.length);
  try {
    const fillArgs = { fields, submit: false };
    let fill = await executeServiceNowRecordControllerTool(host, {
      tabId,
      args: fillArgs,
      label: "Configure ServiceNow form",
      eventName: "servicenow_record_controller_fill_started",
    });
    let fillSignal = detectTrustedFormFillStepCompletion({
      toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
      toolArgs: fillArgs,
      toolResult: fill.result,
    });
    if (
      (!fill.ok || !fillSignal) &&
      isServiceNowRecordFormLoadMiss(fill.result) &&
      moduleRequest
    ) {
      const navigationArgs = {
        application: moduleRequest.application,
        path: moduleRequest.path,
      };
      const navigationToolCall: ToolCall = {
        id: `controller_${crypto.randomUUID()}`,
        type: "function",
        function: {
          name: ToolName.OPEN_SERVICENOW_MODULE,
          arguments: JSON.stringify(navigationArgs),
        },
      } as ToolCall;
      host.traceRecorder?.recordEvent(
        "servicenow_record_controller_navigation_started",
        {
          turn: host.turnCount,
          application: moduleRequest.application,
          path: moduleRequest.path,
        },
      );
      const navigationStartedAt = Date.now();
      const navigationResult = await host.executeToolCall(
        navigationToolCall,
        tabId,
      );
      const navigationOk = !navigationResult.startsWith("Error:");
      host.traceRecorder?.recordToolExecution(
        navigationToolCall.id,
        ToolName.OPEN_SERVICENOW_MODULE,
        navigationArgs,
        navigationResult,
        navigationOk,
        Date.now() - navigationStartedAt,
        RiskLevel.MEDIUM,
        navigationOk ? undefined : navigationResult,
      );
      host.context.addMessage({
        role: "tool",
        content: navigationResult,
        tool_call_id: navigationToolCall.id,
      });
      if (navigationOk) {
        await waitForDomReady(tabId, {
          timeoutMs: 1_500,
          waitForElements: true,
        });
        fill = await executeServiceNowRecordControllerTool(host, {
          tabId,
          args: fillArgs,
          label: "Configure ServiceNow form after module navigation",
          eventName:
            "servicenow_record_controller_fill_after_navigation_started",
        });
        fillSignal = detectTrustedFormFillStepCompletion({
          toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
          toolArgs: fillArgs,
          toolResult: fill.result,
        });
        if (
          (!fill.ok || !fillSignal) &&
          isServiceNowRecordFormLoadMiss(fill.result)
        ) {
          const createRecordUrl =
            await resolveServiceNowCreateRecordUrlFromCurrentList(tabId);
          if (createRecordUrl) {
            const navigateArgs = { url: createRecordUrl };
            const navigateToolCall: ToolCall = {
              id: `controller_${crypto.randomUUID()}`,
              type: "function",
              function: {
                name: ToolName.NAVIGATE,
                arguments: JSON.stringify(navigateArgs),
              },
            } as ToolCall;
            host.traceRecorder?.recordEvent(
              "servicenow_record_controller_create_navigation_started",
              {
                turn: host.turnCount,
                url: createRecordUrl,
              },
            );
            const createNavigationStartedAt = Date.now();
            const createNavigationResult = await host.executeToolCall(
              navigateToolCall,
              tabId,
            );
            const createNavigationOk =
              !createNavigationResult.startsWith("Error:");
            host.traceRecorder?.recordToolExecution(
              navigateToolCall.id,
              ToolName.NAVIGATE,
              navigateArgs,
              createNavigationResult,
              createNavigationOk,
              Date.now() - createNavigationStartedAt,
              RiskLevel.MEDIUM,
              createNavigationOk ? undefined : createNavigationResult,
            );
            host.context.addMessage({
              role: "tool",
              content: createNavigationResult,
              tool_call_id: navigateToolCall.id,
            });
            if (createNavigationOk) {
              await waitForDomReady(tabId, {
                timeoutMs: 2_000,
                waitForElements: true,
              });
              fill = await executeServiceNowRecordControllerTool(host, {
                tabId,
                args: fillArgs,
                label:
                  "Configure ServiceNow form after opening create record",
                eventName:
                  "servicenow_record_controller_fill_after_create_navigation_started",
              });
              fillSignal = detectTrustedFormFillStepCompletion({
                toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
                toolArgs: fillArgs,
                toolResult: fill.result,
              });
            }
          }
        }
      }
    }
    const maxFormLoadRetries = 5;
    for (
      let attempt = 1;
      (!fill.ok || !fillSignal) &&
      isServiceNowRecordFormLoadMiss(fill.result) &&
      attempt <= maxFormLoadRetries;
      attempt++
    ) {
      host.traceRecorder?.recordEvent(
        "servicenow_record_controller_fill_retry_queued",
        {
          turn: host.turnCount,
          attempt,
          reason: "form_not_ready",
        },
      );
      await waitForDomReady(tabId, {
        timeoutMs: 750 + attempt * 500,
        waitForElements: true,
      });
      fill = await executeServiceNowRecordControllerTool(host, {
        tabId,
        args: fillArgs,
        label: `Configure ServiceNow form (retry ${attempt})`,
        eventName: "servicenow_record_controller_fill_retry_started",
      });
      fillSignal = detectTrustedFormFillStepCompletion({
        toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
        toolArgs: fillArgs,
        toolResult: fill.result,
      });
    }
    if (!fill.ok || !fillSignal) {
      const missingFieldLabels = extractServiceNowFormMissingFieldLabels(
        fill.result,
      );
      if (missingFieldLabels.length > 0) {
        const summary =
          buildServiceNowMissingFieldInfeasibleSummary(missingFieldLabels);
        host.traceRecorder?.recordEvent(
          "servicenow_record_controller_infeasible",
          {
            turn: host.turnCount,
            phase: "fill",
            missingFieldLabels,
          },
        );
        host.completeTaskResult(summary);
        return {
          outcome: "completed",
          turnCount: host.turnCount,
          summary,
          failure: { category: "none", code: "none" },
          metrics: host.getMetrics(),
        };
      }
      host.traceRecorder?.recordEvent(
        "servicenow_record_controller_deferred",
        {
          turn: host.turnCount,
          phase: "fill",
          reason: fill.ok ? "untrusted_fill_result" : "tool_error",
        },
      );
      host.context.addMessage({
        role: "user",
        content:
          "The ServiceNow record form controller could not verify every requested field. Continue manually, using configure_servicenow_form again after correcting missing or mismatched fields.",
      });
      return null;
    }

    host.maybeAdvanceTrustedFormFillStep({
      toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
      toolArgs: fillArgs,
      toolResult: fill.result,
      mode: "sequential",
    });

    const submitArgs = { submit: true, submitButton: "Submit" };
    const submit = await executeServiceNowRecordControllerTool(host, {
      tabId,
      args: submitArgs,
      label: "Submit ServiceNow form",
      eventName: "servicenow_record_controller_submit_started",
    });
    let completion = host.maybeCompleteTrustedFormSubmitStep({
      toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
      toolArgs: submitArgs,
      toolResult: submit.result,
      mode: "sequential",
    });

    const submitRejected = isServiceNowSubmitRejected(submit.result);
    const submitStayedOnCreateForm = isServiceNowSubmitStayedOnCreateForm(
      submit.result,
    );
    // A hard validation rejection won't resolve by resubmitting identical
    // values; the controller still tries its single refill+retry, but on a
    // persistent rejection it surfaces a diagnostic instead of inviting the
    // agent to resubmit on a loop (see buildServiceNowSubmitDeferralMessage).
    const submitHardRejected = isServiceNowSubmitHardRejected(submit.result);
    if (
      submit.ok &&
      !completion &&
      (!submitRejected || submitStayedOnCreateForm)
    ) {
      host.traceRecorder?.recordEvent(
        "servicenow_record_controller_submit_retry_queued",
        {
          turn: host.turnCount,
          reason: submitStayedOnCreateForm
            ? "same_create_form_after_submit"
            : "untrusted_submit_result",
        },
      );
      await waitForDomReady(tabId, { timeoutMs: 500, waitForElements: true });

      const refill = await executeServiceNowRecordControllerTool(host, {
        tabId,
        args: fillArgs,
        label: "Recheck ServiceNow form",
        eventName: "servicenow_record_controller_refill_started",
      });
      const refillSignal = detectTrustedFormFillStepCompletion({
        toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
        toolArgs: fillArgs,
        toolResult: refill.result,
      });
      if (refill.ok && refillSignal) {
        host.traceRecorder?.recordEvent(
          "servicenow_record_controller_submit_retry_ready",
          {
            turn: host.turnCount,
            fieldCount: fields.length,
          },
        );
        const retrySubmit = await executeServiceNowRecordControllerTool(
          host,
          {
            tabId,
            args: submitArgs,
            label: "Retry ServiceNow submit",
            eventName: "servicenow_record_controller_submit_retry_started",
          },
        );
        completion = host.maybeCompleteTrustedFormSubmitStep({
          toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
          toolArgs: submitArgs,
          toolResult: retrySubmit.result,
          mode: "sequential",
        });
      } else {
        host.traceRecorder?.recordEvent(
          "servicenow_record_controller_submit_retry_abandoned",
          {
            turn: host.turnCount,
            reason: refill.ok
              ? "untrusted_refill_result"
              : "refill_tool_error",
          },
        );
      }
    } else if (submit.ok && !completion && submitRejected) {
      const reason = submitHardRejected ? "submit_hard_validation_rejection" : "submit_rejected_by_servicenow"; // prettier-ignore
      host.traceRecorder?.recordEvent(
        "servicenow_record_controller_submit_retry_abandoned",
        { turn: host.turnCount, reason },
      );
    }
    if (!submit.ok || !completion) {
      const reason = !submit.ok ? "tool_error" : submitHardRejected ? "submit_hard_validation_rejection" : "untrusted_submit_result"; // prettier-ignore
      host.traceRecorder?.recordEvent(
        "servicenow_record_controller_deferred",
        { turn: host.turnCount, phase: "submit", reason },
      );
      host.context.addMessage({
        role: "user",
        content: buildServiceNowSubmitDeferralMessage(
          submit.result,
          submitHardRejected,
        ),
      });
      return null;
    }

    const summary = completion.finalSummary;
    host.completeTaskResult(summary, {
      completionCandidate: completion.completionCandidate,
    });
    host.traceRecorder?.recordEvent(
      "servicenow_record_controller_completed",
      {
        turn: host.turnCount,
        summary,
      },
    );

    return {
      outcome: "completed",
      turnCount: host.turnCount,
      summary,
      failure: { category: "none", code: "none" },
      metrics: host.getMetrics(),
      completionEnvelope: host.completedResult?.completionEnvelope,
    };
  } finally {
    await host.traceRecorder?.endTurn();
  }
}

export function shouldAutoSubmitTrustedServiceNowForm(
  host: ServiceNowRecordFormHost,
  params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  },
): boolean {
  if (host.selectedSkillId !== "servicenow-record-form") return false;
  if (!isTaskLevelServiceNowRecordWorkflow(host)) return false;
  if (!hasTaskLevelServiceNowSubmitIntent(host)) return false;
  if (currentServiceNowPlanStepForbidsSubmit(host)) return false;
  const signal = detectTrustedFormFillStepCompletion({
    toolName: params.toolName,
    toolArgs: params.toolArgs,
    toolResult: params.toolResult,
  });
  if (!signal) return false;
  const missingFields = getMissingTrustedServiceNowAutoSubmitFields(
    host,
    params,
  );
  if (missingFields.length > 0) {
    host.traceRecorder?.recordEvent("trusted_form_auto_submit_blocked", {
      turn: host.turnCount,
      reason: "missing_requested_fields",
      missingFields,
      trustedTool: ToolName.CONFIGURE_SERVICENOW_FORM,
    });
    return false;
  }
  return true;
}

function getMissingTrustedServiceNowAutoSubmitFields(
  host: ServiceNowRecordFormHost,
  params: {
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  },
): string[] {
  const expectedFields = extractFieldValuePairs(
    getServiceNowRecordWorkflowText(host),
  );
  if (expectedFields.length === 0) return [];

  const normalizeField = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9 _-]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const normalizeValue = (value: string) => {
    let normalized = value.trim();
    if (/^\((empty|none|null)\)$/i.test(normalized)) return "";
    normalized = normalized
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/^'([\s\S]*)'$/, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return normalized;
  };
  const configuredRows = [
    ...params.toolResult.matchAll(
      /(?:^|\n)- (.+?)\s+\(([^)]+)\) =\s*([\s\S]*?)(?=\n- .+?\s+\([^)]+\) =|\nServiceNow form fields discovered|\nCurrent URL|\nCurrent title|\nMismatches:|$)/g,
    ),
  ].map((match) => ({
    field: match[1] ?? "",
    systemName: match[2] ?? "",
    value: match[3] ?? "",
  }));

  return expectedFields
    .filter((expected) => {
      const expectedField = normalizeField(expected.field);
      if (!expectedField) return true;
      const row = configuredRows.find(
        (entry) =>
          normalizeField(entry.field) === expectedField ||
          normalizeField(entry.systemName) === expectedField,
      );
      if (!row) return true;
      const expectedValue = normalizeValue(expected.value);
      if (!expectedValue) {
        return normalizeValue(row.value) !== "";
      }
      const actualValue = normalizeValue(row.value);
      if (actualValue === expectedValue) return false;
      if (
        actualValue.length >= 3 &&
        (expectedValue.includes(actualValue) ||
          actualValue.includes(expectedValue))
      ) {
        return false;
      }
      return true;
    })
    .map((field) => field.field);
}

export async function maybeAutoSubmitTrustedServiceNowForm(
  host: ServiceNowRecordFormHost,
  params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    tabId: number;
    mode: "parallel" | "sequential";
  },
): Promise<{
  finalSummary: string;
  newIndex: number;
  completionCandidate: TrustedCompletionCandidate;
} | null> {
  if (!shouldAutoSubmitTrustedServiceNowForm(host, params)) return null;

  const submitArgs = { submit: true, submitButton: "Submit" };
  const submitToolCall: ToolCall = {
    id: `auto_${crypto.randomUUID()}`,
    type: "function",
    function: {
      name: ToolName.CONFIGURE_SERVICENOW_FORM,
      arguments: JSON.stringify(submitArgs),
    },
  } as ToolCall;
  const toolStep: AgentStep = {
    id: crypto.randomUUID(),
    type: "tool",
    label: "Submit ServiceNow form",
    detail: JSON.stringify(submitArgs),
    toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
    status: "running",
    timestamp: Date.now(),
  };
  host.stepHandler(toolStep, false);
  host.log.info("agent", "Auto-submitting trusted ServiceNow form", {
    turn: host.turnCount,
    mode: params.mode,
  });
  host.traceRecorder?.recordEvent("trusted_form_auto_submit_started", {
    turn: host.turnCount,
    mode: params.mode,
    trustedTool: ToolName.CONFIGURE_SERVICENOW_FORM,
  });

  const startedAt = Date.now();
  const result = await host.executeToolCall(submitToolCall, params.tabId);
  const durationMs = Date.now() - startedAt;
  host.stepHandler(
    {
      ...toolStep,
      status: "done",
      durationMs,
    },
    true,
  );
  host.traceRecorder?.recordToolExecution(
    submitToolCall.id,
    ToolName.CONFIGURE_SERVICENOW_FORM,
    submitArgs,
    result,
    true,
    durationMs,
    RiskLevel.MEDIUM,
  );
  host.context.addMessage({
    role: "tool",
    content: result,
    tool_call_id: submitToolCall.id,
  });

  return host.maybeCompleteTrustedFormSubmitStep({
    toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
    toolArgs: submitArgs,
    toolResult: result,
    mode: params.mode,
  });
}
