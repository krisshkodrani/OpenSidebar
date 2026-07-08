/**
 * Read-answer grounding and answer extraction (RFC LP-16 Phase 1). The
 * read_answer contract kind's closed sub-graph: detects grounded page questions,
 * parses row/sentence-scoped question parts, and extracts + validates grounded
 * answers (label-value, relation, definition, reason, location, event-date,
 * target count/presence/state/metric, superlative). Verbatim movement from
 * completion-kernel.ts.
 */
import type { DomSnapshot, TaggedElement } from "../../../types";
import type { CompletionEvidence } from "./kernel-types";
import {
  cleanLabel,
  escapeRegExp,
  LABEL_STOPWORDS,
  normalizeText,
  tokenizeCompletionText,
} from "./text-utils";
import {
  dateRangeValuePattern,
  isAreaValue,
  isCidrValue,
  isConcisePriorityLabelValue,
  isConciseSingleTokenLabelValue,
  isCoordinatePairValue,
  isCssHslColorValue,
  isCssNamedColorValue,
  isCssRgbColorValue,
  isDataRateValue,
  isDataSizeValue,
  isDateRangeValue,
  isDomainNameValue,
  isDottedVersionValue,
  isDurationValue,
  isElectricalValue,
  isFrequencyValue,
  isHashValue,
  isHexColorValue,
  isIpv6AddressValue,
  isIpv6CidrValue,
  labelCanHaveIpv6AddressValue,
  preciseIpv6CidrValueCoveredBySummary,
  preciseIpv6ValueCoveredBySummary,
  isIdentifierCodeValue,
  isLengthValue,
  isLocaleCodeValue,
  isMacAddressValue,
  isMassValue,
  isPathValue,
  isPhysicalSpeedValue,
  isPressureValue,
  isTemperatureValue,
  isTimeRangeValue,
  isTimezoneValue,
  isVolumeValue,
  labelCanHaveAreaValue,
  labelCanHaveCidrValue,
  labelCanHaveColorValue,
  labelCanHaveCoordinatePairValue,
  labelCanHaveDataRateValue,
  labelCanHaveDataSizeValue,
  labelCanHaveDateRangeValue,
  labelCanHaveDomainValue,
  labelCanHaveDurationValue,
  labelCanHaveElectricalValue,
  labelCanHaveFrequencyValue,
  labelCanHaveHashValue,
  labelCanHaveLengthValue,
  labelCanHaveLocaleValue,
  labelCanHaveMacAddressValue,
  labelCanHaveMassValue,
  labelCanHavePathValue,
  labelCanHavePhysicalSpeedValue,
  labelCanHavePressureValue,
  labelCanHaveTemperatureValue,
  labelCanHaveTimeRangeValue,
  labelCanHaveTimezoneValue,
  labelCanHaveUuidValue,
  labelCanHaveVolumeValue,
  preciseAreaValueCoveredBySummary,
  preciseCidrValueCoveredBySummary,
  preciseCoordinatePairValueCoveredBySummary,
  preciseCssHslColorValueCoveredBySummary,
  preciseCssNamedColorValueCoveredBySummary,
  preciseCssRgbColorValueCoveredBySummary,
  preciseDataRateValueCoveredBySummary,
  preciseDataSizeValueCoveredBySummary,
  preciseDateRangeValueCoveredBySummary,
  preciseDomainValueCoveredBySummary,
  preciseDurationValueCoveredBySummary,
  preciseElectricalValueCoveredBySummary,
  preciseFrequencyValueCoveredBySummary,
  preciseHashValueCoveredBySummary,
  preciseHexColorValueCoveredBySummary,
  preciseIdentifierCodeValueCoveredBySummary,
  preciseLengthValueCoveredBySummary,
  preciseLocaleCodeValueCoveredBySummary,
  preciseMacAddressValueCoveredBySummary,
  preciseMassValueCoveredBySummary,
  precisePathValueCoveredBySummary,
  precisePhysicalSpeedValueCoveredBySummary,
  precisePressureValueCoveredBySummary,
  preciseTemperatureValueCoveredBySummary,
  preciseTimeRangeValueCoveredBySummary,
  preciseTimezoneValueCoveredBySummary,
  preciseVersionValueCoveredBySummary,
  preciseVolumeValueCoveredBySummary,
  timeRangeValuePattern,
  timezoneValuePattern,
  valueTokenCoveredBySummary,
} from "./label-value-types";
import {
  normalizeWorkflowTargetLabel,
  workflowTargetLabelCoveredByText,
} from "./workflow-confirmation-analysis";

export type SentenceScopedSuperlativeDirection = "highest" | "lowest";

export type ReadAnswerSuperlativeMetricCandidate = {
  target: string;
  value: number;
  sentence: string;
};

export function isWorkflowRowLikeElement(element: TaggedElement): boolean {
  const tagName = element.tagName.toLowerCase();
  const role = normalizeText(element.role || "");
  return (
    tagName === "tr" ||
    tagName === "li" ||
    tagName === "article" ||
    role === "row" ||
    role === "listitem" ||
    role === "article"
  );
}

