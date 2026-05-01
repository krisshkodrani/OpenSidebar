import type { ToolProfile } from "../tools/metadata";

type SynthesizedPlanStep = {
  objective: string;
  successCriteria: string;
  dependencies: number[];
  assumptions: string[];
  toolProfile?: ToolProfile;
};

export interface TaskContract {
  requiresRoundTrip: boolean;
  requiredEntities: string[];
  requiredNumbers: string[];
  requiredActionTargets: string[];
  actionTargetDestination?: string;
  returnTargets: string[];
  reportTargets: string[];
  multiReturnCount?: number;
  exhaustiveScopeLabel?: string;
  exhaustiveScopeCount?: number;
  requiresAggregateReport?: boolean;
  requiresSequentialDetailReview?: boolean;
}

export interface TaskContractCoverage {
  missingEntities: string[];
  missingNumbers: string[];
  missingReturnTarget: boolean;
  missingExhaustiveCoverage: boolean;
  missingMultiReturnCoverage: boolean;
  satisfied: boolean;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

const CONVERSATIONAL_FILLERS = new Set([
  "actually",
  "basically",
  "just",
  "now",
  "please",
  "thanks",
  "thank you",
  "one more change",
  "one more thing",
]);

function extractQuotedPhrases(text: string): string[] {
  const phrases = [
    ...Array.from(text.matchAll(/"([^"]*)"/g), (match) =>
      normalize(match[1] || ""),
    ),
    ...Array.from(text.matchAll(/(^|[^\w])'([^']*)'(?!\w)/g), (match) =>
      normalize(match[2] || ""),
    ),
  ];

  return unique(
    phrases
      .filter((value) => value.length >= 2)
      .filter((value) => value.length <= 120)
      .filter((value) => !looksLikeQuotedAnswerPrompt(value)),
  ).filter((value) => !CONVERSATIONAL_FILLERS.has(value));
}

function stripQuotedSpans(text: string): string {
  return text
    .replace(/"([^"]*)"/g, " ")
    .replace(/(^|[^\w])'([^']*)'(?!\w)/g, "$1 ");
}

export function isNavigationOnlyTask(query: string): boolean {
  const text = normalize(query);
  if (
    !/\b(?:navigate|go to|open|visit|take me to)\b/.test(text) ||
    !/\b(?:page|module|application|app|screen|view|url|site|dashboard|list|record|form)\b/.test(
      text,
    )
  ) {
    return false;
  }

  const unquoted = normalize(stripQuotedSpans(query));
  return !/\b(?:tell me|report|summari[sz]e|extract|read|compare|find out|what is|what are|how many|how much|create|add|update|set|change|fill|submit|order|delete|remove|move|apply|select|choose|sort by|filter by)\b/.test(
    unquoted,
  );
}

function looksLikeQuotedAnswerPrompt(value: string): boolean {
  return (
    /\?/.test(value) &&
    /\b(?:answer|your answer|what|when|where|who|which|why|how many|how much|does|is|are|should)\b/i.test(
      value,
    )
  );
}

