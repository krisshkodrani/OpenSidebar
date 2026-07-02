import type { DomSnapshot } from "../../../types";
import { countExplicitSteps } from "../explicit-steps";
import { getListDetailDoneRejection } from "../list-detail-policy";
import {
  isDoneSummaryGroundedInSnapshot,
  requiresGroundingReadBeforeDone,
} from "../loop-helpers";
import { getIncompleteDoneSummaryReason } from "../summary-completeness";
import {
  assessTaskContractCoverage,
  buildTaskContract,
} from "../task-contract";
import { getAutocompleteSuggestionDoneRejection } from "../text-entry-guards";
import { assessWorkflowDoneGuard } from "../verification";
import { cleanLabel, escapeRegExp, normalizeText } from "./text-utils";
import type {
  CompletionEarlyMultiStepPreflight,
  CompletionGroundingReadPreflight,
  CompletionListDetailReviewPreflight,
  CompletionMoneyTableAggregatePreflight,
  CompletionPendingAutocompletePreflight,
  CompletionRequiredEvidencePreflight,
  CompletionSummaryPreflight,
  CompletionTaskContractPreflight,
  CompletionWorkflowContractPreflight,
} from "./kernel-types";

type RequestedAttributeKind =
  | "availability_date"
  | "specifications"
  | "amenity"
  | "nearby_attractions"
  | "activities"
  | "calculator_result"
  | "price"
  | "rating"
  | "filter_constraint";

interface RequestedAttributeExpectation {
  kind: RequestedAttributeKind;
  label: string;
  requiredTerms: string[];
}

