import type { DomSnapshot, TaggedElement } from "../../../types";

export type ReadAnswerMetricAggregateOperation =
  | "total"
  | "average"
  | "median"
  | "range"
  | "highest"
  | "lowest"
  | "categorical_count"
  | "conditional_count"
  | "count";

export type ReadAnswerMetricComparisonOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "between";

export interface ReadAnswerMetricComparison {
  operator: ReadAnswerMetricComparisonOperator;
  value: number;
  upperValue?: number;
  entity: string;
}

export interface ReadAnswerRowCategoricalCondition {
  entity: string;
  label: string;
  value: string;
}

export interface ReadAnswerMetricAggregateParts {
  metric: string;
  operation: ReadAnswerMetricAggregateOperation;
  comparison?: ReadAnswerMetricComparison;
  categoricalCondition?: ReadAnswerRowCategoricalCondition;
}

export type ReadAnswerMetricAggregate = {
  answer: string;
  evidenceText: string;
};

type ReadAnswerSuperlativeMetricCandidate = {
  target: string;
  value: number;
  sentence: string;
};

const LABEL_STOPWORDS = new Set([
  "answer",
  "checked",
  "choice",
  "company",
  "option",
  "should",
  "that",
  "the",
  "this",
  "true",
  "use",
  "which",
  "with",
]);

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

export function extractRowScopedMetricAggregateQuestionParts(
  question: string,
): {
  label: string;
  metric: string;
  operation: ReadAnswerMetricAggregateOperation;
} | null {
  const text = cleanLabel(question);
  const conditionalCountQuestion =
    extractRowScopedConditionalCountQuestionParts(text);
  if (conditionalCountQuestion) return conditionalCountQuestion;
  const categoricalCountQuestion =
    extractRowScopedCategoricalCountQuestionParts(text);
  if (categoricalCountQuestion) return categoricalCountQuestion;

  const patterns: Array<{
    operation: ReadAnswerMetricAggregateOperation;
    pattern: RegExp;
  }> = [
    {
      operation: "total",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?sum\s+of\s+(.+?)\s+(?:across|for|of|in|on)\s+(?:all\s+|the\s+)?(.+?)(?:[?.!]|$)/i,
    },
    {
      operation: "total",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?(?:total|combined|overall)\s+(?:of\s+)?(.+?)\s+(?:across|for|of|in|on)\s+(?:all\s+|the\s+)?(.+?)(?:[?.!]|$)/i,
    },
    {
      operation: "average",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?(?:average|mean)\s+(?:of\s+)?(.+?)\s+(?:across|for|of|in|on)\s+(?:all\s+|the\s+)?(.+?)(?:[?.!]|$)/i,
    },
    {
      operation: "median",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?median\s+(?:of\s+)?(.+?)\s+(?:across|for|of|in|on)\s+(?:all\s+|the\s+)?(.+?)(?:[?.!]|$)/i,
    },
    {
      operation: "range",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?range\s+(?:of\s+)?(.+?)\s+(?:across|for|of|in|on)\s+(?:all\s+|the\s+)?(.+?)(?:[?.!]|$)/i,
    },
    {
      operation: "range",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?difference\s+between\s+(?:the\s+)?(?:highest|largest|maximum|max)\s+and\s+(?:the\s+)?(?:lowest|smallest|minimum|min)\s+(.+?)\s+(?:across|for|of|in|on)\s+(?:all\s+|the\s+)?(.+?)(?:[?.!]|$)/i,
    },
    {
      operation: "highest",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?(?:highest|largest|maximum|max)\s+(?:of\s+)?(.+?)\s+(?:across|for|of|in|on)\s+(?:all\s+|the\s+)?(.+?)(?:[?.!]|$)/i,
    },
    {
      operation: "lowest",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?(?:lowest|smallest|minimum|min)\s+(?:of\s+)?(.+?)\s+(?:across|for|of|in|on)\s+(?:all\s+|the\s+)?(.+?)(?:[?.!]|$)/i,
    },
    {
      operation: "count",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?how\s+many\s+(.+?)\s+(?:are|were)\s+(?:listed|shown|displayed|visible|present|on\s+(?:this|the)\s+page)(?:[?.!]|$)/i,
    },
    {
      operation: "count",
      pattern:
        /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are)\s+(?:the\s+)?(?:number|count|quantity)\s+of\s+(.+?)\s+(?:listed|shown|displayed|visible|present|on\s+(?:this|the)\s+page)(?:[?.!]|$)/i,
    },
  ];
  const aggregateMatch = patterns
    .map(({ operation, pattern }) => ({ operation, match: pattern.exec(text) }))
    .find(
      (
        result,
      ): result is {
        operation: ReadAnswerMetricAggregateOperation;
        match: RegExpExecArray;
      } => result.match !== null,
    );
  if (!aggregateMatch) return null;

  const metric =
    aggregateMatch.operation === "count"
      ? cleanRowScopedCountEntity(aggregateMatch.match[1] ?? "")
      : cleanRowScopedMetricAggregateMetric(aggregateMatch.match[1] ?? "");
  const entityTokens =
    aggregateMatch.operation === "count"
      ? tokenizeCompletionText(metric ?? "")
      : tokenizeCompletionText(aggregateMatch.match[2] ?? "");
  if (!metric || entityTokens.length < 1 || entityTokens.length > 6) {
    return null;
  }

  return {
    label: rowScopedMetricAggregateLabel(metric, aggregateMatch.operation),
    metric,
    operation: aggregateMatch.operation,
  };
}

