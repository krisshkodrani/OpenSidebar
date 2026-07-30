import {
  FLEET_TELEMETRY_SCHEMA_VERSION,
  type FleetCompletionReason,
  type FleetDurationBucket,
  type FleetErrorCode,
  type FleetEvidenceType,
  type FleetExtensionChannel,
  type FleetModelId,
  type FleetOsFamily,
  type FleetOutcome,
  type FleetProviderId,
  type FleetTaskShape,
  type FleetTelemetryEnvelopeV1,
  type FleetTerminalReason,
  type FleetToolName,
  validateFleetTelemetryEnvelope,
} from "@observability-schema";

/**
 * Deliberately narrow input surface for fleet projection. It contains no user
 * request, page state, URL, DOM, screenshot, model response, tool arguments, or
 * free-text completion reason.
 */
export interface FleetTelemetryProjectionInput {
  eventId: string;
  extensionVersion: string;
  extensionChannel: string;
  browserMajor: number;
  osFamily: string;
  providerId?: string | null;
  executorModel?: string | null;
  plannerModel?: string | null;
  judgeModel?: string | null;
  plannerStepCount: number;
  turnCount: number;
  durationMs: number;
  toolExecutions: readonly FleetToolExecutionInput[];
  completionDecisions?: readonly FleetCompletionDecisionInput[];
  evidence?: readonly FleetEvidenceInput[];
  outcome:
    | "completed"
    | "stopped"
    | "max_turns"
    | "error"
    | "awaiting_approval"
    | "awaiting_clarification"
    | "guardrail_stopped"
    | "abandoned";
  terminalReason?: string | null;
  errorCodes?: readonly string[];
}

export interface FleetToolExecutionInput {
  name: string;
  success: boolean;
}

export interface FleetCompletionDecisionInput {
  turn: number;
  verdict: "accepted" | "rejected";
  candidateSource: "model_done" | "trusted_tool";
  basis?: string | null;
  guardId?: string | null;
  contractKind?: string | null;
}

export interface FleetEvidenceInput {
  type: string;
  observedAtTurn: number;
  supportsTaskGoal?: boolean;
}

export function projectFleetTelemetryEnvelope(
  input: FleetTelemetryProjectionInput,
): FleetTelemetryEnvelopeV1 {
  const toolCounts = projectToolCounts(input.toolExecutions);
  const decisions = input.completionDecisions ?? [];
  const modelDoneDecisions = decisions.filter(
    (decision) => decision.candidateSource === "model_done",
  );
  const rejectedDoneDecisions = modelDoneDecisions.filter(
    (decision) => decision.verdict === "rejected",
  );
  const acceptedDecision = decisions.find(
    (decision) => decision.verdict === "accepted",
  );
  const acceptedDoneDecision = modelDoneDecisions.find(
    (decision) => decision.verdict === "accepted",
  );
  const evidence = projectEvidence(input.evidence ?? []);
  const doneToolCalls = toolCounts.done?.attempted ?? 0;

  const envelope: FleetTelemetryEnvelopeV1 = {
    schemaVersion: FLEET_TELEMETRY_SCHEMA_VERSION,
    eventId: input.eventId,
    extension: {
      version: input.extensionVersion,
      channel: normalizeExtensionChannel(input.extensionChannel),
    },
    environment: {
      browserMajor: clampInteger(input.browserMajor, 1, 999),
      osFamily: normalizeFleetOsFamily(input.osFamily),
    },
    runtime: {
      provider: normalizeFleetProviderId(input.providerId),
      executorModel: normalizeFleetModelId(input.executorModel),
      plannerModel: normalizeFleetModelId(input.plannerModel),
      judgeModel: normalizeFleetModelId(input.judgeModel),
      taskShape: deriveFleetTaskShape(input.toolExecutions),
    },
    execution: {
      plannerStepCount: clampInteger(input.plannerStepCount, 0, 200),
      turnCount: clampInteger(input.turnCount, 0, 500),
      durationBucket: bucketFleetDuration(input.durationMs),
      toolCounts,
    },
    completion: {
      doneCallCount: clampInteger(
        Math.max(doneToolCalls, modelDoneDecisions.length),
        0,
        500,
      ),
      ...(firstTurn(modelDoneDecisions) !== undefined
        ? { firstDoneCandidateTurn: firstTurn(modelDoneDecisions) }
        : {}),
      ...(acceptedDoneDecision
        ? { acceptedDoneTurn: clampInteger(acceptedDoneDecision.turn, 0, 500) }
        : {}),
      acceptedSource: acceptedDecision?.candidateSource ?? "none",
      rejectedDoneCount: clampInteger(rejectedDoneDecisions.length, 0, 500),
      rejectionReasons: unique(
        rejectedDoneDecisions.map(normalizeFleetCompletionReason),
      ),
      evidenceTypes: evidence.types,
      ...(evidence.firstTurn !== undefined
        ? {
            firstSatisfiedEvidenceTurn: evidence.firstTurn,
            turnsAfterFirstSatisfiedEvidence: clampInteger(
              input.turnCount - evidence.firstTurn,
              0,
              500,
            ),
          }
        : {}),
    },
    result: {
      outcome: normalizeFleetOutcome(input.outcome),
      terminalReason: normalizeFleetTerminalReason(
        input.terminalReason,
        input.outcome,
      ),
      errorCodes: projectErrorCodes(input.errorCodes ?? [], input.outcome),
    },
  };

  const validation = validateFleetTelemetryEnvelope(envelope);
  if (!validation.valid) {
    throw new Error(
      `Fleet telemetry projection violated its closed schema: ${validation.errors.join("; ")}`,
    );
  }
  return envelope;
}

