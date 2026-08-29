/**
 * Programmatic task-summary builder (RFC LP-16 Phase 5). Renders a fallback
 * completion summary from verifier-accepted task-node results while preserving
 * the root answer contract.
 */
import type { OrchestratorTask } from "./types";
import {
  assessTaskContractCoverage,
  buildTaskContract,
  type TaskContractCoverage,
} from "../agent/task-contract";
import {
  extractRequestedStructuredAnswerValues,
  hasRestrictedRootDisclosure,
  sanitizeRestrictedRootSummary,
} from "./root-response-contract";
import { collectVerifierAcceptedResults } from "./verifier-accepted-results";

interface AcceptedResult {
  nodeId: string;
  result: string;
}

function acceptedResult(entry: AcceptedResult | undefined): string {
  return (entry?.result || "").trim();
}

function missingCoverageCount(coverage: TaskContractCoverage): number {
  return (
    coverage.missingEntities.length +
    coverage.missingNumbers.length +
    Number(coverage.missingExhaustiveCoverage) +
    Number(coverage.missingMultiReturnCoverage)
  );
}

function synthesizeVerifiedResults(
  task: OrchestratorTask,
  acceptedResults: AcceptedResult[],
): string {
  const finalResult = acceptedResult(acceptedResults.at(-1));
  if (!finalResult) return "";

  // Restricted-disclosure synthesis never forwards intermediate narration.
  // It may recover requested code/ID-shaped facts from verifier-accepted node
  // results, while excluding values explicitly marked out of scope. Rebuild
  // the identifier line so truncated or excluded values cannot survive from a
  // worker's prose summary.
  if (hasRestrictedRootDisclosure(task.query)) {
    const verifiedResults = acceptedResults.map(acceptedResult).filter(Boolean);
    const requestedValues = extractRequestedStructuredAnswerValues(
      task.query,
      verifiedResults,
    );
    const sanitizedFinal = sanitizeRestrictedRootSummary(
      task.query,
      finalResult,
    );
    return [
      ...(requestedValues.length > 0
        ? [
            "Root-answer evidence:",
            `- Requested identifiers: ${requestedValues.join(", ")}`,
          ]
        : []),
      sanitizedFinal,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const contract = buildTaskContract(task.query);
  let coverage = assessTaskContractCoverage({ contract, text: finalResult });
  if (coverage.satisfied) return finalResult;

  const supportingResults: string[] = [];
  let corpus = finalResult;
  let missingCount = missingCoverageCount(coverage);
  for (const entry of acceptedResults.slice(0, -1).reverse()) {
    const candidate = acceptedResult(entry);
    if (!candidate) continue;
    const candidateCorpus = `${corpus}\n${candidate}`;
    const candidateCoverage = assessTaskContractCoverage({
      contract,
      text: candidateCorpus,
    });
    const candidateMissingCount = missingCoverageCount(candidateCoverage);
    if (candidateMissingCount >= missingCount) continue;
    supportingResults.unshift(candidate);
    corpus = candidateCorpus;
    coverage = candidateCoverage;
    missingCount = candidateMissingCount;
    if (coverage.satisfied) break;
  }

  if (supportingResults.length === 0) return finalResult;
  return [
    finalResult,
    "Verified supporting evidence:",
    ...supportingResults,
  ].join("\n\n");
}

export function buildProgrammaticSummary(task: OrchestratorTask): string {
  const completedNodes = task.nodes.filter((n) => n.status === "completed");
  const acceptedResults = collectVerifierAcceptedResults(task);
  const failed = task.nodes.filter((n) => n.status === "failed").length;
  const lastCompleted = [...task.nodes]
    .reverse()
    .find((n) => n.status === "completed");
  const lastFailed = [...task.nodes]
    .reverse()
    .find((n) => n.status === "failed" && (n.error || "").trim().length > 0);

  // Disclosure boundaries apply even when the planner collapses a workflow to
  // one executor. The fast path must not bypass canonical answer synthesis or
  // repeat out-of-scope values from an otherwise accepted worker summary.
  if (
    acceptedResults.length > 0 &&
    hasRestrictedRootDisclosure(task.query)
  ) {
    return synthesizeVerifiedResults(task, acceptedResults);
  }

  // Single-node completed: show executor's actual output directly
  if (
    task.planClassification?.isSingleNode &&
    acceptedResults.length === 1 &&
    failed === 0
  ) {
    return acceptedResult(acceptedResults[0]);
  }

  // Multi-node completion is a synthesis over verifier-accepted results. The
  // last worker owns the root answer; prior results are added only when they
  // close a concrete root-contract coverage gap. Never concatenate every
  // intermediate progress report into the user-visible answer.
  if (acceptedResults.length > 1 && acceptedResult(acceptedResults.at(-1))) {
    return synthesizeVerifiedResults(task, acceptedResults);
  }

  if (acceptedResults.length > 0) {
    return acceptedResult(acceptedResults.at(-1));
  }

  if (
    completedNodes.length > 0 &&
    (lastCompleted?.userFacingResult || lastCompleted?.result)
  ) {
    return lastCompleted.userFacingResult || lastCompleted.result || "";
  }

  if (failed > 0 && lastFailed?.error) {
    return lastFailed.error;
  }

  return "";
}