export function rowScopedMetricAggregatePartsForLabel(
  label: string,
): ReadAnswerMetricAggregateParts | null {
  const normalizedLabel = normalizeText(label);
  const categoricalMatch =
    /^(.+?)\s+rows\s+where\s+(.+?)\s+equals\s+(.+?)$/.exec(
      normalizedLabel,
    );
  if (categoricalMatch) {
    const entity = cleanRowScopedCountEntity(categoricalMatch[1] ?? "");
    const categoricalLabel = cleanRowScopedCategoricalCountLabel(
      categoricalMatch[2] ?? "",
    );
    const value = cleanRowScopedCategoricalCountValue(
      categoricalMatch[3] ?? "",
    );
    if (entity && categoricalLabel && value) {
      return {
        metric: categoricalLabel,
        operation: "categorical_count",
        categoricalCondition: {
          entity,
          label: categoricalLabel,
          value,
        },
      };
    }
  }

  const rangedMatch =
    /^(.+?)\s+rows\s+where\s+(.+?)\s+between\s+(\d[\d.]*)\s+and\s+(\d[\d.]*)$/.exec(
      normalizedLabel,
    );
  if (rangedMatch) {
    const entity = cleanRowScopedCountEntity(rangedMatch[1] ?? "");
    const metric = cleanRowScopedMetricAggregateMetric(rangedMatch[2] ?? "");
    const lowerValue = Number(rangedMatch[3] ?? "");
    const upperValue = Number(rangedMatch[4] ?? "");
    if (
      entity &&
      metric &&
      Number.isFinite(lowerValue) &&
      Number.isFinite(upperValue)
    ) {
      return {
        metric,
        operation: "conditional_count",
        comparison: rowScopedMetricRangedComparison(
          entity,
          lowerValue,
          upperValue,
        ),
      };
    }
  }

  const conditionalMatch =
    /^(.+?)\s+rows\s+where\s+(.+?)\s+(greater\s+than|at\s+least|less\s+than|at\s+most|equal\s+to)\s+(\d[\d.]*)$/.exec(
      normalizedLabel,
    );
  if (conditionalMatch) {
    const entity = cleanRowScopedCountEntity(conditionalMatch[1] ?? "");
    const metric = cleanRowScopedMetricAggregateMetric(
      conditionalMatch[2] ?? "",
    );
    const operator = canonicalRowScopedMetricComparisonOperator(
      conditionalMatch[3] ?? "",
    );
    const value = Number(conditionalMatch[4] ?? "");
    if (entity && metric && operator && Number.isFinite(value)) {
      return {
        metric,
        operation: "conditional_count",
        comparison: { operator, value, entity },
      };
    }
  }

  const countMatch = /^(.+?)\s+row\s+count$/.exec(normalizedLabel);
  if (countMatch) {
    const metric = cleanRowScopedCountEntity(countMatch[1] ?? "");
    return metric ? { metric, operation: "count" } : null;
  }

  const match = /^(.+?)\s+(total|average|median|range|highest|lowest)$/.exec(
    normalizedLabel,
  );
  if (!match) return null;
  const operation = match[2] as ReadAnswerMetricAggregateOperation;
  const metric = cleanRowScopedMetricAggregateMetric(match[1] ?? "");
  return metric ? { metric, operation } : null;
}