export function normalizeFleetProviderId(
  providerId: string | null | undefined,
): FleetProviderId {
  const normalized = providerId?.trim().toLowerCase();
  switch (normalized) {
    case "openrouter":
    case "openai":
    case "groq":
    case "fireworks":
    case "moonshot":
    case "deepseek":
    case "xiaomi":
    case "cerebras":
      return normalized;
    default:
      return "other";
  }
}

export function normalizeFleetModelId(
  model: string | null | undefined,
): FleetModelId {
  const normalized =
    model
      ?.trim()
      .toLowerCase()
      .replace(/:nitro$/, "") ?? "";
  if (normalized.includes("minimax-m3")) return "minimax_m3";
  if (normalized.includes("kimi-k2.7") || normalized.includes("kimi-k2p7")) {
    return "kimi_k2_7_code";
  }
  if (normalized.includes("kimi-k2.6") || normalized.includes("kimi-k2p6")) {
    return "kimi_k2_6";
  }
  if (normalized.includes("kimi-k2.5") || normalized.includes("kimi-k2p5")) {
    return "kimi_k2_5";
  }
  if (normalized.includes("glm-5.2") || normalized.includes("glm-5p2")) {
    return "glm_5_2";
  }
  if (normalized.includes("gpt-oss-120b")) return "gpt_oss_120b";
  if (normalized.includes("mimo-v2")) return "mimo_v2";
  if (normalized.includes("deepseek-v4")) return "deepseek_v4";
  if (normalized.includes("qwen3-vl")) return "qwen_3_vl";
  if (normalized.includes("qwen3.7") || normalized.includes("qwen3p7")) {
    return "qwen_3_7";
  }
  if (normalized.includes("grok-4.5")) return "grok_4_5";
  if (normalized.includes("gemma-4-31b")) return "gemma_4_31b";
  return "other";
}

export function normalizeFleetOsFamily(osFamily: string): FleetOsFamily {
  const normalized = osFamily.trim().toLowerCase();
  if (normalized.includes("win")) return "windows";
  if (normalized.includes("mac")) return "macos";
  if (normalized.includes("cros") || normalized.includes("chromeos")) {
    return "chromeos";
  }
  if (normalized.includes("linux")) return "linux";
  return "other";
}

export function bucketFleetDuration(durationMs: number): FleetDurationBucket {
  const duration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  if (duration < 1_000) return "under_1s";
  if (duration < 5_000) return "1s_to_5s";
  if (duration < 15_000) return "5s_to_15s";
  if (duration < 60_000) return "15s_to_60s";
  if (duration < 300_000) return "1m_to_5m";
  return "over_5m";
}

function normalizeExtensionChannel(channel: string): FleetExtensionChannel {
  if (channel === "stable" || channel === "beta" || channel === "dev") {
    return channel;
  }
  return "dev";
}

function projectToolCounts(
  executions: readonly FleetToolExecutionInput[],
): Partial<Record<FleetToolName, { attempted: number; failed: number }>> {
  const counts: Partial<
    Record<FleetToolName, { attempted: number; failed: number }>
  > = {};
  for (const execution of executions.slice(0, 1_000)) {
    const name = normalizeFleetToolName(execution.name);
    const current = counts[name] ?? { attempted: 0, failed: 0 };
    current.attempted = clampInteger(current.attempted + 1, 0, 1_000);
    if (!execution.success) {
      current.failed = clampInteger(current.failed + 1, 0, current.attempted);
    }
    counts[name] = current;
  }
  return counts;
}