export function hasPageReadAnswerIntent(
  text: string,
  snapshot?: DomSnapshot | null,
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const trivialPageQuestions = [
    /\bwhat(?:'s| is) the title\b/,
    /\bwhat(?:'s| is) the url\b/,
    /\bwhat page is this\b/,
    /\bwhich page is this\b/,
    /\bwhat site is this\b/,
    /\bwhat domain is this\b/,
  ];
  if (trivialPageQuestions.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const chartValueExtraction =
    /\b(chart|dashboard|graph|plot|highcharts|visualization)\b/.test(
      normalized,
    ) &&
    /\b(value|count|percentage|percent|number|label|maximum|minimum|highest|lowest|largest|smallest)\b/.test(
      normalized,
    );
  const wholePageReadIntent = [
    /\bsummari[sz]e\b/,
    /\bsummary\b/,
    /\bdescribe (?:this|the) page\b/,
    /\breport (?:on|about) (?:this|the) page\b/,
    /\breview (?:this|the) page\b/,
    /\bmain points?\b/,
    /\bkey points?\b/,
    /\bheadlines?\b/,
    /\bwhat does (?:this|the) page say\b/,
    /\bread (?:this|the) page\b/,
    /\b(article|post|document|readme|page content)\b.+\b(summarize|summary|describe|report|extract)\b/,
  ].some((pattern) => pattern.test(normalized));
  if (chartValueExtraction && !wholePageReadIntent) return false;

  const pageReadTasks = [
    /\bsummari[sz]e\b/,
    /\bsummary\b/,
    /\bdescribe (?:this|the) page\b/,
    /\breport (?:on|about) (?:this|the) page\b/,
    /\breview (?:this|the) page\b/,
    /\bextract\b.+\b(page|article|post|document|readme|content)\b/,
    /\b(?:find|identify|locate|tell me|what(?:'s| is))\b.{0,120}\b(?:source|reference|citation)\b.{0,50}\b(?:referenced|cited|cites?)\b.{0,120}\b(?:article|document|page|post|readme)\b/,
    /\b(?:find|identify|locate|tell me|what(?:'s| is))\b.{0,120}\bfootnote\b.{0,120}\b(?:article|document|page|post|readme)\b/,
    /\b(?:find|identify|locate)\b.{0,160}\b(?:article|document|page|post|record|item)\b.{0,160}\b(?:tell me|extract|read|report|identify)\b.{0,80}\b(?:code|token|key|id|identifier)\b/,
    /\bmain points?\b/,
    /\bkey points?\b/,
    /\bheadlines?\b/,
    /\bwhat does (?:this|the) page say\b/,
    /\b(?:what(?:'s| is)|who(?:'s| is)|when|where|which|how many|how much|tell me|find|identify|locate)\b.{0,140}\b(?:on|in|according to) (?:this|the) (?:page|article|document|post|readme)\b/,
    /\b(?:on|in|according to) (?:this|the) (?:page|article|document|post|readme)\b.{0,140}\b(?:what(?:'s| is)|who(?:'s| is)|when|where|which|how many|how much)\b/,
    /\bread (?:this|the) page\b/,
    /\bfrom (?:this|the) page\b/,
    /\b(article|post|document|readme|page content)\b.+\b(summarize|summary|describe|report|extract)\b/,
  ];

  if (pageReadTasks.some((pattern) => pattern.test(normalized))) return true;
  if (hasDecomposedReadAnswerIntent(normalized)) return true;

  return hasGroundedDirectPageQuestion(normalized, snapshot);
}

function hasDecomposedReadAnswerIntent(normalized: string): boolean {
  const requestedResult =
    /\b(?:requested|target|matching|found|located)\s+(?:result|results|answer|answers|value|values|code|token|key|identifier|id)s?\b/;
  const answerNoun =
    /\b(?:answer|answers|result|results|value|values|code|token|key|identifier|id)s?\b/;
  const readOrReportVerb =
    /\b(?:read|report|extract|identify|tell me|return|provide|find|locate)\b/;
  const navigationVerb = /\b(?:navigate to|open|go to|visit|scroll to)\b/;

  return (
    readOrReportVerb.test(normalized) &&
    (requestedResult.test(normalized) ||
      (navigationVerb.test(normalized) && answerNoun.test(normalized)))
  );
}

const DIRECT_PAGE_QUESTION_STOPWORDS = new Set([
  ...LABEL_STOPWORDS,
  "about",
  "according",
  "answer",
  "current",
  "does",
  "existing",
  "from",
  "give",
  "how",
  "latest",
  "many",
  "much",
  "my",
  "our",
  "page",
  "please",
  "tell",
  "what",
  "whats",
  "when",
  "where",
  "which",
  "who",
  "whose",
  "your",
]);

const EXPLANATORY_LABEL_VALUE_START_WORDS = new Set([
  "available",
  "covered",
  "described",
  "documented",
  "explained",
  "included",
  "listed",
  "mentioned",
  "provided",
  "shown",
  "specified",
  "visible",
]);

function hasGroundedDirectPageQuestion(
  normalizedQuestion: string,
  snapshot?: DomSnapshot | null,
): boolean {
  if (!snapshot) return false;
  const hasBroadQuestionStarter =
    /\b(?:what(?:'s| is)?|who(?:'s| is)?|when|where|which|how many|how much)\b/.test(
      normalizedQuestion,
    );
  const hasBooleanLabelQuestionStarter =
    /^(?:please\s+)?(?:is|are|was|were)\b/.test(normalizedQuestion);
  if (!hasBroadQuestionStarter && !hasBooleanLabelQuestionStarter) {
    return false;
  }
  if (findGroundedRowScopedLabelValueQuestion(normalizedQuestion, snapshot)) {
    return true;
  }

  const pageText = snapshotPageText(snapshot);
  if (!hasSubstantiveReadAnswerEvidence(pageText)) return false;
  if (findGroundedLabelValueQuestionLabel(normalizedQuestion, pageText)) {
    return true;
  }
  if (hasBooleanLabelQuestionStarter) return false;

  const questionTokens = tokenizeCompletionText(normalizedQuestion).filter(
    (token) => !DIRECT_PAGE_QUESTION_STOPWORDS.has(token),
  );
  if (questionTokens.length < 2) return false;

  const pageTokens = new Set(tokenizeCompletionText(pageText));
  const overlap = questionTokens.filter((token) => pageTokens.has(token));
  return overlap.length >= Math.min(3, questionTokens.length);
}

export function findGroundedRowScopedLabelValueQuestion(
  question: string,
  snapshot: DomSnapshot,
): { label: string; target: string } | null {
  const parts = extractRowScopedLabelValueQuestionParts(question);
  if (!parts) return null;

  const labelTokens = tokenizeLabelValueQuestionLabel(parts.label);
  if (labelTokens.length < 1 || labelTokens.length > 3) return null;

  const target = normalizeWorkflowTargetLabel(parts.target);
  if (!target) return null;

  const label = cleanLabel(labelTokens.join(" "));
  return findReadAnswerRowScopedLabelValueText(snapshot, target, label)
    ? { label, target }
    : null;
}

export function extractRowScopedLabelValueQuestionParts(
  question: string,
): { label: string; target: string } | null {
  const text = cleanLabel(question);
  const possessivePointOfContactMatch =
    /^(?:please\s+)?(?:tell me\s+)?who(?:'s| is| are)\s+(?:is|are|was|were)?\s*(?:the\s+)?(.+?)(?:'|\u2019)s\s+(?:point\s+of\s+contact|poc|contact)(?:[?.!]|$)/i.exec(
      text,
    );
  if (possessivePointOfContactMatch) {
    const target = cleanLabel(possessivePointOfContactMatch[1] ?? "");
    return target ? { label: "contact", target } : null;
  }

  const responsibleForMatch =
    /^(?:please\s+)?(?:tell me\s+)?who(?:'s|\s+is|\s+was)?\s+responsible\s+for\s+(?:the\s+)?(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (responsibleForMatch) {
    const target = cleanLabel(responsibleForMatch[1] ?? "");
    return target ? { label: "responsible party", target } : null;
  }

  const accountableForMatch =
    /^(?:please\s+)?(?:tell me\s+)?who(?:'s|\s+is|\s+was)?\s+accountable\s+for\s+(?:the\s+)?(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (accountableForMatch) {
    const target = cleanLabel(accountableForMatch[1] ?? "");
    return target ? { label: "accountable party", target } : null;
  }

  const labelBeforeTargetMatch =
    /^(?:please\s+)?(?:tell me\s+)?(?:what(?:'s| is| are)|who(?:'s| is)|when|where|which)\s+(?:is|are|was|were)?\s*(?:the\s+)?(.+?)\s+(?:for|of|on)\s+(?:the\s+)?(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (labelBeforeTargetMatch) {
    const label = cleanLabel(labelBeforeTargetMatch[1] ?? "");
    const target = cleanLabel(labelBeforeTargetMatch[2] ?? "");
    return label && target ? { label, target } : null;
  }

  const possessiveMatch =
    /^(?:please\s+)?(?:tell me\s+)?(?:what(?:'s| is| are)|who(?:'s| is| are)|which)\s+(?:is|are|was|were)?\s*(?:the\s+)?(.+?)(?:'|\u2019)s\s+(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (possessiveMatch) {
    const target = cleanLabel(possessiveMatch[1] ?? "");
    const label = cleanLabel(possessiveMatch[2] ?? "");
    return label && target ? { label, target } : null;
  }

  const whenPossessiveDueDateMatch =
    /^(?:please\s+)?(?:tell me\s+)?when\s+(?:is|are|was|were)\s+(?:the\s+)?(.+?)(?:'|\u2019)s\s+due\s+date(?:[?.!]|$)/i.exec(
      text,
    );
  if (whenPossessiveDueDateMatch) {
    const target = cleanLabel(whenPossessiveDueDateMatch[1] ?? "");
    return target ? { label: "due date", target } : null;
  }

  const linkingVerbLabelMatch =
    /^(?:please\s+)?(?:tell me\s+)?(?:what|which)\s+(.+?)\s+(?:is|are|was|were)\s+(?:the\s+)?(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (linkingVerbLabelMatch) {
    const label = cleanLabel(linkingVerbLabelMatch[1] ?? "");
    const target = cleanLabel(linkingVerbLabelMatch[2] ?? "");
    return label && target ? { label, target } : null;
  }

  const dueDateTargetMatch =
    /^(?:please\s+)?(?:tell me\s+)?when\s+(?:is|are|was|were)\s+(?:the\s+)?(.+?)\s+due(?:[?.!]|$)/i.exec(
      text,
    );
  if (dueDateTargetMatch) {
    const target = cleanLabel(dueDateTargetMatch[1] ?? "");
    return target ? { label: "due date", target } : null;
  }

  const sentenceScopedByRelation =
    extractSentenceScopedByRelationQuestionParts(text);
  if (sentenceScopedByRelation) return sentenceScopedByRelation;

  return null;
}

const SENTENCE_SCOPED_BY_RELATIONS = [
  {
    label: "owner",
    directQuestionTail: "\\s+owns",
    passiveTargetSuffix: "owned\\s+by",
    sentenceRelationPattern: "owned\\s+by",
  },
  {
    label: "manager",
    directQuestionTail: "\\s+manages",
    passiveTargetSuffix: "managed\\s+by",
    sentenceRelationPattern: "managed\\s+by",
  },
  {
    label: "lead",
    directQuestionTail: "\\s+leads",
    passiveTargetSuffix: "led\\s+by",
    sentenceRelationPattern: "led\\s+by",
  },
  {
    label: "maintainer",
    directQuestionTail: "\\s+maintains",
    passiveTargetSuffix: "maintained\\s+by",
    sentenceRelationPattern: "maintained\\s+by",
  },
  {
    label: "handler",
    directQuestionTail: "\\s+handles",
    passiveTargetSuffix: "handled\\s+by",
    sentenceRelationPattern: "handled\\s+by",
  },
  {
    label: "operator",
    directQuestionTail: "\\s+operates",
    passiveTargetSuffix: "operated\\s+by",
    sentenceRelationPattern: "operated\\s+by",
  },
  {
    label: "provider",
    directQuestionTail: "\\s+provides",
    passiveTargetSuffix: "provided\\s+by",
    sentenceRelationPattern: "provided\\s+by",
  },
  {
    label: "supporter",
    directQuestionTail: "\\s+supports",
    passiveTargetSuffix: "supported\\s+by",
    sentenceRelationPattern: "supported\\s+by",
  },
  {
    label: "host",
    directQuestionTail: "\\s+hosts",
    passiveTargetSuffix: "hosted\\s+by",
    sentenceRelationPattern: "hosted\\s+by",
  },
  {
    label: "administrator",
    directQuestionTail: "\\s+administers",
    passiveTargetSuffix: "administered\\s+by",
    sentenceRelationPattern: "administered\\s+by",
  },
  {
    label: "monitor",
    directQuestionTail: "\\s+monitors",
    passiveTargetSuffix: "monitored\\s+by",
    sentenceRelationPattern: "monitored\\s+by",
  },
  {
    label: "supervisor",
    directQuestionTail: "\\s+supervises",
    passiveTargetSuffix: "supervised\\s+by",
    sentenceRelationPattern: "supervised\\s+by",
  },
  {
    label: "coordinator",
    directQuestionTail: "\\s+coordinates",
    passiveTargetSuffix: "coordinated\\s+by",
    sentenceRelationPattern: "coordinated\\s+by",
  },
  {
    label: "sponsor",
    directQuestionTail: "\\s+sponsors",
    passiveTargetSuffix: "sponsored\\s+by",
    sentenceRelationPattern: "sponsored\\s+by",
  },
  {
    label: "funder",
    directQuestionTail: "\\s+funds",
    passiveTargetSuffix: "funded\\s+by",
    sentenceRelationPattern: "funded\\s+by",
  },
  {
    label: "overseer",
    directQuestionTail: "\\s+oversees",
    passiveTargetSuffix: "overseen\\s+by",
    sentenceRelationPattern: "overseen\\s+by",
  },
  {
    label: "governor",
    directQuestionTail: "\\s+governs",
    passiveTargetSuffix: "governed\\s+by",
    sentenceRelationPattern: "governed\\s+by",
  },
  {
    label: "controller",
    directQuestionTail: "\\s+controls",
    passiveTargetSuffix: "controlled\\s+by",
    sentenceRelationPattern: "controlled\\s+by",
  },
  {
    label: "auditor",
    directQuestionTail: "\\s+audits",
    passiveTargetSuffix: "audited\\s+by",
    sentenceRelationPattern: "audited\\s+by",
  },
  {
    label: "validator",
    directQuestionTail: "\\s+validates",
    passiveTargetSuffix: "validated\\s+by",
    sentenceRelationPattern: "validated\\s+by",
  },
  {
    label: "verifier",
    directQuestionTail: "\\s+verifies",
    passiveTargetSuffix: "verified\\s+by",
    sentenceRelationPattern: "verified\\s+by",
  },
  {
    label: "certifier",
    directQuestionTail: "\\s+certifies",
    passiveTargetSuffix: "certified\\s+by",
    sentenceRelationPattern: "certified\\s+by",
  },
  {
    label: "assignee",
    directQuestionTail: "(?:'s|\\s+is|\\s+was)\\s+assigned\\s+to",
    passiveTargetSuffix: "assigned\\s+to",
    sentenceRelationPattern: "assigned\\s+to",
  },
  {
    label: "requester",
    directQuestionTail: "\\s+requested",
    passiveTargetSuffix: "requested\\s+by",
    sentenceRelationPattern: "requested\\s+by",
  },
  {
    label: "reporter",
    directQuestionTail: "\\s+reported",
    passiveTargetSuffix: "reported\\s+by",
    sentenceRelationPattern: "reported\\s+by",
  },
  {
    label: "creator",
    directQuestionTail: "\\s+created",
    passiveTargetSuffix: "created\\s+by",
    sentenceRelationPattern: "created\\s+by",
  },
  {
    label: "opener",
    directQuestionTail: "\\s+opened",
    passiveTargetSuffix: "opened\\s+by",
    sentenceRelationPattern: "opened\\s+by",
  },
  {
    label: "approver",
    directQuestionTail: "\\s+approved",
    passiveTargetSuffix: "approved\\s+by",
    sentenceRelationPattern: "approved\\s+by",
  },
  {
    label: "reviewer",
    directQuestionTail: "\\s+reviewed",
    passiveTargetSuffix: "reviewed\\s+by",
    sentenceRelationPattern: "reviewed\\s+by",
  },
] as const;

function extractSentenceScopedByRelationQuestionParts(
  text: string,
): { label: string; target: string } | null {
  for (const relation of SENTENCE_SCOPED_BY_RELATIONS) {
    const directMatch = new RegExp(
      `^(?:please\\s+)?(?:tell me\\s+)?who${relation.directQuestionTail}\\s+(?:the\\s+)?(.+?)(?:[?.!]|$)`,
      "i",
    ).exec(text);
    if (directMatch) {
      const target = cleanLabel(directMatch[1] ?? "");
      if (target) return { label: relation.label, target };
    }

    const passiveMatch = new RegExp(
      `^(?:please\\s+)?(?:tell me\\s+)?who(?:'s|\\s+is|\\s+was)\\s+(?:the\\s+)?(.+?)\\s+${relation.passiveTargetSuffix}(?:[?.!]|$)`,
      "i",
    ).exec(text);
    if (passiveMatch) {
      const target = cleanLabel(passiveMatch[1] ?? "");
      if (target) return { label: relation.label, target };
    }
  }
  return null;
}

export function extractSentenceScopedDefinitionQuestionParts(
  question: string,
): { target: string; strongDefinitionIntent: boolean } | null {
  const text = cleanLabel(question);
  const strongPatterns = [
    /^(?:please\s+)?(?:tell me\s+)?what\s+does\s+(?:the\s+)?(?:term\s+)?(.+?)\s+mean(?:[?.!]|$)/i,
    /^(?:please\s+)?(?:tell me\s+)?what\s+does\s+(?:the\s+)?(?:term\s+)?(.+?)\s+stand\s+for(?:[?.!]|$)/i,
    /^(?:please\s+)?(?:tell me\s+)?what\s+is\s+meant\s+by\s+(?:the\s+)?(?:term\s+)?(.+?)(?:[?.!]|$)/i,
    /^(?:please\s+)?(?:tell me\s+)?define\s+(?:the\s+)?(?:term\s+)?(.+?)(?:[?.!]|$)/i,
    /^(?:please\s+)?(?:tell me\s+)?what\s+is\s+the\s+definition\s+of\s+(?:the\s+)?(?:term\s+)?(.+?)(?:[?.!]|$)/i,
    /^(?:please\s+)?(?:tell me\s+)?what\s+is\s+(?:the\s+)?(?:term\s+)?(.+?)\s+defined\s+as(?:[?.!]|$)/i,
  ];
  for (const pattern of strongPatterns) {
    const target = cleanSentenceScopedDefinitionTarget(
      pattern.exec(text)?.[1] ?? "",
    );
    if (target) return { target, strongDefinitionIntent: true };
  }

  const weakWhatIsMatch =
    /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is)\s+(?:the\s+)?(?:term\s+)?(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  const weakTarget = cleanSentenceScopedDefinitionTarget(
    weakWhatIsMatch?.[1] ?? "",
  );
  return weakTarget
    ? { target: weakTarget, strongDefinitionIntent: false }
    : null;
}

function cleanSentenceScopedDefinitionTarget(value: string): string | null {
  return normalizeWorkflowTargetLabel(
    cleanLabel(value)
      .replace(/^(?:the\s+)?term\s+/i, "")
      .replace(
        /\s+(?:on|in|from|according to)\s+(?:this|the)\s+(?:page|article|document|post|readme)$/i,
        "",
      ),
  );
}

export function extractSentenceScopedReasonQuestionParts(
  question: string,
): { label: string; target: string } | null {
  const text = cleanLabel(question);
  const beMatch =
    /^(?:please\s+)?(?:tell me\s+)?why\s+(?:is|are|was|were)\s+(?:the\s+)?(.+?)\s+(delayed|blocked|failed|canceled|cancelled|rejected|paused|stopped|closed|escalated|on\s+hold)(?:[?.!]|$)/i.exec(
      text,
    );
  if (beMatch) {
    const label = canonicalSentenceScopedReasonLabel(beMatch[2] ?? "");
    const target = cleanSentenceScopedReasonTarget(beMatch[1] ?? "");
    if (label && target) return { label, target };
  }

  const hasBeenMatch =
    /^(?:please\s+)?(?:tell me\s+)?why\s+(?:has|have)\s+(?:the\s+)?(.+?)\s+been\s+(delayed|blocked|canceled|cancelled|rejected|paused|stopped|closed|escalated|on\s+hold)(?:[?.!]|$)/i.exec(
      text,
    );
  if (hasBeenMatch) {
    const label = canonicalSentenceScopedReasonLabel(hasBeenMatch[2] ?? "");
    const target = cleanSentenceScopedReasonTarget(hasBeenMatch[1] ?? "");
    if (label && target) return { label, target };
  }

  const didMatch =
    /^(?:please\s+)?(?:tell me\s+)?why\s+did\s+(?:the\s+)?(.+?)\s+(delay|delayed|block|blocked|fail|failed|cancel|canceled|cancelled|reject|rejected|pause|paused|stop|stopped|close|closed|escalate|escalated)(?:[?.!]|$)/i.exec(
      text,
    );
  if (didMatch) {
    const label = canonicalSentenceScopedReasonLabel(didMatch[2] ?? "");
    const target = cleanSentenceScopedReasonTarget(didMatch[1] ?? "");
    if (label && target) return { label, target };
  }

  return null;
}

export function extractSentenceScopedLocationQuestionParts(
  question: string,
): { label: string; target: string } | null {
  const text = cleanLabel(question);
  const beMatch =
    /^(?:please\s+)?(?:tell me\s+)?where\s+(?:is|are|was|were)\s+(?:the\s+)?(.+?)\s+(?:located|based|hosted|deployed|stored|running)(?:[?.!]|$)/i.exec(
      text,
    );
  if (beMatch) {
    const target = cleanSentenceScopedLocationTarget(beMatch[1] ?? "");
    if (target) return { label: "location", target };
  }

  const hasBeenMatch =
    /^(?:please\s+)?(?:tell me\s+)?where\s+(?:has|have)\s+(?:the\s+)?(.+?)\s+been\s+(?:located|based|hosted|deployed|stored|running)(?:[?.!]|$)/i.exec(
      text,
    );
  if (hasBeenMatch) {
    const target = cleanSentenceScopedLocationTarget(hasBeenMatch[1] ?? "");
    if (target) return { label: "location", target };
  }

  const activeMatch =
    /^(?:please\s+)?(?:tell me\s+)?where\s+(?:does|do|did)\s+(?:the\s+)?(.+?)\s+(?:run|reside|live)(?:[?.!]|$)/i.exec(
      text,
    );
  if (activeMatch) {
    const target = cleanSentenceScopedLocationTarget(activeMatch[1] ?? "");
    if (target) return { label: "location", target };
  }

  return null;
}

function cleanSentenceScopedLocationTarget(value: string): string | null {
  return normalizeWorkflowTargetLabel(cleanLabel(value));
}

export function extractSentenceScopedEventDateQuestionParts(
  question: string,
): { label: string; target: string } | null {
  const text = cleanLabel(question);
  const passiveMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?when\\s+(?:is|are|was|were)\\s+(?:the\\s+)?(.+?)\\s+(${SENTENCE_SCOPED_EVENT_DATE_PASSIVE_QUESTION_PATTERN})(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (passiveMatch) {
    const label = canonicalSentenceScopedEventDateLabel(passiveMatch[2] ?? "");
    const target = cleanSentenceScopedEventDateTarget(passiveMatch[1] ?? "");
    if (label && target) return { label, target };
  }

  const hasBeenMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?when\\s+(?:has|have)\\s+(?:the\\s+)?(.+?)\\s+been\\s+(${SENTENCE_SCOPED_EVENT_DATE_PASSIVE_QUESTION_PATTERN})(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (hasBeenMatch) {
    const label = canonicalSentenceScopedEventDateLabel(hasBeenMatch[2] ?? "");
    const target = cleanSentenceScopedEventDateTarget(hasBeenMatch[1] ?? "");
    if (label && target) return { label, target };
  }

  const activeMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?when\\s+(?:did|does|do)\\s+(?:the\\s+)?(.+?)\\s+(${SENTENCE_SCOPED_EVENT_DATE_ACTIVE_QUESTION_PATTERN})(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (activeMatch) {
    const label = canonicalSentenceScopedEventDateLabel(activeMatch[2] ?? "");
    const target = cleanSentenceScopedEventDateTarget(activeMatch[1] ?? "");
    if (label && target) return { label, target };
  }

  return null;
}

function cleanSentenceScopedEventDateTarget(value: string): string | null {
  return normalizeWorkflowTargetLabel(cleanLabel(value));
}

export function extractSentenceScopedTargetCountQuestionParts(
  question: string,
): { label: string; target: string } | null {
  const text = cleanLabel(question);
  const adverbPattern = sentenceScopedTargetCountAdverbPattern();
  const targetVerbMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:does|do|did)\\s+(?:the\\s+)?(.+?)\\s+${adverbPattern}(?:have|contain|include|show|list|track|report)(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (targetVerbMatch) {
    const metric = cleanSentenceScopedTargetCountMetric(
      targetVerbMatch[1] ?? "",
    );
    const target = cleanSentenceScopedTargetCountTarget(
      targetVerbMatch[2] ?? "",
    );
    if (metric && target) return { label: `${metric} count`, target };
  }

  const thereAreMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:is|are|was|were)\\s+there\\s+${adverbPattern}(?:for|of|on|in)\\s+(?:the\\s+)?(.+?)(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (thereAreMatch) {
    const metric = cleanSentenceScopedTargetCountMetric(thereAreMatch[1] ?? "");
    const target = cleanSentenceScopedTargetCountTarget(thereAreMatch[2] ?? "");
    if (metric && target) return { label: `${metric} count`, target };
  }

  const remainingMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:(?:${adverbPattern}(?:remain|remains))|(?:(?:is|are|was|were)\\s+${adverbPattern}(?:left|remaining)))\\s+(?:for|of|on|in)\\s+(?:the\\s+)?(.+?)(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (remainingMatch) {
    const metric = cleanSentenceScopedTargetCountMetric(
      remainingMatch[1] ?? "",
    );
    const target = cleanSentenceScopedTargetCountTarget(
      remainingMatch[2] ?? "",
    );
    if (metric && target) return { label: `${metric} count`, target };
  }

  const countOfMatch =
    /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is)\s+(?:the\s+)?(?:number|count|quantity)\s+of\s+(.+?)\s+(?:for|of|on|in)\s+(?:the\s+)?(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (countOfMatch) {
    const metric = cleanSentenceScopedTargetCountMetric(countOfMatch[1] ?? "");
    const target = cleanSentenceScopedTargetCountTarget(countOfMatch[2] ?? "");
    if (metric && target) return { label: `${metric} count`, target };
  }

  return null;
}

export function extractSentenceScopedTargetPresenceQuestionParts(
  question: string,
): { label: string; target: string } | null {
  const text = cleanLabel(question);
  const adverbPattern = sentenceScopedTargetPresenceAdverbPattern();
  const targetVerbMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?(?:does|do|did)\\s+(?:the\\s+)?(.+?)\\s+${adverbPattern}(?:have|contain|include|show|list|track|report)\\s+(?:any\\s+)?(.+?)(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (targetVerbMatch) {
    const target = cleanSentenceScopedTargetPresenceTarget(
      targetVerbMatch[1] ?? "",
    );
    const metric = cleanSentenceScopedTargetCountMetric(
      targetVerbMatch[2] ?? "",
    );
    if (metric && target) return { label: `${metric} presence`, target };
  }

  const thereAreMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?(?:is|are|was|were)\\s+there\\s+${adverbPattern}(?:any\\s+)?(.+?)\\s+(?:for|of|on|in)\\s+(?:the\\s+)?(.+?)(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (thereAreMatch) {
    const metric = cleanSentenceScopedTargetCountMetric(thereAreMatch[1] ?? "");
    const target = cleanSentenceScopedTargetCountTarget(thereAreMatch[2] ?? "");
    if (metric && target) return { label: `${metric} presence`, target };
  }

  return null;
}

function cleanSentenceScopedTargetPresenceTarget(value: string): string | null {
  return cleanSentenceScopedTargetCountTarget(
    cleanLabel(value).replace(
      /\s+(?:currently|still|now|presently|actively)$/i,
      "",
    ),
  );
}

function cleanSentenceScopedTargetCountMetric(value: string): string | null {
  const metric = cleanLabel(value)
    .replace(/^(?:the\s+)?(?:current|total|overall)\s+/i, "")
    .replace(/^(?:any)\s+/i, "")
    .replace(/\s+(?:count|number|quantity)$/i, "");
  const normalized = normalizeText(metric);
  const tokens = tokenizeCompletionText(normalized);
  if (tokens.length < 2 || tokens.length > 6) return null;
  return tokens.join(" ");
}

function cleanSentenceScopedTargetCountTarget(value: string): string | null {
  return normalizeWorkflowTargetLabel(
    cleanLabel(value).replace(
      /\s+(?:currently|still|now|presently|actively)$/i,
      "",
    ),
  );
}

export function extractSentenceScopedTargetMetricValueQuestionParts(
  question: string,
): { label: string; target: string } | null {
  const text = cleanLabel(question);
  if (
    /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are|\s+was|\s+were)\s+(?:the\s+)?(?:number|count|quantity)\s+of\s+/i.test(
      text,
    )
  ) {
    return null;
  }
  const possessiveMatch =
    /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are|\s+was|\s+were)\s+(?:the\s+)?(.+?)(?:'|\u2019)s\s+(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (possessiveMatch) {
    const target = cleanSentenceScopedTargetMetricValueTarget(
      possessiveMatch[1] ?? "",
    );
    const metric = cleanSentenceScopedTargetMetricValueMetric(
      possessiveMatch[2] ?? "",
    );
    if (metric && target) return { label: `${metric} value`, target };
  }

  const metricForTargetMatch =
    /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are|\s+was|\s+were)\s+(?:the\s+)?(.+?)\s+(?:for|of|on|in)\s+(?:the\s+)?(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (metricForTargetMatch) {
    const metric = cleanSentenceScopedTargetMetricValueMetric(
      metricForTargetMatch[1] ?? "",
    );
    const target = cleanSentenceScopedTargetMetricValueTarget(
      metricForTargetMatch[2] ?? "",
    );
    if (metric && target) return { label: `${metric} value`, target };
  }

  return null;
}

export function extractSentenceScopedSuperlativeMetricQuestionParts(
  question: string,
): {
  label: string;
  metric: string;
  direction: SentenceScopedSuperlativeDirection;
} | null {
  const text = cleanLabel(question);
  const match =
    /^(?:please\s+)?(?:tell me\s+)?(?:which|what)\s+(.+?)\s+(?:currently\s+)?(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\s+(?:the\s+)?(highest|lowest|largest|smallest|most|least|fewest)\s+(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (!match) return null;

  const entityTokens = tokenizeCompletionText(match[1] ?? "");
  if (entityTokens.length < 1 || entityTokens.length > 4) return null;

  const direction = canonicalSentenceScopedSuperlativeDirection(match[2] ?? "");
  const metric = cleanSentenceScopedSuperlativeMetric(match[3] ?? "");
  if (!direction || !metric) return null;

  return {
    label: sentenceScopedSuperlativeMetricLabel(metric, direction),
    metric,
    direction,
  };
}

function canonicalSentenceScopedSuperlativeDirection(
  value: string,
): SentenceScopedSuperlativeDirection | null {
  const normalized = normalizeText(value);
  if (/^(?:highest|largest|most)$/.test(normalized)) return "highest";
  if (/^(?:lowest|smallest|least|fewest)$/.test(normalized)) return "lowest";
  return null;
}

function cleanSentenceScopedSuperlativeMetric(value: string): string | null {
  const metric = cleanLabel(value)
    .replace(/^(?:the\s+)?(?:current|latest|reported)\s+/i, "")
    .replace(/^(?:number|count|quantity|amount)\s+of\s+/i, "");
  const tokens = tokenizeCompletionText(metric);
  if (tokens.length < 1 || tokens.length > 6) return null;
  return tokens.join(" ");
}

function sentenceScopedSuperlativeMetricLabel(
  metric: string,
  direction: SentenceScopedSuperlativeDirection,
): string {
  return `${metric} ${direction} target`;
}

export function sentenceScopedSuperlativeMetricPartsForLabel(label: string): {
  metric: string;
  direction: SentenceScopedSuperlativeDirection;
} | null {
  const normalizedLabel = normalizeText(label);
  const highMatch = /^(.+?)\s+highest\s+target$/.exec(normalizedLabel);
  if (highMatch) {
    const metric = cleanSentenceScopedSuperlativeMetric(highMatch[1] ?? "");
    return metric ? { metric, direction: "highest" } : null;
  }
  const lowMatch = /^(.+?)\s+lowest\s+target$/.exec(normalizedLabel);
  if (lowMatch) {
    const metric = cleanSentenceScopedSuperlativeMetric(lowMatch[1] ?? "");
    return metric ? { metric, direction: "lowest" } : null;
  }
  return null;
}

function cleanSentenceScopedTargetMetricValueMetric(
  value: string,
): string | null {
  const metric = cleanLabel(value)
    .replace(/^(?:the\s+)?(?:current|latest|present|reported)\s+/i, "")
    .replace(/\s+(?:value|metric)$/i, "");
  const normalized = normalizeText(metric);
  if (!normalized || sentenceScopedMetricValueReservedLabel(normalized)) {
    return null;
  }
  const tokens = tokenizeCompletionText(normalized);
  if (tokens.length < 1 || tokens.length > 5) return null;
  return tokens.join(" ");
}

function cleanSentenceScopedTargetMetricValueTarget(
  value: string,
): string | null {
  return normalizeWorkflowTargetLabel(cleanLabel(value));
}

function sentenceScopedMetricValueReservedLabel(label: string): boolean {
  const normalizedLabel = normalizeText(label);
  if (
    normalizedLabel === "definition" ||
    normalizedLabel === "location" ||
    normalizedLabel === "status" ||
    normalizedLabel === "priority" ||
    normalizedLabel === "severity" ||
    normalizedLabel === "due date"
  ) {
    return true;
  }
  if (sentenceScopedEventDatePatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedCountMetricPatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedPresenceMetricPatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedTargetStatePatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedByRelationPatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedRelationNounPatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedActiveRelationPatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedAttributePatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedReasonPredicatePatternForLabel(normalizedLabel))
    return true;
  return false;
}

export function extractSentenceScopedTargetStateQuestionParts(
  question: string,
): { label: string; target: string } | null {
  const text = cleanLabel(question);
  const stateAdverbPattern = sentenceScopedTargetStateAdverbPattern();
  const beMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?(?:is|are|was|were)\\s+(?:the\\s+)?(.+?)\\s+${stateAdverbPattern}(${SENTENCE_SCOPED_TARGET_STATE_QUESTION_PATTERN})(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (beMatch) {
    const label = canonicalSentenceScopedTargetStateLabel(beMatch[2] ?? "");
    const target = cleanSentenceScopedTargetStateTarget(beMatch[1] ?? "");
    if (label && target) return { label, target };
  }

  const hasBeenMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?(?:has|have|had)\\s+(?:the\\s+)?(.+?)\\s+been\\s+${stateAdverbPattern}(${SENTENCE_SCOPED_TARGET_STATE_QUESTION_PATTERN})(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (hasBeenMatch) {
    const label = canonicalSentenceScopedTargetStateLabel(
      hasBeenMatch[2] ?? "",
    );
    const target = cleanSentenceScopedTargetStateTarget(hasBeenMatch[1] ?? "");
    if (label && target) return { label, target };
  }

  return null;
}

function cleanSentenceScopedTargetStateTarget(value: string): string | null {
  return normalizeWorkflowTargetLabel(cleanLabel(value));
}

function cleanSentenceScopedReasonTarget(value: string): string | null {
  return normalizeWorkflowTargetLabel(cleanLabel(value));
}

const SENTENCE_SCOPED_EVENT_DATE_PASSIVE_QUESTION_PATTERN =
  "(?:launched|released|deployed|created|opened|closed|resolved|updated|changed|approved|reviewed|completed|submitted|published|started|stopped|scheduled|canceled|cancelled)";

const SENTENCE_SCOPED_EVENT_DATE_ACTIVE_QUESTION_PATTERN =
  "(?:launch|release|deploy|create|open|close|resolve|update|change|approve|review|complete|submit|publish|start|stop|schedule|cancel)";

const SENTENCE_SCOPED_TARGET_STATE_QUESTION_PATTERN =
  "(?:active|inactive|blocked|unblocked|open|closed|pending|resolved|enabled|disabled|approved|rejected|complete|completed|done|failed|successful|success|draft|submitted|sent|archived|deleted|canceled|cancelled|delayed|paused|stopped|escalated|on\\s+hold)";

function canonicalSentenceScopedTargetStateLabel(value: string): string | null {
  const normalized = normalizeText(value).replace(/-/g, " ");
  if (normalized === "active") return "active state";
  if (normalized === "inactive") return "inactive state";
  if (normalized === "blocked") return "blocked state";
  if (normalized === "unblocked") return "unblocked state";
  if (normalized === "open") return "open state";
  if (normalized === "closed") return "closed state";
  if (normalized === "pending") return "pending state";
  if (normalized === "resolved") return "resolved state";
  if (normalized === "enabled") return "enabled state";
  if (normalized === "disabled") return "disabled state";
  if (normalized === "approved") return "approved state";
  if (normalized === "rejected") return "rejected state";
  if (
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "done"
  ) {
    return "completed state";
  }
  if (normalized === "failed") return "failed state";
  if (normalized === "successful" || normalized === "success") {
    return "successful state";
  }
  if (normalized === "draft") return "draft state";
  if (normalized === "submitted") return "submitted state";
  if (normalized === "sent") return "sent state";
  if (normalized === "archived") return "archived state";
  if (normalized === "deleted") return "deleted state";
  if (normalized === "canceled" || normalized === "cancelled") {
    return "canceled state";
  }
  if (normalized === "delayed") return "delayed state";
  if (normalized === "paused") return "paused state";
  if (normalized === "stopped") return "stopped state";
  if (normalized === "escalated") return "escalated state";
  if (normalized === "on hold") return "on hold state";
  return null;
}

function canonicalSentenceScopedEventDateLabel(value: string): string | null {
  const normalized = normalizeText(value).replace(/-/g, " ");
  if (/^launch(?:ed)?$/.test(normalized)) return "launched date";
  if (/^release(?:d)?$/.test(normalized)) return "released date";
  if (/^deploy(?:ed)?$/.test(normalized)) return "deployed date";
  if (/^creat(?:e|ed)$/.test(normalized)) return "created date";
  if (/^open(?:ed)?$/.test(normalized)) return "opened date";
  if (/^clos(?:e|ed)$/.test(normalized)) return "closed date";
  if (/^resolv(?:e|ed)$/.test(normalized)) return "resolved date";
  if (/^updat(?:e|ed)$/.test(normalized)) return "updated date";
  if (/^chang(?:e|ed)$/.test(normalized)) return "updated date";
  if (/^approv(?:e|ed)$/.test(normalized)) return "approved date";
  if (/^review(?:ed)?$/.test(normalized)) return "reviewed date";
  if (/^complet(?:e|ed)$/.test(normalized)) return "completed date";
  if (/^submit(?:ted)?$/.test(normalized)) return "submitted date";
  if (/^publish(?:ed)?$/.test(normalized)) return "published date";
  if (/^start(?:ed)?$/.test(normalized)) return "started date";
  if (/^stop(?:ped)?$/.test(normalized)) return "stopped date";
  if (/^schedul(?:e|ed)$/.test(normalized)) return "scheduled date";
  if (/^cancel(?:ed|led)?$/.test(normalized)) return "canceled date";
  return null;
}

function canonicalSentenceScopedReasonLabel(value: string): string | null {
  const normalized = normalizeText(value).replace(/-/g, " ");
  if (/^delay(?:ed)?$/.test(normalized)) return "delayed reason";
  if (/^block(?:ed)?$/.test(normalized)) return "blocked reason";
  if (/^fail(?:ed)?$/.test(normalized)) return "failed reason";
  if (/^cancel(?:ed|led)?$/.test(normalized)) return "canceled reason";
  if (/^reject(?:ed)?$/.test(normalized)) return "rejected reason";
  if (/^paus(?:e|ed)$/.test(normalized)) return "paused reason";
  if (/^stop(?:ped)?$/.test(normalized)) return "stopped reason";
  if (/^clos(?:e|ed)$/.test(normalized)) return "closed reason";
  if (/^escalat(?:e|ed)$/.test(normalized)) return "escalated reason";
  if (normalized === "on hold") return "on hold reason";
  return null;
}

export function findGroundedSentenceScopedAnswer(
  question: string,
  evidenceText: string,
): { label: string; target: string } | null {
  const definitionQuestion =
    extractSentenceScopedDefinitionQuestionParts(question);
  if (definitionQuestion) {
    const target = normalizeWorkflowTargetLabel(definitionQuestion.target);
    if (
      target &&
      findReadAnswerSentenceScopedAnswer(evidenceText, target, "definition")
    ) {
      return { label: "definition", target };
    }
  }

  const reasonQuestion = extractSentenceScopedReasonQuestionParts(question);
  if (reasonQuestion) {
    const target = normalizeWorkflowTargetLabel(reasonQuestion.target);
    if (
      target &&
      findReadAnswerSentenceScopedAnswer(
        evidenceText,
        target,
        reasonQuestion.label,
      )
    ) {
      return { label: reasonQuestion.label, target };
    }
  }

  const locationQuestion = extractSentenceScopedLocationQuestionParts(question);
  if (locationQuestion) {
    const target = normalizeWorkflowTargetLabel(locationQuestion.target);
    if (
      target &&
      findReadAnswerSentenceScopedAnswer(
        evidenceText,
        target,
        locationQuestion.label,
      )
    ) {
      return { label: locationQuestion.label, target };
    }
  }

  const eventDateQuestion =
    extractSentenceScopedEventDateQuestionParts(question);
  if (eventDateQuestion) {
    const target = normalizeWorkflowTargetLabel(eventDateQuestion.target);
    if (
      target &&
      findReadAnswerSentenceScopedAnswer(
        evidenceText,
        target,
        eventDateQuestion.label,
      )
    ) {
      return { label: eventDateQuestion.label, target };
    }
  }

  const targetCountQuestion =
    extractSentenceScopedTargetCountQuestionParts(question);
  if (targetCountQuestion) {
    const target = normalizeWorkflowTargetLabel(targetCountQuestion.target);
    if (
      target &&
      findReadAnswerSentenceScopedAnswer(
        evidenceText,
        target,
        targetCountQuestion.label,
      )
    ) {
      return { label: targetCountQuestion.label, target };
    }
  }

  const targetPresenceQuestion =
    extractSentenceScopedTargetPresenceQuestionParts(question);
  if (targetPresenceQuestion) {
    const target = normalizeWorkflowTargetLabel(targetPresenceQuestion.target);
    if (
      target &&
      findReadAnswerSentenceScopedAnswer(
        evidenceText,
        target,
        targetPresenceQuestion.label,
      )
    ) {
      return { label: targetPresenceQuestion.label, target };
    }
  }

  const targetStateQuestion =
    extractSentenceScopedTargetStateQuestionParts(question);
  if (targetStateQuestion) {
    const target = normalizeWorkflowTargetLabel(targetStateQuestion.target);
    if (
      target &&
      findReadAnswerSentenceScopedAnswer(
        evidenceText,
        target,
        targetStateQuestion.label,
      )
    ) {
      return { label: targetStateQuestion.label, target };
    }
  }

  const targetMetricValueQuestion =
    extractSentenceScopedTargetMetricValueQuestionParts(question);
  if (targetMetricValueQuestion) {
    const target = normalizeWorkflowTargetLabel(
      targetMetricValueQuestion.target,
    );
    if (
      target &&
      findReadAnswerSentenceScopedAnswer(
        evidenceText,
        target,
        targetMetricValueQuestion.label,
      )
    ) {
      return { label: targetMetricValueQuestion.label, target };
    }
  }

  const superlativeMetricQuestion =
    extractSentenceScopedSuperlativeMetricQuestionParts(question);
  if (superlativeMetricQuestion) {
    const winner = findReadAnswerSuperlativeMetricWinner(
      evidenceText,
      superlativeMetricQuestion.metric,
      superlativeMetricQuestion.direction,
    );
    if (winner) {
      return {
        label: superlativeMetricQuestion.label,
        target: winner.target,
      };
    }
  }

  const parts = extractRowScopedLabelValueQuestionParts(question);
  if (!parts) return null;

  const normalizedLabel = normalizeText(parts.label);
  const attributeLabel = canonicalSentenceScopedAttributeLabel(normalizedLabel);
  const answerLabel = attributeLabel ?? normalizedLabel;
  if (
    answerLabel !== "due date" &&
    answerLabel !== "status" &&
    answerLabel !== "priority" &&
    answerLabel !== "severity" &&
    answerLabel !== "location" &&
    !sentenceScopedEventDatePatternForLabel(answerLabel) &&
    !sentenceScopedCountMetricPatternForLabel(answerLabel) &&
    !sentenceScopedPresenceMetricPatternForLabel(answerLabel) &&
    !sentenceScopedMetricValuePatternForLabel(answerLabel) &&
    !sentenceScopedTargetStatePatternForLabel(answerLabel) &&
    !sentenceScopedByRelationPatternForLabel(answerLabel) &&
    !sentenceScopedRelationNounPatternForLabel(answerLabel) &&
    !sentenceScopedActiveRelationPatternForLabel(answerLabel) &&
    !sentenceScopedAttributePatternForLabel(answerLabel)
  ) {
    return null;
  }

  const target = normalizeWorkflowTargetLabel(parts.target);
  if (!target) return null;

  return findReadAnswerSentenceScopedAnswer(evidenceText, target, answerLabel)
    ? { label: answerLabel, target }
    : null;
}

export function findReadAnswerRowScopedLabelValueText(
  snapshot: DomSnapshot,
  target: string,
  expectedAnswerLabel: string,
): string | null {
  for (const element of snapshot.elements) {
    if (!element.isVisible || element.isDisabled) continue;
    if (!isWorkflowRowLikeElement(element)) continue;

    const rowText = readAnswerRowElementText(element);
    if (!rowText) continue;
    if (!workflowTargetLabelCoveredByText(target, rowText)) continue;
    if (!extractExpectedLabelValueAnswer(rowText, expectedAnswerLabel)) {
      continue;
    }
    return rowText;
  }
  return null;
}

function findReadAnswerSuperlativeMetricAnswer(
  evidenceText: string,
  expectedTarget: string,
  metric: string,
  direction: SentenceScopedSuperlativeDirection,
): { sentence: string; answer: string } | null {
  const winner = findReadAnswerSuperlativeMetricWinner(
    evidenceText,
    metric,
    direction,
  );
  if (!winner) return null;
  if (!workflowTargetLabelCoveredByText(expectedTarget, winner.target)) {
    return null;
  }
  return { sentence: winner.sentence, answer: winner.target };
}

function findReadAnswerSuperlativeMetricWinner(
  evidenceText: string,
  metric: string,
  direction: SentenceScopedSuperlativeDirection,
): ReadAnswerSuperlativeMetricCandidate | null {
  const candidates = evidenceText
    .split(/(?:[.!?]+|[\r\n]+)+/g)
    .map((sentence) => cleanLabel(sentence))
    .filter(Boolean)
    .filter((sentence) => sentence.length <= 500)
    .map((sentence) =>
      extractReadAnswerSuperlativeMetricCandidate(sentence, metric),
    )
    .filter(
      (candidate): candidate is ReadAnswerSuperlativeMetricCandidate =>
        candidate !== null,
    );
  return selectReadAnswerSuperlativeMetricWinner(candidates, direction);
}

export function selectReadAnswerSuperlativeMetricWinner(
  candidates: ReadAnswerSuperlativeMetricCandidate[],
  direction: SentenceScopedSuperlativeDirection,
): ReadAnswerSuperlativeMetricCandidate | null {
  const uniqueCandidates = new Map<
    string,
    ReadAnswerSuperlativeMetricCandidate
  >();
  for (const candidate of candidates) {
    const key = normalizeText(candidate.target);
    const existing = uniqueCandidates.get(key);
    if (existing && existing.value !== candidate.value) return null;
    if (!existing) uniqueCandidates.set(key, candidate);
  }
  if (uniqueCandidates.size < 2) return null;

  const sorted = [...uniqueCandidates.values()].sort((a, b) =>
    direction === "highest" ? b.value - a.value : a.value - b.value,
  );
  const [winner, runnerUp] = sorted;
  if (!winner || !runnerUp) return null;
  if (winner.value === runnerUp.value) return null;
  return winner;
}

export function extractReadAnswerSuperlativeMetricCandidate(
  sentence: string,
  metric: string,
): ReadAnswerSuperlativeMetricCandidate | null {
  const metricPattern = sentenceScopedSuperlativeMetricPattern(metric);
  if (!metricPattern) return null;
  const valuePattern = sentenceScopedSuperlativeMetricValuePattern();
  const patterns: Array<{
    pattern: RegExp;
    targetIndex: number;
    valueIndex: number;
  }> = [
    {
      pattern: new RegExp(
        `^\\s*(?:the\\s+)?(.{2,120}?)\\b(?:\\s*(?:'|\\u2019)s)?\\s+(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${valuePattern})\\s*$`,
        "i",
      ),
      targetIndex: 1,
      valueIndex: 2,
    },
    {
      pattern: new RegExp(
        `^\\s*(?:the\\s+)?(.{2,120}?)\\b\\s+(?:currently\\s+)?(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(${valuePattern})\\s+${metricPattern}\\s*$`,
        "i",
      ),
      targetIndex: 1,
      valueIndex: 2,
    },
    {
      pattern: new RegExp(
        `^\\s*(${valuePattern})\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?(.{2,120}?)\\s*$`,
        "i",
      ),
      targetIndex: 2,
      valueIndex: 1,
    },
  ];

  for (const { pattern, targetIndex, valueIndex } of patterns) {
    const match = pattern.exec(sentence);
    if (!match) continue;

    const target = cleanSentenceScopedSuperlativeCandidateTarget(
      match[targetIndex] ?? "",
    );
    const value = parseSentenceScopedSuperlativeMetricValue(
      match[valueIndex] ?? "",
    );
    if (target && value !== null) {
      return { target, value, sentence };
    }
  }

  return null;
}

function sentenceScopedSuperlativeMetricPattern(metric: string): string | null {
  const tokens = tokenizeCompletionText(metric);
  if (tokens.length < 1 || tokens.length > 6) return null;
  return tokens.map(escapeRegExp).join("\\s+");
}

function sentenceScopedSuperlativeMetricValuePattern(): string {
  const numeric = "(?:\\$\\s*)?\\d[\\d,]*(?:\\.\\d+)?";
  const unit =
    "(?:%|percentage|percent|points?|pts?|ms|msec|milliseconds?|sec|secs|seconds?|s|mins?|minutes?|m|hrs?|hours?|h|kbps|mbps|gbps|bps|kb|mb|gb|tb|bytes?|kg|mg|g|cm|mm|km|c|f|hz|khz|mhz|ghz|units?|items?|tickets?|incidents?|thousand|million|billion|k|b)";
  return `${numeric}(?:\\s*${unit})?`;
}

function cleanSentenceScopedSuperlativeCandidateTarget(
  value: string,
): string | null {
  const target = normalizeWorkflowTargetLabel(
    cleanLabel(value)
      .replace(/^(?:the\s+)?/i, "")
      .replace(/\s+(?:currently|still|now|presently|actively)$/i, ""),
  );
  if (!target) return null;
  const tokens = tokenizeCompletionText(target);
  if (tokens.length < 1 || tokens.length > 8) return null;
  return target;
}

function parseSentenceScopedSuperlativeMetricValue(
  value: string,
): number | null {
  const match = /(?:\$\s*)?(\d[\d,]*(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const numeric = Number((match[1] ?? "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

export function findReadAnswerSentenceScopedAnswer(
  evidenceText: string,
  target: string,
  expectedAnswerLabel: string,
): { sentence: string; answer: string } | null {
  const superlative =
    sentenceScopedSuperlativeMetricPartsForLabel(expectedAnswerLabel);
  if (superlative) {
    return findReadAnswerSuperlativeMetricAnswer(
      evidenceText,
      target,
      superlative.metric,
      superlative.direction,
    );
  }

  const sentences = evidenceText
    .split(/(?:[.!?]+|[\r\n]+)+/g)
    .map((sentence) => cleanLabel(sentence))
    .filter(Boolean);
  for (const sentence of sentences) {
    if (sentence.length > 500) continue;
    if (!workflowTargetLabelCoveredByText(target, sentence)) continue;
    const answer = extractSentenceScopedRelationAnswer(
      sentence,
      target,
      expectedAnswerLabel,
    );
    if (answer) return { sentence, answer };
  }
  return null;
}

export function readAnswerRowElementText(element: TaggedElement): string {
  const attrs = element.attributes ?? {};
  return cleanLabel(
    [element.text, attrs["aria-label"], attrs.title, attrs.label]
      .filter(Boolean)
      .join(" "),
  );
}

export function findGroundedLabelValueQuestionLabel(
  normalizedQuestion: string,
  pageText: string,
): string | null {
  const label = extractDirectQuestionLabel(normalizedQuestion);
  if (!label) return null;

  const labelTokens = tokenizeLabelValueQuestionLabel(label);
  if (labelTokens.length < 1 || labelTokens.length > 3) return null;

  const labelPattern = labelTokens.map(escapeRegExp).join("\\s+");
  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:([:=-])|\\b(is)\\b)\\s*([^.;\\n]{1,160})`,
    "i",
  ).exec(pageText);
  if (!match) return null;
  if (
    labelValueSeparatorNeedsAnswerShape(match[1], match[2]) &&
    !labelValueLooksAnswerLike(match[3] ?? "")
  ) {
    return null;
  }
  return cleanLabel(labelTokens.join(" "));
}

function tokenizeLabelValueQuestionLabel(label: string): string[] {
  return [
    ...new Set(normalizeText(label).match(/[a-z0-9$@._-]+/g) ?? []),
  ].filter(
    (token) =>
      (token.length >= 3 || token === "id") &&
      !DIRECT_PAGE_QUESTION_STOPWORDS.has(token),
  );
}

function labelValueSeparatorNeedsAnswerShape(
  symbolSeparator?: string,
  wordSeparator?: string,
): boolean {
  return symbolSeparator === "-" || normalizeText(wordSeparator ?? "") === "is";
}

function labelValueLooksAnswerLike(value: string): boolean {
  const tokens = tokenizeCompletionText(value);
  if (tokens.length === 0) return false;
  return !EXPLANATORY_LABEL_VALUE_START_WORDS.has(tokens[0]);
}

function extractDirectQuestionLabel(normalizedQuestion: string): string | null {
  const match =
    /^(?:please\s+)?(?:tell me\s+)?(?:what(?:'s| is| are)|who(?:'s| is)|when|where|which|how many|how much)\s+(?:is|are|was|were)?\s*(?:the\s+)?(.+?)(?:\?|$)/i.exec(
      normalizedQuestion,
    );
  const booleanMatch =
    /^(?:please\s+)?(?:is|are|was|were)\s+(?:the\s+)?(.+?)(?:\?|$)/i.exec(
      normalizedQuestion,
    );
  const label = cleanLabel(
    (match?.[1] ?? booleanMatch?.[1])
      ?.replace(
        /\b(?:on|in|according to|from) (?:this|the) (?:page|article|document|post|readme)\b.*$/i,
        "",
      )
      .replace(/\b(?:is|are|was|were)\s+there$/i, "")
      .replace(/^(?:total\s+)?(?:number|count|quantity)\s+of\s+/i, "")
      .replace(/[?.!]+$/g, "") ?? "",
  );
  return label || null;
}

export function snapshotPageText(snapshot: DomSnapshot): string {
  return cleanLabel(
    [snapshot.pageContent, snapshot.visibleContent].filter(Boolean).join(" "),
  );
}

export function hasSubstantiveReadAnswerEvidence(value: string): boolean {
  return (
    tokenizeCompletionText(value).length >= 12 && cleanLabel(value).length > 100
  );
}

export function readAnswerSummaryGroundedInEvidence(
  summary: string,
  evidence: Extract<CompletionEvidence, { type: "answer_state" }>,
  expectedAnswerLabel?: string,
): boolean {
  if (expectedAnswerLabel) {
    if (
      readAnswerSummaryMatchesExpectedLabelValue(
        summary,
        evidence.detail.evidenceText,
        expectedAnswerLabel,
      )
    ) {
      return true;
    }
    if (
      readAnswerLabelCanUseDistinctAnswerToken(expectedAnswerLabel) &&
      !extractExpectedLabelValueAnswer(
        evidence.detail.evidenceText,
        expectedAnswerLabel,
      ) &&
      readAnswerSummarySharesDistinctAnswerToken(
        summary,
        evidence.detail.evidenceText,
      )
    ) {
      return true;
    }
    return false;
  }

  const sourceTokens = new Set(
    tokenizeCompletionText(evidence.detail.evidenceText),
  );
  if (sourceTokens.size < 12) return false;

  const summaryTokens = tokenizeCompletionText(summary);
  if (summaryTokens.length < 4) return false;
  const overlap = new Set(
    summaryTokens.filter((token) => sourceTokens.has(token)),
  ).size;
  const requiredOverlap = Math.min(
    5,
    Math.max(3, Math.ceil(summaryTokens.length * 0.25)),
  );
  return overlap >= requiredOverlap;
}

function readAnswerLabelCanUseDistinctAnswerToken(label: string): boolean {
  return /\b(?:code|token|key|identifier|id|number)\b/i.test(label);
}

function readAnswerSummarySharesDistinctAnswerToken(
  summary: string,
  evidenceText: string,
): boolean {
  const evidenceTokens = new Set(extractDistinctAnswerTokens(evidenceText));
  if (evidenceTokens.size === 0) return false;
  return extractDistinctAnswerTokens(summary).some((token) =>
    evidenceTokens.has(token),
  );
}

function extractDistinctAnswerTokens(value: string): string[] {
  return Array.from(
    new Set(
      (value.match(/\b[A-Z0-9]{2,}(?:[-_][A-Z0-9]{2,})+\b/g) ?? []).map(
        (token) => token.toLowerCase(),
      ),
    ),
  );
}

function readAnswerSummaryMatchesExpectedLabelValue(
  summary: string,
  evidenceText: string,
  expectedAnswerLabel: string,
): boolean {
  const labelTokens = tokenizeLabelValueQuestionLabel(expectedAnswerLabel);
  if (labelTokens.length < 1 || labelTokens.length > 3) return false;

  const labelPattern = labelTokens.map(escapeRegExp).join("\\s+");
  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:([:=-])|\\b(is)\\b)\\s*([^.;\\n]{1,160})`,
    "i",
  ).exec(evidenceText);
  if (
    match &&
    labelValueSeparatorNeedsAnswerShape(match[1], match[2]) &&
    !labelValueLooksAnswerLike(match[3] ?? "")
  ) {
    return false;
  }
  if (
    !labelCanHaveCoordinatePairValue(expectedAnswerLabel) &&
    labelValueStartsWithCoordinatePair(evidenceText, labelPattern)
  ) {
    return false;
  }
  if (
    !labelCanHaveDateRangeValue(expectedAnswerLabel) &&
    labelValueStartsWithDateRange(evidenceText, labelPattern)
  ) {
    return false;
  }
  const rawValue = extractExpectedLabelValueAnswer(
    evidenceText,
    expectedAnswerLabel,
  );
  if (!rawValue) return false;
  if (
    !labelCanHaveColorValue(expectedAnswerLabel) &&
    /\b(?:rgba?|hsla?)\s*\(/i.test(rawValue)
  ) {
    return false;
  }
  if (
    !labelCanHaveCoordinatePairValue(expectedAnswerLabel) &&
    isCoordinatePairValue(rawValue)
  ) {
    return false;
  }
  if (
    !labelCanHaveDateRangeValue(expectedAnswerLabel) &&
    isDateRangeValue(rawValue)
  ) {
    return false;
  }

  const valueWords = rawValue.split(/\s+/).filter(Boolean);
  if (valueWords.length === 0) return false;

  const normalizedSummary = normalizeText(summary);
  const preciseConciseValue = extractPreciseConciseLabelValue(
    evidenceText,
    labelPattern,
    expectedAnswerLabel,
  );
  if (preciseConciseValue) {
    if (isMacAddressValue(preciseConciseValue)) {
      return preciseMacAddressValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isIpv6AddressValue(preciseConciseValue)) {
      return preciseIpv6ValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isIpv6CidrValue(preciseConciseValue)) {
      return preciseIpv6CidrValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCidrValue(preciseConciseValue)) {
      return preciseCidrValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isPathValue(preciseConciseValue)) {
      return precisePathValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDomainNameValue(preciseConciseValue)) {
      return preciseDomainValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDottedVersionValue(preciseConciseValue)) {
      return preciseVersionValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isHashValue(preciseConciseValue)) {
      return preciseHashValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isHexColorValue(preciseConciseValue)) {
      return preciseHexColorValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCssRgbColorValue(preciseConciseValue)) {
      return preciseCssRgbColorValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCssHslColorValue(preciseConciseValue)) {
      return preciseCssHslColorValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCssNamedColorValue(preciseConciseValue)) {
      return preciseCssNamedColorValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDurationValue(preciseConciseValue)) {
      return preciseDurationValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDataSizeValue(preciseConciseValue)) {
      return preciseDataSizeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDataRateValue(preciseConciseValue)) {
      return preciseDataRateValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isPhysicalSpeedValue(preciseConciseValue)) {
      return precisePhysicalSpeedValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isTemperatureValue(preciseConciseValue)) {
      return preciseTemperatureValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isElectricalValue(preciseConciseValue)) {
      return preciseElectricalValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isMassValue(preciseConciseValue)) {
      return preciseMassValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isLengthValue(preciseConciseValue)) {
      return preciseLengthValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isAreaValue(preciseConciseValue)) {
      return preciseAreaValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isVolumeValue(preciseConciseValue)) {
      return preciseVolumeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isPressureValue(preciseConciseValue)) {
      return precisePressureValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isFrequencyValue(preciseConciseValue)) {
      return preciseFrequencyValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDateRangeValue(preciseConciseValue)) {
      return preciseDateRangeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isTimeRangeValue(preciseConciseValue)) {
      return preciseTimeRangeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isTimezoneValue(preciseConciseValue)) {
      return preciseTimezoneValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isLocaleCodeValue(preciseConciseValue)) {
      return preciseLocaleCodeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCoordinatePairValue(preciseConciseValue)) {
      return preciseCoordinatePairValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    return valueTokenCoveredBySummary(
      normalizedSummary,
      normalizeText(preciseConciseValue),
    );
  }

  if (valueWords.length >= 2) {
    return labelValuePhraseCoveredBySummary(normalizedSummary, valueWords);
  }

  const normalizedValue = normalizeText(valueWords[0]);
  if (isIdentifierCodeValue(rawValue)) {
    return preciseIdentifierCodeValueCoveredBySummary(
      normalizedSummary,
      normalizedValue,
    );
  }
  if (
    (isConciseSingleTokenLabelValue(rawValue) ||
      isConcisePriorityLabelValue(rawValue, expectedAnswerLabel)) &&
    valueTokenCoveredBySummary(normalizedSummary, normalizedValue)
  ) {
    return true;
  }

  const normalizedLabel = normalizeText(expectedAnswerLabel);
  return (
    normalizedSummary.includes(normalizedLabel) &&
    normalizedSummary.includes(normalizedValue)
  );
}

export function labelValuePhraseCoveredBySummary(
  normalizedSummary: string,
  valueWords: string[],
): boolean {
  const requiredWords =
    valueWords.length <= 4 ? valueWords : valueWords.slice(0, 2);
  const phrase = normalizeText(requiredWords.join(" "));
  if (!phrase) return false;
  if (valueWords.length > 4) return normalizedSummary.includes(phrase);
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(phrase)}(?=$|[.,;:!?)]|\\s+(?:and|are|as|for|from|has|have|had|in|is|on|was|were|with)\\b)`,
  ).test(normalizedSummary);
}

export function extractExpectedLabelValueAnswer(
  evidenceText: string,
  expectedAnswerLabel: string,
): string | null {
  for (const labelPattern of labelValuePatternsForExpectedLabel(
    expectedAnswerLabel,
  )) {
    const match = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:([:=-])|\\b(is)\\b)\\s*([^.;\\n]{1,160})`,
      "i",
    ).exec(evidenceText);
    if (!match) continue;
    if (
      labelValueSeparatorNeedsAnswerShape(match[1], match[2]) &&
      !labelValueLooksAnswerLike(match[3] ?? "")
    ) {
      return null;
    }
    const answer = cleanLabelValueAnswerText(match[3] ?? "");
    if (answer) return answer;
  }
  return null;
}

function extractSentenceScopedRelationAnswer(
  sentence: string,
  target: string,
  expectedAnswerLabel: string,
): string | null {
  const targetPattern = workflowTargetTextPattern(target);
  if (!targetPattern) return null;
  const normalizedLabel = normalizeText(expectedAnswerLabel);
  if (normalizedLabel === "definition") {
    return extractSentenceScopedDefinitionAnswer(sentence, targetPattern);
  }

  const reasonPredicatePattern =
    sentenceScopedReasonPredicatePatternForLabel(normalizedLabel);
  if (reasonPredicatePattern) {
    return extractSentenceScopedReasonAnswer(
      sentence,
      targetPattern,
      reasonPredicatePattern,
    );
  }

  if (normalizedLabel === "location") {
    return extractSentenceScopedLocationAnswer(sentence, targetPattern);
  }

  const eventDatePattern =
    sentenceScopedEventDatePatternForLabel(normalizedLabel);
  if (eventDatePattern) {
    return extractSentenceScopedEventDateAnswer(
      sentence,
      targetPattern,
      eventDatePattern,
      normalizedLabel,
    );
  }

  const countMetricPattern =
    sentenceScopedCountMetricPatternForLabel(normalizedLabel);
  if (countMetricPattern) {
    return extractSentenceScopedTargetCountAnswer(
      sentence,
      targetPattern,
      countMetricPattern,
    );
  }

  const presenceMetricPattern =
    sentenceScopedPresenceMetricPatternForLabel(normalizedLabel);
  if (presenceMetricPattern) {
    return extractSentenceScopedTargetPresenceAnswer(
      sentence,
      targetPattern,
      presenceMetricPattern,
    );
  }

  const targetStatePattern =
    sentenceScopedTargetStatePatternForLabel(normalizedLabel);
  if (targetStatePattern) {
    return extractSentenceScopedTargetStateAnswer(
      sentence,
      targetPattern,
      targetStatePattern,
    );
  }

  const metricValuePattern =
    sentenceScopedMetricValuePatternForLabel(normalizedLabel);
  if (metricValuePattern) {
    return extractSentenceScopedTargetMetricValueAnswer(
      sentence,
      targetPattern,
      metricValuePattern,
    );
  }

  if (normalizedLabel === "priority" || normalizedLabel === "severity") {
    const labelPattern =
      normalizedLabel === "severity" ? "severity" : "priority";
    const priorityPatterns = [
      `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+${labelPattern}\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${SENTENCE_SCOPED_PRIORITY_ANSWER_PATTERN})(?:\\b|$)`,
      `^\\s*${targetPattern}\\b.{0,80}\\b(?:is|are|was|were|remains|remain|became|becomes)\\s+(${SENTENCE_SCOPED_PRIORITY_ANSWER_PATTERN})\\s+${labelPattern}(?:\\b|$)`,
    ];
    for (const pattern of priorityPatterns) {
      const match = new RegExp(pattern, "i").exec(sentence);
      const answer = cleanSentenceScopedPriorityAnswer(match?.[1] ?? "");
      if (answer) return answer;
    }
    return null;
  }

  if (normalizedLabel === "status") {
    const explicitStatusPatterns = [
      `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+status\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,120})`,
      `^\\s*${targetPattern}\\b.{0,80}\\b(?:is|are|was|were|remains|remain|became|becomes)\\s+(${SENTENCE_SCOPED_STATUS_ANSWER_PATTERN})(?:\\b|$)`,
    ];
    for (const pattern of explicitStatusPatterns) {
      const match = new RegExp(pattern, "i").exec(sentence);
      const answer = cleanSentenceScopedStatusAnswer(match?.[1] ?? "");
      if (answer) return answer;
    }
    return null;
  }

  if (normalizedLabel === "due date") {
    const dueDatePatterns = [
      `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+due\\s+date\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,120})`,
      `^\\s*${targetPattern}\\b.{0,80}\\b(?:is|are|was|were)?\\s*due\\s+(?:on|by)\\s+([^.;\\n]{2,120})`,
    ];
    for (const pattern of dueDatePatterns) {
      const match = new RegExp(pattern, "i").exec(sentence);
      const answer = cleanSentenceScopedAnswerText(match?.[1] ?? "");
      if (answer) return answer;
    }
    return null;
  }

  const attributePattern =
    sentenceScopedAttributePatternForLabel(normalizedLabel);
  if (attributePattern) {
    const attributePatterns = [
      `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+${attributePattern}\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,120})`,
      `^\\s*${attributePattern}\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,120})`,
    ];
    for (const pattern of attributePatterns) {
      const match = new RegExp(pattern, "i").exec(sentence);
      const answer = cleanSentenceScopedAnswerText(match?.[1] ?? "");
      if (answer) return answer;
    }
    return null;
  }

  const relationPattern =
    sentenceScopedByRelationPatternForLabel(normalizedLabel);
  const activeRelationPattern =
    sentenceScopedActiveRelationPatternForLabel(normalizedLabel);
  const relationNounPattern =
    sentenceScopedRelationNounPatternForLabel(normalizedLabel);
  if (!relationPattern && !activeRelationPattern && !relationNounPattern) {
    return null;
  }

  if (relationNounPattern) {
    const possessiveSeparatorMatch = new RegExp(
      `^\\s*${targetPattern}\\b\\s*(?:'|\\u2019)s\\s+${relationNounPattern}\\s*(?::|=)\\s*([^.;\\n]{2,120})`,
      "i",
    ).exec(sentence);
    const possessiveSeparatorAnswer = cleanSentenceScopedAnswerText(
      possessiveSeparatorMatch?.[1] ?? "",
    );
    if (possessiveSeparatorAnswer) return possessiveSeparatorAnswer;

    const possessiveMatch = new RegExp(
      `^\\s*${targetPattern}\\b\\s*(?:'|\\u2019)s\\s+${relationNounPattern}\\s+(?:is|are|was|were)\\s+([^.;\\n]{2,120})`,
      "i",
    ).exec(sentence);
    const possessiveAnswer = cleanSentenceScopedAnswerText(
      possessiveMatch?.[1] ?? "",
    );
    if (possessiveAnswer) return possessiveAnswer;

    const leadingNounMatch = new RegExp(
      `^\\s*${relationNounPattern}\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,120})`,
      "i",
    ).exec(sentence);
    const leadingNounAnswer = cleanSentenceScopedAnswerText(
      leadingNounMatch?.[1] ?? "",
    );
    if (leadingNounAnswer) return leadingNounAnswer;

    const targetRelationMatch = new RegExp(
      `^\\s*${targetPattern}\\b\\s+${relationNounPattern}\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,120})`,
      "i",
    ).exec(sentence);
    const targetRelationAnswer = cleanSentenceScopedAnswerText(
      targetRelationMatch?.[1] ?? "",
    );
    if (targetRelationAnswer) return targetRelationAnswer;

    const currentRoleNounAnswer = extractCurrentRoleRelationNounAnswer(
      sentence,
      target,
      targetPattern,
      relationNounPattern,
    );
    if (currentRoleNounAnswer) return currentRoleNounAnswer;

    const predicateNounMatch = new RegExp(
      `([^.;\\n]{2,120})\\s+(?:is|are|was|were)\\s+(?:the\\s+)?${relationNounPattern}\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b`,
      "i",
    ).exec(sentence);
    const predicateNounAnswer = cleanActiveSentenceScopedAnswerText(
      predicateNounMatch?.[1] ?? "",
      target,
    );
    if (predicateNounAnswer) return predicateNounAnswer;
  }

  if (activeRelationPattern) {
    const activeMatch = new RegExp(
      `([^.;\\n]{2,120})\\s+${activeRelationPattern}\\s+(?:the\\s+)?${targetPattern}\\b`,
      "i",
    ).exec(sentence);
    const activeAnswer = cleanActiveSentenceScopedAnswerText(
      activeMatch?.[1] ?? "",
      target,
    );
    if (activeAnswer) return activeAnswer;
  }

  if (relationPattern) {
    const match = new RegExp(
      `^\\s*${targetPattern}\\b.{0,80}\\b(?:is|are|was|were|has\\s+been|have\\s+been)?\\s*${relationPattern}\\s+([^.;\\n]{2,120})`,
      "i",
    ).exec(sentence);
    const answer = cleanSentenceScopedAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }
  return null;
}

function extractSentenceScopedDefinitionAnswer(
  sentence: string,
  targetPattern: string,
): string | null {
  const subjectPattern = `(?:the\\s+)?(?:term\\s+)?${targetPattern}\\b`;
  const patterns = [
    `^\\s*${subjectPattern}\\s+(?:means|refers\\s+to|stands\\s+for)\\s+([^.;\\n]{2,180})`,
    `^\\s*${subjectPattern}\\s+(?:is|are|was|were)\\s+defined\\s+as\\s+([^.;\\n]{2,180})`,
    `^\\s*${subjectPattern}\\s+(?:is|are|was|were)\\s+((?:a|an|the)\\s+[^.;\\n]{2,180})`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedDefinitionAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }

  return null;
}

function cleanSentenceScopedDefinitionAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (tokenizeCompletionText(answer).length < 2) return "";
  return answer;
}

export function sentenceScopedReasonPredicatePatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (normalizedLabel === "delayed reason") return "delayed";
  if (normalizedLabel === "blocked reason") return "blocked";
  if (normalizedLabel === "failed reason") return "failed";
  if (normalizedLabel === "canceled reason") return "cancel(?:ed|led)";
  if (normalizedLabel === "rejected reason") return "rejected";
  if (normalizedLabel === "paused reason") return "paused";
  if (normalizedLabel === "stopped reason") return "stopped";
  if (normalizedLabel === "closed reason") return "closed";
  if (normalizedLabel === "escalated reason") return "escalated";
  if (normalizedLabel === "on hold reason") return "on\\s+hold";
  return null;
}

function extractSentenceScopedReasonAnswer(
  sentence: string,
  targetPattern: string,
  predicatePattern: string,
): string | null {
  const verbPattern =
    "(?:is|are|was|were|has\\s+been|have\\s+been|got|became|becomes|remains|remain)";
  const targetPredicatePattern = `^\\s*${targetPattern}\\b\\s+(?:${verbPattern}\\s+)?${predicatePattern}\\b`;
  const patterns = [
    `${targetPredicatePattern}\\s+because\\s+of\\s+([^.;\\n]{2,180})`,
    `${targetPredicatePattern}\\s+(?:because|since)\\s+([^.;\\n]{2,180})`,
    `${targetPredicatePattern}\\s+due\\s+to\\s+([^.;\\n]{2,180})`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedReasonAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }

  return null;
}

function cleanSentenceScopedReasonAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (tokenizeCompletionText(answer).length < 2) return "";
  return answer;
}

function extractSentenceScopedLocationAnswer(
  sentence: string,
  targetPattern: string,
): string | null {
  const bePattern =
    "(?:is|are|was|were|has\\s+been|have\\s+been|got|became|becomes|remains|remain)";
  const locationVerbPattern =
    "(?:located|based|hosted|deployed|stored|running)";
  const prepositionPattern = "(?:in|at|on|inside|within|near)";
  const patterns = [
    `^\\s*${targetPattern}\\b\\s+(?:${bePattern}\\s+)?${locationVerbPattern}\\s+${prepositionPattern}\\s+([^.;\\n]{2,160})`,
    `^\\s*${targetPattern}\\b\\s+(?:runs?|ran|resides?|lives?)\\s+${prepositionPattern}\\s+([^.;\\n]{2,160})`,
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+location\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,160})`,
    `^\\s*location\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,160})`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedLocationAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }

  return null;
}

function cleanSentenceScopedLocationAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  if (
    /\b(?:is|are|was|were|has\s+been|have\s+been)\s+(?:located|based|hosted|deployed|stored|running)\b/i.test(
      answer,
    ) ||
    /\b(?:runs?|ran|resides?|lives?)\s+(?:in|at|on|inside|within|near)\b/i.test(
      answer,
    )
  ) {
    return "";
  }
  return answer;
}

export function sentenceScopedEventDatePatternForLabel(label: string): string | null {
  const normalizedLabel = normalizeText(label);
  if (normalizedLabel === "launched date") return "launch(?:ed)?";
  if (normalizedLabel === "released date") return "release(?:d)?";
  if (normalizedLabel === "deployed date") return "deploy(?:ed)?";
  if (normalizedLabel === "created date") return "creat(?:e|ed)";
  if (normalizedLabel === "opened date") return "open(?:ed)?";
  if (normalizedLabel === "closed date") return "clos(?:e|ed)";
  if (normalizedLabel === "resolved date") return "resolv(?:e|ed)";
  if (normalizedLabel === "updated date")
    return "(?:updat(?:e|ed)|chang(?:e|ed))";
  if (normalizedLabel === "approved date") return "approv(?:e|ed)";
  if (normalizedLabel === "reviewed date") return "review(?:ed)?";
  if (normalizedLabel === "completed date") return "complet(?:e|ed)";
  if (normalizedLabel === "submitted date") return "submit(?:ted)?";
  if (normalizedLabel === "published date") return "publish(?:ed)?";
  if (normalizedLabel === "started date") return "start(?:ed)?";
  if (normalizedLabel === "stopped date") return "stop(?:ped)?";
  if (normalizedLabel === "scheduled date") return "schedul(?:e|ed)";
  if (normalizedLabel === "canceled date") return "cancel(?:ed|led)?";
  return null;
}

function extractSentenceScopedEventDateAnswer(
  sentence: string,
  targetPattern: string,
  eventPattern: string,
  normalizedLabel: string,
): string | null {
  const bePattern =
    "(?:is|are|was|were|has\\s+been|have\\s+been|got|became|becomes)";
  const datePattern = sentenceScopedEventDateAnswerPattern();
  const eventNounPattern =
    sentenceScopedEventDateNounPatternForLabel(normalizedLabel);
  const patterns = [
    `^\\s*${targetPattern}\\b\\s+(?:${bePattern}\\s+)?${eventPattern}\\s+(?:on|at)\\s+(${datePattern})\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:${bePattern}\\s+)?${eventPattern}\\s+(?:in|during)\\s+(${datePattern})\\s*$`,
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+${eventNounPattern}\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${datePattern})\\s*$`,
    `^\\s*${eventNounPattern}\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${datePattern})\\s*$`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedEventDateAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }

  return null;
}

function sentenceScopedEventDateNounPatternForLabel(label: string): string {
  const normalizedLabel = normalizeText(label).replace(/\s+date$/, "");
  if (normalizedLabel === "launched") return "(?:launch|launched)\\s+date";
  if (normalizedLabel === "released") return "(?:release|released)\\s+date";
  if (normalizedLabel === "deployed")
    return "(?:deploy|deployment|deployed)\\s+date";
  if (normalizedLabel === "created")
    return "(?:create|creation|created)\\s+date";
  if (normalizedLabel === "opened") return "(?:open|opened)\\s+date";
  if (normalizedLabel === "closed") return "(?:close|closure|closed)\\s+date";
  if (normalizedLabel === "resolved")
    return "(?:resolve|resolution|resolved)\\s+date";
  if (normalizedLabel === "updated")
    return "(?:update|change|updated|changed)\\s+date";
  if (normalizedLabel === "approved")
    return "(?:approve|approval|approved)\\s+date";
  if (normalizedLabel === "reviewed") return "(?:review|reviewed)\\s+date";
  if (normalizedLabel === "completed")
    return "(?:complete|completion|completed)\\s+date";
  if (normalizedLabel === "submitted")
    return "(?:submit|submission|submitted)\\s+date";
  if (normalizedLabel === "published")
    return "(?:publish|publication|published)\\s+date";
  if (normalizedLabel === "started") return "(?:start|started)\\s+date";
  if (normalizedLabel === "stopped") return "(?:stop|stopped)\\s+date";
  if (normalizedLabel === "scheduled") return "(?:schedule|scheduled)\\s+date";
  if (normalizedLabel === "canceled")
    return "(?:cancel|cancellation|canceled|cancelled)\\s+date";
  return `${escapeRegExp(normalizedLabel)}\\s+date`;
}

function sentenceScopedEventDateAnswerPattern(): string {
  const month =
    "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const clock =
    "(?:[01]?\\d|2[0-3]):[0-5]\\d(?:\\s*(?:am|pm|utc|gmt|[a-z]{2,4}))?";
  const namedDate = `${month}\\.?\\s+\\d{1,2}(?:,\\s*\\d{4})?`;
  const dayFirstDate = `\\d{1,2}\\s+${month}\\.?\\s+\\d{4}`;
  const isoDate = "\\d{4}-\\d{2}-\\d{2}";
  const slashDate = "\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}";
  const monthYear = `${month}\\.?\\s+\\d{4}`;
  const quarter = "q[1-4]\\s+\\d{4}";
  const year = "\\d{4}";
  return `(?:(?:${namedDate}|${dayFirstDate}|${isoDate}|${slashDate})(?:\\s+(?:at\\s+)?${clock})?|${monthYear}|${quarter}|${year}|${clock})`;
}

function cleanSentenceScopedEventDateAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  return new RegExp(`^${sentenceScopedEventDateAnswerPattern()}$`, "i").test(
    answer,
  )
    ? answer
    : "";
}

function sentenceScopedCountMetricPatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel.endsWith(" count")) return null;
  const metric = normalizedLabel.replace(/\s+count$/, "");
  const tokens = tokenizeCompletionText(metric);
  if (tokens.length < 2 || tokens.length > 6) return null;
  return tokens.map(escapeRegExp).join("\\s+");
}

export function sentenceScopedPresenceMetricPatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel.endsWith(" presence")) return null;
  const metric = normalizedLabel.replace(/\s+presence$/, "");
  const tokens = tokenizeCompletionText(metric);
  if (tokens.length < 2 || tokens.length > 6) return null;
  return tokens.map(escapeRegExp).join("\\s+");
}

export function sentenceScopedMetricValuePatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel.endsWith(" value")) return null;
  const metric = normalizedLabel.replace(/\s+value$/, "");
  if (sentenceScopedMetricValueReservedLabel(metric)) return null;
  const tokens = tokenizeCompletionText(metric);
  if (tokens.length < 1 || tokens.length > 5) return null;
  return tokens.map(escapeRegExp).join("\\s+");
}

function extractSentenceScopedTargetCountAnswer(
  sentence: string,
  targetPattern: string,
  metricPattern: string,
): string | null {
  const countPattern = sentenceScopedTargetCountAnswerPattern();
  const adverbPattern = sentenceScopedTargetCountAdverbPattern();
  const zeroPatterns = [
    `^\\s*${targetPattern}\\b\\s+no\\s+longer\\s+(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(?:any\\s+)?${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(?:no|zero)\\s+${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:does|do|did)\\s+${adverbPattern}not\\s+(?:have|contain|include|show|list|track|report)\\s+(?:any\\s+)?${metricPattern}\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+no\\s+longer\\s+)(?:any\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})(?:no|zero)\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern}not\\s+)(?:any\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
  ];
  for (const pattern of zeroPatterns) {
    if (new RegExp(pattern, "i").test(sentence)) return "zero";
  }

  const patterns = [
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(${countPattern})\\s+${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(${countPattern})\\s+${metricPattern}\\s+(?:left|remaining)\\s*$`,
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+${metricPattern}\\s+(?:count|number|quantity)\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${countPattern})\\s*$`,
    `^\\s*${metricPattern}\\s+(?:count|number|quantity)\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${countPattern})\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})?(${countPattern})\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})?(${countPattern})\\s+${metricPattern}\\s+(?:left|remaining)\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(${countPattern})\\s+${metricPattern}\\s+(?:(?:${adverbPattern}(?:remain|remains))|(?:(?:is|are|was|were)\\s+${adverbPattern}(?:left|remaining)))\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedTargetCountAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }
  return null;
}

