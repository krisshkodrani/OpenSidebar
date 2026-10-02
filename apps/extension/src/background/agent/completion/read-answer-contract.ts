import type { DomSnapshot } from "../../../types";
import { assessTaskContractCoverage, buildTaskContract } from "../task-contract";
import {
  extractRowScopedMetricAggregateQuestionParts,
  findReadAnswerMetricAggregateFromSnapshotRows,
  findReadAnswerMetricAggregateFromTextLines,
  rowScopedMetricAggregatePartsForLabel,
} from "./read-answer-row-aggregates";
import {
  extractReadAnswerSuperlativeMetricCandidate,
  extractRowScopedLabelValueQuestionParts,
  extractSentenceScopedDefinitionQuestionParts,
  extractSentenceScopedEventDateQuestionParts,
  extractSentenceScopedLocationQuestionParts,
  extractSentenceScopedReasonQuestionParts,
  extractSentenceScopedSuperlativeMetricQuestionParts,
  extractSentenceScopedTargetCountQuestionParts,
  extractSentenceScopedTargetMetricValueQuestionParts,
  extractSentenceScopedTargetPresenceQuestionParts,
  extractSentenceScopedTargetStateQuestionParts,
  findGroundedLabelValueQuestionLabel,
  findGroundedRowScopedLabelValueQuestion,
  findGroundedSentenceScopedAnswer,
  findReadAnswerRowScopedLabelValueText,
  findReadAnswerSentenceScopedAnswer,
  hasPageReadAnswerIntent,
  hasSubstantiveReadAnswerEvidence,
  labelValuePhraseCoveredBySummary,
  readAnswerSummaryGroundedInEvidence,
  isWorkflowRowLikeElement,
  readAnswerRowElementText,
  selectReadAnswerSuperlativeMetricWinner,
  sentenceScopedActiveRelationPatternForLabel,
  sentenceScopedAttributePatternForLabel,
  sentenceScopedByRelationPatternForLabel,
  sentenceScopedEventDatePatternForLabel,
  sentenceScopedMetricValuePatternForLabel,
  sentenceScopedPresenceMetricPatternForLabel,
  sentenceScopedReasonPredicatePatternForLabel,
  sentenceScopedRelationNounPatternForLabel,
  sentenceScopedSuperlativeMetricPartsForLabel,
  extractExpectedLabelValueAnswer,
  snapshotPageText,
  type ReadAnswerSuperlativeMetricCandidate,
  type SentenceScopedSuperlativeDirection,
} from "./read-answer-analysis";
import type {
  CompletionEvaluation,
  CompletionEvidence,
  GeneratedCompletionContract,
  ReadAnswerContract,
} from "./kernel-types";
import { extractCanonicalUserRequest } from "./request-text";
import { cleanLabel, compactKey, hashStableString, normalizeText } from "./text-utils";
import { inferRequestedWorkflowConfirmationAction } from "./workflow-request-intent";
import { compareEvidenceRecency } from "./evidence-order";
import { valueTokenCoveredBySummary } from "./label-value-types";
import { latestObservedTurn } from "./workflow-terminal-state";
import { workflowTargetLabelCoveredByText } from "./workflow-confirmation-analysis";