function normalizeFleetToolName(name: string): FleetToolName {
  const normalized = name.trim().toLowerCase();
  if (normalized === "done") return "done";
  if (
    normalized.includes("click") ||
    normalized === "right_click" ||
    normalized === "hover_element" ||
    normalized === "press_key" ||
    normalized === "drag_and_drop" ||
    normalized === "hide_element" ||
    normalized === "dismiss_overlays"
  ) {
    return "click";
  }
  if (normalized === "type_text" || normalized === "compose_text") {
    return "type";
  }
  if (
    normalized.startsWith("read_") ||
    normalized.startsWith("inspect_") ||
    normalized === "find_element" ||
    normalized === "search_knowledge_base"
  ) {
    return "read";
  }
  if (
    normalized === "navigate" ||
    normalized === "go_back" ||
    normalized === "open_servicenow_module"
  ) {
    return "navigate";
  }
  if (normalized === "scroll_page") return "scroll";
  if (
    normalized === "create_tab" ||
    normalized === "close_tab" ||
    normalized === "switch_tab" ||
    normalized === "list_tabs" ||
    normalized === "create_window"
  ) {
    return "tab";
  }
  if (
    normalized === "select_option" ||
    normalized === "set_checkbox" ||
    normalized === "extract_form_state" ||
    normalized.startsWith("apply_list_") ||
    normalized.startsWith("configure_")
  ) {
    return "form";
  }
  if (normalized === "download_file" || normalized === "upload_file") {
    return "download";
  }
  if (
    normalized.includes("cookie") ||
    normalized === "search_history" ||
    normalized === "get_profile_fields"
  ) {
    return "browser_management";
  }
  return "other";
}

function deriveFleetTaskShape(
  executions: readonly FleetToolExecutionInput[],
): FleetTaskShape {
  const meaningful = executions
    .map((execution) => normalizeFleetToolName(execution.name))
    .filter((name) => name !== "done" && name !== "other");
  if (meaningful.length === 0) return "unknown";
  if (meaningful.length === 1 && meaningful[0] === "click") {
    return "single_interaction";
  }

  const categories = new Set(meaningful);
  if (categories.has("tab")) return "multi_tab";
  if (categories.has("download")) return "download";
  if (categories.has("browser_management")) return "browser_management";
  if (categories.has("form") || categories.has("type")) return "form";
  if (
    categories.size === 1 &&
    (categories.has("read") ||
      categories.has("navigate") ||
      categories.has("scroll"))
  ) {
    if (categories.has("read")) return "read";
    if (categories.has("navigate")) return "navigation";
    return "read";
  }
  if (
    categories.size <= 2 &&
    categories.has("navigate") &&
    categories.has("click")
  ) {
    return "navigation";
  }
  return "mixed";
}

function projectEvidence(evidence: readonly FleetEvidenceInput[]): {
  types: FleetEvidenceType[];
  firstTurn?: number;
} {
  const supported = evidence
    .filter((item) => item.supportsTaskGoal !== false)
    .map((item) => ({
      type: normalizeFleetEvidenceType(item.type),
      turn: clampInteger(item.observedAtTurn, 0, 500),
    }))
    .filter((item) => item.type !== "none");

  if (supported.length === 0) return { types: ["none"] };
  return {
    types: unique(supported.map((item) => item.type)),
    firstTurn: Math.min(...supported.map((item) => item.turn)),
  };
}

function normalizeFleetEvidenceType(type: string): FleetEvidenceType {
  const normalized = type.trim().toLowerCase();
  if (
    normalized === "navigation_state" ||
    normalized === "navigation_reached" ||
    normalized === "navigation_committed"
  ) {
    return "navigation_committed";
  }
  if (
    normalized === "field_value" ||
    normalized === "draft_state" ||
    normalized === "form_state_captured" ||
    normalized === "field_value_observed" ||
    normalized === "fill_attempted"
  ) {
    return "form_state_observed";
  }
  if (
    normalized === "confirmation_state" ||
    normalized === "correct_feedback" ||
    normalized === "submit_succeeded" ||
    normalized === "goal_state_verified"
  ) {
    return "page_confirmation_observed";
  }
  if (
    normalized === "download_observed" ||
    normalized === "download_file_result" ||
    normalized === "download_file_completed"
  ) {
    return "download_observed";
  }
  if (normalized === "media_state_changed") return "media_state_changed";
  if (
    normalized === "selected_state" ||
    normalized === "answer_state" ||
    normalized === "answer_extracted" ||
    normalized === "record_identity_observed"
  ) {
    return "target_state_observed";
  }
  return "none";
}