function sentenceScopedTargetCountAnswerPattern(): string {
  return "(?:\\d[\\d,]*(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
}

function cleanSentenceScopedTargetCountAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  return new RegExp(`^${sentenceScopedTargetCountAnswerPattern()}$`, "i").test(
    answer,
  )
    ? answer
    : "";
}

function sentenceScopedTargetCountAdverbPattern(): string {
  return "(?:(?:currently|still|now|presently|actively)\\s+)?";
}

function extractSentenceScopedTargetPresenceAnswer(
  sentence: string,
  targetPattern: string,
  metricPattern: string,
): string | null {
  const countPattern = sentenceScopedTargetCountAnswerPattern();
  const adverbPattern = sentenceScopedTargetPresenceAdverbPattern();
  const noPatterns = [
    `^\\s*${targetPattern}\\b\\s+no\\s+longer\\s+(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(?:any\\s+)?${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(?:no|zero)\\s+${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:does|do|did)\\s+${adverbPattern}not\\s+(?:have|contain|include|show|list|track|report)\\s+(?:any\\s+)?${metricPattern}\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+no\\s+longer\\s+)(?:any\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})(?:no|zero)\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern}not\\s+)(?:any\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
  ];
  for (const pattern of noPatterns) {
    if (new RegExp(pattern, "i").test(sentence)) return "no";
  }

  const countPatterns = [
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(${countPattern})\\s+${metricPattern}\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})?(${countPattern})\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
  ];
  for (const pattern of countPatterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const count = cleanSentenceScopedTargetCountAnswerText(match?.[1] ?? "");
    if (count)
      return sentenceScopedTargetCountAnswerIsZero(count) ? "no" : "yes";
  }

  return null;
}

function sentenceScopedTargetPresenceAdverbPattern(): string {
  return "(?:(?:currently|still|now|presently|actively)\\s+)?";
}

function sentenceScopedTargetCountAnswerIsZero(value: string): boolean {
  const normalized = normalizeText(value).replace(/,/g, "");
  if (normalized === "zero") return true;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric === 0;
}

function extractSentenceScopedTargetMetricValueAnswer(
  sentence: string,
  targetPattern: string,
  metricPattern: string,
): string | null {
  const answerPattern = sentenceScopedMetricValueAnswerPattern();
  const patterns = [
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${answerPattern})\\s*$`,
    `^\\s*(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${answerPattern})\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:has|have|had|shows?|lists?|tracks?|reports?)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s+(?:of|at|as)\\s+(${answerPattern})\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:shows?|lists?|tracks?|reports?)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s*(${answerPattern})\\s*$`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedMetricValueAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }
  return null;
}