export function generateReadAnswerContract(
  params: {
    userRequest: string;
    snapshot: DomSnapshot | null | undefined;
    activeObjective?: string;
    successCriteria?: string;
  },
  _snapshot: DomSnapshot,
): GeneratedCompletionContract | null {
  const canonicalUserRequest = extractCanonicalUserRequest(params.userRequest);
  const focusedRequestText = [params.activeObjective, params.successCriteria]
    .filter(Boolean)
    .join("\n");
  const actionScope = focusedRequestText || canonicalUserRequest;
  if (inferRequestedWorkflowConfirmationAction(actionScope)) return null;

  const requestText = focusedRequestText || canonicalUserRequest;
  const sentenceScopedAnswer = getGroundedSentenceScopedAnswer(
    requestText,
    _snapshot,
  );
  const rowMetricAggregateQuestion =
    extractRowScopedMetricAggregateQuestionParts(requestText);
  const rowScopedSuperlativeAnswer = !sentenceScopedAnswer
    ? getGroundedRowScopedSuperlativeMetricAnswer(requestText, _snapshot)
    : null;
  const rowScopedMetricAggregateAnswer =
    rowMetricAggregateQuestion && !rowScopedSuperlativeAnswer
      ? getGroundedRowScopedMetricAggregateAnswer(requestText, _snapshot)
      : null;
  const definitionQuestion =
    extractSentenceScopedDefinitionQuestionParts(requestText);
  if (definitionQuestion?.strongDefinitionIntent && !sentenceScopedAnswer) {
    return null;
  }
  const reasonQuestion = extractSentenceScopedReasonQuestionParts(requestText);
  if (reasonQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const locationQuestion =
    extractSentenceScopedLocationQuestionParts(requestText);
  if (locationQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const eventDateQuestion =
    extractSentenceScopedEventDateQuestionParts(requestText);
  if (eventDateQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const targetCountQuestion =
    extractSentenceScopedTargetCountQuestionParts(requestText);
  if (targetCountQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const targetPresenceQuestion =
    extractSentenceScopedTargetPresenceQuestionParts(requestText);
  if (targetPresenceQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const targetStateQuestion =
    extractSentenceScopedTargetStateQuestionParts(requestText);
  if (targetStateQuestion && !sentenceScopedAnswer) {
    return null;
  }
  if (rowMetricAggregateQuestion && !rowScopedMetricAggregateAnswer) {
    return null;
  }
  const targetMetricValueQuestion =
    extractSentenceScopedTargetMetricValueQuestionParts(requestText);
  if (
    targetMetricValueQuestion &&
    !sentenceScopedAnswer &&
    !rowScopedMetricAggregateAnswer
  ) {
    return null;
  }
  const superlativeMetricQuestion =
    extractSentenceScopedSuperlativeMetricQuestionParts(requestText);
  if (
    superlativeMetricQuestion &&
    !sentenceScopedAnswer &&
    !rowScopedSuperlativeAnswer
  ) {
    return null;
  }
  if (
    !sentenceScopedAnswer &&
    !rowScopedSuperlativeAnswer &&
    !rowScopedMetricAggregateAnswer &&
    !hasPageReadAnswerIntent(requestText, _snapshot)
  ) {
    return null;
  }
  const taskContract = buildTaskContract(requestText);
  const hasConcreteMultiReturn =
    (taskContract.multiReturnCount ?? 0) >= 2 &&
    taskContract.requiredEntities.length >=
      (taskContract.multiReturnCount ?? 0);
  const rowScopedAnswer = getGroundedRowScopedLabelValueQuestion(
    requestText,
    _snapshot,
  );
  const groundedLabelValueQuestionLabel = getGroundedLabelValueQuestionLabel(
    requestText,
    _snapshot,
  );
  const groundedLabelValueBypassesScopedTargetGate =
    groundedLabelValueQuestionCanBypassScopedTargetGate(
      requestText,
      groundedLabelValueQuestionLabel,
    );
  const targetSpecificLabelQuestion =
    !rowScopedAnswer &&
    !sentenceScopedAnswer &&
    !groundedLabelValueBypassesScopedTargetGate
      ? extractRowScopedLabelValueQuestionParts(requestText)
      : null;
  const targetSpecificLabelRequiresScopedEvidence = targetSpecificLabelQuestion
    ? readAnswerLabelRequiresScopedTargetEvidence(
        targetSpecificLabelQuestion.label,
      )
    : false;
  if (targetSpecificLabelRequiresScopedEvidence) {
    return null;
  }
  const expectedAnswerLabel =
    rowScopedAnswer?.label ??
    rowScopedSuperlativeAnswer?.label ??
    rowScopedMetricAggregateAnswer?.label ??
    sentenceScopedAnswer?.label ??
    (targetSpecificLabelRequiresScopedEvidence
      ? null
      : groundedLabelValueQuestionLabel);

  return {
    contract: {
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
      ...(hasConcreteMultiReturn ? { taskContract } : {}),
      ...(expectedAnswerLabel ? { expectedAnswerLabel } : {}),
      ...(rowScopedAnswer
        ? {
            expectedAnswerTarget: rowScopedAnswer.target,
            expectedAnswerScope: "row" as const,
          }
        : rowScopedSuperlativeAnswer
          ? {
              expectedAnswerTarget: rowScopedSuperlativeAnswer.target,
              expectedAnswerScope: "sentence" as const,
            }
          : rowScopedMetricAggregateAnswer
            ? {
                expectedAnswerScope: "aggregate" as const,
              }
            : sentenceScopedAnswer
              ? {
                  expectedAnswerTarget: sentenceScopedAnswer.target,
                  expectedAnswerScope: "sentence" as const,
                }
              : {}),
    },
    confidence: "medium",
    source: hasConcreteMultiReturn ? "task_contract" : "heuristic",
    repairable: true,
    notes: hasConcreteMultiReturn
      ? [
          `multi-return coverage requires ${taskContract.multiReturnCount} returned entities`,
        ]
      : [],
  };
}

function readAnswerLabelRequiresScopedTargetEvidence(label: string): boolean {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) return false;
  if (normalizedLabel === "definition") return true;
  if (sentenceScopedReasonPredicatePatternForLabel(normalizedLabel))
    return true;
  if (normalizedLabel === "location") return true;
  if (sentenceScopedEventDatePatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedPresenceMetricPatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedMetricValuePatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedSuperlativeMetricPartsForLabel(normalizedLabel))
    return true;
  if (rowScopedMetricAggregatePartsForLabel(normalizedLabel)) return true;
  if (
    normalizedLabel === "status" ||
    normalizedLabel === "priority" ||
    normalizedLabel === "severity" ||
    normalizedLabel === "due date" ||
    normalizedLabel === "number" ||
    normalizedLabel === "count" ||
    normalizedLabel === "quantity" ||
    normalizedLabel === "value"
  ) {
    return true;
  }
  return Boolean(
    sentenceScopedAttributePatternForLabel(normalizedLabel) ||
    sentenceScopedRelationNounPatternForLabel(normalizedLabel) ||
    sentenceScopedByRelationPatternForLabel(normalizedLabel) ||
    sentenceScopedActiveRelationPatternForLabel(normalizedLabel),
  );
}

function groundedLabelValueQuestionCanBypassScopedTargetGate(
  question: string,
  label: string | null,
): boolean {
  if (!label) return false;
  return /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are|\s+was|\s+were)\s+(?:the\s+)?(?:total\s+)?(?:number|count|quantity)\s+of\s+/i.test(
    cleanLabel(question),
  );
}

function getGroundedLabelValueQuestionLabel(
  question: string,
  snapshot?: DomSnapshot | null,
): string | null {
  if (!snapshot) return null;
  const pageText = snapshotPageText(snapshot);
  if (!hasSubstantiveReadAnswerEvidence(pageText)) return null;
  return findGroundedLabelValueQuestionLabel(normalizeText(question), pageText);
}

function getGroundedRowScopedLabelValueQuestion(
  question: string,
  snapshot?: DomSnapshot | null,
): { label: string; target: string } | null {
  if (!snapshot) return null;
  return findGroundedRowScopedLabelValueQuestion(question, snapshot);
}

function getGroundedSentenceScopedAnswer(
  question: string,
  snapshot?: DomSnapshot | null,
): { label: string; target: string } | null {
  if (!snapshot) return null;
  return findGroundedSentenceScopedAnswer(question, snapshotPageText(snapshot));
}

function getGroundedRowScopedSuperlativeMetricAnswer(
  question: string,
  snapshot?: DomSnapshot | null,
): { label: string; target: string } | null {
  if (!snapshot) return null;
  const superlativeMetricQuestion =
    extractSentenceScopedSuperlativeMetricQuestionParts(question);
  if (!superlativeMetricQuestion) return null;

  const winner = findReadAnswerSuperlativeMetricWinnerFromSnapshotRows(
    snapshot,
    superlativeMetricQuestion.metric,
    superlativeMetricQuestion.direction,
  );
  if (!winner) return null;

  return {
    label: superlativeMetricQuestion.label,
    target: winner.target,
  };
}

function getGroundedRowScopedMetricAggregateAnswer(
  question: string,
  snapshot?: DomSnapshot | null,
): { label: string } | null {
  if (!snapshot) return null;
  const metricAggregateQuestion =
    extractRowScopedMetricAggregateQuestionParts(question);
  if (!metricAggregateQuestion) return null;

  const aggregate = findReadAnswerMetricAggregateFromSnapshotRows(
    snapshot,
    metricAggregateQuestion.label,
  );
  return aggregate ? { label: metricAggregateQuestion.label } : null;
}

export function findReadAnswerSuperlativeMetricWinnerFromSnapshotRows(
  snapshot: DomSnapshot,
  metric: string,
  direction: SentenceScopedSuperlativeDirection,
): ReadAnswerSuperlativeMetricCandidate | null {
  const candidates = snapshot.elements
    .filter((element) => element.isVisible && !element.isDisabled)
    .filter(isWorkflowRowLikeElement)
    .map(readAnswerRowElementText)
    .map((rowText) => cleanLabel(rowText))
    .filter(Boolean)
    .filter((rowText) => rowText.length <= 500)
    .map((rowText) =>
      extractReadAnswerSuperlativeMetricCandidate(rowText, metric),
    )
    .filter(
      (candidate): candidate is ReadAnswerSuperlativeMetricCandidate =>
        candidate !== null,
    );
  return selectReadAnswerSuperlativeMetricWinner(candidates, direction);
}

export function evaluateReadAnswer(params: {
  contract: ReadAnswerContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): CompletionEvaluation {
  const contract = params.contract;
  if (params.summary && contract.taskContract?.multiReturnCount) {
    const coverage = assessTaskContractCoverage({
      contract: contract.taskContract,
      text: params.summary,
    });
    if (coverage.missingMultiReturnCoverage) {
      return {
        status: "rejected",
        reason:
          `Read-answer summary is missing required multi-return coverage. ` +
          `Missing: ${coverage.missingEntities.join(", ") || "additional requested result"}.`,
        contract,
        evidence: params.evidence,
      };
    }
  }
  const pageEvidence = params.evidence
    .filter(
      (event): event is Extract<CompletionEvidence, { type: "answer_state" }> =>
        event.type === "answer_state" && event.detail.source === "page_read",
    )
    .sort(compareEvidenceRecency);
  const groundedEvidence = pageEvidence.find((event) =>
    hasSubstantiveReadAnswerEvidence(event.detail.evidenceText),
  );

  const snapshotEvidence =
    params.snapshot &&
    hasSubstantiveReadAnswerEvidence(snapshotPageText(params.snapshot))
      ? readAnswerSnapshotEvidence({
          snapshot: params.snapshot,
          observedAtTurn: latestObservedTurn(params.evidence),
        })
      : null;

  const rowScopedEvidence =
    contract.expectedAnswerScope === "row" &&
    contract.expectedAnswerLabel &&
    contract.expectedAnswerTarget &&
    (params.snapshot || pageEvidence.length > 0)
      ? ((params.snapshot
          ? readAnswerRowScopedSnapshotEvidence({
              snapshot: params.snapshot,
              expectedAnswerLabel: contract.expectedAnswerLabel,
              expectedAnswerTarget: contract.expectedAnswerTarget,
              observedAtTurn: latestObservedTurn(params.evidence),
            })
          : null) ??
        readAnswerRowScopedTextEvidence({
          evidence: pageEvidence,
          expectedAnswerLabel: contract.expectedAnswerLabel,
          expectedAnswerTarget: contract.expectedAnswerTarget,
        }))
      : null;
  const sentenceScopedEvidence =
    contract.expectedAnswerScope === "sentence" &&
    contract.expectedAnswerLabel &&
    contract.expectedAnswerTarget &&
    (params.snapshot || pageEvidence.length > 0)
      ? ((params.snapshot
          ? readAnswerSentenceScopedSnapshotEvidence({
              snapshot: params.snapshot,
              expectedAnswerLabel: contract.expectedAnswerLabel,
              expectedAnswerTarget: contract.expectedAnswerTarget,
              observedAtTurn: latestObservedTurn(params.evidence),
            })
          : null) ??
        readAnswerSentenceScopedTextEvidence({
          evidence: pageEvidence,
          expectedAnswerLabel: contract.expectedAnswerLabel,
          expectedAnswerTarget: contract.expectedAnswerTarget,
        }))
      : null;
  const aggregateScopedEvidence =
    contract.expectedAnswerScope === "aggregate" &&
    contract.expectedAnswerLabel &&
    (params.snapshot || pageEvidence.length > 0)
      ? ((params.snapshot
          ? readAnswerAggregateScopedSnapshotEvidence({
              snapshot: params.snapshot,
              expectedAnswerLabel: contract.expectedAnswerLabel,
              observedAtTurn: latestObservedTurn(params.evidence),
            })
          : null) ??
        readAnswerAggregateScopedTextEvidence({
          evidence: pageEvidence,
          expectedAnswerLabel: contract.expectedAnswerLabel,
        }))
      : null;

  if (
    contract.expectedAnswerScope === "row" &&
    contract.expectedAnswerLabel &&
    contract.expectedAnswerTarget &&
    !rowScopedEvidence
  ) {
    return {
      status: "needs_verification",
      reason:
        "Requested row-scoped page-answer task has no matching visible row evidence yet.",
      hint: "Read the visible row for the requested item, then call done with the value from that row.",
      contract,
      evidence: params.evidence,
    };
  }
  if (
    contract.expectedAnswerScope === "sentence" &&
    contract.expectedAnswerLabel &&
    contract.expectedAnswerTarget &&
    !sentenceScopedEvidence
  ) {
    return {
      status: "needs_verification",
      reason:
        "Requested sentence-scoped page-answer task has no matching visible sentence evidence yet.",
      hint: "Read the visible sentence for the requested item, then call done with the value from that sentence.",
      contract,
      evidence: params.evidence,
    };
  }
  if (
    contract.expectedAnswerScope === "aggregate" &&
    contract.expectedAnswerLabel &&
    !aggregateScopedEvidence
  ) {
    return {
      status: "needs_verification",
      reason:
        "Requested aggregate page-answer task has no matching visible row evidence yet.",
      hint: "Read the visible rows for the requested metric, then call done with the computed aggregate.",
      contract,
      evidence: params.evidence,
    };
  }

  const sourceEvidence =
    rowScopedEvidence ??
    sentenceScopedEvidence ??
    aggregateScopedEvidence ??
    groundedEvidence ??
    snapshotEvidence;
  if (!sourceEvidence) {
    return {
      status: "needs_verification",
      reason:
        "Requested page-answer task has no grounded page-read evidence yet.",
      hint: "Call read_page first to verify the current page content, then call done with the answer from that evidence.",
      contract,
      evidence: params.evidence,
    };
  }

  if (
    params.summary &&
    !(["sentence", "aggregate"].includes(contract.expectedAnswerScope ?? "")
      ? readAnswerSummaryMatchesSentenceScopedAnswer(
          params.summary,
          sourceEvidence.detail.answer,
        )
      : readAnswerSummaryGroundedInEvidence(
          params.summary,
          sourceEvidence,
          contract.expectedAnswerLabel,
        ))
  ) {
    return {
      status: "inconclusive",
      reason:
        "Page-read evidence exists, but the done summary is not grounded strongly enough for deterministic read-answer acceptance.",
      contract,
      evidence: [sourceEvidence],
    };
  }

  return {
    status: "accepted",
    reason: "Read-answer contract is satisfied by grounded page evidence.",
    contract,
    evidence: [sourceEvidence],
  };
}

function readAnswerSnapshotEvidence(params: {
  snapshot: DomSnapshot;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }> {
  const evidenceText = snapshotPageText(params.snapshot);
  const pageKey =
    compactKey(params.snapshot.url) ||
    compactKey(params.snapshot.title ?? "") ||
    "current-page";
  return {
    type: "answer_state",
    confidence: "medium",
    logicalKey: `read_answer:page:${pageKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      answer: evidenceText.slice(0, 1000),
      source: "page_read",
      evidenceText: evidenceText.slice(0, 4000),
      ...(params.snapshot.url ? { url: params.snapshot.url } : {}),
    },
  };
}

function readAnswerRowScopedSnapshotEvidence(params: {
  snapshot: DomSnapshot;
  expectedAnswerLabel: string;
  expectedAnswerTarget: string;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  const rowText = findReadAnswerRowScopedLabelValueText(
    params.snapshot,
    params.expectedAnswerTarget,
    params.expectedAnswerLabel,
  );
  if (!rowText) return null;

  const targetKey = compactKey(params.expectedAnswerTarget) || "target";
  const labelKey = compactKey(params.expectedAnswerLabel) || "label";
  return {
    type: "answer_state",
    confidence: "high",
    logicalKey: `read_answer:row:${targetKey}:${labelKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      answer: rowText.slice(0, 1000),
      source: "page_read",
      evidenceText: rowText.slice(0, 4000),
      ...(params.snapshot.url ? { url: params.snapshot.url } : {}),
    },
  };
}

function readAnswerRowScopedTextEvidence(params: {
  evidence: Extract<CompletionEvidence, { type: "answer_state" }>[];
  expectedAnswerLabel: string;
  expectedAnswerTarget: string;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  for (const event of params.evidence) {
    const rowText = findReadAnswerRowScopedLabelValueLine(
      event.detail.evidenceText,
      params.expectedAnswerTarget,
      params.expectedAnswerLabel,
    );
    if (!rowText) continue;

    const targetKey = compactKey(params.expectedAnswerTarget) || "target";
    const labelKey = compactKey(params.expectedAnswerLabel) || "label";
    return {
      ...event,
      confidence: event.confidence === "high" ? "high" : "medium",
      logicalKey: `read_answer:row-text:${targetKey}:${labelKey}`,
      detail: {
        ...event.detail,
        answer: rowText.slice(0, 1000),
        evidenceText: rowText.slice(0, 4000),
      },
    };
  }
  return null;
}

function readAnswerAggregateScopedSnapshotEvidence(params: {
  snapshot: DomSnapshot;
  expectedAnswerLabel: string;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  const aggregate = findReadAnswerMetricAggregateFromSnapshotRows(
    params.snapshot,
    params.expectedAnswerLabel,
  );
  if (!aggregate) return null;

  const labelKey = compactKey(params.expectedAnswerLabel) || "label";
  return {
    type: "answer_state",
    confidence: "high",
    logicalKey: `read_answer:aggregate:${labelKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      answer: aggregate.answer.slice(0, 1000),
      source: "page_read",
      evidenceText: aggregate.evidenceText.slice(0, 4000),
      ...(params.snapshot.url ? { url: params.snapshot.url } : {}),
    },
  };
}

function readAnswerAggregateScopedTextEvidence(params: {
  evidence: Extract<CompletionEvidence, { type: "answer_state" }>[];
  expectedAnswerLabel: string;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  for (const event of params.evidence) {
    const aggregate = findReadAnswerMetricAggregateFromTextLines(
      event.detail.evidenceText,
      params.expectedAnswerLabel,
    );
    if (!aggregate) continue;

    const labelKey = compactKey(params.expectedAnswerLabel) || "label";
    return {
      ...event,
      confidence: event.confidence === "high" ? "high" : "medium",
      logicalKey: `read_answer:aggregate-text:${labelKey}`,
      detail: {
        ...event.detail,
        answer: aggregate.answer.slice(0, 1000),
        evidenceText: aggregate.evidenceText.slice(0, 4000),
      },
    };
  }
  return null;
}

function readAnswerSentenceScopedSnapshotEvidence(params: {
  snapshot: DomSnapshot;
  expectedAnswerLabel: string;
  expectedAnswerTarget: string;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  const answer =
    findReadAnswerRowScopedSuperlativeMetricAnswer(
      params.snapshot,
      params.expectedAnswerTarget,
      params.expectedAnswerLabel,
    ) ??
    findReadAnswerSentenceScopedAnswer(
      snapshotPageText(params.snapshot),
      params.expectedAnswerTarget,
      params.expectedAnswerLabel,
    );
  if (!answer) return null;

  const targetKey = compactKey(params.expectedAnswerTarget) || "target";
  const labelKey = compactKey(params.expectedAnswerLabel) || "label";
  return {
    type: "answer_state",
    confidence: "high",
    logicalKey: `read_answer:sentence:${targetKey}:${labelKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      answer: answer.answer.slice(0, 1000),
      source: "page_read",
      evidenceText: answer.sentence.slice(0, 4000),
      ...(params.snapshot.url ? { url: params.snapshot.url } : {}),
    },
  };
}

function findReadAnswerRowScopedSuperlativeMetricAnswer(
  snapshot: DomSnapshot,
  expectedTarget: string,
  expectedAnswerLabel: string,
): { sentence: string; answer: string } | null {
  const superlative =
    sentenceScopedSuperlativeMetricPartsForLabel(expectedAnswerLabel);
  if (!superlative) return null;

  const winner = findReadAnswerSuperlativeMetricWinnerFromSnapshotRows(
    snapshot,
    superlative.metric,
    superlative.direction,
  );
  if (!winner) return null;
  if (!workflowTargetLabelCoveredByText(expectedTarget, winner.target)) {
    return null;
  }
  return { sentence: winner.sentence, answer: winner.target };
}

function readAnswerSentenceScopedTextEvidence(params: {
  evidence: Extract<CompletionEvidence, { type: "answer_state" }>[];
  expectedAnswerLabel: string;
  expectedAnswerTarget: string;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  for (const event of params.evidence) {
    const answer = findReadAnswerSentenceScopedAnswer(
      event.detail.evidenceText,
      params.expectedAnswerTarget,
      params.expectedAnswerLabel,
    );
    if (!answer) continue;

    const targetKey = compactKey(params.expectedAnswerTarget) || "target";
    const labelKey = compactKey(params.expectedAnswerLabel) || "label";
    return {
      ...event,
      confidence: event.confidence === "high" ? "high" : "medium",
      logicalKey: `read_answer:sentence-text:${targetKey}:${labelKey}`,
      detail: {
        ...event.detail,
        answer: answer.answer.slice(0, 1000),
        evidenceText: answer.sentence.slice(0, 4000),
      },
    };
  }
  return null;
}

export function readAnswerToolEvidence(params: {
  result: string;
  snapshot?: DomSnapshot | null;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }>[] {
  const evidenceText = cleanReadAnswerEvidenceText(params.result, {
    preserveLines: true,
  });
  if (!hasSubstantiveReadAnswerEvidence(evidenceText)) return [];

  const pageKey =
    compactKey(params.snapshot?.url ?? "") ||
    compactKey(params.snapshot?.title ?? "") ||
    hashStableString(evidenceText.slice(0, 500));
  return [
    {
      type: "answer_state",
      confidence: "high",
      logicalKey: `read_answer:page:${pageKey}`,
      observedAtTurn: params.observedAtTurn,
      detail: {
        answer: cleanLabel(evidenceText).slice(0, 1000),
        source: "page_read",
        evidenceText: evidenceText.slice(0, 4000),
        ...(params.snapshot?.url ? { url: params.snapshot.url } : {}),
      },
    },
  ];
}

function findReadAnswerRowScopedLabelValueLine(
  evidenceText: string,
  target: string,
  expectedAnswerLabel: string,
): string | null {
  const lines = evidenceText
    .split(/[\r\n]+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean);
  if (lines.length < 2) return null;

  for (const line of lines) {
    if (line.length > 500) continue;
    if (!workflowTargetLabelCoveredByText(target, line)) continue;
    if (!extractExpectedLabelValueAnswer(line, expectedAnswerLabel)) continue;
    return line;
  }
  return null;
}

function cleanReadAnswerEvidenceText(
  value: string,
  options: { preserveLines?: boolean } = {},
): string {
  const cleaned = value
    .replace(/^Page\s+(?:content|text|read)\s*:\s*/i, "")
    .replace(/^Result\s*:\s*/i, "");
  if (!options.preserveLines) return cleanLabel(cleaned);
  return cleaned
    .split(/[\r\n]+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean)
    .join("\n");
}

function readAnswerSummaryMatchesSentenceScopedAnswer(
  summary: string,
  expectedAnswer: string,
): boolean {
  const valueWords = cleanLabel(expectedAnswer).split(/\s+/).filter(Boolean);
  if (valueWords.length === 0) return false;

  const normalizedSummary = normalizeText(summary);
  if (valueWords.length >= 2) {
    return labelValuePhraseCoveredBySummary(normalizedSummary, valueWords);
  }
  const normalizedValue = normalizeText(valueWords[0]);
  if (normalizedValue === "zero" || normalizedValue === "0") {
    return (
      valueTokenCoveredBySummary(normalizedSummary, "zero") ||
      valueTokenCoveredBySummary(normalizedSummary, "0")
    );
  }
  return valueTokenCoveredBySummary(normalizedSummary, normalizedValue);
}
