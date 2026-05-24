import { LLMClient, LLMClientOptions } from "../llm";
import { logger } from "../../utils";
import { renderPrompt } from "../../prompts";
import { StructuredEvidence } from "./types";
import { tokenizeStepText } from "../agent/loop-helpers";
import {
  EvidenceEvent,
  EvidenceEventType,
  isTrustedEvidence,
} from "../../types";

export interface NodeVerificationInput {
  taskQuery: string;
  objective: string;
  successCriteria: string;
  output: string;
  handoffContext?: string;
  executorOutcome?: string;
  evidence?: StructuredEvidence[];
  requiredEvidenceTypes?: EvidenceEventType[];
  previousUrl?: string;
  currentUrl?: string;
  previousTitle?: string;
  currentTitle?: string;
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
  taskQuery?: string;
  output: string;
  objective?: string;
  successCriteria: string;
  evidence?: StructuredEvidence[];
  requiredEvidenceTypes?: EvidenceEventType[];
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

const NEGATIVE_COMPLETION_PATTERNS = [
  /\b(?:verification|verifier)\s+(?:result|status)?\s*[:-]?\s*(?:task\s+)?not\s+(?:complete|completed|successful|satisfied|verified)\b/i,
  /\btask\s+(?:is\s+)?not\s+complete\b/i,
  /\b(?:field|input|value|required\s+state|required\s+value|actual\s+value)\b[\s\S]{0,120}\b(?:does\s+not\s+contain|missing|absent|empty|not\s+present|not\s+filled|not\s+set)\b/i,
  /\bdid\s+not\s+(?:complete|succeed|work|match|fill|submit|save|update|delete|confirm)\b/i,
  /\bhas\s+not\s+been\s+(?:completed|filled|submitted|saved|updated|deleted|confirmed)\b/i,
  /\bnot\s+successfully\s+(?:filled|submitted|saved|updated|deleted|confirmed)\b/i,
  /\brequired\s+value\b[\s\S]{0,120}\b(?:missing|absent|empty|not present)\b/i,
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

const EVIDENCE_SENSITIVE_MARKERS = [
  "submit",
  "checkout",
  "place order",
  "order confirmation",
  "purchase",
  "buy",
  "confirm",
  "delete",
  "remove",
  "save changes",
  "register",
  "sign up",
  "book",
  "reserve",
  "send",
];

const READ_ONLY_OBJECTIVE_MARKERS = [
  "summarize",
  "summary",
  "read",
  "extract",
  "find",
  "report",
  "count",
  "list",
  "identify",
  "compare",
  "describe",
  "inspect",
];

const HIGH_RISK_VERIFICATION_MARKERS = [
  "delete",
  "remove",
  "destroy",
  "cancel subscription",
  "purchase",
  "buy",
  "checkout",
  "place order",
  "payment",
  "send",
  "publish",
  "submit application",
  "apply for",
  "book",
  "reserve",
];

const MEDIUM_RISK_VERIFICATION_MARKERS = [
  "submit",
  "save",
  "update",
  "change",
  "edit",
  "set",
  "login",
  "log in",
  "sign in",
  "sign up",
  "register",
  "upload",
  "download",
  "fill",
  "checkbox",
  "select",
];

const LOW_RISK_INTERACTION_MARKERS = [
  "advance",
  "reveal",
  "expand",
  "collapse",
  "open",
  "show",
  "view",
  "navigate",
  "go to",
  "scroll",
  "hover",
  "find",
];

const EXPLICIT_COMPLETION_MARKERS = [
  /\border confirmed\b/i,
  /\border number\b/i,
  /\bpurchase confirmed\b/i,
  /\bpurchase complete\b/i,
  /\bconfirmation number\b/i,
  /\bnew tab\b/i,
  /\btab id\b/i,
  /\bstore url\b/i,
  /\bmarked complete\b/i,
  /\bchecked off\b/i,
];

const OVERLAY_DISMISSAL_GOAL_RE =
  /\b(?:close|dismiss|clear|remove)\b[\s\S]{0,100}\b(?:cookie|newsletter|popup|pop-up|banner|modal|overlay|dialog|notice|toast)s?\b|\b(?:cookie|newsletter|popup|pop-up|banner|modal|overlay|dialog|notice|toast)s?\b[\s\S]{0,100}\b(?:close|dismiss|clear|remove)\b/i;

const OVERLAY_FINAL_ABSENCE_RE =
  /\bno\b[\s\S]{0,80}\b(?:blocking\s+)?(?:cookie\s+banner|newsletter\s+popup|popup|pop-up|banner|modal|overlay|dialog|notice|toast|dismiss(?:al)?\s+target)s?\b[\s\S]{0,80}\b(?:remain|remains|visible|hidden|found|present)\b|\b(?:cookie\s+banner|newsletter\s+popup|popup|pop-up|banner|modal|overlay|dialog|notice|toast)\b[\s\S]{0,80}\b(?:gone|removed|dismissed|closed|no\s+longer\s+visible)\b/i;

function hasGoalTokenSupport(
  text: string,
  objective: string,
  successCriteria: string,
  evidence?: StructuredEvidence[],
): boolean {
  const corpus = [
    text,
    ...(evidence ?? []).map((item) => item.claim || item.event?.type || ""),
  ]
    .join(" ")
    .trim();
  const outputTokens = new Set(tokenizeStepText(corpus));
  const goalTokens = [
    ...tokenizeStepText(objective || ""),
    ...tokenizeStepText(successCriteria || ""),
  ].filter((token) => token.length >= 4 && !GOAL_TOKEN_STOPWORDS.has(token));

  if (goalTokens.length === 0) return true;
  return goalTokens.some((token) => outputTokens.has(token));
}

function isEvidenceSensitiveObjective(
  taskQuery: string,
  objective: string,
  successCriteria: string,
): boolean {
  const corpus = `${taskQuery} ${objective} ${successCriteria}`.toLowerCase();
  return EVIDENCE_SENSITIVE_MARKERS.some((marker) => corpus.includes(marker));
}

function isReadOnlyObjective(
  taskQuery: string,
  objective: string,
  successCriteria: string,
): boolean {
  const corpus = `${taskQuery} ${objective} ${successCriteria}`.toLowerCase();
  return READ_ONLY_OBJECTIVE_MARKERS.some((marker) => corpus.includes(marker));
}

export type VerificationRiskTier = "low" | "medium" | "high";

export function classifyVerificationRisk(input: {
  taskQuery?: string;
  objective?: string;
  successCriteria?: string;
}): VerificationRiskTier {
  const corpus =
    `${input.taskQuery ?? ""} ${input.objective ?? ""} ${input.successCriteria ?? ""}`.toLowerCase();

  if (
    HIGH_RISK_VERIFICATION_MARKERS.some((marker) => corpus.includes(marker))
  ) {
    return "high";
  }
  if (
    MEDIUM_RISK_VERIFICATION_MARKERS.some((marker) => corpus.includes(marker))
  ) {
    return "medium";
  }
  if (
    READ_ONLY_OBJECTIVE_MARKERS.some((marker) => corpus.includes(marker)) ||
    LOW_RISK_INTERACTION_MARKERS.some((marker) => corpus.includes(marker))
  ) {
    return "low";
  }
  return "medium";
}

function hasSubstantiveAlignedOutput(
  output: string,
  objective: string,
  successCriteria: string,
  evidence?: StructuredEvidence[],
): boolean {
  const trimmed = output.trim();
  if (!trimmed) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < 6) return false;
  return hasGoalTokenSupport(trimmed, objective, successCriteria, evidence);
}

function hasExplicitCompletionEvidence(text: string): boolean {
  return EXPLICIT_COMPLETION_MARKERS.some((pattern) => pattern.test(text));
}

function hasSupersedingFinalStateEvidence(
  input: ProgrammaticVerificationInput,
): boolean {
  const text = input.output.trim();
  if (!text) return false;
  if (hasNegativeCompletionEvidence(text)) return false;

  const lower = text.toLowerCase();
  if (
    /\b(?:final|success|confirmation|dashboard|welcome|code)\b[\s\S]{0,80}\b(?:not|is not|isn't|no longer)\s+(?:visible|present|available|shown|there|displayed|reached)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  const previousControlGone =
    /\b(?:previous|old|prior|original|source|trigger|initial)?\s*(?:button|control|link|element|step|page)?\b[\s\S]{0,100}\b(?:no longer|not|is not|isn't|missing|absent|gone|removed)\s+(?:visible|present|available|shown|there|displayed)\b/i.test(
      text,
    ) ||
    /\b(?:no longer|not|is not|isn't|missing|absent|gone|removed)\s+(?:visible|present|available|shown|there|displayed)\b[\s\S]{0,100}\b(?:button|control|link|element|step|page)\b/i.test(
      text,
    );
  const replacementStateVisible =
    /\b(?:now|new|revealed|appears?|shows?|displayed|present|landed|reached|advanced|transitioned|changed)\b[\s\S]{0,180}\b(?:final|next|success|confirmation|dashboard|welcome|code|input|field|form|screen|state|page)\b/i.test(
      text,
    ) ||
    /\b(?:final|next|success|confirmation|dashboard|welcome|code|input|field|form|screen|state|page)\b[\s\S]{0,180}\b(?:now|new|revealed|appears?|visible|shows?|displayed|present|reached)\b/i.test(
      text,
    );

  if (!previousControlGone || !replacementStateVisible) return false;
  return hasGoalTokenSupport(
    lower,
    input.objective || "",
    input.successCriteria,
    input.evidence,
  );
}

function hasOverlayDismissalFinalStateEvidence(
  input: ProgrammaticVerificationInput,
): boolean {
  if (input.executorOutcome !== "completed") return false;

  const goalText = [
    input.taskQuery,
    input.objective,
    input.successCriteria,
  ]
    .filter(Boolean)
    .join(" ");
  if (!OVERLAY_DISMISSAL_GOAL_RE.test(goalText)) return false;

  const output = input.output.trim();
  if (!OVERLAY_FINAL_ABSENCE_RE.test(output)) return false;

  return hasGoalTokenSupport(
    output,
    input.objective || "",
    input.successCriteria,
    input.evidence,
  );
}

function isClarificationNeededOutcome(text: string): boolean {
  const mentionsChoiceKind =
    /\b(?:workspace|account|project|environment|tenant|record|option|item|choice)\b/i.test(
      text,
    );
  const asksForUserClarification =
    /\b(?:need|needs|requires?|must|should)\b[\s\S]{0,80}\b(?:clarification|context|confirmation|user input|user confirmation)\b/i.test(
      text,
    ) ||
    /\b(?:ask|confirm with|check with)\s+(?:the\s+)?user\b[\s\S]{0,120}\b(?:which|what|before|choose|select|open|use)\b/i.test(
      text,
    );
  const identifiesMissingChoice =
    /\b(?:correct|right|appropriate|intended)\s+(?:workspace|account|project|environment|tenant|record|option|item|choice)\b[\s\S]{0,120}\b(?:not specified|unspecified|unknown|unclear|ambiguous|not provided)\b/i.test(
      text,
    );

  return (
    mentionsChoiceKind && asksForUserClarification && identifiesMissingChoice
  );
}

function hasNegativeCompletionEvidence(text: string): boolean {
  return NEGATIVE_COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

function evidenceConfidenceRank(value: EvidenceEvent["confidence"]): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

export function validateEvidenceSufficiency(
  requiredTypes: EvidenceEventType[] | undefined,
  evidence: StructuredEvidence[] | undefined,
): {
  sufficient: boolean;
  missing: EvidenceEventType[];
  conflicts: EvidenceEvent[];
} {
  const required = [...new Set(requiredTypes ?? [])];
  if (required.length === 0) {
    return { sufficient: false, missing: [], conflicts: [] };
  }

  const trusted = (evidence ?? [])
    .map((item) => item.event)
    .filter((event): event is EvidenceEvent => Boolean(event))
    .filter(isTrustedEvidence);
  const conflicts = trusted.filter(
    (event) => event.type === "uncertainty_detected",
  );
  const missing = required.filter(
    (type) =>
      !trusted.some(
        (event) =>
          event.type === type &&
          event.supportsTaskGoal &&
          evidenceConfidenceRank(event.confidence) >=
            evidenceConfidenceRank("medium"),
      ),
  );

  return {
    sufficient: missing.length === 0 && conflicts.length === 0,
    missing,
    conflicts,
  };
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

  if (
    input.executorOutcome === "completed" &&
    isClarificationNeededOutcome(input.output)
  ) {
    return {
      decision: "accept",
      reason:
        "Executor correctly deferred an ambiguous choice that requires user clarification.",
      confidence: 0.82,
    };
  }

  const evidenceSufficiency = validateEvidenceSufficiency(
    input.requiredEvidenceTypes,
    input.evidence,
  );
  if (evidenceSufficiency.sufficient) {
    return {
      decision: "accept",
      reason: `Required typed evidence is present: ${input.requiredEvidenceTypes?.join(", ")}.`,
      confidence: 0.95,
    };
  }

  if (hasSupersedingFinalStateEvidence(input)) {
    return {
      decision: "accept",
      reason:
        "Output cites a superseding final/replacement state; the prior trigger control no longer needs to remain visible.",
      confidence: 0.82,
    };
  }

  if (hasNegativeCompletionEvidence(input.output)) {
    return {
      decision: "retry",
      reason:
        "Executor output explicitly says the step is not complete or the required state is missing.",
      confidence: 0.9,
      failureType: "state_mismatch",
    };
  }

  if (hasOverlayDismissalFinalStateEvidence(input)) {
    return {
      decision: "accept",
      reason:
        "Overlay dismissal final state is verified: no blocking popup, modal, banner, or dismissal target remains.",
      confidence: 0.86,
    };
  }
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
      (e) =>
        (e.basis === "tool_output" && (e.confidence ?? 0) >= 0.8) ||
        (e.event && isTrustedEvidence(e.event) && e.event.confidence !== "low"),
    );
  const verificationRisk = classifyVerificationRisk({
    taskQuery: input.taskQuery,
    objective: input.objective,
    successCriteria: input.successCriteria,
  });

  // Error keywords + no evidence of DOM change → retry. When the executor
  // explicitly completed, the "error" text may be quoted page content from a
  // read-only task, so leave that case to success/evidence checks or the LLM.
  if (
    input.executorOutcome !== "completed" &&
    hasErrorMarker &&
    !domChanged &&
    !hasSuccessMarker
  ) {
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

  // Success keywords + explicit completion details in the summary → accept
  if (
    hasSuccessMarker &&
    hasGoalSupport &&
    hasExplicitCompletionEvidence(input.output)
  ) {
    return {
      decision: "accept",
      reason:
        "Output contains explicit completion evidence aligned with the success criteria.",
      confidence: 0.8,
    };
  }

  // Ambiguous → fall through to LLM
  // Low-risk read/reveal/navigation-style work can be accepted without a
  // verifier LLM call when the completed executor output is substantive and
  // aligned. Medium/high-risk workflows still require stronger typed,
  // structural, or LLM verification before acceptance.
  if (
    input.executorOutcome === "completed" &&
    verificationRisk === "low" &&
    !hasErrorMarker &&
    hasSubstantiveAlignedOutput(
      input.output,
      input.objective || "",
      input.successCriteria,
      input.evidence,
    )
  ) {
    return {
      decision: "accept",
      reason:
        "Low-risk verification budget accepted substantive output aligned with the objective.",
      confidence: 0.78,
    };
  }

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

  const programmaticResult = programmaticVerify({
    taskQuery: input.taskQuery,
    output: input.output,
    objective: input.objective,
    successCriteria: input.successCriteria,
    evidence: input.evidence,
    requiredEvidenceTypes: input.requiredEvidenceTypes,
    previousUrl: input.previousUrl,
    currentUrl: input.currentUrl,
    previousTitle: input.previousTitle,
    currentTitle: input.currentTitle,
    executorOutcome: input.executorOutcome,
  });
  if (programmaticResult) return programmaticResult;

  // Executor explicitly called done() but verifier LLM failed.
  // Accept with low confidence — the executor's own done() signal is the best
  // evidence available when the verifier is unreachable. Returning "retry"
  // here would loop if the provider is consistently failing, eventually
  // marking the node as failed even though the executor completed successfully.
  if (input.executorOutcome === "completed") {
    const hasAlignedOutput =
      hasSubstantiveAlignedOutput(
        input.output,
        input.objective,
        input.successCriteria,
        input.evidence,
      ) ||
      (isReadOnlyObjective(
        input.taskQuery,
        input.objective,
        input.successCriteria,
      ) &&
        input.output.trim().split(/\s+/).filter(Boolean).length >= 8);

    if (
      isEvidenceSensitiveObjective(
        input.taskQuery,
        input.objective,
        input.successCriteria,
      )
    ) {
      return {
        decision: "accept",
        reason: hasAlignedOutput
          ? "Executor completed an action-sensitive step with answer-aligned output while verifier LLM was unavailable; accepting to avoid replaying side effects."
          : "Executor completed an action-sensitive step without deterministic evidence; accepting low-confidence completion because retry could replay side effects while verifier LLM was unavailable.",
        confidence: hasAlignedOutput ? 0.55 : 0.4,
      };
    }
    if (hasAlignedOutput) {
      return {
        decision: "accept",
        reason:
          "Executor completed with answer-aligned output while verifier LLM was unavailable.",
        confidence: 0.55,
      };
    }
    return {
      decision: "retry",
      reason:
        "Executor completed but the output does not contain enough aligned evidence to confirm success.",
      confidence: 0.6,
      failureType: "insufficient_evidence",
    };
  }

  if (
    (text.includes("completed") ||
      text.includes("success") ||
      text.includes("done") ||
      text.includes("verified")) &&
    hasGoalTokenSupport(
      input.output,
      input.objective,
      input.successCriteria,
      input.evidence,
    )
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
              `Task (background context only — do NOT judge completion against this): ${input.taskQuery}\n` +
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