function normalizeFleetCompletionReason(
  decision: FleetCompletionDecisionInput,
): FleetCompletionReason {
  const source = [decision.guardId, decision.basis, decision.contractKind]
    .filter((value): value is string => Boolean(value))
    .join("_")
    .toLowerCase();
  if (source.includes("missing_evidence")) return "missing_evidence";
  if (source.includes("task_contract")) return "task_contract";
  if (source.includes("workflow_contract")) return "workflow_contract";
  if (source.includes("no_read") || source.includes("read_answer")) {
    return "read_not_grounded";
  }
  if (
    source.includes("plan") ||
    source.includes("early_multistep") ||
    source.includes("incomplete_multi")
  ) {
    return "plan_incomplete";
  }
  if (source.includes("duplicate_terminal")) return "duplicate_terminal";
  if (source.includes("kernel")) return "kernel_reject";
  return "other";
}

function normalizeFleetOutcome(
  outcome: FleetTelemetryProjectionInput["outcome"],
): FleetOutcome {
  switch (outcome) {
    case "completed":
      return "completed";
    case "stopped":
      return "stopped";
    case "max_turns":
    case "guardrail_stopped":
      return "guardrail_stopped";
    case "error":
      return "failed";
    case "awaiting_approval":
    case "awaiting_clarification":
      return "paused";
    case "abandoned":
      return "abandoned";
  }
}

function normalizeFleetTerminalReason(
  reason: string | null | undefined,
  outcome: FleetTelemetryProjectionInput["outcome"],
): FleetTerminalReason {
  const normalized = reason?.trim().toLowerCase() ?? "";
  if (normalized.includes("completion")) return "completion_accepted";
  if (normalized.includes("max_turn")) return "max_turns";
  if (normalized.includes("stuck")) return "stuck_guardrail";
  if (normalized.includes("give_up") || normalized.includes("giveup")) {
    return "give_up_guardrail";
  }
  if (normalized.includes("user") || normalized.includes("abort")) {
    return "user_stopped";
  }
  if (normalized.includes("awaiting") || normalized.includes("approval")) {
    return "awaiting_user";
  }
  if (normalized.includes("abandon") || normalized.includes("worker")) {
    return "worker_abandoned";
  }
  if (normalized.includes("error") || normalized.includes("fail"))
    return "error";

  switch (outcome) {
    case "completed":
      return "completion_accepted";
    case "stopped":
      return "user_stopped";
    case "max_turns":
      return "max_turns";
    case "error":
      return "error";
    case "awaiting_approval":
    case "awaiting_clarification":
      return "awaiting_user";
    case "guardrail_stopped":
      return "unknown";
    case "abandoned":
      return "worker_abandoned";
  }
}

function projectErrorCodes(
  codes: readonly string[],
  outcome: FleetTelemetryProjectionInput["outcome"],
): FleetErrorCode[] {
  const projected = unique(codes.map(normalizeFleetErrorCode)).slice(0, 8);
  if (
    projected.length === 0 &&
    (outcome === "error" ||
      outcome === "max_turns" ||
      outcome === "guardrail_stopped" ||
      outcome === "abandoned")
  ) {
    if (outcome === "max_turns" || outcome === "guardrail_stopped") {
      return ["guardrail_exhausted"];
    }
    if (outcome === "abandoned") return ["worker_abandoned"];
    return ["unknown"];
  }
  return projected;
}

function normalizeFleetErrorCode(code: string): FleetErrorCode {
  const normalized = code.trim().toLowerCase();
  if (
    normalized.includes("provider") ||
    normalized.includes("credits") ||
    normalized.includes("rate_limit") ||
    normalized.includes("llm")
  ) {
    return "provider_error";
  }
  if (normalized.includes("navigation")) return "navigation_error";
  if (normalized.includes("completion") || normalized.includes("done")) {
    return "completion_error";
  }
  if (
    normalized.includes("max_turn") ||
    normalized.includes("stuck") ||
    normalized.includes("give_up")
  ) {
    return "guardrail_exhausted";
  }
  if (normalized.includes("abort") || normalized.includes("user_stop")) {
    return "user_abort";
  }
  if (normalized.includes("worker") || normalized.includes("abandon")) {
    return "worker_abandoned";
  }
  if (normalized.includes("tool")) return "tool_error";
  return "unknown";
}

function firstTurn(
  decisions: readonly FleetCompletionDecisionInput[],
): number | undefined {
  if (decisions.length === 0) return undefined;
  return Math.min(
    ...decisions.map((decision) => clampInteger(decision.turn, 0, 500)),
  );
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
