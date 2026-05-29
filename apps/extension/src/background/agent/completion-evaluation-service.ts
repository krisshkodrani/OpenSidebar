import type { DomSnapshot } from "../../types";
import {
  evaluateCompletionContract,
  generateCompletionContract,
  type CompletionCandidateSource,
  type CompletionEvaluation,
  type CompletionEvidence,
  type GeneratedCompletionContract,
} from "./completion-kernel";

export interface GeneratedCompletionEvaluationRequest {
  userRequest: string;
  snapshot: DomSnapshot | null | undefined;
  activeObjective?: string;
  successCriteria?: string;
  evidence: CompletionEvidence[];
  candidateSource: CompletionCandidateSource;
  summary?: string;
}

export interface GeneratedCompletionEvaluationResult {
  generated: GeneratedCompletionContract | null;
  decision: CompletionEvaluation;
}

export function evaluateGeneratedCompletionCandidate(
  request: GeneratedCompletionEvaluationRequest,
): GeneratedCompletionEvaluationResult {
  const generated = generateCompletionContract({
    userRequest: request.userRequest,
    snapshot: request.snapshot,
    activeObjective: request.activeObjective,
    successCriteria: request.successCriteria,
  });
  const decision = evaluateCompletionContract({
    contract: generated?.contract,
    evidence: request.evidence,
    snapshot: request.snapshot,
    candidateSource: request.candidateSource,
    summary: request.summary,
  });
  return { generated, decision };
}
