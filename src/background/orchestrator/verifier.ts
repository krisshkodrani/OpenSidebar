import { LLMClient } from "../llm";
import { logger } from "../../utils";

export interface NodeVerificationInput {
  taskQuery: string;
  objective: string;
  successCriteria: string;
  output: string;
  handoffContext?: string;
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

const VERIFY_SYSTEM = `You are a strict verifier for browser automation subtasks.

Decide if the executor output satisfies the objective and success criteria.
Return JSON only:
{"decision":"accept","reason":"...","confidence":0.0}
{"decision":"retry","reason":"...","confidence":0.0,"failureType":"insufficient_evidence"}
{"decision":"reroute","reason":"...","confidence":0.0,"failureType":"blocked","rerouteObjective":"..."}

Rules:
- accept only when criteria are clearly satisfied.
- retry when likely fixable by one more attempt on the same objective.
- reroute when current approach is blocked and objective should be reframed.
- rerouteObjective must be concrete and action-oriented.
- confidence must be a number between 0 and 1.
- failureType must be one of: blocked, state_mismatch, insufficient_evidence, transient, unknown.
- for accept, omit failureType.
- for retry/reroute, always include failureType.`;

const BLOCKED_MARKERS = [
  "captcha",
  "blocked",
  "forbidden",
  "access denied",
  "not available",
  "not found",
  "timeout",
];

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
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

function normalizeDecision(value: unknown): NodeVerificationResult["decision"] | null {
  if (value === "accept" || value === "retry" || value === "reroute") return value;
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

  if (BLOCKED_MARKERS.some((m) => text.includes(m))) {
    return {
      decision: "reroute",
      reason: "Execution appears blocked by page constraints.",
      confidence: 0.9,
      failureType: "blocked",
      rerouteObjective: `Use an alternate path to achieve: ${input.objective}`,
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

  constructor(openRouterApiKey: string, cerebrasApiKey?: string) {
    this.llm = new LLMClient(openRouterApiKey, undefined, cerebrasApiKey);
    this.llm.switchToSmart();
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
        max_tokens: 220,
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
        const failureType = normalizeFailureType(parsed?.failureType) ?? "blocked";
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
          : normalizeFailureType(parsed?.failureType) ?? "insufficient_evidence";

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