export function findReadAnswerMetricAggregateFromSnapshotRows(
  snapshot: DomSnapshot,
  expectedAnswerLabel: string,
): ReadAnswerMetricAggregate | null {
  const aggregate = rowScopedMetricAggregatePartsForLabel(expectedAnswerLabel);
  if (!aggregate) return null;

  const rowTexts = snapshot.elements
    .filter((element) => element.isVisible && !element.isDisabled)
    .filter(isWorkflowRowLikeElement)
    .map(readAnswerRowElementText)
    .map((rowText) => cleanLabel(rowText))
    .filter(Boolean)
    .filter((rowText) => rowText.length <= 500);
  if (aggregate.operation === "categorical_count") {
    return calculateReadAnswerCategoricalRowCountAggregate(rowTexts, aggregate);
  }
  if (aggregate.operation === "conditional_count") {
    return calculateReadAnswerConditionalRowCountAggregate(rowTexts, aggregate);
  }
  if (aggregate.operation === "count") {
    return calculateReadAnswerRowCountAggregate(rowTexts, aggregate.metric);
  }

  const candidates = rowTexts
    .map((rowText) =>
      extractReadAnswerSuperlativeMetricCandidate(rowText, aggregate.metric),
    )
    .filter(
      (
        candidate,
      ): candidate is ReadAnswerSuperlativeMetricCandidate =>
        candidate !== null,
    );
  return calculateReadAnswerMetricAggregate(candidates, aggregate.operation);
}

export function findReadAnswerMetricAggregateFromTextLines(
  evidenceText: string,
  expectedAnswerLabel: string,
): ReadAnswerMetricAggregate | null {
  const aggregate = rowScopedMetricAggregatePartsForLabel(expectedAnswerLabel);
  if (!aggregate) return null;

  const lines = evidenceText
    .split(/[\r\n]+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean);
  if (lines.length < 2) return null;

  const rowTexts = lines.filter((line) => line.length <= 500);
  if (aggregate.operation === "categorical_count") {
    return calculateReadAnswerCategoricalRowCountAggregate(rowTexts, aggregate);
  }
  if (aggregate.operation === "conditional_count") {
    return calculateReadAnswerConditionalRowCountAggregate(rowTexts, aggregate);
  }
  if (aggregate.operation === "count") {
    return calculateReadAnswerRowCountAggregate(rowTexts, aggregate.metric);
  }

  const candidates = rowTexts
    .map((line) =>
      extractReadAnswerSuperlativeMetricCandidate(line, aggregate.metric),
    )
    .filter(
      (
        candidate,
      ): candidate is ReadAnswerSuperlativeMetricCandidate =>
        candidate !== null,
    );
  return calculateReadAnswerMetricAggregate(candidates, aggregate.operation);
}