function sentenceScopedMetricValueAnswerPattern(): string {
  const numeric = "\\d[\\d,]*(?:\\.\\d+)?";
  const unit =
    "(?:%|percentage|percent|points?|pts?|ms|msec|milliseconds?|sec|secs|seconds?|s|mins?|minutes?|m|hrs?|hours?|h|kbps|mbps|gbps|bps|kb|mb|gb|tb|bytes?|kg|mg|g|cm|mm|km|c|f|hz|khz|mhz|ghz|thousand|million|billion|k|b)";
  return `(?:\\$\\s*)?${numeric}(?:\\s*${unit})?`;
}

function cleanSentenceScopedMetricValueAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  return new RegExp(`^${sentenceScopedMetricValueAnswerPattern()}$`, "i").test(
    answer,
  )
    ? answer
    : "";
}

function sentenceScopedTargetStatePatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (normalizedLabel === "active state") return "active";
  if (normalizedLabel === "inactive state") return "inactive";
  if (normalizedLabel === "blocked state") return "blocked";
  if (normalizedLabel === "unblocked state") return "unblocked";
  if (normalizedLabel === "open state") return "open";
  if (normalizedLabel === "closed state") return "closed";
  if (normalizedLabel === "pending state") return "pending";
  if (normalizedLabel === "resolved state") return "resolved";
  if (normalizedLabel === "enabled state") return "enabled";
  if (normalizedLabel === "disabled state") return "disabled";
  if (normalizedLabel === "approved state") return "approved";
  if (normalizedLabel === "rejected state") return "rejected";
  if (normalizedLabel === "completed state")
    return "(?:complete|completed|done)";
  if (normalizedLabel === "failed state") return "failed";
  if (normalizedLabel === "successful state") return "(?:successful|success)";
  if (normalizedLabel === "draft state") return "draft";
  if (normalizedLabel === "submitted state") return "submitted";
  if (normalizedLabel === "sent state") return "sent";
  if (normalizedLabel === "archived state") return "archived";
  if (normalizedLabel === "deleted state") return "deleted";
  if (normalizedLabel === "canceled state") return "cancel(?:ed|led)";
  if (normalizedLabel === "delayed state") return "delayed";
  if (normalizedLabel === "paused state") return "paused";
  if (normalizedLabel === "stopped state") return "stopped";
  if (normalizedLabel === "escalated state") return "escalated";
  if (normalizedLabel === "on hold state") return "on\\s+hold";
  return null;
}

