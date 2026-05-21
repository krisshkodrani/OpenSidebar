import type {
  CompletionCandidateSource,
  CompletionEnvelope,
  CompletionEvidence,
  TrustedCompletionCandidate,
} from "./kernel-types";
import { compactKey, hashStableString } from "./text-utils";

export function buildCompletionEnvelope(params: {
  source: CompletionCandidateSource;
  contractKind: string;
  decisionReason: string;
  evidence: CompletionEvidence[];
  turn: number;
  summary: string;
}): CompletionEnvelope {
  const evidenceKeys = [
    ...new Set(params.evidence.map((event) => event.logicalKey)),
  ].sort();
  const latestEvidenceTurn = params.evidence.reduce(
    (latest, event) => Math.max(latest, event.observedAtTurn),
    params.turn,
  );
  const evidenceMaterial = params.evidence
    .map(
      (event) =>
        `${event.logicalKey}@${event.observedAtTurn}:${event.confidence}`,
    )
    .sort()
    .join("|");
  const evidenceEpoch = `turn:${latestEvidenceTurn}:evidence:${hashStableString(
    evidenceMaterial || "none",
  )}`;
  const resultId = `completion:${hashStableString(
    [
      params.source,
      params.contractKind,
      params.decisionReason,
      evidenceEpoch,
      params.summary,
    ].join("\n"),
  )}`;
  return {
    status: "completed",
    resultId,
    source: params.source,
    contractKind: params.contractKind,
    decisionReason: params.decisionReason,
    evidenceKeys,
    evidenceEpoch,
  };
}

export function buildTrustedCompletionCandidate(params: {
  workflow: string;
  summary: string;
  reason: string;
  turn: number;
  contractKind?: string;
  evidenceText?: string;
  recordId?: string;
  targetText?: string;
  url?: string;
}): TrustedCompletionCandidate {
  const workflowKey = compactKey(params.workflow) || "workflow";
  const recordKey =
    (params.recordId ? compactKey(params.recordId) : null) ||
    compactKey(params.summary) ||
    "completed";
  return {
    contractKind: params.contractKind ?? "workflow_confirmation",
    decisionReason: params.reason,
    evidence: [
      {
        type: "confirmation_state",
        confidence: "high",
        logicalKey: `trusted:${workflowKey}:confirmation:${recordKey}`,
        observedAtTurn: params.turn,
        detail: {
          source: "trusted_workflow",
          text: (params.evidenceText ?? params.summary).slice(0, 1000),
          ...(params.recordId ? { recordId: params.recordId } : {}),
          ...(params.targetText ? { targetText: params.targetText } : {}),
          ...(params.url ? { url: params.url } : {}),
        },
      },
    ],
  };
}

export function buildTrustedReadAnswerCompletionCandidate(params: {
  workflow: string;
  answer: string;
  source: "knowledge_base_search" | "page_read";
  turn: number;
  question?: string;
  evidenceText?: string;
  url?: string;
}): TrustedCompletionCandidate {
  const workflowKey = compactKey(params.workflow) || "read-answer";
  const questionKey = params.question ? compactKey(params.question) : "";
  const answerKey = compactKey(params.answer) || hashStableString(params.answer);
  const logicalKey = questionKey
    ? `trusted:${workflowKey}:answer:${questionKey}:${answerKey}`
    : `trusted:${workflowKey}:answer:${answerKey}`;
  return {
    contractKind: "read_answer",
    decisionReason:
      params.source === "knowledge_base_search"
        ? "Trusted knowledge answer extraction produced an answer from grounded knowledge base search evidence."
        : "Trusted knowledge answer extraction produced an answer from grounded page-read evidence.",
    evidence: [
      {
        type: "answer_state",
        confidence: "high",
        logicalKey,
        observedAtTurn: params.turn,
        detail: {
          answer: params.answer.slice(0, 1000),
          ...(params.question ? { question: params.question.slice(0, 1000) } : {}),
          source: params.source,
          evidenceText: (params.evidenceText ?? params.answer).slice(0, 1000),
          ...(params.url ? { url: params.url } : {}),
        },
      },
    ],
  };
}