function extractRowScopedConditionalCountQuestionParts(
  question: string,
): {
  label: string;
  metric: string;
  operation: Extract<ReadAnswerMetricAggregateOperation, "conditional_count">;
} | null {
  const rangedQuestion = extractRowScopedRangedCountQuestionParts(question);
  if (rangedQuestion) return rangedQuestion;

  const comparisonPattern = rowScopedMetricComparisonQuestionPattern();
  const valuePattern = sentenceScopedSuperlativeMetricValuePattern();
  const patterns: Array<{
    pattern: RegExp;
    entityIndex: number;
    metricIndex: number;
    operatorIndex: number;
    valueIndex: number;
  }> = [
    {
      pattern: new RegExp(
        `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:have|has|with|show|shows|list|lists|report|reports|contain|contains)\\s+(.+?)\\s+(${comparisonPattern})\\s+(${valuePattern})(?:[?.!]|$)`,
        "i",
      ),
      entityIndex: 1,
      metricIndex: 2,
      operatorIndex: 3,
      valueIndex: 4,
    },
    {
      pattern: new RegExp(
        `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:have|has|with|show|shows|list|lists|report|reports|contain|contains)\\s+(${comparisonPattern})\\s+(${valuePattern})\\s+(.+?)(?:[?.!]|$)`,
        "i",
      ),
      entityIndex: 1,
      operatorIndex: 2,
      valueIndex: 3,
      metricIndex: 4,
    },
  ];

  for (const { pattern, entityIndex, metricIndex, operatorIndex, valueIndex } of patterns) {
    const match = pattern.exec(question);
    if (!match) continue;

    const entity = cleanRowScopedCountEntity(match[entityIndex] ?? "");
    const metric = cleanRowScopedMetricAggregateMetric(
      match[metricIndex] ?? "",
    );
    const operator = canonicalRowScopedMetricComparisonOperator(
      match[operatorIndex] ?? "",
    );
    const value = parseSentenceScopedSuperlativeMetricValue(
      match[valueIndex] ?? "",
    );
    if (!entity || !metric || !operator || value === null) continue;

    return {
      label: rowScopedConditionalCountLabel(entity, metric, {
        operator,
        value,
        entity,
      }),
      metric,
      operation: "conditional_count",
    };
  }

  return null;
}