function extractSentenceScopedTargetStateAnswer(
  sentence: string,
  targetPattern: string,
  statePattern: string,
): string | null {
  const bePattern =
    "(?:is|are|was|were|has\\s+been|have\\s+been|had\\s+been|became|becomes|remains|remain)";
  const adverbPattern = sentenceScopedTargetStateAdverbPattern();
  const negationPattern = "((?:not|no\\s+longer)\\s+)?";
  const tailPattern =
    "(?:\\s+(?:because|since|due\\s+to|by)\\b[^.;\\n]{2,180})?";
  const patterns = [
    `^\\s*${targetPattern}\\b\\s+${bePattern}\\s+${adverbPattern}${negationPattern}${adverbPattern}${statePattern}\\b${tailPattern}\\s*$`,
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+status\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*${adverbPattern}${negationPattern}${adverbPattern}${statePattern}\\b\\s*$`,
    `^\\s*status\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*${adverbPattern}${negationPattern}${adverbPattern}${statePattern}\\b\\s*$`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    if (!match) continue;
    return normalizeText(match[1] ?? "") ? "no" : "yes";
  }
  return null;
}

function sentenceScopedTargetStateAdverbPattern(): string {
  return "(?:(?:currently|still|now|presently|actively)\\s+)?";
}

function extractCurrentRoleRelationNounAnswer(
  sentence: string,
  target: string,
  targetPattern: string,
  relationNounPattern: string,
): string | null {
  const currentRoleAdverbPattern = "(?:currently|presently|now|still|actively)";
  const currentRolePhrasePattern = `(?:(?:${currentRoleAdverbPattern}\\s+)?(?:serves?|acts|functions)\\s+as|(?:is|are)\\s+(?:${currentRoleAdverbPattern}\\s+)?(?:acting|listed|designated|identified|shown|named|recorded|displayed)\\s+as)`;
  const match = new RegExp(
    `([^.;\\n]{2,120}?)\\s+${currentRolePhrasePattern}\\s+(?:the\\s+)?${relationNounPattern}\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b`,
    "i",
  ).exec(sentence);

  return cleanActiveSentenceScopedAnswerText(match?.[1] ?? "", target);
}

export function sentenceScopedByRelationPatternForLabel(label: string): string | null {
  return (
    SENTENCE_SCOPED_BY_RELATIONS.find(
      (relation) => relation.label === normalizeText(label),
    )?.sentenceRelationPattern ?? null
  );
}

export function sentenceScopedRelationNounPatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  return SENTENCE_SCOPED_BY_RELATIONS.some(
    (relation) => relation.label === normalizedLabel,
  )
    ? escapeRegExp(normalizedLabel).replace(/\s+/g, "\\s+")
    : null;
}

export function sentenceScopedActiveRelationPatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (normalizedLabel === "owner") return "owns";
  if (normalizedLabel === "manager") return "manages";
  if (normalizedLabel === "lead") return "leads";
  if (normalizedLabel === "maintainer") return "maintains";
  if (normalizedLabel === "handler") return "handles";
  if (normalizedLabel === "operator") return "operates";
  if (normalizedLabel === "provider") return "provides";
  if (normalizedLabel === "supporter") return "supports";
  if (normalizedLabel === "host") return "hosts";
  if (normalizedLabel === "administrator") return "administers";
  if (normalizedLabel === "monitor") return "monitors";
  if (normalizedLabel === "supervisor") return "supervises";
  if (normalizedLabel === "coordinator") return "coordinates";
  if (normalizedLabel === "sponsor") return "sponsors";
  if (normalizedLabel === "funder") return "funds";
  if (normalizedLabel === "overseer") return "oversees";
  if (normalizedLabel === "governor") return "governs";
  if (normalizedLabel === "controller") return "controls";
  if (normalizedLabel === "auditor") return "audits";
  if (normalizedLabel === "validator") return "validates";
  if (normalizedLabel === "verifier") return "verifies";
  if (normalizedLabel === "certifier") return "certifies";
  if (normalizedLabel === "assignee") return "(?:is|was)\\s+assigned\\s+to";
  if (normalizedLabel === "responsible party") {
    return "(?:is|was)\\s+responsible\\s+for";
  }
  if (normalizedLabel === "accountable party") {
    return "(?:is|was)\\s+accountable\\s+for";
  }
  if (normalizedLabel === "requester") return "requested";
  if (normalizedLabel === "reporter") return "reported";
  if (normalizedLabel === "creator") return "created";
  if (normalizedLabel === "opener") return "opened";
  if (normalizedLabel === "approver") return "approved";
  if (normalizedLabel === "reviewer") return "reviewed";
  return null;
}

function canonicalSentenceScopedAttributeLabel(label: string): string | null {
  const normalizedLabel = normalizeText(label);
  if (
    normalizedLabel === "contact" ||
    normalizedLabel === "point of contact" ||
    normalizedLabel === "poc"
  ) {
    return "contact";
  }
  if (normalizedLabel === "category" || normalizedLabel === "classification") {
    return "category";
  }
  if (normalizedLabel === "type" || normalizedLabel === "kind") return "type";
  if (normalizedLabel === "tier") return "tier";
  if (normalizedLabel === "plan" || normalizedLabel === "package") {
    return "plan";
  }
  if (normalizedLabel === "region") return "region";
  if (normalizedLabel === "environment" || normalizedLabel === "env") {
    return "environment";
  }
  return null;
}

export function sentenceScopedAttributePatternForLabel(label: string): string | null {
  const attributeLabel = canonicalSentenceScopedAttributeLabel(label);
  if (attributeLabel === "contact") {
    return "(?:point\\s+of\\s+contact|contact|poc)";
  }
  if (attributeLabel === "category") return "(?:category|classification)";
  if (attributeLabel === "type") return "(?:type|kind)";
  if (attributeLabel === "tier") return "tier";
  if (attributeLabel === "plan") return "(?:plan|package)";
  if (attributeLabel === "region") return "region";
  if (attributeLabel === "environment") return "(?:environment|env)";
  return null;
}

function workflowTargetTextPattern(target: string): string | null {
  const tokens = tokenizeCompletionText(target);
  if (tokens.length === 0) return null;
  return tokens.map(escapeRegExp).join("\\s+");
}

function cleanSentenceScopedAnswerText(value: string): string {
  return cleanLabel(
    cleanLabel(value)
      .replace(/\s+\b(?:and|but|while)\b.+$/i, "")
      .replace(/[),.;!?]+$/g, ""),
  );
}

function cleanActiveSentenceScopedAnswerText(
  value: string,
  target: string,
): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  return activeSentenceScopedAnswerLooksFlattenedPrefix(answer, target)
    ? ""
    : answer;
}

const FLATTENED_ACTIVE_SENTENCE_PREFIX_SECOND_TOKENS = new Set([
  "board",
  "dashboard",
  "detail",
  "details",
  "inbox",
  "list",
  "overview",
  "page",
  "queue",
  "record",
  "records",
  "report",
  "reports",
  "summary",
  "table",
]);

function activeSentenceScopedAnswerLooksFlattenedPrefix(
  answer: string,
  target: string,
): boolean {
  const answerTokens = tokenizeCompletionText(answer);
  if (answerTokens.length < 4) return false;
  const targetTokens = tokenizeCompletionText(target);
  const targetHead = targetTokens[0] ?? "";
  if (!targetHead || targetHead.length < 3) return false;
  return (
    answerTokens[0] === targetHead &&
    FLATTENED_ACTIVE_SENTENCE_PREFIX_SECOND_TOKENS.has(answerTokens[1] ?? "")
  );
}

const SENTENCE_SCOPED_STATUS_ANSWER_PATTERN =
  "(?:in\\s+progress|on\\s+hold|open|closed|pending|resolved|active|inactive|enabled|disabled|blocked|unblocked|approved|rejected|complete|completed|done|failed|successful|success|draft|submitted|sent|archived|deleted|canceled|cancelled)";

function cleanSentenceScopedStatusAnswer(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  const match = new RegExp(
    `^${SENTENCE_SCOPED_STATUS_ANSWER_PATTERN}$`,
    "i",
  ).exec(answer);
  return match ? answer : "";
}

const SENTENCE_SCOPED_PRIORITY_ANSWER_PATTERN =
  "(?:p[0-5]|sev\\s*[0-5]|critical|urgent|highest|high|medium|normal|standard|low|lowest|minor|major)";

function cleanSentenceScopedPriorityAnswer(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  const match = new RegExp(
    `^${SENTENCE_SCOPED_PRIORITY_ANSWER_PATTERN}$`,
    "i",
  ).exec(answer);
  return match ? answer : "";
}

function labelValuePatternsForExpectedLabel(
  expectedAnswerLabel: string,
): string[] {
  const labels = [expectedAnswerLabel];
  if (normalizeText(expectedAnswerLabel) === "owner") {
    labels.push("owned\\s+by");
  }
  if (normalizeText(expectedAnswerLabel) === "assignee") {
    labels.push("assigned\\s+to");
  }

  const patterns: string[] = [];
  for (const label of labels) {
    if (label.includes("\\s+")) {
      patterns.push(label);
      continue;
    }
    const tokens = tokenizeLabelValueQuestionLabel(label);
    if (tokens.length < 1 || tokens.length > 3) continue;
    patterns.push(tokens.map(escapeRegExp).join("\\s+"));
  }
  return [...new Set(patterns)];
}

function cleanLabelValueAnswerText(value: string): string {
  return cleanLabel(
    cleanLabel(value)
      .replace(/\s+(?:\|\s*)?[a-z][a-z0-9 /_-]{1,40}\s*(?::|=|\bis\b).*$/i, "")
      .replace(/[),.;!?]+$/g, ""),
  );
}

function labelValueStartsWithCoordinatePair(
  evidenceText: string,
  labelPattern: string,
): boolean {
  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(\\(?\\s*[+-]?(?:(?:[0-8]?\\d)(?:\\.\\d+)?|90(?:\\.0+)?)\\s*,\\s*[+-]?(?:(?:(?:[0-9]?\\d)|(?:1[0-7]\\d))(?:\\.\\d+)?|180(?:\\.0+)?)\\s*\\)?)`,
    "i",
  ).exec(evidenceText);
  const candidate = cleanLabel(match?.[1] ?? "");
  return candidate ? isCoordinatePairValue(candidate) : false;
}

