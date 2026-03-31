import { LLMClient, LLMClientOptions } from "../llm";
import { logger } from "../../utils";
import { renderPrompt } from "../../prompts";
import { StructuredEvidence } from "./types";
import { tokenizeStepText } from "../agent/loop-helpers";

export interface NodeVerificationInput {
  taskQuery: string;
  objective: string;
  successCriteria: string;
  output: string;
  handoffContext?: string;
  executorOutcome?: string;
}

export type VerificationFailureType =
  | "blocked"
  | "state_mismatch"
  | "insufficient_evidence"
  | "transient"
  | "unknown";

export interface NodeVerificationResult {
  decision: "accept" | "retry" | "reroute";
  reason: string;
  confidence: number;
  failureType?: VerificationFailureType;
  rerouteObjective?: string;
}

export interface ProgrammaticVerificationInput {
  output: string;
  objective?: string;
  successCriteria: string;
  evidence?: StructuredEvidence[];
  previousUrl?: string;
  currentUrl?: string;
  previousTitle?: string;
  currentTitle?: string;
  executorOutcome?: string;
}

const VERIFY_SYSTEM = renderPrompt("orchestrator.verifier.system");

const BLOCKED_MARKERS = [
  "captcha",
  "blocked",
  "forbidden",
  "access denied",
  "not available",
  "not found",
  "timeout",
];

const SUCCESS_MARKERS = ["completed", "success", "done", "verified"];

const ERROR_MARKERS = [
  "error",
  "failed",
  "exception",
  "unable to",
  "could not",
  "cannot",
];

const GOAL_TOKEN_STOPWORDS = new Set([
  "page",
  "pages",
  "step",
  "steps",
  "task",
  "goal",
  "done",
  "show",
  "shows",
  "visible",
  "verify",
  "verified",
  "complete",
  "completed",
  "success",
  "successful",
  "navigate",
  "navigated",
  "navigation",
  "return",
  "returned",
  "report",
  "reported",
  "inventory",
  "count",
  "counts",
  "warehouse",
]);

function hasGoalTokenSupport(
  text: string,
  objective: string,
  successCriteria: string,
  evidence?: StructuredEvidence[],
): boolean {
  const corpus = [text, ...(evidence ?? []).map((item) => item.claim || "")]
    .join(" ")
    .trim();
  const outputTokens = new Set(tokenizeStepText(corpus));
  const goalTokens = [
    ...tokenizeStepText(objective || ""),
    ...tokenizeStepText(successCriteria || ""),
  ].filter(
    (token) => token.length >= 4 && !GOAL_TOKEN_STOPWORDS.has(token),
  );

  if (goalTokens.length === 0) return true;
  return goalTokens.some((token) => outputTokens.has(token));
}

/**
 * Programmatic DOM-state verification that short-circuits the LLM verifier
 * for clear-cut cases. Returns null when the case is ambiguous and needs
 * LLM judgment.
 */