function extractRowScopedCategoricalCountQuestionParts(
  question: string,
): {
  label: string;
  metric: string;
  operation: Extract<ReadAnswerMetricAggregateOperation, "categorical_count">;
} | null {
  const text = cleanLabel(question);
  const adjectiveStatusMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(${rowScopedCategoricalStatusValuePattern()})\\s+(.+?)\\s+(?:are|were)\\s+(?:listed|shown|displayed|visible|present|on\\s+(?:this|the)\\s+page)(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (adjectiveStatusMatch) {
    const value = cleanRowScopedCategoricalCountValue(
      adjectiveStatusMatch[1] ?? "",
    );
    const entity = cleanRowScopedCountEntity(adjectiveStatusMatch[2] ?? "");
    if (entity && value) {
      return {
        label: rowScopedCategoricalCountLabel(entity, "status", value),
        metric: "status",
        operation: "categorical_count",
      };
    }
  }

  const explicitLabelMatch =
    /^(?:please\s+)?(?:tell me\s+)?how\s+many\s+(.+?)\s+(?:have|has|with|show|shows|list|lists|report|reports|contain|contains|where)\s+(.+?)\s+(?:is|are|=|as)?\s*(.+?)(?:[?.!]|$)/i.exec(
      text,
    );
  if (explicitLabelMatch) {
    const entity = cleanRowScopedCountEntity(explicitLabelMatch[1] ?? "");
    const label = cleanRowScopedCategoricalCountLabel(
      explicitLabelMatch[2] ?? "",
    );
    const value = cleanRowScopedCategoricalCountValue(
      explicitLabelMatch[3] ?? "",
    );
    if (entity && label && value) {
      return {
        label: rowScopedCategoricalCountLabel(entity, label, value),
        metric: label,
        operation: "categorical_count",
      };
    }
  }

  const implicitStatusMatch = new RegExp(
    `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:are|were)\\s+(${rowScopedCategoricalStatusValuePattern()})(?:[?.!]|$)`,
    "i",
  ).exec(text);
  if (implicitStatusMatch) {
    const entity = cleanRowScopedCountEntity(implicitStatusMatch[1] ?? "");
    const value = cleanRowScopedCategoricalCountValue(
      implicitStatusMatch[2] ?? "",
    );
    if (entity && value) {
      return {
        label: rowScopedCategoricalCountLabel(entity, "status", value),
        metric: "status",
        operation: "categorical_count",
      };
    }
  }

  return null;
}

function extractRowScopedRangedCountQuestionParts(
  question: string,
): {
  label: string;
  metric: string;
  operation: Extract<ReadAnswerMetricAggregateOperation, "conditional_count">;
} | null {
  const valuePattern = sentenceScopedSuperlativeMetricValuePattern();
  const patterns: Array<{
    pattern: RegExp;
    entityIndex: number;
    metricIndex: number;
    lowerValueIndex: number;
    upperValueIndex: number;
  }> = [
    {
      pattern: new RegExp(
        `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:have|has|with|show|shows|list|lists|report|reports|contain|contains)\\s+(.+?)\\s+between\\s+(${valuePattern})\\s+and\\s+(${valuePattern})(?:[?.!]|$)`,
        "i",
      ),
      entityIndex: 1,
      metricIndex: 2,
      lowerValueIndex: 3,
      upperValueIndex: 4,
    },
    {
      pattern: new RegExp(
        `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:have|has|with|show|shows|list|lists|report|reports|contain|contains)\\s+between\\s+(${valuePattern})\\s+and\\s+(${valuePattern})\\s+(.+?)(?:[?.!]|$)`,
        "i",
      ),
      entityIndex: 1,
      lowerValueIndex: 2,
      upperValueIndex: 3,
      metricIndex: 4,
    },
    {
      pattern: new RegExp(
        `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:have|has|with|show|shows|list|lists|report|reports|contain|contains)\\s+(.+?)\\s+from\\s+(${valuePattern})\\s+to\\s+(${valuePattern})(?:[?.!]|$)`,
        "i",
      ),
      entityIndex: 1,
      metricIndex: 2,
      lowerValueIndex: 3,
      upperValueIndex: 4,
    },
    {
      pattern: new RegExp(
        `^(?:please\\s+)?(?:tell me\\s+)?how\\s+many\\s+(.+?)\\s+(?:have|has|with|show|shows|list|lists|report|reports|contain|contains)\\s+from\\s+(${valuePattern})\\s+to\\s+(${valuePattern})\\s+(.+?)(?:[?.!]|$)`,
        "i",
      ),
      entityIndex: 1,
      lowerValueIndex: 2,
      upperValueIndex: 3,
      metricIndex: 4,
    },
  ];

  for (const {
    pattern,
    entityIndex,
    metricIndex,
    lowerValueIndex,
    upperValueIndex,
  } of patterns) {
    const match = pattern.exec(question);
    if (!match) continue;

    const entity = cleanRowScopedCountEntity(match[entityIndex] ?? "");
    const metric = cleanRowScopedMetricAggregateMetric(
      match[metricIndex] ?? "",
    );
    const lowerValue = parseSentenceScopedSuperlativeMetricValue(
      match[lowerValueIndex] ?? "",
    );
    const upperValue = parseSentenceScopedSuperlativeMetricValue(
      match[upperValueIndex] ?? "",
    );
    if (!entity || !metric || lowerValue === null || upperValue === null) {
      continue;
    }

    const comparison = rowScopedMetricRangedComparison(
      entity,
      lowerValue,
      upperValue,
    );
    return {
      label: rowScopedConditionalCountLabel(entity, metric, comparison),
      metric,
      operation: "conditional_count",
    };
  }

  return null;
}

function rowScopedMetricRangedComparison(
  entity: string,
  firstValue: number,
  secondValue: number,
): ReadAnswerMetricComparison {
  return {
    operator: "between",
    value: Math.min(firstValue, secondValue),
    upperValue: Math.max(firstValue, secondValue),
    entity,
  };
}

function cleanRowScopedCategoricalCountLabel(value: string): string | null {
  const normalized = normalizeText(value).replace(/^(?:the\s+)?/i, "");
  const canonical =
    normalized === "state"
      ? "status"
      : normalized === "stage"
        ? "status"
        : normalized;
  if (
    ![
      "status",
      "priority",
      "severity",
      "type",
      "category",
      "region",
      "environment",
      "tier",
      "plan",
    ].includes(canonical)
  ) {
    return null;
  }
  return canonical;
}

function cleanRowScopedCategoricalCountValue(value: string): string | null {
  const normalized = normalizeText(
    cleanLabel(value)
      .replace(/^(?:the\s+)?/i, "")
      .replace(/^["']|["']$/g, ""),
  );
  if (!normalized) return null;
  const tokens = tokenizeCompletionText(normalized);
  if (tokens.length < 1 || tokens.length > 4) return null;
  if (tokens.some((token) => DIRECT_PAGE_QUESTION_STOPWORDS.has(token))) {
    return null;
  }
  return tokens.join(" ");
}

function rowScopedCategoricalStatusValuePattern(): string {
  return "(?:active|inactive|blocked|unblocked|open|closed|pending|resolved|enabled|disabled|approved|rejected|complete|completed|done|failed|successful|success|draft|submitted|sent|archived|deleted|canceled|cancelled|delayed|paused|stopped|escalated|on\\s+hold)";
}

function rowScopedCategoricalCountLabel(
  entity: string,
  label: string,
  value: string,
): string {
  return `${entity} rows where ${label} equals ${value}`;
}

function rowScopedMetricComparisonQuestionPattern(): string {
  return "(?:greater\\s+than\\s+or\\s+equal\\s+to|less\\s+than\\s+or\\s+equal\\s+to|at\\s+least|at\\s+most|no\\s+less\\s+than|no\\s+more\\s+than|greater\\s+than|more\\s+than|above|over|less\\s+than|fewer\\s+than|below|under|equal\\s+to|equals|exactly)";
}

function canonicalRowScopedMetricComparisonOperator(
  value: string,
): ReadAnswerMetricComparisonOperator | null {
  const normalized = normalizeText(value);
  if (
    /^(?:greater than or equal to|at least|no less than)$/.test(normalized)
  ) {
    return "gte";
  }
  if (/^(?:less than or equal to|at most|no more than)$/.test(normalized)) {
    return "lte";
  }
  if (/^(?:greater than|more than|above|over)$/.test(normalized)) return "gt";
  if (/^(?:less than|fewer than|below|under)$/.test(normalized)) return "lt";
  if (/^(?:equal to|equals|exactly)$/.test(normalized)) return "eq";
  return null;
}

function rowScopedConditionalCountLabel(
  entity: string,
  metric: string,
  comparison: ReadAnswerMetricComparison,
): string {
  if (
    comparison.operator === "between" &&
    comparison.upperValue !== undefined
  ) {
    return `${entity} rows where ${metric} between ${formatReadAnswerMetricAggregateValue(
      comparison.value,
    )} and ${formatReadAnswerMetricAggregateValue(comparison.upperValue)}`;
  }
  return `${entity} rows where ${metric} ${rowScopedMetricComparisonLabel(
    comparison.operator,
  )} ${formatReadAnswerMetricAggregateValue(comparison.value)}`;
}

function rowScopedMetricComparisonLabel(
  operator: ReadAnswerMetricComparisonOperator,
): string {
  switch (operator) {
    case "gt":
      return "greater than";
    case "gte":
      return "at least";
    case "lt":
      return "less than";
    case "lte":
      return "at most";
    case "eq":
      return "equal to";
    case "between":
      return "between";
  }
}

function cleanRowScopedMetricAggregateMetric(value: string): string | null {
  const metric = cleanLabel(value)
    .replace(
      /^(?:the\s+)?(?:current|latest|reported|combined|overall|average|mean)\s+/i,
      "",
    )
    .replace(
      /^(?:range|median|highest|largest|maximum|max|lowest|smallest|minimum|min)\s+/i,
      "",
    )
    .replace(/^(?:number|count|quantity|amount)\s+of\s+/i, "");
  const tokens = tokenizeCompletionText(metric);
  if (tokens.length < 1 || tokens.length > 6) return null;
  return tokens.join(" ");
}

function cleanRowScopedCountEntity(value: string): string | null {
  const entity = cleanLabel(value)
    .replace(/^(?:the\s+)?(?:visible|listed|shown|displayed|current)\s+/i, "")
    .replace(/\s+(?:rows?|records?|entries|items?|results?)$/i, "");
  const tokens = tokenizeCompletionText(entity).filter(
    (token) =>
      !/^(?:rows?|records?|entries|items?|results?|listed|shown|displayed|visible|present)$/.test(
        token,
      ),
  );
  if (tokens.length < 1 || tokens.length > 5) return null;
  return tokens.join(" ");
}

function rowScopedMetricAggregateLabel(
  metric: string,
  operation: ReadAnswerMetricAggregateOperation,
): string {
  if (operation === "count") return `${metric} row count`;
  return `${metric} ${operation}`;
}

function calculateReadAnswerRowCountAggregate(
  rowTexts: string[],
  entity: string,
): ReadAnswerMetricAggregate | null {
  const matches = rowTexts.filter((rowText) =>
    readAnswerRowCountTextMatchesEntity(rowText, entity),
  );
  if (matches.length < 1) return null;
  return {
    answer: String(matches.length),
    evidenceText: matches.join("\n"),
  };
}

function calculateReadAnswerCategoricalRowCountAggregate(
  rowTexts: string[],
  aggregate: ReadAnswerMetricAggregateParts,
): ReadAnswerMetricAggregate | null {
  const condition = aggregate.categoricalCondition;
  if (!condition) return null;

  const candidates = rowTexts.filter((rowText) =>
    readAnswerRowCountTextMatchesEntity(rowText, condition.entity),
  );
  if (candidates.length < 1) return null;

  const evidenceRows: string[] = [];
  let matchingCount = 0;
  for (const rowText of candidates) {
    const answer = extractExpectedLabelValueAnswer(rowText, condition.label);
    if (!answer) continue;
    evidenceRows.push(rowText);
    if (
      normalizeText(answer) === condition.value ||
      valueTokenCoveredBySummary(normalizeText(answer), condition.value)
    ) {
      matchingCount += 1;
    }
  }
  if (evidenceRows.length < 1) return null;

  return {
    answer: String(matchingCount),
    evidenceText: evidenceRows.join("\n"),
  };
}

function calculateReadAnswerConditionalRowCountAggregate(
  rowTexts: string[],
  aggregate: ReadAnswerMetricAggregateParts,
): ReadAnswerMetricAggregate | null {
  const comparison = aggregate.comparison;
  if (!comparison) return null;

  const candidates = rowTexts
    .filter((rowText) =>
      readAnswerRowCountTextMatchesEntity(rowText, comparison.entity),
    )
    .map((rowText) =>
      extractReadAnswerSuperlativeMetricCandidate(rowText, aggregate.metric),
    )
    .filter(
      (
        candidate,
      ): candidate is ReadAnswerSuperlativeMetricCandidate =>
        candidate !== null,
    );
  if (candidates.length < 2) return null;

  const matchingCount = candidates.filter((candidate) =>
    readAnswerMetricComparisonMatches(candidate.value, comparison),
  ).length;
  return {
    answer: String(matchingCount),
    evidenceText: candidates.map((candidate) => candidate.sentence).join("\n"),
  };
}

function readAnswerMetricComparisonMatches(
  value: number,
  comparison: ReadAnswerMetricComparison,
): boolean {
  switch (comparison.operator) {
    case "gt":
      return value > comparison.value;
    case "gte":
      return value >= comparison.value;
    case "lt":
      return value < comparison.value;
    case "lte":
      return value <= comparison.value;
    case "eq":
      return value === comparison.value;
    case "between":
      return (
        comparison.upperValue !== undefined &&
        value >= comparison.value &&
        value <= comparison.upperValue
      );
  }
}

function calculateReadAnswerMetricAggregate(
  candidates: ReadAnswerSuperlativeMetricCandidate[],
  operation: ReadAnswerMetricAggregateOperation,
): ReadAnswerMetricAggregate | null {
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

  const values = [...uniqueCandidates.values()];
  const sum = values.reduce((total, candidate) => total + candidate.value, 0);
  const numericValues = values.map((candidate) => candidate.value);
  const answer =
    operation === "average"
      ? sum / values.length
      : operation === "median"
        ? medianReadAnswerMetricAggregateValue(numericValues)
      : operation === "range"
        ? Math.max(...numericValues) - Math.min(...numericValues)
      : operation === "highest"
        ? Math.max(...numericValues)
        : operation === "lowest"
          ? Math.min(...numericValues)
          : sum;
  return {
    answer: formatReadAnswerMetricAggregateValue(answer),
    evidenceText: values.map((candidate) => candidate.sentence).join("\n"),
  };
}

function medianReadAnswerMetricAggregateValue(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function readAnswerRowCountTextMatchesEntity(
  rowText: string,
  entity: string,
): boolean {
  const rowTokens = tokenizeCompletionText(rowText);
  const [firstToken] = rowTokens;
  if (!firstToken) return false;

  const entityTokens = tokenizeCompletionText(entity);
  if (entityTokens.length < 1 || entityTokens.length > 5) return false;

  return entityTokens.some((token) =>
    rowCountTokenVariants(token).includes(firstToken),
  );
}

function rowCountTokenVariants(token: string): string[] {
  const variants = new Set([token]);
  if (token.endsWith("ies") && token.length > 4) {
    variants.add(`${token.slice(0, -3)}y`);
  }
  if (token.endsWith("es") && token.length > 3) {
    variants.add(token.slice(0, -2));
  }
  if (token.endsWith("s") && token.length > 3) {
    variants.add(token.slice(0, -1));
  }
  return [...variants];
}

function formatReadAnswerMetricAggregateValue(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/(\.\d*?)0+$/g, "$1").replace(/\.$/g, "");
}

function extractReadAnswerSuperlativeMetricCandidate(
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

function parseSentenceScopedSuperlativeMetricValue(value: string): number | null {
  const match = /(?:\$\s*)?(\d[\d,]*(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const numeric = Number((match[1] ?? "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function extractExpectedLabelValueAnswer(
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

function cleanLabelValueAnswerText(value: string): string {
  return cleanLabel(
    cleanLabel(value)
      .replace(
        /\s+(?:\|\s*)?[a-z][a-z0-9 /_-]{1,40}\s*(?::|=|\bis\b).*$/i,
        "",
      )
      .replace(/[),.;!?]+$/g, ""),
  );
}

function isWorkflowRowLikeElement(element: TaggedElement): boolean {
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

function readAnswerRowElementText(element: TaggedElement): string {
  const attrs = element.attributes ?? {};
  return cleanLabel(
    [element.text, attrs["aria-label"], attrs.title, attrs.label]
      .filter(Boolean)
      .join(" "),
  );
}

function normalizeWorkflowTargetLabel(value: string): string | null {
  let target = cleanLabel(value);
  if (!target) return null;
  target = target.replace(
    /^(?:the|this|that|selected|current|visible)\s+/i,
    "",
  );
  target = target.replace(
    /\s+(?:and|then|after that)\s+(?:confirm|verify|make sure|ensure|check|click|press|select|open|go)\b.+$/i,
    "",
  );
  target = target.replace(/\s+(?:from|in|on|under|inside)\s+.+$/i, "");
  target = target.replace(/\s+(?:please|now)$/i, "");
  target = cleanLabel(target);
  if (!target) return null;

  const normalized = normalizeText(target);
  if (
    /^(?:record|item|row|entry|target|object|selection|selected|current|this|that|it|them)$/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const tokens = tokenizeCompletionText(target);
  if (tokens.length === 0) return null;
  if (tokens.length < 2 && !/[\d_-]/.test(target)) {
    return null;
  }
  return target.slice(0, 160);
}

function valueTokenCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedValue)}($|[^a-z0-9])`,
  ).test(normalizedSummary);
}

function tokenizeCompletionText(value: string): string[] {
  return [
    ...new Set(
      normalizeText(value).match(/[a-z0-9$@._-]{3,}/g) ?? [],
    ),
  ].filter((token) => !LABEL_STOPWORDS.has(token));
}

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