export function isDoneSummaryAskingClarification(summary: string): boolean {
  const text = summary.trim();
  if (!text.includes("?")) return false;

  const lower = text.toLowerCase();
  const hasCompletionFrame =
    /\b(completed|successfully|identified|found|located|confirmed|verified|posted|sent|drafted|updated|read|analysis complete|summary)\b/.test(
      lower,
    );
  if (hasCompletionFrame) return false;

  if (
    /^(can|could|should|do|does|did|is|are|which|what|when|where|who|why|how|would|please)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return /\?$/.test(text);
}

export function evaluateCompletionSummaryPreflight(params: {
  summary: string;
  taskContext: string;
  turnCount: number;
  rootUserRequest?: string;
  isOrchestratorNode?: boolean;
}): CompletionSummaryPreflight {
  if (
    params.turnCount <= 2 &&
    isDoneSummaryAskingClarification(params.summary)
  ) {
    return {
      status: "needs_clarification",
      reason: "done_summary_is_question",
    };
  }

  const incompleteReason = getIncompleteDoneSummaryReason({
    summary: params.summary,
    taskContext: params.taskContext,
  });
  if (incompleteReason) {
    return {
      status: "rejected",
      kind: "incomplete_summary",
      reason: incompleteReason,
    };
  }

  if (params.rootUserRequest && !params.isOrchestratorNode) {
    const requestedAttributeRejection =
      getRequestedAttributeDoneSummaryRejection({
        userRequest: params.rootUserRequest,
        summary: params.summary,
      });
    if (requestedAttributeRejection) {
      return {
        status: "rejected",
        kind: "missing_requested_attribute",
        reason: requestedAttributeRejection,
      };
    }

    const multiReturnContract = buildTaskContract(params.rootUserRequest);
    if ((multiReturnContract.multiReturnCount ?? 0) >= 2) {
      const multiCoverage = assessTaskContractCoverage({
        contract: multiReturnContract,
        text: params.summary,
      });
      if (!multiCoverage.satisfied) {
        return {
          status: "rejected",
          kind: "missing_multi_return_coverage",
          reason:
            `Query requires ${multiReturnContract.multiReturnCount} results ` +
            `(detected "both"/"all") but summary only covers ` +
            `${multiReturnContract.requiredEntities.length - multiCoverage.missingEntities.length}. ` +
            `Missing: ${multiCoverage.missingEntities.join(", ")}`,
        };
      }
    }
  }

  return { status: "valid" };
}

function getRequestedAttributeDoneSummaryRejection(params: {
  userRequest: string;
  summary: string;
}): string | null {
  const expectations = extractRequestedAttributeExpectations(
    params.userRequest,
  );
  if (expectations.length === 0) return null;

  const missing = expectations.filter(
    (expectation) =>
      !summarySatisfiesRequestedAttribute(params.summary, expectation),
  );
  if (missing.length === 0) return null;

  const labels = missing.map((expectation) => expectation.label).join(", ");
  const weakCompletion = isWeakSearchOrPageCompletionSummary(params.summary);
  return (
    (weakCompletion
      ? "final summary only confirms the target page/entity/result was found"
      : "final summary does not answer all requested attributes") +
    `; missing requested attribute(s): ${labels}`
  );
}

function extractRequestedAttributeExpectations(
  userRequest: string,
): RequestedAttributeExpectation[] {
  const text = normalizeForAttributeMatching(userRequest);
  const expectations: RequestedAttributeExpectation[] = [];

  const add = (
    kind: RequestedAttributeKind,
    label: string,
    requiredTerms: string[],
  ) => {
    const cleanedLabel = cleanAttributeLabel(label);
    if (!cleanedLabel) return;
    if (
      expectations.some(
        (expectation) => expectation.label === cleanedLabel,
      )
    ) {
      return;
    }
    expectations.push({
      kind,
      label: cleanedLabel,
      requiredTerms,
    });
  };

  if (
    /\b(?:next\s+available\s+date|available\s+dates?|availability|available\s+appointment|reservation\s+date)\b/.test(
      text,
    )
  ) {
    add("availability_date", "next available date", [
      "available",
      "date",
    ]);
  }

  if (
    /\b(?:tech(?:nical)?\s+specs?|specifications?|product\s+specs?|laptop\s+specs?)\b/.test(
      text,
    )
  ) {
    add("specifications", "technical specifications", ["specifications"]);
  }

  if (/\bnearby\s+attractions?\b|\battractions?\s+near(?:by)?\b/.test(text)) {
    add("nearby_attractions", "nearby attractions", [
      "nearby",
      "attractions",
    ]);
  }

  if (
    /\bactivities?\b/.test(text) &&
    /\b(?:find|show|list|search|filter|available|book|reserve|cruise|excursion)\b/.test(
      text,
    )
  ) {
    add("activities", "activities", ["activities"]);
  }

  if (/\b(?:percentile|calculator|calculate)\b/.test(text)) {
    if (/\bpercentile\b/.test(text)) {
      add("calculator_result", "percentile result", ["percentile"]);
    } else if (/\bcalculator\b|\bcalculate\b/.test(text)) {
      add("calculator_result", "calculator result", ["result"]);
    }
  }

  if (/\b(?:price|prices|cost|fee|fare|rate|rates)\b/.test(text)) {
    add("price", "price or cost", ["price"]);
  }

  if (/\b(?:rating|ratings|stars?|review\s+score)\b/.test(text)) {
    add("rating", "rating", ["rating"]);
  }

  if (
    /\b(?:houses?|homes?|apartments?|condos?|properties|rentals?|hotels?|rooms?|stays?|listings?)\b/.test(
      text,
    )
  ) {
    for (const amenity of extractAmenityExpectations(text)) {
      add("amenity", amenity.label, amenity.requiredTerms);
    }
  }

  for (const constraint of extractWithClauseConstraints(userRequest)) {
    add("filter_constraint", constraint, significantTerms(constraint));
  }

  return expectations;
}

function extractAmenityExpectations(
  normalizedRequest: string,
): RequestedAttributeExpectation[] {
  const expectations: RequestedAttributeExpectation[] = [];
  const amenityPatterns: Array<{
    label: string;
    requiredTerms: string[];
    pattern: RegExp;
  }> = [
    {
      label: "pool",
      requiredTerms: ["pool"],
      pattern: /\bpool\b/,
    },
    {
      label: "private outdoor space",
      requiredTerms: ["private", "outdoor", "space"],
      pattern: /\bprivate\s+outdoor\s+(?:space|area|patio|yard|balcony)\b/,
    },
    {
      label: "outdoor space",
      requiredTerms: ["outdoor", "space"],
      pattern: /\boutdoor\s+(?:space|area|patio|yard|balcony)\b/,
    },
    {
      label: "garage",
      requiredTerms: ["garage"],
      pattern: /\bgarage\b/,
    },
    {
      label: "parking",
      requiredTerms: ["parking"],
      pattern: /\bparking\b/,
    },
    {
      label: "bedrooms",
      requiredTerms: ["bedroom"],
      pattern: /\bbedrooms?\b/,
    },
    {
      label: "bathrooms",
      requiredTerms: ["bathroom"],
      pattern: /\bbathrooms?\b/,
    },
  ];

  for (const amenity of amenityPatterns) {
    if (amenity.pattern.test(normalizedRequest)) {
      expectations.push({
        kind: "amenity",
        label: amenity.label,
        requiredTerms: amenity.requiredTerms,
      });
    }
  }
  return expectations;
}

function extractWithClauseConstraints(userRequest: string): string[] {
  const normalized = normalizeForAttributeMatching(userRequest);
  if (
    !/\b(?:find|show|list|search|filter|display|give|tell)\b/.test(
      normalized,
    )
  ) {
    return [];
  }

  const constraints: string[] = [];
  for (const match of normalized.matchAll(
    /\bwith\s+(.+?)(?=\s+(?:on|from|for|near|at|using|where|that|which)\b|[.;?]|$)/g,
  )) {
    const clause = cleanAttributeLabel(match[1] ?? "");
    if (!clause || clause.length > 100) continue;
    for (const part of clause.split(/\s*(?:,|&|\/|\band\b|\bor\b)\s*/)) {
      const cleaned = cleanAttributeLabel(part);
      if (!cleaned) continue;
      if (isGenericConstraint(cleaned)) continue;
      constraints.push(cleaned);
    }
  }
  return constraints;
}

function summarySatisfiesRequestedAttribute(
  summary: string,
  expectation: RequestedAttributeExpectation,
): boolean {
  const raw = cleanLabel(summary);
  const text = normalizeForAttributeMatching(raw);

  if (isAttributeSpecificNegativeAnswer(text, expectation)) return true;

  switch (expectation.kind) {
    case "availability_date":
      return hasAvailabilityDateAnswer(text);
    case "specifications":
      return hasSpecificationAnswer(text);
    case "nearby_attractions":
      return hasListAnswerForLabel(text, /\b(?:nearby\s+)?attractions?\b/);
    case "activities":
      return hasListAnswerForLabel(text, /\bactivities?\b/);
    case "calculator_result":
      return hasCalculatorResultAnswer(text, expectation);
    case "price":
      return hasPriceAnswer(text);
    case "rating":
      return hasRatingAnswer(text);
    case "amenity":
    case "filter_constraint":
      return requiredTermsCovered(text, expectation.requiredTerms);
    default:
      return false;
  }
}

function hasAvailabilityDateAnswer(normalizedSummary: string): boolean {
  const mentionsAvailability =
    /\b(?:available|availability|date|reservation|appointment)\b/.test(
      normalizedSummary,
    );
  return mentionsAvailability && hasDateLikeValue(normalizedSummary);
}

function hasSpecificationAnswer(normalizedSummary: string): boolean {
  const specSignals = [
    /\b(?:cpu|gpu|processor|chip|cores?|neural\s+engine)\b/,
    /\b(?:memory|ram|storage|ssd|tb|gb)\b/,
    /\b(?:display|screen|retina|resolution|inch|inches)\b/,
    /\b(?:battery|ports?|thunderbolt|usb|hdmi|weight|dimensions?)\b/,
    /\b(?:m[1-9]|intel|amd|ryzen|snapdragon|geforce|radeon)\b/,
  ];
  const signalCount = specSignals.filter((pattern) =>
    pattern.test(normalizedSummary),
  ).length;
  const hasSpecLabel = /\b(?:specs?|specifications?|technical)\b/.test(
    normalizedSummary,
  );
  return signalCount >= 2 || (hasSpecLabel && signalCount >= 1);
}

function hasListAnswerForLabel(
  normalizedSummary: string,
  labelPattern: RegExp,
): boolean {
  if (!labelPattern.test(normalizedSummary)) return false;
  if (/\b(?:include|includes|including|are|listed|matching|found)\b/.test(
    normalizedSummary,
  )) {
    return hasListLikeDetail(normalizedSummary);
  }
  return /\b\d+\s+(?:matching\s+)?(?:results?|items?|activities?|attractions?|listings?)\b/.test(
    normalizedSummary,
  );
}

function hasCalculatorResultAnswer(
  normalizedSummary: string,
  expectation: RequestedAttributeExpectation,
): boolean {
  if (!requiredTermsCovered(normalizedSummary, expectation.requiredTerms)) {
    return false;
  }
  return /\b\d+(?:\.\d+)?\s*(?:st|nd|rd|th)?\s*percentile\b/.test(
    normalizedSummary,
  ) || /\b\d+(?:\.\d+)?\s*%\b/.test(normalizedSummary);
}

function hasPriceAnswer(normalizedSummary: string): boolean {
  return /\$\s*\d[\d,]*(?:\.\d{2})?\b/.test(normalizedSummary) ||
    /\b\d[\d,]*(?:\.\d{2})?\s*(?:usd|dollars?|per\s+night|per\s+person|each)\b/.test(
      normalizedSummary,
    );
}

function hasRatingAnswer(normalizedSummary: string): boolean {
  return /\b\d(?:\.\d+)?\s*(?:\/\s*5|stars?|rating|review\s+score)\b/.test(
    normalizedSummary,
  );
}

function hasDateLikeValue(normalizedSummary: string): boolean {
  return (
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b/.test(
      normalizedSummary,
    ) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(normalizedSummary) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(normalizedSummary) ||
    /\b(?:today|tomorrow)\b/.test(normalizedSummary)
  );
}

function hasListLikeDetail(normalizedSummary: string): boolean {
  if (/[,:;]/.test(normalizedSummary)) return true;
  return /\b(?:include|includes|including|are)\b\s+[a-z0-9][a-z0-9\s'-]{8,}\s+\band\b\s+[a-z0-9]/.test(
    normalizedSummary,
  );
}

function isAttributeSpecificNegativeAnswer(
  normalizedSummary: string,
  expectation: RequestedAttributeExpectation,
): boolean {
  if (!summaryMentionsExpectation(normalizedSummary, expectation)) return false;

  const explicitNoValue =
    /\b(?:no|not)\s+(?:available|availability|matching|results?|listings?|dates?|activities?|attractions?|specifications?|specs?|ratings?|prices?|percentile|calculator\s+result)\b/.test(
      normalizedSummary,
    ) ||
    /\b(?:unavailable|not\s+listed|not\s+shown|not\s+visible)\b/.test(
      normalizedSummary,
    );
  if (explicitNoValue) return true;

  const couldNotFind =
    /\b(?:could\s+not|couldn't|did\s+not|didn't|unable\s+to)\s+find\b/.test(
      normalizedSummary,
    ) || /\bnot\s+found\b/.test(normalizedSummary);
  if (!couldNotFind) return false;

  return /\b(?:after|checked|checking|inspected|reviewed|read|opened|detail|details|calendar|filters?|calculator|specifications?|results?)\b/.test(
    normalizedSummary,
  );
}

function summaryMentionsExpectation(
  normalizedSummary: string,
  expectation: RequestedAttributeExpectation,
): boolean {
  if (phraseCovered(normalizedSummary, expectation.label)) return true;
  return expectation.requiredTerms.some((term) =>
    phraseCovered(normalizedSummary, term),
  );
}

function requiredTermsCovered(
  normalizedSummary: string,
  requiredTerms: string[],
): boolean {
  return requiredTerms.every((term) => phraseCovered(normalizedSummary, term));
}

function phraseCovered(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizeForAttributeMatching(phrase);
  if (!normalizedPhrase) return false;
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedPhrase).replace(/\s+/g, "\\s+")}(?=$|[^a-z0-9])`,
  );
  if (pattern.test(normalizedText)) return true;

  if (normalizedPhrase === "space") {
    return /\b(?:space|area|patio|yard|balcony)\b/.test(normalizedText);
  }
  return false;
}

function significantTerms(value: string): string[] {
  return normalizeForAttributeMatching(value)
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 3 &&
        !new Set([
          "the",
          "and",
          "for",
          "with",
          "that",
          "this",
          "from",
          "into",
          "onto",
          "any",
          "all",
        ]).has(token),
    );
}

function isWeakSearchOrPageCompletionSummary(summary: string): boolean {
  const text = normalizeForAttributeMatching(summary);
  return (
    /\bsuccessfully\s+(?:searched|found|located|opened|navigated)\b/.test(
      text,
    ) ||
    /\b(?:search\s+results?|results\s+page|listing|listings|product\s+page|detail\s+page|page)\b.{0,80}\b(?:open|visible|display|displays|displayed|shows|shown|loaded|found)\b/.test(
      text,
    ) ||
    /\b(?:found|located)\b.{0,100}\b(?:first\s+listing|in\s+the\s+results|on\s+the\s+page|page)\b/.test(
      text,
    ) ||
    /\b(?:url|page)\s+(?:confirms|shows|displays)\b/.test(text)
  );
}

function normalizeForAttributeMatching(value: string): string {
  return normalizeText(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9$%.'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAttributeLabel(value: string): string {
  return cleanLabel(value)
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericConstraint(value: string): boolean {
  const normalized = normalizeForAttributeMatching(value);
  if (!normalized || significantTerms(normalized).length === 0) return true;
  return /^(?:filters?|results?|listings?|items?|things?|options?|page|site|website|search|google|browser)$/.test(
    normalized,
  );
}

export function evaluateCompletionPendingAutocompletePreflight(params: {
  snapshot: DomSnapshot | null | undefined;
  userRequest: string;
  activeObjective?: string;
  successCriteria?: string;
  summary?: string;
}): CompletionPendingAutocompletePreflight {
  const rejection = getAutocompleteSuggestionDoneRejection({
    snapshot: params.snapshot,
    originalQuery: params.userRequest,
    activeObjective: params.activeObjective,
    successCriteria: params.successCriteria,
    summary: params.summary,
  });
  if (!rejection) return { status: "valid" };

  return {
    status: "rejected",
    kind: "pending_autocomplete_suggestion",
    ...rejection,
  };
}

/**
 * Reject done() when the final summary drops required task entities/results or
 * when a round-trip task has not actually returned to the required page.
 */
export function evaluateCompletionTaskContractPreflight(params: {
  userRequest: string;
  summary: string;
  snapshot: DomSnapshot | null | undefined;
}): CompletionTaskContractPreflight {
  const contract = buildTaskContract(params.userRequest);
  const hasObligations =
    contract.requiresRoundTrip ||
    contract.requiredEntities.length > 0 ||
    contract.requiredNumbers.length > 0;

  const summaryCoverage = assessTaskContractCoverage({
    contract,
    text: params.summary,
  });

  if (!hasObligations) {
    return {
      blocked: false,
      reason: null,
      summaryCoverage,
      missingReturnTarget: false,
    };
  }

  const returnTargetCoverage = contract.requiresRoundTrip
    ? assessTaskContractCoverage({
        contract: {
          ...contract,
          requiredEntities: [],
          requiredNumbers: [],
        },
        text: taskContractSnapshotSearchText(params.snapshot),
        requireReturnTarget: true,
      })
    : null;

  const reasons: string[] = [];
  if (summaryCoverage.missingEntities.length > 0) {
    reasons.push(
      `final summary is missing required targets: ${summaryCoverage.missingEntities.join(", ")}`,
    );
  }
  if (summaryCoverage.missingNumbers.length > 0) {
    reasons.push(
      `final summary is missing required values: ${summaryCoverage.missingNumbers.join(", ")}`,
    );
  }
  if (summaryCoverage.missingExhaustiveCoverage) {
    reasons.push(
      "final summary does not confirm exhaustive coverage of the requested items",
    );
  }
  if (summaryCoverage.missingMultiReturnCoverage) {
    reasons.push("final summary does not cover all required requested results");
  }
  if (returnTargetCoverage?.missingReturnTarget) {
    reasons.push(
      `you have not actually returned to the required page before finishing`,
    );
  }

  return {
    blocked: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    summaryCoverage,
    missingReturnTarget: Boolean(returnTargetCoverage?.missingReturnTarget),
  };
}

export function evaluateCompletionGroundingReadPreflight(params: {
  userRequest: string;
  summary: string;
  snapshot: DomSnapshot | null | undefined;
  hasReadPage: boolean;
  hasExplicitPageRead: boolean;
  hasTaskId: boolean;
}): CompletionGroundingReadPreflight {
  const needsGroundingRead = requiresGroundingReadBeforeDone(
    params.userRequest,
  );
  const hasEnoughGrounding = needsGroundingRead
    ? params.hasExplicitPageRead
    : params.hasReadPage;
  if (hasEnoughGrounding || (!params.hasTaskId && !needsGroundingRead)) {
    return { status: "valid", needsGroundingRead };
  }

  const elementCount = params.snapshot?.elements?.length ?? 0;
  const visibleLen = (
    params.snapshot?.visibleContent ||
    params.snapshot?.pageContent ||
    ""
  ).length;
  if (elementCount <= 5 || visibleLen <= 100) {
    return { status: "valid", needsGroundingRead };
  }
  if (
    isDoneSummaryGroundedInSnapshot(params.summary, params.snapshot ?? null)
  ) {
    return {
      status: "grounded_from_snapshot",
      needsGroundingRead,
      elementCount,
      visibleLen,
    };
  }

  return {
    status: "rejected",
    kind: "missing_grounding_read",
    needsGroundingRead,
    elementCount,
    visibleLen,
  };
}

export function evaluateCompletionEarlyMultiStepPreflight(params: {
  userRequest: string;
  doneRejections: number;
  turnCount: number;
  hasNodeId: boolean;
}): CompletionEarlyMultiStepPreflight {
  if (
    params.doneRejections !== 0 ||
    !params.userRequest ||
    params.hasNodeId
  ) {
    return { status: "valid", stepCount: 0 };
  }

  const stepCount = countExplicitSteps(params.userRequest);
  // turnCount includes planner setup; <=3 means the executor has had at most
  // one action turn before trying to complete a 3+ step root task.
  if (stepCount < 3 || params.turnCount > 3) {
    return { status: "valid", stepCount };
  }

  return { status: "rejected", kind: "early_multi_step", stepCount };
}

export function evaluateCompletionMoneyTableAggregatePreflight(params: {
  incompleteScanReason?: string | null;
  incorrectAnswerReason?: string | null;
}): CompletionMoneyTableAggregatePreflight {
  if (params.incompleteScanReason) {
    return {
      status: "rejected",
      kind: "incomplete_money_table_scan",
      reason: params.incompleteScanReason,
    };
  }

  if (params.incorrectAnswerReason) {
    return {
      status: "rejected",
      kind: "incorrect_money_table_answer",
      reason: params.incorrectAnswerReason,
    };
  }

  return { status: "valid" };
}

export function evaluateCompletionRequiredEvidencePreflight(params: {
  missingRequiredEvidence: string[];
}): CompletionRequiredEvidencePreflight {
  if (params.missingRequiredEvidence.length === 0) {
    return { status: "valid" };
  }

  return {
    status: "rejected",
    kind: "missing_required_evidence",
    missingRequiredEvidence: [...params.missingRequiredEvidence],
  };
}

export function evaluateCompletionListDetailReviewPreflight(params: {
  selectedSkillId?: string | null;
  userRequest: string;
  reviewedDetailCount: number;
  visibleDetailActionCount: number;
}): CompletionListDetailReviewPreflight {
  const rejection = getListDetailDoneRejection({
    selectedSkillId: params.selectedSkillId,
    query: params.userRequest,
    reviewedDetailCount: params.reviewedDetailCount,
    visibleDetailActionCount: params.visibleDetailActionCount,
  });
  if (!rejection) return { status: "valid" };

  return {
    status: "rejected",
    kind: "incomplete_list_detail_review",
    reason: rejection,
  };
}

export function evaluateCompletionWorkflowContractPreflight(params: {
  userRequest: string;
  summary: string;
  selectedSkillId?: string | null;
  pageUrl?: string;
  pageTitle?: string;
}): CompletionWorkflowContractPreflight {
  return assessWorkflowDoneGuard({
    query: params.userRequest,
    summary: params.summary,
    selectedSkillId: params.selectedSkillId,
    pageUrl: params.pageUrl,
    pageTitle: params.pageTitle,
  });
}

function taskContractSnapshotSearchText(
  snapshot: DomSnapshot | null | undefined,
): string {
  if (!snapshot) return "";
  const elementText = snapshot.elements
    .flatMap((element) => [
      element.text,
      element.tagName,
      element.attributes.id,
      element.attributes.name,
      element.attributes.placeholder,
      element.attributes["aria-label"],
      element.attributes.label,
      element.attributes.value,
    ])
    .filter(Boolean)
    .join(" ");
  return [
    snapshot.title,
    snapshot.url,
    snapshot.pageContent,
    snapshot.visibleContent,
    elementText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