function labelValueStartsWithDateRange(
  evidenceText: string,
  labelPattern: string,
): boolean {
  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${dateRangeValuePattern()})`,
    "i",
  ).exec(evidenceText);
  const candidate = cleanLabel(match?.[1] ?? "");
  return candidate ? isDateRangeValue(candidate) : false;
}

function extractPreciseConciseLabelValue(
  evidenceText: string,
  labelPattern: string,
  expectedAnswerLabel: string,
): string | null {
  const urlMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(https?:\\/\\/[^\\s<>"']+)`,
    "i",
  ).exec(evidenceText);
  if (urlMatch) {
    return cleanLabel((urlMatch[1] ?? "").replace(/[),.;!?]+$/g, "")) || null;
  }

  if (labelCanHavePathValue(expectedAnswerLabel)) {
    const uncPathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(\\\\\\\\[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (uncPathMatch) {
      return (
        cleanLabel(
          (uncPathMatch[1] ?? "").replace(/[),;!?]+$/g, "").replace(/\.$/g, ""),
        ) || null
      );
    }

    const windowsPathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z]:\\\\[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (windowsPathMatch) {
      return (
        cleanLabel(
          (windowsPathMatch[1] ?? "")
            .replace(/[),;!?]+$/g, "")
            .replace(/\.$/g, ""),
        ) || null
      );
    }

    const pathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\.{1,2})?\\/[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (pathMatch) {
      return (
        cleanLabel(
          (pathMatch[1] ?? "").replace(/[),;!?]+$/g, "").replace(/\.$/g, ""),
        ) || null
      );
    }
  }

  const emailMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
    "i",
  ).exec(evidenceText);
  if (emailMatch) return cleanLabel(emailMatch[1] ?? "") || null;

  const phoneMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:\\+?\\d{1,3}[\\s.-]?)?(?:\\(?\\d{3}\\)?[\\s.-]?)\\d{3}[\\s.-]?\\d{4}(?:\\s*(?:x|ext\\.?|extension)\\s*\\d{1,6})?)`,
    "i",
  ).exec(evidenceText);
  if (phoneMatch) return cleanLabel(phoneMatch[1] ?? "") || null;

  const ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  if (labelCanHaveCidrValue(expectedAnswerLabel)) {
    const cidrMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\/(?:[0-9]|[12][0-9]|3[0-2]))(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (cidrMatch) return cleanLabel(cidrMatch[1] ?? "") || null;
  }

  const ipv4Match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet})(?=$|[^\\d./])`,
    "i",
  ).exec(evidenceText);
  if (ipv4Match) return cleanLabel(ipv4Match[1] ?? "") || null;

  if (labelCanHaveMacAddressValue(expectedAnswerLabel)) {
    const macAddressMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (macAddressMatch) return cleanLabel(macAddressMatch[1] ?? "") || null;
  }

  if (
    labelCanHaveIpv6AddressValue(expectedAnswerLabel) ||
    labelCanHaveCidrValue(expectedAnswerLabel)
  ) {
    const ipv6CidrMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%[a-z0-9_.-]+)?\\/(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const ipv6CidrCandidate = cleanLabel(ipv6CidrMatch?.[1] ?? "");
    if (ipv6CidrCandidate && isIpv6CidrValue(ipv6CidrCandidate)) {
      return ipv6CidrCandidate;
    }
  }

  if (labelCanHaveIpv6AddressValue(expectedAnswerLabel)) {
    const ipv6Match = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%[a-z0-9_.-]+)?)(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(ipv6Match?.[1] ?? "");
    if (candidate && isIpv6AddressValue(candidate)) return candidate;
  }

  if (labelCanHaveDomainValue(expectedAnswerLabel)) {
    const domainMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (domainMatch) return cleanLabel(domainMatch[1] ?? "") || null;
  }

  if (labelCanHaveUuidValue(expectedAnswerLabel)) {
    const uuidMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (uuidMatch) return cleanLabel(uuidMatch[1] ?? "") || null;
  }

  if (labelCanHaveHashValue(expectedAnswerLabel)) {
    const hashMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-f0-9]{128}|[a-f0-9]{96}|[a-f0-9]{64}|[a-f0-9]{56}|[a-f0-9]{40}|[a-f0-9]{32})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (hashMatch) return cleanLabel(hashMatch[1] ?? "") || null;
  }

  if (labelCanHaveColorValue(expectedAnswerLabel)) {
    const colorMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(#[a-f0-9]{3}(?:[a-f0-9]{3})?(?:[a-f0-9]{2})?)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (colorMatch) return cleanLabel(colorMatch[1] ?? "") || null;

    const rgbChannel = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
    const rgbAlpha = "(?:0(?:\\.\\d+)?|1(?:\\.0+)?|\\.\\d+|(?:[1-9]\\d?|100)%)";
    const rgbMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:rgba?|RGBA?)\\(\\s*${rgbChannel}\\s*,\\s*${rgbChannel}\\s*,\\s*${rgbChannel}(?:\\s*,\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (rgbMatch) return cleanLabel(rgbMatch[1] ?? "") || null;
    const modernRgbMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:rgba?|RGBA?)\\(\\s*${rgbChannel}\\s+${rgbChannel}\\s+${rgbChannel}(?:\\s*\\/\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (modernRgbMatch) {
      return cleanLabel(modernRgbMatch[1] ?? "") || null;
    }

    const hslHue = "(?:360|3[0-5]\\d|[12]?\\d?\\d)";
    const hslPercent = "(?:100|[1-9]?\\d)%";
    const hslMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:hsla?|HSLA?)\\(\\s*${hslHue}\\s*,\\s*${hslPercent}\\s*,\\s*${hslPercent}(?:\\s*,\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (hslMatch) return cleanLabel(hslMatch[1] ?? "") || null;
    const modernHslMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:hsla?|HSLA?)\\(\\s*${hslHue}\\s+${hslPercent}\\s+${hslPercent}(?:\\s*\\/\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (modernHslMatch) {
      return cleanLabel(modernHslMatch[1] ?? "") || null;
    }

    const namedColorMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z][a-z]+)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const namedColor = cleanLabel(namedColorMatch?.[1] ?? "");
    if (isCssNamedColorValue(namedColor)) return namedColor;
  }

  if (/\b(?:version|build|release|revision|rev)\b/i.test(expectedAnswerLabel)) {
    const versionMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:v(?:ersion)?\\s*)?\\d+(?:\\.\\d+){1,5}(?:[-+][a-z0-9][a-z0-9.-]*)?)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (versionMatch) return cleanLabel(versionMatch[1] ?? "") || null;
  }

  if (labelCanHaveDurationValue(expectedAnswerLabel)) {
    const durationMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:ms|msec|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (durationMatch) return cleanLabel(durationMatch[1] ?? "") || null;
  }

  if (labelCanHaveDataSizeValue(expectedAnswerLabel)) {
    const dataSizeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib|pb|pib))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (dataSizeMatch) return cleanLabel(dataSizeMatch[1] ?? "") || null;
  }

  if (labelCanHaveDataRateValue(expectedAnswerLabel)) {
    const dataRateMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:bps|kbps|mbps|gbps|tbps|kbit\\/s|mbit\\/s|gbit\\/s|tbit\\/s|kb\\/s|kib\\/s|mb\\/s|mib\\/s|gb\\/s|gib\\/s|tb\\/s|tib\\/s|bytes?\\/s|bytes?\\s+per\\s+second))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (dataRateMatch) return cleanLabel(dataRateMatch[1] ?? "") || null;
  }

  if (labelCanHavePhysicalSpeedValue(expectedAnswerLabel)) {
    const physicalSpeedMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mph|mi\\/h|kph|kmph|km\\/h|m\\/s|meters?\\s+per\\s+second|metres?\\s+per\\s+second|ft\\/s|feet\\s+per\\s+second|knots?|kt|kts))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (physicalSpeedMatch) {
      return cleanLabel(physicalSpeedMatch[1] ?? "") || null;
    }
  }

  if (labelCanHaveTemperatureValue(expectedAnswerLabel)) {
    const temperatureMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*[+-]?\\d+(?:\\.\\d+)?\\s*(?:\\u00b0\\s*)?(?:c|f|k|celsius|fahrenheit|kelvin))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (temperatureMatch) return cleanLabel(temperatureMatch[1] ?? "") || null;
  }

  if (labelCanHaveElectricalValue(expectedAnswerLabel)) {
    const electricalMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mv|v|kv|ma|a|ka|mw|w|kw|wh|kwh|mwh|va|kva|mah|ah))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (electricalMatch) return cleanLabel(electricalMatch[1] ?? "") || null;
  }

  if (labelCanHaveMassValue(expectedAnswerLabel)) {
    const massMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mg|milligrams?|g|grams?|kg|kgs|kilograms?|lb|lbs|pounds?|oz|ounces?|tons?|tonnes?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (massMatch) return cleanLabel(massMatch[1] ?? "") || null;
  }

  if (labelCanHaveLengthValue(expectedAnswerLabel)) {
    const lengthMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|m|meters?|metres?|km|kilometers?|kilometres?|in|inch|inches|ft|foot|feet|yd|yards?|mi|miles?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (lengthMatch) return cleanLabel(lengthMatch[1] ?? "") || null;
  }

  if (labelCanHaveAreaValue(expectedAnswerLabel)) {
    const areaMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mm2|cm2|m2|km2|in2|ft2|yd2|mi2|sq\\.?\\s*(?:mm|cm|m|km|in|ft|feet|yd|mi)|square\\s+(?:millimeters?|millimetres?|centimeters?|centimetres?|meters?|metres?|kilometers?|kilometres?|inches|feet|yards?|miles?)|acres?|hectares?|ha))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (areaMatch) return cleanLabel(areaMatch[1] ?? "") || null;
  }

  if (labelCanHaveVolumeValue(expectedAnswerLabel)) {
    const volumeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:ml|milliliters?|millilitres?|l|liters?|litres?|gal|gallons?|qt|quarts?|pt|pints?|fl\\s*oz|fluid\\s+ounces?|m3|cm3|cubic\\s+meters?|cubic\\s+metres?|cubic\\s+centimeters?|cubic\\s+centimetres?|cu\\s*ft|cubic\\s+feet))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (volumeMatch) return cleanLabel(volumeMatch[1] ?? "") || null;
  }

  if (labelCanHavePressureValue(expectedAnswerLabel)) {
    const pressureMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:pa|kpa|mpa|gpa|psi|psig|psia|bar|mbar|millibars?|atm|atmospheres?|pascals?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (pressureMatch) return cleanLabel(pressureMatch[1] ?? "") || null;
  }

  if (labelCanHaveFrequencyValue(expectedAnswerLabel)) {
    const frequencyMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:hz|khz|mhz|ghz|thz|rpm|rps|cycles?\\s+per\\s+second))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (frequencyMatch) return cleanLabel(frequencyMatch[1] ?? "") || null;
  }

  if (labelCanHaveDateRangeValue(expectedAnswerLabel)) {
    const dateRangeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${dateRangeValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(dateRangeMatch?.[1] ?? "");
    if (candidate && isDateRangeValue(candidate)) return candidate;
  }

  if (labelCanHaveTimeRangeValue(expectedAnswerLabel)) {
    const timeRangeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${timeRangeValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(timeRangeMatch?.[1] ?? "");
    if (candidate && isTimeRangeValue(candidate)) return candidate;
  }

  if (labelCanHaveTimezoneValue(expectedAnswerLabel)) {
    const timezoneMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${timezoneValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(timezoneMatch?.[1] ?? "");
    if (candidate && isTimezoneValue(candidate)) return candidate;
  }

  if (labelCanHaveLocaleValue(expectedAnswerLabel)) {
    const localeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z]{2,3}(?:[-_][a-z0-9]{2,8}){1,3})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(localeMatch?.[1] ?? "");
    if (candidate && isLocaleCodeValue(candidate)) return candidate;
  }

  if (labelCanHaveCoordinatePairValue(expectedAnswerLabel)) {
    const coordinatePairMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(\\(?\\s*[+-]?(?:(?:[0-8]?\\d)(?:\\.\\d+)?|90(?:\\.0+)?)\\s*,\\s*[+-]?(?:(?:(?:[0-9]?\\d)|(?:1[0-7]\\d))(?:\\.\\d+)?|180(?:\\.0+)?)\\s*\\)?)(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(coordinatePairMatch?.[1] ?? "");
    if (candidate && isCoordinatePairValue(candidate)) return candidate;
  }

  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[~\\u2248]?\\s*\\$\\d[\\d,]*(?:\\.\\d+)?)|(?:[~\\u2248]?\\s*\\d[\\d,]*(?:\\.\\d+%?|%)))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
    "i",
  ).exec(evidenceText);
  return cleanLabel(match?.[1] ?? "") || null;
}