export function programmaticVerify(
  input: ProgrammaticVerificationInput,
): NodeVerificationResult | null {
  const text = input.output.trim().toLowerCase();
  if (!text) return null;

  // Blocked markers → reroute (skip when executor completed — markers may be page content)
  if (
    input.executorOutcome !== "completed" &&
    BLOCKED_MARKERS.some((m) => text.includes(m))
  ) {
    return {
      decision: "reroute",
      reason: "Execution appears blocked by page constraints.",
      confidence: 0.9,
      failureType: "blocked",
      rerouteObjective: "Use an alternate approach to achieve the objective.",
    };
  }

  const hasSuccessMarker = SUCCESS_MARKERS.some((m) => text.includes(m));
  const hasErrorMarker = ERROR_MARKERS.some((m) => text.includes(m));
  const hasGoalSupport = hasGoalTokenSupport(
    input.output,
    input.objective || "",
    input.successCriteria,
    input.evidence,
  );

  const urlChanged =
    input.previousUrl != null &&
    input.currentUrl != null &&
    input.previousUrl !== input.currentUrl;

  const titleChanged =
    input.previousTitle != null &&
    input.currentTitle != null &&
    input.previousTitle !== input.currentTitle;

  const domChanged = urlChanged || titleChanged;

  const hasStructuredEvidence =
    Array.isArray(input.evidence) &&
    input.evidence.some(
      (e) => e.basis === "tool_output" && e.confidence >= 0.8,
    );

  // Error keywords + no evidence of DOM change → retry
  if (hasErrorMarker && !domChanged && !hasSuccessMarker) {
    return {
      decision: "retry",
      reason: "Output indicates errors with no evidence of DOM change.",
      confidence: 0.8,
      failureType: "transient",
    };
  }

  // Success keywords + DOM change evidence → accept
  if (hasSuccessMarker && domChanged && hasGoalSupport) {
    return {
      decision: "accept",
      reason: "Output indicates success with corroborating DOM change.",
      confidence: 0.85,
    };
  }

  // Success keywords + structured evidence → accept
  if (hasSuccessMarker && hasStructuredEvidence && hasGoalSupport) {
    return {
      decision: "accept",
      reason: "Output indicates success with structured evidence support.",
      confidence: 0.85,
    };
  }

  // Ambiguous → fall through to LLM
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```/g, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function normalizeDecision(
  value: unknown,
): NodeVerificationResult["decision"] | null {
  if (value === "accept" || value === "retry" || value === "reroute")
    return value;
  return null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function normalizeFailureType(value: unknown): VerificationFailureType | null {
  if (
    value === "blocked" ||
    value === "state_mismatch" ||
    value === "insufficient_evidence" ||
    value === "transient" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

export function deriveVerifierFallbackDecision(
  input: NodeVerificationInput,
): NodeVerificationResult {
  const text = input.output.trim().toLowerCase();
  if (!text) {
    return {
      decision: "retry",
      reason: "No output produced by executor.",
      confidence: 0.85,
      failureType: "insufficient_evidence",
    };
  }

  if (
    input.executorOutcome !== "completed" &&
    BLOCKED_MARKERS.some((m) => text.includes(m))
  ) {
    return {
      decision: "reroute",
      reason: "Execution appears blocked by page constraints.",
      confidence: 0.9,
      failureType: "blocked",
      rerouteObjective: `Use an alternate path to achieve: ${input.objective}`,
    };
  }

  // Executor explicitly called done() — trust it over keyword heuristics
  if (input.executorOutcome === "completed") {
    return {
      decision: "accept",
      reason:
        "Executor completed; verifier parse failed, accepting on executor signal.",
      confidence: 0.7,
    };
  }

  if (
    text.includes("completed") ||
    text.includes("success") ||
    text.includes("done") ||
    text.includes("verified")
  ) {
    return {
      decision: "accept",
      reason: "Output indicates successful completion.",
      confidence: 0.75,
    };
  }

  return {
    decision: "retry",
    reason: "Success criteria not clearly satisfied.",
    confidence: 0.55,
    failureType: "insufficient_evidence",
  };
}

export class OrchestratorVerifier {
  private llm: LLMClient;

  constructor(openRouterApiKey: string, modelOverrides?: LLMClientOptions) {
    this.llm = new LLMClient(openRouterApiKey, modelOverrides);
    this.llm.switchToPlanner();
  }

  async advise(
    input: {
      executorInstruction: string;
      pageTitle: string;
      pageUrl: string;
      visibleContent: string;
    },
    signal?: AbortSignal,
  ): Promise<string | null> {
    const ADVISORY_SYSTEM = renderPrompt("orchestrator.advisory.system");
    try {
      const response = await this.llm.complete({
        messages: [
          { role: "system", content: ADVISORY_SYSTEM },
          {
            role: "user",
            content:
              `Executor instruction:\n${input.executorInstruction}\n\n` +
              `Current page: ${input.pageTitle} (${input.pageUrl})\n` +
              `Visible content (first 500 chars):\n${input.visibleContent.slice(0, 500)}`,
          },
        ],
        max_tokens: 4096,
        temperature: 0,
        signal,
      });
      const text = (response.content || "").trim();
      if (!text || text.toLowerCase().includes("no advisory needed")) {
        return null;
      }
      return text;
    } catch (error) {
      logger.warn("orchestrator", "Advisory call failed, skipping", { error });
      return null;
    }
  }

  async verifyNode(
    input: NodeVerificationInput,
    signal?: AbortSignal,
  ): Promise<NodeVerificationResult> {
    try {
      const response = await this.llm.complete({
        messages: [
          { role: "system", content: VERIFY_SYSTEM },
          {
            role: "user",
            content:
              `Task: ${input.taskQuery}\n` +
              `Objective: ${input.objective}\n` +
              `Success criteria: ${input.successCriteria}\n` +
              `Executor output: ${input.output}\n` +
              `\nHandoff context:\n${input.handoffContext || "No additional handoff context."}\n`,
          },
        ],
        max_tokens: 4096,
        temperature: 0,
        signal,
      });

      const parsed = parseJsonObject(response.content || "");
      const decision = normalizeDecision(parsed?.decision);
      const reason =
        typeof parsed?.reason === "string" && parsed.reason.trim().length > 0
          ? parsed.reason.trim()
          : "No reason provided by verifier.";
      const confidence = normalizeConfidence(parsed?.confidence) ?? 0.5;

      if (!decision) {
        throw new Error("Verifier returned invalid decision.");
      }

      if (decision === "reroute") {
        const failureType =
          normalizeFailureType(parsed?.failureType) ?? "blocked";
        const rerouteObjective =
          typeof parsed?.rerouteObjective === "string" &&
          parsed.rerouteObjective.trim().length > 0
            ? parsed.rerouteObjective.trim()
            : `Use an alternate approach for: ${input.objective}`;
        logger.debug("orchestrator", "Verifier parsed reroute decision", {
          objective: input.objective,
          reason,
          confidence,
          failureType,
          rerouteObjective,
        });
        return { decision, reason, confidence, failureType, rerouteObjective };
      }

      const failureType =
        decision === "accept"
          ? undefined
          : (normalizeFailureType(parsed?.failureType) ??
            "insufficient_evidence");

      logger.debug("orchestrator", "Verifier parsed decision", {
        objective: input.objective,
        decision,
        reason,
        confidence,
        failureType,
      });
      return { decision, reason, confidence, failureType };
    } catch (error) {
      logger.warn("orchestrator", "Verifier failed, using fallback decision", {
        error,
      });
      return deriveVerifierFallbackDecision(input);
    }
  }
}
