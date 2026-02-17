import { LLMClient } from "../llm";
import { logger } from "../../utils";
import { renderPrompt } from "../../prompts";

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

export interface VerificationReflectionInput {
  taskQuery: string;
  objective: string;
  successCriteria: string;
  output: string;
  handoffContext?: string;
  priorDecision: NodeVerificationResult;
  driftDetected?: boolean;
  staleSignalCount?: number;
}

export interface VerifierDialogueTurn {
  role: "verifier" | "critic";
  decision: NodeVerificationResult;
  round: number;
}

export interface DialogueResult {
  finalDecision: NodeVerificationResult;
  turns: VerifierDialogueTurn[];
  converged: boolean;
  totalRounds: number;
}

const VERIFY_SYSTEM = renderPrompt("orchestrator.verifier.system");
const REFLECT_SYSTEM = renderPrompt("orchestrator.verifier.critic.system");

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

  async advise(
    input: {
      executorInstruction: string;
      pageTitle: string;
      pageUrl: string;
      viewportText: string;
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
              `Viewport text (first 500 chars):\n${input.viewportText.slice(0, 500)}`,
          },
        ],
        max_tokens: 150,
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

  async runDialogue(
    input: NodeVerificationInput,
    maxRounds: number,
    confidenceDelta: number,
    signal?: AbortSignal,
  ): Promise<DialogueResult> {
    const turns: VerifierDialogueTurn[] = [];

    const initial = await this.verifyNode(input, signal);
    turns.push({ role: "verifier", decision: initial, round: 0 });

    if (initial.decision === "accept") {
      return { finalDecision: initial, turns, converged: true, totalRounds: 1 };
    }

    let current = initial;
    for (let round = 1; round <= maxRounds; round += 1) {
      const dialogueHistory = this.formatDialogueHistory(turns);
      const challenge = await this.criticChallenge(input, current, dialogueHistory, signal);
      turns.push({ role: "critic", decision: challenge, round });

      if (challenge.decision === "accept") {
        return { finalDecision: challenge, turns, converged: true, totalRounds: round + 1 };
      }

      if (
        challenge.decision === current.decision &&
        Math.abs(challenge.confidence - current.confidence) < confidenceDelta
      ) {
        return { finalDecision: challenge, turns, converged: true, totalRounds: round + 1 };
      }

      current = challenge;
    }

    return { finalDecision: current, turns, converged: false, totalRounds: turns.length };
  }

  private formatDialogueHistory(turns: VerifierDialogueTurn[]): string {
    return turns
      .map((turn) => {
        const d = turn.decision;
        return `[Round ${turn.round} - ${turn.role}]: decision=${d.decision}, confidence=${d.confidence.toFixed(2)}, reason="${d.reason}"`;
      })
      .join("\n");
  }

  private async criticChallenge(
    input: NodeVerificationInput,
    priorDecision: NodeVerificationResult,
    dialogueHistory: string,
    signal?: AbortSignal,
  ): Promise<NodeVerificationResult> {
    try {
      const response = await this.llm.complete({
        messages: [
          { role: "system", content: REFLECT_SYSTEM },
          {
            role: "user",
            content:
              `Task: ${input.taskQuery}\n` +
              `Objective: ${input.objective}\n` +
              `Success criteria: ${input.successCriteria}\n` +
              `Executor output: ${input.output}\n` +
              `\nPrior verifier decision:\n${JSON.stringify(priorDecision)}\n` +
              `\nDialogue history:\n${dialogueHistory}\n` +
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
          : "No reason provided by critic.";
      const confidence = normalizeConfidence(parsed?.confidence) ?? priorDecision.confidence;

      if (!decision) {
        throw new Error("Critic returned invalid decision.");
      }

      if (decision === "reroute") {
        const failureType = normalizeFailureType(parsed?.failureType) ?? "blocked";
        const rerouteObjective =
          typeof parsed?.rerouteObjective === "string" &&
          parsed.rerouteObjective.trim().length > 0
            ? parsed.rerouteObjective.trim()
            : priorDecision.rerouteObjective ||
              `Use an alternate approach for: ${input.objective}`;
        return { decision, reason, confidence, failureType, rerouteObjective };
      }

      const failureType =
        decision === "accept"
          ? undefined
          : normalizeFailureType(parsed?.failureType) ??
            priorDecision.failureType ??
            "insufficient_evidence";
      return { decision, reason, confidence, failureType };
    } catch (error) {
      logger.warn("orchestrator", "Critic challenge failed, keeping prior decision", {
        error,
        priorDecision,
      });
      return priorDecision;
    }
  }

  async reflectDecision(
    input: VerificationReflectionInput,
    signal?: AbortSignal,
  ): Promise<NodeVerificationResult> {
    try {
      const response = await this.llm.complete({
        messages: [
          { role: "system", content: REFLECT_SYSTEM },
          {
            role: "user",
            content:
              `Task: ${input.taskQuery}\n` +
              `Objective: ${input.objective}\n` +
              `Success criteria: ${input.successCriteria}\n` +
              `Executor output: ${input.output}\n` +
              `\nPrior verifier decision:\n${JSON.stringify(input.priorDecision)}\n` +
              `\nContext flags:\n` +
              `driftDetected=${Boolean(input.driftDetected)}\n` +
              `staleSignalCount=${Math.max(0, input.staleSignalCount || 0)}\n` +
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
          : "No reason provided by verifier critic.";
      const confidence = normalizeConfidence(parsed?.confidence) ?? input.priorDecision.confidence;

      if (!decision) {
        throw new Error("Verifier critic returned invalid decision.");
      }

      if (decision === "reroute") {
        const failureType = normalizeFailureType(parsed?.failureType) ?? "blocked";
        const rerouteObjective =
          typeof parsed?.rerouteObjective === "string" &&
          parsed.rerouteObjective.trim().length > 0
            ? parsed.rerouteObjective.trim()
            : input.priorDecision.rerouteObjective ||
              `Use an alternate approach for: ${input.objective}`;
        return { decision, reason, confidence, failureType, rerouteObjective };
      }

      const failureType =
        decision === "accept"
          ? undefined
          : normalizeFailureType(parsed?.failureType) ??
            input.priorDecision.failureType ??
            "insufficient_evidence";
      return { decision, reason, confidence, failureType };
    } catch (error) {
      logger.warn("orchestrator", "Verifier critic failed, keeping prior decision", {
        error,
        priorDecision: input.priorDecision,
      });
      return input.priorDecision;
    }
  }
}