export function extractFieldValuePairs(text: string): Array<{
  field: string;
  value: string;
}> {
  const pairs: Array<{ field: string; value: string }> = [];
  const seenFields = new Set<string>();
  const pushPair = (field: string, value: string) => {
    const trimmedField = field.trim();
    if (!trimmedField) return;
    const key = normalize(trimmedField);
    if (seenFields.has(key)) return;
    seenFields.add(key);
    pairs.push({ field: trimmedField, value });
  };

  for (const match of text.matchAll(
    /\b(?:a\s+)?value\s+of\s+(["'])([\s\S]*?)\1\s+for\s+field\s+(["'])([\s\S]*?)\3/gi,
  )) {
    pushPair(match[4] ?? "", match[2] ?? "");
  }

  for (const match of text.matchAll(
    /\bfield\s+(["'])([^"'\r\n]{1,160})\1\s+(?:to|with|as|=)\s+(["'])([\s\S]*?)\3/gi,
  )) {
    pushPair(match[2] ?? "", match[4] ?? "");
  }

  if (pairs.length === 0) {
    for (const match of text.matchAll(
      /\b([A-Z][A-Za-z0-9 /_-]{1,80})\s*=\s*(?:(["'])([\s\S]*?)\2|\b(empty|false|true|none|null)\b)/g,
    )) {
      const field = match[1] ?? "";
      const quotedValue = match[3];
      const bareValue = match[4];
      if (quotedValue != null) {
        pushPair(field, quotedValue);
      } else if (bareValue != null) {
        pushPair(field, /^empty|none|null$/i.test(bareValue) ? "" : bareValue);
      }
    }
  }

  return unique(pairs.map((pair) => `${pair.field}\u0000${pair.value}`)).map(
    (serialized) => {
      const [field, value = ""] = serialized.split("\u0000");
      return { field, value };
    },
  );
}

function isRecordFormCreationPrompt(text: string): boolean {
  return (
    /\b(create|add|open|start|submit)\b[^.\n]{0,80}\b(new\s+)?(record|incident|case|ticket|request|entry|form|item)\b/i.test(
      text,
    ) || /\bcreate\s+a\s+new\b/i.test(text)
  );
}

function formatFieldValue(pair: { field: string; value: string }): string {
  return pair.value.length > 0
    ? `${pair.field}="${pair.value}"`
    : `${pair.field}=empty`;
}

function synthesizeFieldValueFormPlan(
  query: string,
): SynthesizedPlanStep[] | null {
  const pairs = extractFieldValuePairs(query);
  if (pairs.length < 3 || !isRecordFormCreationPrompt(query)) return null;

  const fieldList = pairs.map(formatFieldValue).join("; ");
  return [
    {
      objective: `Fill the form with the requested field values: ${fieldList}. Do not submit the form yet.`,
      successCriteria: `Each requested field has the specified value: ${fieldList}; the final submit action has not been clicked yet.`,
      dependencies: [],
      assumptions: [],
      toolProfile: "form_fill",
    },
    {
      objective:
        "Submit the form and verify the created record or confirmation is visible.",
      successCriteria:
        "The form submission completes and a created record, confirmation, or resulting item page is visible.",
      dependencies: [0],
      assumptions: [],
      toolProfile: "submit_form",
    },
  ];
}

function extractLargeNumbers(text: string): string[] {
  return unique(
    text
      .match(/\b\d[\d,]{2,}\b/g)
      ?.map((value) => normalize(value))
      .filter((value) => /\d{3,}|,/.test(value)) ?? [],
  );
}

function extractNamedEntities(text: string): string[] {
  const matches = [
    ...text.matchAll(
      /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}|[A-Z]{2,}(?:\s+[A-Z][a-z]+)*)\b/g,
    ),
  ];
  const blacklist = new Set([
    "You",
    "This",
    "Step",
    "Call",
    "Then",
    "Page",
    "Pages",
    "Task",
    "Original",
    "Tell",
    "Check",
    "Find",
    "Read",
    "Show",
    "Give",
    "List",
    "Open",
    "Click",
    "Type",
    "Fill",
    "Search",
    "Report",
    "Verify",
    "Both",
    "BOTH",
    "All",
    "Each",
    "Every",
  ]);
  const imperativeLeads = new Set([
    "Actually",
    "Call",
    "Check",
    "Click",
    "Compare",
    "Decline",
    "Draft",
    "Fill",
    "Find",
    "Give",
    "Keep",
    "List",
    "Open",
    "Read",
    "Report",
    "Review",
    "Search",
    "Show",
    "Suggest",
    "Tell",
    "Type",
    "Verify",
  ]);
  return unique(
    matches
      .map((match) => {
        const value = (match[0] || "").trim();
        const index = match.index ?? 0;
        const isSingleTitleCaseWord =
          /^[A-Z][a-z]+$/.test(value) && !value.includes(" ");
        const prefix = text.slice(0, index);
        const atSentenceBoundary =
          index === 0 || /(?:^|[.!?]\s*)$/.test(prefix);
        if (isSingleTitleCaseWord && atSentenceBoundary) {
          return "";
        }
        const [firstWord, ...restWords] = value.split(/\s+/);
        if (
          restWords.length > 0 &&
          imperativeLeads.has(firstWord) &&
          atSentenceBoundary
        ) {
          return restWords.join(" ");
        }
        return value;
      })
      .filter((value) => value.length >= 4)
      .filter((value) => !blacklist.has(value))
      .map((value) => normalize(value)),
  ).filter((value) => !CONVERSATIONAL_FILLERS.has(value));
}

function extractReturnTargets(text: string): string[] {
  const targets: string[] = [];
  for (const match of text.matchAll(
    /return to[^()\n]*\(([^)]+)\)|go_back[^()\n]*\(([^)]+)\)/gi,
  )) {
    const raw = match[1] || match[2];
    if (raw) targets.push(normalize(raw));
  }
  for (const match of text.matchAll(
    /\b(?:return|go back|navigate back|back)\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g,
  )) {
    targets.push(normalize(match[1]));
  }
  return unique(targets);
}

function extractReportTargets(text: string): string[] {
  const targets: string[] = [];
  const bothAllPattern =
    /(?:report|done)[^.\n]{0,80}\b(?:both|all)\b[^:.\n]*[: ]\s*([^\n.]+)/gi;
  for (const match of text.matchAll(bothAllPattern)) {
    const raw = match[1] || "";
    const pieces = raw.split(/\b(?:and|,)\b/);
    for (const piece of pieces) {
      const named = extractNamedEntities(piece);
      targets.push(...named);
    }
  }
  for (const match of text.matchAll(
    /report(?:ing)?[^.\n]{0,120}\b(?:both|all)\b[^.\n]{0,80}\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b[^.\n]{0,40}\band\b[^.\n]{0,40}\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
  )) {
    targets.push(normalize(match[1]));
    targets.push(normalize(match[2]));
  }
  const readPattern =
    /read[^.\n]{0,80}\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;
  for (const match of text.matchAll(readPattern)) {
    targets.push(normalize(match[1]));
  }
  return unique(targets);
}

function extractMultiReturnMarkers(text: string): {
  count: number;
  entities: string[];
} {
  const lower = text.toLowerCase();
  let count = 0;

  if (/\bboth\b/.test(lower)) count = 2;
  else if (/\ball\s+(three|3)\b/.test(lower)) count = 3;
  else if (/\ball\s+(four|4)\b/.test(lower)) count = 4;

  if (count === 0) return { count: 0, entities: [] };

  // Extract the named entities that "both/all" refers to
  const entities = extractNamedEntities(text);
  if (entities.length < count) return { count: 0, entities: [] };
  return { count, entities };
}

function singularizePhrase(label: string): string {
  const normalized = normalize(label);
  if (normalized.endsWith("ies")) return normalized.slice(0, -3) + "y";
  if (normalized.endsWith("s") && !normalized.endsWith("ss")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function cleanupActionTarget(value: string): string {
  return normalize(value)
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/\b(?:card|cards|task|tasks|item|items)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMultiActionTargets(text: string): {
  targets: string[];
  destination?: string;
} {
  const targetSets: string[][] = [];
  let destination: string | undefined;
  const movePattern =
    /\b(?:move|drag|put|place)\s+(.+?)\s+(?:into|onto|to|under)\s+([A-Z][A-Za-z0-9\s-]{2,60}|[a-z][a-z0-9\s-]{2,60})(?=[.!?]|$)/gi;

  for (const match of text.matchAll(movePattern)) {
    const rawTargets = match[1] || "";
    const pieces = rawTargets
      .split(/\s*,\s*|\s+\band\b\s+/i)
      .map(cleanupActionTarget)
      .filter((value) => value.length >= 3);
    if (pieces.length >= 2) {
      targetSets.push(pieces);
      destination = cleanupActionTarget(match[2] || "");
    }
  }

  return {
    targets: unique(targetSets.flat()),
    ...(destination ? { destination } : {}),
  };
}

function extractExhaustiveScope(text: string): {
  label?: string;
  count?: number;
} {
  const vagueScopeLabels = new Set([
    "that",
    "this",
    "it",
    "them",
    "those",
    "these",
    "everything",
    "anything",
    "something",
    "of that",
    "of this",
    "of it",
    "of them",
    "of those",
    "of these",
  ]);
  const patterns = [
    /\b(?:review|inspect|check|open|browse|read|visit|compare|analyze)\s+(?:all|every|each(?:\s+of)?)\s+(?:(\d{1,3})\s+)?([a-z][a-z0-9\s-]{2,40}?)(?=\s+(?:on|in|for|from|with|then|and)\b|[,.]|$)/i,
    /\b(?:all|every|each(?:\s+of)?)\s+(?:(\d{1,3})\s+)?([a-z][a-z0-9\s-]{2,40}?)(?=\s+(?:on|in|for|from|with|then|and)\b|[,.]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const rawLabel = normalize(match[2] || "");
    if (!rawLabel) continue;
    const label = rawLabel
      .replace(/\b(?:this page|the page|page)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!label) continue;
    if (vagueScopeLabels.has(label)) continue;
    const count =
      typeof match[1] === "string" && /^\d+$/.test(match[1])
        ? Number(match[1])
        : undefined;
    return { label, count };
  }

  return {};
}

function countWord(value: number): string | null {
  const words: Record<number, string> = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
    11: "eleven",
    12: "twelve",
  };
  return words[value] ?? null;
}

function extractAggregateReportIntent(text: string): boolean {
  return /\b(report|tell me|summari[sz]e|recommend|best match|best matches|rank|compare|which .* strongest|which .* best|give .* answer|why)\b/i.test(
    text,
  );
}

function extractSequentialDetailReviewIntent(text: string): boolean {
  return /\b(click into each|open each|each one|every one|read the full details|read full details|full details|come back|go back|return to the listings|return to the list|back to the listings|back to the list)\b/i.test(
    text,
  );
}

export function buildTaskContract(query: string): TaskContract {
  const namedEntities = extractNamedEntities(query);
  const multiReturn = extractMultiReturnMarkers(query);
  const exhaustiveScope = extractExhaustiveScope(query);
  const multiAction = extractMultiActionTargets(query);
  const requiredEntities = unique([
    ...extractQuotedPhrases(query),
    ...extractReportTargets(query),
    ...extractReturnTargets(query),
    ...multiReturn.entities,
    ...multiAction.targets,
  ]);

  const broadEntities =
    requiredEntities.length > 0
      ? namedEntities.filter((entity) =>
          requiredEntities.some(
            (required) =>
              entity.includes(required) ||
              required.includes(entity) ||
              entity.split(" ").slice(-1)[0] ===
                required.split(" ").slice(-1)[0],
          ),
        )
      : [];

  return {
    requiresRoundTrip:
      /\b(go_back|go back|return to|back to|twice to return|use go_back)\b/i.test(
        query,
      ),
    requiredEntities: unique([...requiredEntities, ...broadEntities]),
    requiredNumbers: extractLargeNumbers(stripQuotedSpans(query)),
    requiredActionTargets: multiAction.targets,
    actionTargetDestination: multiAction.destination,
    returnTargets: extractReturnTargets(query),
    reportTargets: extractReportTargets(query),
    multiReturnCount: multiReturn.count || undefined,
    exhaustiveScopeLabel: exhaustiveScope.label,
    exhaustiveScopeCount: exhaustiveScope.count,
    requiresAggregateReport:
      Boolean(exhaustiveScope.label) && extractAggregateReportIntent(query),
    requiresSequentialDetailReview:
      Boolean(exhaustiveScope.label) &&
      extractSequentialDetailReviewIntent(query),
  };
}

function buildExhaustiveSynthesisStep(contract: TaskContract): {
  objective: string;
  successCriteria: string;
  dependencies: number[];
  assumptions: string[];
  toolProfile?: ToolProfile;
} | null {
  if (!contract.exhaustiveScopeLabel || !contract.requiresAggregateReport) {
    return null;
  }
  const singular = singularizePhrase(contract.exhaustiveScopeLabel);
  const countText =
    typeof contract.exhaustiveScopeCount === "number"
      ? `${contract.exhaustiveScopeCount} ${contract.exhaustiveScopeLabel}`
      : contract.exhaustiveScopeLabel;
  return {
    objective: `Compare the reviewed ${countText} and report the best matches for the user's stated constraints.`,
    successCriteria: `Final answer mentions multiple reviewed ${singular} items and explains why they best fit the user's stated constraints.`,
    dependencies: [],
    assumptions: [],
    toolProfile: "read_only",
  };
}

export function assessTaskContractCoverage(params: {
  contract: TaskContract;
  text: string;
  requireReturnTarget?: boolean;
}): TaskContractCoverage {
  const corpus = normalize(params.text);
  const missingEntities = params.contract.requiredEntities.filter(
    (entity) => !corpus.includes(entity),
  );
  const missingNumbers = params.contract.requiredNumbers.filter(
    (value) => !corpus.includes(value),
  );
  const missingReturnTarget = Boolean(
    params.requireReturnTarget &&
    params.contract.returnTargets.length > 0 &&
    !params.contract.returnTargets.some((target) => corpus.includes(target)),
  );
  const exhaustiveLabel = params.contract.exhaustiveScopeLabel;
  const exhaustiveCount = params.contract.exhaustiveScopeCount;
  const exhaustiveVariants = exhaustiveLabel
    ? unique([exhaustiveLabel, singularizePhrase(exhaustiveLabel)])
    : [];
  const mentionsExhaustiveLabel =
    exhaustiveVariants.length === 0
      ? true
      : exhaustiveVariants.some((label) => corpus.includes(label));
  const countWords = exhaustiveCount ? [String(exhaustiveCount)] : [];
  const countWordVariant = exhaustiveCount ? countWord(exhaustiveCount) : null;
  if (countWordVariant) countWords.push(countWordVariant);
  const mentionsExhaustiveCount =
    countWords.length === 0
      ? true
      : countWords.some((value) => corpus.includes(value));
  const mentionsExhaustiveMarker =
    /\b(all|every|each|reviewed|checked|inspected|visited)\b/.test(corpus);
  const missingExhaustiveCoverage = Boolean(
    exhaustiveLabel &&
    (!mentionsExhaustiveLabel ||
      !(mentionsExhaustiveCount || mentionsExhaustiveMarker)),
  );
  // Multi-return check: when "both"/"all N" is detected, ensure enough
  // distinct entities from the contract are present in the summary
  const multiReturnCount = params.contract.multiReturnCount ?? 0;
  const coveredEntities =
    multiReturnCount >= 2
      ? params.contract.requiredEntities.filter((e) => corpus.includes(e))
      : [];
  const multiReturnShortfall =
    multiReturnCount >= 2 &&
    params.contract.requiredEntities.length >= multiReturnCount &&
    coveredEntities.length < multiReturnCount;

  return {
    missingEntities,
    missingNumbers,
    missingReturnTarget,
    missingExhaustiveCoverage,
    missingMultiReturnCoverage: multiReturnShortfall,
    satisfied:
      missingEntities.length === 0 &&
      missingNumbers.length === 0 &&
      !missingReturnTarget &&
      !missingExhaustiveCoverage &&
      !multiReturnShortfall,
  };
}

export function repairPlanCoverage(params: {
  query: string;
  steps: Array<{
    objective: string;
    successCriteria: string;
    dependencies: number[];
    assumptions: string[];
    verifyAfter?: {
      trigger: string;
      action: "call_done" | "advance_step" | "retry_step";
      maxRetries?: number;
      pattern?: string;
    };
    toolProfile?: ToolProfile;
  }>;
}): typeof params.steps {
  const { query } = params;
  const contract = buildTaskContract(query);
  const steps = [...params.steps];

  // Check if any step explicitly returns to the target (not just mentions it
  // in a "navigate FROM target" context). Look for "return to X" or "back to X"
  // patterns in objectives, not bare string inclusion.
  const hasExplicitReturn = (target: string) =>
    steps.some((step) => {
      const obj = normalize(step.objective);
      return (
        obj.includes(`return to ${target}`) ||
        obj.includes(`back to ${target}`) ||
        obj.includes(`navigate to ${target}`) ||
        (obj.startsWith(`read`) && obj.includes(target))
      );
    });
  if (
    contract.requiresRoundTrip &&
    contract.returnTargets.length > 0 &&
    !contract.returnTargets.some((target) => hasExplicitReturn(target))
  ) {
    const target = contract.returnTargets[0];
    steps.push({
      objective: `Return to ${target} and verify that page is visible.`,
      successCriteria: `Page shows ${target}.`,
      dependencies: steps.length > 0 ? [steps.length - 1] : [],
      assumptions: [],
      toolProfile: "navigate",
    });
  }

  const refreshedCorpus = normalize(
    steps
      .map((step) => `${step.objective}\n${step.successCriteria}`)
      .join("\n"),
  );
  const missingReportTargets = contract.reportTargets.filter(
    (target) => !refreshedCorpus.includes(target),
  );
  for (const target of missingReportTargets) {
    steps.push({
      objective: `Read the requested result for ${target} and keep it for the final report.`,
      successCriteria: `Page shows ${target} and the requested result value.`,
      dependencies: steps.length > 0 ? [steps.length - 1] : [],
      assumptions: [],
      toolProfile: "read_only",
    });
  }

  const missingActionTargets = contract.requiredActionTargets.filter(
    (target) => !refreshedCorpus.includes(target),
  );
  for (const target of missingActionTargets) {
    const destination = contract.actionTargetDestination;
    steps.push({
      objective: destination
        ? `Move ${target} to ${destination} according to the original request.`
        : `Update ${target} according to the original request.`,
      successCriteria: destination
        ? `Page or tool output confirms ${target} is in ${destination}.`
        : `Page or tool output confirms ${target} was updated as requested.`,
      dependencies: steps.length > 0 ? [steps.length - 1] : [],
      assumptions: [],
      toolProfile: "full",
    });
  }

  const exhaustiveSynthesisStep = buildExhaustiveSynthesisStep(contract);
  if (exhaustiveSynthesisStep) {
    const hasAggregateStep = steps.some((step) => {
      const objective = normalize(step.objective);
      const criteria = normalize(step.successCriteria ?? "");
      const aggregateObjective =
        /^(compare|report|recommend|rank|summari[sz]e)\b/.test(objective) ||
        /\b(report|recommend|rank|summari[sz]e)\b/.test(objective);
      const finalAnswerCriteria =
        criteria.includes("final answer") ||
        criteria.includes("user's stated constraints") ||
        criteria.includes("user constraints") ||
        criteria.includes("best matches");
      return aggregateObjective && finalAnswerCriteria;
    });
    if (!hasAggregateStep) {
      steps.push({
        ...exhaustiveSynthesisStep,
        dependencies: steps.length > 0 ? [steps.length - 1] : [],
      });
    }
  }

  return steps;
}

export function synthesizePlanFromTaskContract(
  query: string,
): SynthesizedPlanStep[] | null {
  if (isNavigationOnlyTask(query)) return null;

  const fieldValueFormPlan = synthesizeFieldValueFormPlan(query);
  if (fieldValueFormPlan) return fieldValueFormPlan;

  const contract = buildTaskContract(query);
  const reportTargets = unique(
    contract.reportTargets.length >= 2
      ? contract.reportTargets
      : contract.requiredEntities,
  );

  if (
    !contract.requiresRoundTrip &&
    reportTargets.length < 2 &&
    contract.requiredActionTargets.length < 2 &&
    contract.requiredNumbers.length === 0
  ) {
    return null;
  }

  const steps: SynthesizedPlanStep[] = [];

  const returnTarget = contract.returnTargets[0] || null;
  const forwardTargets = reportTargets.filter(
    (target) =>
      !returnTarget ||
      (!target.includes(returnTarget) && !returnTarget.includes(target)),
  );

  if (forwardTargets.length > 0) {
    const targetList = forwardTargets.join(" and ");
    steps.push({
      objective: `Navigate to ${targetList} and read the requested result there.`,
      successCriteria: `Page shows ${targetList} and the requested result value.`,
      dependencies: [],
      assumptions: [],
      toolProfile: "navigate",
    });
  }

  if (returnTarget) {
    steps.push({
      objective: `Return to ${returnTarget} and read the requested result there.`,
      successCriteria: `Page shows ${returnTarget} and the requested result value.`,
      dependencies: steps.length > 0 ? [steps.length - 1] : [],
      assumptions: [],
      toolProfile: "navigate",
    });
  }

  if (reportTargets.length > 0) {
    steps.push({
      objective: `Report the requested results for ${reportTargets.join(" and ")}.`,
      successCriteria: `Final answer mentions ${reportTargets.join(" and ")} and the requested result values.`,
      dependencies: steps.length > 0 ? [steps.length - 1] : [],
      assumptions: [],
      toolProfile: "read_only",
    });
  }

  if (steps.length === 0 && contract.requiredActionTargets.length >= 2) {
    for (const target of contract.requiredActionTargets) {
      const destination = contract.actionTargetDestination;
      steps.push({
        objective: destination
          ? `Move ${target} to ${destination} according to the original request.`
          : `Update ${target} according to the original request.`,
        successCriteria: destination
          ? `Page or tool output confirms ${target} is in ${destination}.`
          : `Page or tool output confirms ${target} was updated as requested.`,
        dependencies: steps.length > 0 ? [steps.length - 1] : [],
        assumptions: [],
        toolProfile: "full",
      });
    }
  }

  return steps.length >= 2 ? steps : null;
}

export function synthesizeBatchedExhaustivePlan(query: string): Array<{
  objective: string;
  successCriteria: string;
  dependencies: number[];
  assumptions: string[];
  toolProfile?: ToolProfile;
}> | null {
  const contract = buildTaskContract(query);
  const count = contract.exhaustiveScopeCount;
  const label = contract.exhaustiveScopeLabel;
  if (
    !label ||
    !count ||
    count < 5 ||
    !contract.requiresAggregateReport ||
    !contract.requiresSequentialDetailReview
  ) {
    return null;
  }

  const batchSize =
    contract.requiresSequentialDetailReview && count <= 12
      ? 1
      : contract.requiresSequentialDetailReview
        ? 2
        : Math.max(1, Math.ceil(count / Math.min(4, count)));
  const singular = singularizePhrase(label);
  const steps: Array<{
    objective: string;
    successCriteria: string;
    dependencies: number[];
    assumptions: string[];
    toolProfile?: ToolProfile;
  }> = [];

  for (let start = 1; start <= count; start += batchSize) {
    const end = Math.min(count, start + batchSize - 1);
    const batchLabel =
      start === end ? `#${start}` : `#${start} through #${end}`;
    const objective =
      start === end
        ? `Review ${singular} ${batchLabel} by opening it, reading its full details, and returning to the original ${label} list.`
        : `Review ${label} ${batchLabel} one by one by opening each item, reading the full details, and returning to the original ${label} list after each review.`;
    const successCriteria =
      start === end
        ? `${singular} ${batchLabel} has been reviewed and the original ${label} list is visible again.`
        : `${label} ${batchLabel} have all been reviewed and the original ${label} list is visible again.`;
    steps.push({
      objective,
      successCriteria,
      dependencies: steps.length > 0 ? [steps.length - 1] : [],
      assumptions: [],
      toolProfile: "navigate",
    });
  }

  const synthesisStep = buildExhaustiveSynthesisStep(contract);
  if (synthesisStep) {
    steps.push({
      ...synthesisStep,
      dependencies: steps.length > 0 ? [steps.length - 1] : [],
    });
  }

  return steps.length >= 2 ? steps : null;
}
