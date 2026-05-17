import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const RUN_TRACE_DIR = resolve(PROJECT_ROOT, "traces", "runs");

const STATE_CHANGING_TOOLS = new Set([
  "click_element",
  "click_coordinates",
  "type_text",
  "set_checkbox",
  "select_option",
  "press_key",
  "drag_and_drop",
  "hide_element",
  "dismiss_overlays",
  "navigate",
  "open_servicenow_module",
  "go_back",
  "create_tab",
  "close_tab",
  "switch_tab",
  "create_window",
  "execute_js",
  "upload_file",
  "apply_list_filter",
  "apply_list_sort",
  "apply_list_action",
  "configure_catalog_item",
  "configure_servicenow_form",
]);

const PAGE_READ_TOOLS = new Set([
  "read_page",
  "read_element",
  "find_element",
  "xray_page",
]);

export type E2EVideoTraceMetrics = {
  schemaVersion: "2026-05-14";
  traceCount: number;
  runIds: string[];
  executorTurns: number;
  perceptionTurns: number;
  pageReadTurns: number;
  verificationReadTurns: number;
  toolCallCount: number;
  toolExecutionCount: number;
  toolCounts: Record<string, number>;
  repeatedSameToolTurns: number;
  escalationCount: number;
  missingToolEscalationCount: number;
  rejectedEscalationCount: number;
  toolProfileAppliedCount: number;
  readsBeforeFirstStateChangingAction: number;
  firstStateChangingAction: {
    toolName: string;
    turnNumber: number | null;
    timestamp: string | null;
    delayMsFromTaskStart: number | null;
  } | null;
  verification: {
    decisions: Record<string, number>;
    retryDecisions: number;
  };
  llmUsage: {
    executorPromptTokens: number;
    executorCompletionTokens: number;
    executorTotalTokens: number;
    runTotalTokens: number | null;
    totalCostUsd: number | null;
    executorLlmDurationMs: number;
  };
  durations: {
    runDurationMs: number | null;
    taskStartedAt: string | null;
    taskCompletedAt: string | null;
  };
};

function resolveProjectPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(PROJECT_ROOT, filePath);
}

function readJsonl(filePath: string): any[] {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function toolCallName(toolCall: any): string {
  return String(toolCall?.function?.name ?? toolCall?.name ?? "");
}

function parseToolCallArgs(toolCall: any): Record<string, unknown> {
  const raw = toolCall?.function?.arguments;
  if (typeof raw !== "string") return toolCall?.args ?? {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function hasPageInterpretation(entry: any): boolean {
  const messages = Array.isArray(entry?.llmRequest?.messages)
    ? entry.llmRequest.messages
    : [];
  return messages.some((message: any) => {
    const content = message?.content;
    if (typeof content === "string")
      return content.includes("Page Interpretation");
    if (!Array.isArray(content)) return false;
    return content.some(
      (part) =>
        part?.type === "text" &&
        typeof part?.text === "string" &&
        part.text.includes("Page Interpretation"),
    );
  });
}

function isMissingToolEscalation(toolCall: any): boolean {
  const args = parseToolCallArgs(toolCall);
  const reason = typeof args.reason === "string" ? args.reason : "";
  const reasonCode =
    typeof args.reasonCode === "string" ? args.reasonCode.toLowerCase() : "";
  return (
    reasonCode === "missing_tool" ||
    /\b(?:missing|unavailable|not available|do(?:es)? not have|don't have|cannot use|can't use|without|no)\b[\s\S]{0,120}\b(?:tool|capability|function|api|action)\b/i.test(
      reason,
    )
  );
}

function isoFromEntry(entry: any): string | null {
  if (typeof entry?.recordedAt === "string") return entry.recordedAt;
  if (typeof entry?.ts === "string") return entry.ts;
  if (typeof entry?.timestamp === "number") {
    return new Date(entry.timestamp).toISOString();
  }
  return null;
}

function msFromIso(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function collectE2EVideoTraceMetrics(
  traceFiles: string[] | undefined,
): E2EVideoTraceMetrics {
  const tracePaths = (traceFiles ?? [])
    .map(resolveProjectPath)
    .filter((filePath) => existsSync(filePath));
  const runIds = new Set<string>();
  const toolCounts: Record<string, number> = {};
  const verificationDecisions: Record<string, number> = {};
  let executorTurns = 0;
  let perceptionTurns = 0;
  let pageReadTurns = 0;
  let verificationReadTurns = 0;
  let toolCallCount = 0;
  let toolExecutionCount = 0;
  let repeatedSameToolTurns = 0;
  let escalationCount = 0;
  let missingToolEscalationCount = 0;
  let rejectedEscalationCount = 0;
  let toolProfileAppliedCount = 0;
  let readsBeforeFirstStateChangingAction = 0;
  let executorPromptTokens = 0;
  let executorCompletionTokens = 0;
  let executorTotalTokens = 0;
  let executorLlmDurationMs = 0;
  let previousToolSignature = "";
  let firstStateChangingAction: E2EVideoTraceMetrics["firstStateChangingAction"] =
    null;

  for (const tracePath of tracePaths) {
    for (const entry of readJsonl(tracePath)) {
      executorTurns += 1;
      if (typeof entry?.runId === "string") runIds.add(entry.runId);
      if (hasPageInterpretation(entry)) perceptionTurns += 1;

      const usage = entry?.llmResponse?.usage;
      if (typeof usage?.prompt_tokens === "number") {
        executorPromptTokens += usage.prompt_tokens;
      }
      if (typeof usage?.completion_tokens === "number") {
        executorCompletionTokens += usage.completion_tokens;
      }
      if (typeof usage?.total_tokens === "number") {
        executorTotalTokens += usage.total_tokens;
      }
      if (typeof entry?.llmResponse?.durationMs === "number") {
        executorLlmDurationMs += entry.llmResponse.durationMs;
      }

      const toolCalls = Array.isArray(entry?.llmResponse?.toolCalls)
        ? entry.llmResponse.toolCalls
        : [];
      const toolExecutions = Array.isArray(entry?.toolExecutions)
        ? entry.toolExecutions
        : [];
      toolCallCount += toolCalls.length;
      toolExecutionCount += toolExecutions.length;

      const callNames = toolCalls.map(toolCallName).filter(Boolean);
      const executionNames = toolExecutions
        .map((execution: any) => String(execution?.toolName ?? ""))
        .filter(Boolean);
      const names = executionNames.length > 0 ? executionNames : callNames;
      const signature = names.join(",");
      if (signature && signature === previousToolSignature) {
        repeatedSameToolTurns += 1;
      }
      previousToolSignature = signature;

      const uniqueTurnNames = new Set(names);
      for (const name of names) {
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
      }
      if ([...uniqueTurnNames].some((name) => PAGE_READ_TOOLS.has(name))) {
        pageReadTurns += 1;
        if (firstStateChangingAction) verificationReadTurns += 1;
        else readsBeforeFirstStateChangingAction += 1;
      }
      if ([...uniqueTurnNames].includes("escalate")) escalationCount += 1;
      for (const toolCall of toolCalls) {
        if (
          toolCallName(toolCall) === "escalate" &&
          isMissingToolEscalation(toolCall)
        ) {
          missingToolEscalationCount += 1;
        }
      }

      for (const event of Array.isArray(entry?.events) ? entry.events : []) {
        if (event?.type === "tool_profile_applied")
          toolProfileAppliedCount += 1;
        if (event?.type === "escalation_rejected") rejectedEscalationCount += 1;
      }

      if (!firstStateChangingAction) {
        const firstTool = [...uniqueTurnNames].find((name) =>
          STATE_CHANGING_TOOLS.has(name),
        );
        if (firstTool) {
          firstStateChangingAction = {
            toolName: firstTool,
            turnNumber:
              typeof entry?.turnNumber === "number" ? entry.turnNumber : null,
            timestamp: isoFromEntry(entry),
            delayMsFromTaskStart: null,
          };
        }
      }
    }
  }

  let runTotalTokens: number | null = null;
  let totalCostUsd: number | null = null;
  let runDurationMs: number | null = null;
  let taskStartedAt: string | null = null;
  let taskCompletedAt: string | null = null;

  for (const runId of runIds) {
    const runTracePath = resolve(RUN_TRACE_DIR, `${runId}.jsonl`);
    for (const entry of readJsonl(runTracePath)) {
      if (entry?.type === "task_started") {
        taskStartedAt ??= isoFromEntry(entry);
      }
      if (entry?.type === "task_completed") {
        taskCompletedAt ??= isoFromEntry(entry);
        if (typeof entry?.data?.totalDurationMs === "number") {
          runDurationMs = (runDurationMs ?? 0) + entry.data.totalDurationMs;
        }
        if (typeof entry?.data?.totalTokens === "number") {
          runTotalTokens = (runTotalTokens ?? 0) + entry.data.totalTokens;
        }
        if (typeof entry?.data?.totalCostUsd === "number") {
          totalCostUsd = (totalCostUsd ?? 0) + entry.data.totalCostUsd;
        }
      }
      if (entry?.type === "node_verified") {
        const decision = String(entry?.data?.decision ?? "unknown");
        verificationDecisions[decision] =
          (verificationDecisions[decision] ?? 0) + 1;
      }
      if (entry?.type === "escalation_rejected") {
        rejectedEscalationCount += 1;
      }
    }
  }

  const startedMs = msFromIso(taskStartedAt);
  const actionMs = msFromIso(firstStateChangingAction?.timestamp ?? null);
  if (
    firstStateChangingAction &&
    startedMs != null &&
    actionMs != null &&
    actionMs >= startedMs
  ) {
    firstStateChangingAction.delayMsFromTaskStart = actionMs - startedMs;
  }

  const retryDecisions = Object.entries(verificationDecisions)
    .filter(([decision]) => decision !== "accept")
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    schemaVersion: "2026-05-14",
    traceCount: tracePaths.length,
    runIds: [...runIds].sort(),
    executorTurns,
    perceptionTurns,
    pageReadTurns,
    verificationReadTurns,
    toolCallCount,
    toolExecutionCount,
    toolCounts,
    repeatedSameToolTurns,
    escalationCount,
    missingToolEscalationCount,
    rejectedEscalationCount,
    toolProfileAppliedCount,
    readsBeforeFirstStateChangingAction,
    firstStateChangingAction,
    verification: {
      decisions: verificationDecisions,
      retryDecisions,
    },
    llmUsage: {
      executorPromptTokens,
      executorCompletionTokens,
      executorTotalTokens,
      runTotalTokens,
      totalCostUsd,
      executorLlmDurationMs,
    },
    durations: {
      runDurationMs,
      taskStartedAt,
      taskCompletedAt,
    },
  };
}
