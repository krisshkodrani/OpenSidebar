import type { VerificationGate } from "../orchestrator/types";
import { tokenizeStepText } from "./loop-helpers";
import {
  hasDurableServiceNowSortEvidence,
  isServiceNowListSortQuery,
} from "./servicenow/trusted-workflow-adapter";

export interface StepCoherenceResult {
  coherent: boolean;
  reason?: string;
}

/**
 * Cross-step coherence check for done() summaries (Layer 4).
 *
 * Detects when the model's done() summary describes completing a DIFFERENT step
 * than the one it's currently on (e.g., "Novablast added" while on the CloudStrike step).
 *
 * Algorithm:
 * 1. Tokenize all step descriptions → find distinctive tokens per step (unique to that step)
 * 2. Tokenize the summary
 * 3. Block if summary contains distinctive tokens from a different step but not the current one
 */
export function checkSummaryStepCoherence(params: {
  summary: string;
  currentStepIndex: number;
  stepDescriptions: string[];
}): StepCoherenceResult {
  const { summary, currentStepIndex, stepDescriptions } = params;

  if (stepDescriptions.length < 2 || currentStepIndex < 0) {
    return { coherent: true };
  }

  // Tokenize all steps
  const stepTokenSets = stepDescriptions.map(
    (desc) => new Set(tokenizeStepText(desc)),
  );

  // Find distinctive tokens per step: tokens that appear in this step but no other
  const distinctiveTokens: Set<string>[] = stepTokenSets.map((tokens, idx) => {
    const distinctive = new Set<string>();
    for (const token of tokens) {
      const appearsElsewhere = stepTokenSets.some(
        (other, otherIdx) => otherIdx !== idx && other.has(token),
      );
      if (!appearsElsewhere) {
        distinctive.add(token);
      }
    }
    return distinctive;
  });

  const currentDistinctive = distinctiveTokens[currentStepIndex];
  if (!currentDistinctive || currentDistinctive.size === 0) {
    // Current step has no distinctive tokens (generic step like "Checkout") → pass
    return { coherent: true };
  }

  // Tokenize the summary
  const summaryTokens = new Set(tokenizeStepText(summary));

  // Check: does the summary mention the current step's distinctive tokens?
  const hasCurrentStepTokens = [...currentDistinctive].some((t) =>
    summaryTokens.has(t),
  );

  // Check: does the summary mention a different step's distinctive tokens?
  let wrongStepIdx = -1;
  let wrongStepToken = "";
  for (let i = 0; i < distinctiveTokens.length; i++) {
    if (i === currentStepIndex) continue;
    for (const token of distinctiveTokens[i]) {
      if (summaryTokens.has(token)) {
        wrongStepIdx = i;
        wrongStepToken = token;
        break;
      }
    }
    if (wrongStepIdx >= 0) break;
  }

  if (!hasCurrentStepTokens && wrongStepIdx >= 0) {
    return {
      coherent: false,
      reason: `Summary mentions "${wrongStepToken}" (step ${wrongStepIdx + 1}) but not current step ${currentStepIndex + 1}`,
    };
  }

  return { coherent: true };
}

export interface GateCheckResult {
  matched: boolean;
  evidence: string;
}

/**
 * Check whether tool results (and optionally current page state) satisfy a
 * verification gate. Tries regex `pattern` first, falls back to substring
 * match on trigger phrases against the combined corpus of tool results + URL.
 *
 * @param toolResults - Array of tool result strings from this turn
 * @param gate - The verification gate to check
 * @param currentUrl - Optional current page URL for URL-based predicates
 */
export function checkVerificationGate(
  toolResults: string[],
  gate?: VerificationGate | null,
  currentUrl?: string,
): GateCheckResult {
  if (!gate) return { matched: false, evidence: "" };

  const corpus = toolResults.join("\n");

  // URL-based trigger check: extract "URL contains X" patterns from trigger
  if (currentUrl) {
    const urlContainsMatch = gate.trigger.match(/url\s+contains?\s+(\S+)/i);
    if (urlContainsMatch) {
      const urlFragment = urlContainsMatch[1].toLowerCase();
      if (currentUrl.toLowerCase().includes(urlFragment)) {
        return {
          matched: true,
          evidence: `URL: ${currentUrl.slice(0, 120)}`,
        };
      }
    }
  }

  // Try regex pattern first (check against both tool results and URL)
  const corpusWithUrl = currentUrl ? corpus + "\nURL: " + currentUrl : corpus;
  if (gate.pattern) {
    try {
      const re = new RegExp(gate.pattern, "i");
      const match = re.exec(corpusWithUrl);
      if (match) {
        return { matched: true, evidence: match[0].slice(0, 120) };
      }
    } catch {
      // Invalid regex — fall through to substring matching
    }
  }

  // Substring match on trigger phrases (split on `,;|`, filter phrases > 3 chars)
  const phrases = gate.trigger
    .split(/[,;|]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 3);

  for (const phrase of phrases) {
    const idx = corpus.toLowerCase().indexOf(phrase);
    if (idx >= 0) {
      const start = Math.max(0, idx - 10);
      const end = Math.min(corpus.length, idx + phrase.length + 10);
      return { matched: true, evidence: corpus.slice(start, end).trim() };
    }
  }

  return { matched: false, evidence: "" };
}

export interface AdmissionResult {
  type: "success" | "failure";
  match: string;
}

const SUCCESS_PATTERNS = [
  /task\s+completed?/i,
  /successfully\s+submitted/i,
  /code\s+accepted/i,
  /has\s+been\s+(saved|created|submitted|applied|updated)/i,
  /operation\s+(complete|successful)/i,
  /all\s+steps?\s+(are\s+)?completed?/i,
  /goal\s+(achieved|accomplished|reached)/i,
  /(?:step|objective)\s+(?:is\s+)?(?:satisfied|complete|done|met)/i,
  /i\s+can\s+report\s+(?:both|all|the)/i,
  /(?:is|are)\s+(?:now\s+)?(?:visible|displayed|shown)\s+on\s+(?:the\s+)?(?:page|screen)/i,
  /^#+\s*completed?\b/im,
  /^done\s*[—–-]/im,
  /i['']?ll\s+mark\s+completion/i,
  /i\s+verified\b/i,
];

const FAILURE_PATTERNS = [
  /i['']?m\s+unable\s+(to\s+)?(find|locate|complete|access)/i,
  /i\s+cannot\s+(find|locate|complete|access)/i,
  /i['']?ve\s+exhausted\s+all/i,
  /unable\s+to\s+(proceed|continue|make\s+progress)/i,
  /no\s+(way|method|approach)\s+(to|for)/i,
  /this\s+(task|action)\s+is\s+not\s+possible/i,
];

export interface DoneSentimentResult {
  confident: boolean;
  reason?: string;
}

/** Failure/uncertainty patterns in done() summaries — generic verb-outcome pairs. */
const DONE_FAILURE_PATTERNS: RegExp[] = [
  /didn['']?t\s+(update|change|work|succeed|complete|add|remove|appear|load|submit)/i,
  /attempt(?:ed)?\s+(?:to\s+)?(?:failed|unsuccessful)/i,
  /(?:could|was)\s+not\s+(?:verify|confirm|complete|find|add|remove|submit|load)/i,
  /not\s+(?:visible|confirmed|updated|added|removed|completed|successful|found|present)/i,
  /no\s+(?:change|update|confirmation|evidence|result|response|effect)/i,
  /unable\s+to\s+(?:find|locate|complete|access|verify|confirm|submit|continue|proceed|make\s+progress)\b/i,
  /(?:fail|error|issue|problem)\s+(?:with|in|during|while)/i,
];

/** Strong success signals that override failure patterns (reduces false positives). */
const DONE_SUCCESS_OVERRIDES: RegExp[] = [
  /successfully\s+(added|completed|submitted|applied|removed|updated|placed|filled)/i,
  /\b(done|finished|completed)\s+(the|this)\s+step/i,
  /\bis\s+(now|already)\s+(in|on|at|applied|selected|checked|submitted)/i,
  /\bhas\s+been\s+(added|applied|selected|submitted|completed|updated|filled)/i,
];

/**
 * Scan the `summary` text passed to done() for failure/uncertainty signals.
 * If the model's own words admit failure, returns `{ confident: false }`.
 * If a failure pattern is matched but a strong success override is also present,
 * the summary is treated as confident (avoids false positives on hedged language).
 * Returns `{ confident: true }` when no failure signals found.
 */
export function assessDoneSummary(summary: string): DoneSentimentResult {
  for (const pattern of DONE_FAILURE_PATTERNS) {
    if (pattern.test(summary)) {
      // Check for success overrides — hedged language like "added item though counter didn't update"
      const hasSuccessOverride = DONE_SUCCESS_OVERRIDES.some((sp) =>
        sp.test(summary),
      );
      if (hasSuccessOverride) {
        return { confident: true };
      }
      return { confident: false, reason: pattern.source };
    }
  }
  return { confident: true };
}

export interface WorkflowDoneGuardInput {
  query: string;
  summary: string;
  selectedSkillId?: string | null;
  pageUrl?: string;
  pageTitle?: string;
}

export interface WorkflowDoneGuardResult {
  blocked: boolean;
  reason: string | null;
}

function normalizeWorkflowGuardText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractWorkflowGuardPrimaryRequest(queryText: string): string {
  const originalRequest = /original user request[^:]*:\s*(.+)$/i.exec(
    queryText,
  )?.[1];
  if (originalRequest?.trim()) return originalRequest.trim();

  const workflowRequest =
    /complete the workflow for the original request:\s*(.+?)(?:\s+success criteria:|\s+planner assumptions|\s+selected workflow skill:|\s+handoff context:|\s+execution policy:|\s+reality check signal:|$)/i.exec(
      queryText,
    )?.[1];
  if (workflowRequest?.trim()) return workflowRequest.trim();

  return queryText;
}

function workflowSkillOrQueryMatches(
  selectedSkillId: string | null | undefined,
  skillId: string,
  queryText: string,
  pattern: RegExp,
): boolean {
  return selectedSkillId === skillId || pattern.test(queryText);
}

function extractStandaloneNumericTokens(text: string): string[] {
  const tokens: string[] = [];
  const numberPattern =
    /(^|[^a-z0-9])((?:[$]\s*)?\d[\d,]*(?:\.\d+)?%?)(?![a-z0-9])/gi;
  for (const match of text.matchAll(numberPattern)) {
    const token = (match[2] || "").replace(/\s+/g, "");
    if (token) tokens.push(token);
  }
  return tokens;
}

function chartQueryExpectsLabelAndCount(queryText: string): boolean {
  return (
    /\blabel\b[^.]{0,60}\bcount\b/.test(queryText) ||
    /\bcount\b[^.]{0,60}\blabel\b/.test(queryText)
  );
}

function chartQueryExpectsSingleNumericAnswer(queryText: string): boolean {
  if (chartQueryExpectsLabelAndCount(queryText)) return false;

  const asksForMultipleNumericValues =
    /\b(?:both|two|three|all|each|every|multiple)\b[^.]{0,50}\b(?:numbers|values|counts|percentages|percents|metrics)\b/.test(
      queryText,
    ) ||
    /\b(?:numbers|values|counts|percentages|percents|metrics)\b[^.]{0,50}\b(?:both|two|three|all|each|every|multiple)\b/.test(
      queryText,
    ) ||
    /\bcompare\b[^.]{0,80}\b(?:numbers|values|counts|percentages|percents|metrics)\b/.test(
      queryText,
    );
  if (asksForMultipleNumericValues) return false;

  return (
    /\bwhat\s+is\s+(?:the\s+)?(?:value|count|percentage|percent)\b/.test(
      queryText,
    ) ||
    /\b(?:maximum|minimum|highest|lowest|largest|smallest)\s+(?:value|count|percentage|percent|number)\b/.test(
      queryText,
    )
  );
}

function chartSummaryHasNonNumericLabel(summary: string): boolean {
  return /[a-z]/.test(
    summary.replace(/(?:[$]\s*)?\d[\d,]*(?:\.\d+)?%?/gi, " "),
  );
}

function parseWorkflowGuardInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractCatalogRequestedQuantity(queryText: string): number | null {
  const patterns = [
    /\b(?:order|request|buy|purchase)\s+(\d[\d,]*)\b/,
    /\bquantity\s*(?:=|:|to|of)?\s*(\d[\d,]*)\b/,
    /\bqty\s*(?:=|:|to|of)?\s*(\d[\d,]*)\b/,
    /\b(\d[\d,]*)\s+(?:standard\s+)?(?:laptops?|items?|catalog items?|requests?)\b/,
  ];
  for (const pattern of patterns) {
    const quantity = parseWorkflowGuardInteger(pattern.exec(queryText)?.[1]);
    if (quantity !== null) return quantity;
  }
  return null;
}

function detectCatalogQuantityConflict(
  summary: string,
  expectedQuantity: number | null,
): string | null {
  if (expectedQuantity === null) return null;

  const mismatchAgainstExpected = new RegExp(
    `\\b(?:not|instead of|rather than)\\s+${expectedQuantity}\\b`,
    "i",
  );
  if (mismatchAgainstExpected.test(summary)) {
    return `Catalog confirmation conflicts with requested quantity ${expectedQuantity}.`;
  }

  const observedItemQuantityPatterns = [
    /\btotal(?:\s+order|\s+quantity|\s+items?)?\s*[:=-]?\s*(\d[\d,]*)\s+(?:standard\s+)?(?:laptops?|items?|catalog items?|requests?)\b/i,
    /\b(\d[\d,]*)\s+(?:standard\s+)?(?:laptops?|items?|catalog items?)\b[^.]{0,80}\b(?:ordered|requested|submitted|total)\b/i,
    /\b(?:ordered|requested|submitted|total(?:\s+order)?)\s+(\d[\d,]*)\s+(?:standard\s+)?(?:laptops?|items?|catalog items?)\b/i,
  ];
  for (const pattern of observedItemQuantityPatterns) {
    const observed = parseWorkflowGuardInteger(pattern.exec(summary)?.[1]);
    if (observed !== null && observed !== expectedQuantity) {
      return `Catalog confirmation shows quantity ${observed}, but the request expected ${expectedQuantity}.`;
    }
  }

  const lineItemCount = parseWorkflowGuardInteger(
    /\b(\d[\d,]*)\s+line\s+items?\b/i.exec(summary)?.[1],
  );
  const eachLineQuantity = parseWorkflowGuardInteger(
    /\beach(?:\s+line\s+item)?[^.]{0,80}\bquantity\s*[:=-]?\s*(\d[\d,]*)\b/i.exec(
      summary,
    )?.[1],
  );
  if (
    lineItemCount !== null &&
    lineItemCount > 1 &&
    eachLineQuantity !== null &&
    eachLineQuantity >= expectedQuantity
  ) {
    return `Catalog confirmation shows ${lineItemCount} line items at quantity ${eachLineQuantity}, which exceeds the requested quantity ${expectedQuantity}.`;
  }

  return null;
}

function extractRequestedSortLabels(queryText: string): string[] {
  const labels = new Set<string>();
  const whitespace = "\\s";
  const parenthesizedDirection = new RegExp(
    `(?:^|[-:${whitespace}])"?([a-z][a-z0-9 /_-]{1,50})"?${whitespace}*\\((?:ascending|descending|asc|desc)\\)`,
    "gi",
  );
  for (const match of queryText.matchAll(parenthesizedDirection)) {
    let label = (match[1] || "")
      .replace(/\s+/g, " ")
      .replace(/^["'\s:,-]+|["'\s:,-]+$/g, "")
      .trim();
    label = label
      .replace(/^.*\bby\s+/i, "")
      .replace(/^.*\bfields?\s*[-:]\s*/i, "")
      .replace(/^(?:and|then)\s+/i, "")
      .replace(/^["'\s:,-]+|["'\s:,-]+$/g, "")
      .trim();
    if (label && !/^(?:sort|fields?|following fields?)$/i.test(label)) {
      labels.add(label.toLowerCase());
    }
  }
  return Array.from(labels);
}

/**
 * Blocks done() summaries that describe an intermediate workflow state for
 * reusable UI patterns where reaching the surface is not the user's goal.
 */
export function assessWorkflowDoneGuard(
  input: WorkflowDoneGuardInput,
): WorkflowDoneGuardResult {
  const queryText = normalizeWorkflowGuardText(
    `${input.query}\n${input.pageTitle ?? ""}\n${input.pageUrl ?? ""}`,
  );
  const currentPageText = normalizeWorkflowGuardText(
    `${input.pageTitle ?? ""}\n${input.pageUrl ?? ""}`,
  );
  const summary = normalizeWorkflowGuardText(input.summary);
  const skillId = input.selectedSkillId ?? null;
  const primaryRequestText = extractWorkflowGuardPrimaryRequest(queryText);
  const guardIntentText = normalizeWorkflowGuardText(
    `${primaryRequestText}\n${currentPageText}`,
  );

  if (!summary) return { blocked: false, reason: null };

  const chartActive = workflowSkillOrQueryMatches(
    skillId,
    "chart-value-extraction",
    guardIntentText,
    /\b(chart|dashboard|graph|plot|highcharts|visualization)\b/,
  );
  if (chartActive) {
    const chartInterim =
      /\b(opened|reached|loaded|visible|displayed|showing|viewing)\b[^.]{0,80}\b(chart|dashboard|graph|plot|report)\b/.test(
        summary,
      ) ||
      /\b(chart|dashboard|graph|plot|report)\b[^.]{0,80}\b(open|opened|visible|loaded|displayed|shown|viewing)\b/.test(
        summary,
      );
    const hasConcreteValue =
      /(?:[$]\s*)?\d[\d,]*(?:\.\d+)?%?/.test(summary) ||
      /\b(value|count|total|metric|answer)\b[^.]{0,60}\b(is|was|=|:)\b/.test(
        summary,
      );
    if (chartInterim && !hasConcreteValue) {
      return {
        blocked: true,
        reason:
          "Chart value task requires a concrete extracted value before completion.",
      };
    }
    const numericTokens = extractStandaloneNumericTokens(summary);
    if (chartQueryExpectsLabelAndCount(primaryRequestText)) {
      if (numericTokens.length !== 1) {
        return {
          blocked: true,
          reason:
            "Chart label-and-count task should answer exactly as 'Label: count' with one numeric count; omit percentages, totals, axis ranges, tie details, and repeated counts.",
        };
      }
      if (!chartSummaryHasNonNumericLabel(summary)) {
        return {
          blocked: true,
          reason:
            "Chart label-and-count task requires both the label and the count, not just the number.",
        };
      }
    }
    if (
      chartQueryExpectsSingleNumericAnswer(primaryRequestText) &&
      numericTokens.length > 1
    ) {
      return {
        blocked: true,
        reason:
          "Chart value task asks for one numeric answer; remove supporting counts, totals, axis ranges, timestamps, and tie details before completion.",
      };
    }
  }

  const searchActive = workflowSkillOrQueryMatches(
    skillId,
    "search-answer-extraction",
    guardIntentText,
    /\b(knowledge base|kb article|search results?|find answer|look up|answer the question)\b/,
  );
  if (searchActive) {
    const searchInterim =
      /\b(opened|found|located|loaded|viewing|read)\b[^.]{0,80}\b(search result|result|article|knowledge base|kb article|page)\b/.test(
        summary,
      ) ||
      /\b(search results?|article|knowledge base|kb article)\b[^.]{0,80}\b(visible|shown|displayed|opened|loaded)\b/.test(
        summary,
      );
    const hasAnswer =
      /\b(answer|answer is|states?|says|according to|the requested|final answer)\b/.test(
        summary,
      ) && !/\b(no answer|without an answer|not answered)\b/.test(summary);
    if (searchInterim && !hasAnswer) {
      return {
        blocked: true,
        reason:
          "Search answer task requires the requested answer, not just an opened result.",
      };
    }
  }

  const listFilterActive = workflowSkillOrQueryMatches(
    skillId,
    "list-filter-workflow",
    guardIntentText,
    /\b(filter|condition builder|filter builder|show records where|query list)\b/,
  );
  if (listFilterActive) {
    const filterFailure =
      /\b(not|no|without)\b[^.]{0,30}\b(applied|filtered|changed|updated|results?)\b/.test(
        summary,
      );
    const filterInterim =
      /\b(opened|visible|ready|loaded|displayed|showing)\b[^.]{0,80}\b(filter|condition builder|filter builder|condition panel)\b/.test(
        summary,
      ) ||
      /\b(filter|condition builder|filter builder|condition panel)\b[^.]{0,80}\b(open|opened|visible|ready|loaded|displayed|shown)\b/.test(
        summary,
      );
    const filterComplete =
      /\b(applied|run|ran|executed|filtered|active filter|query state|sysparm_query|results? updated|rows? filtered|matching records?|condition applied)\b/.test(
        summary,
      );
    if (filterFailure || (filterInterim && !filterComplete)) {
      return {
        blocked: true,
        reason:
          "List filter task requires the filter to be applied and verified before completion.",
      };
    }
  }

  const listSortActive = workflowSkillOrQueryMatches(
    skillId,
    "list-sort-workflow",
    guardIntentText,
    /\b(sort|order by|ascending|descending|sort column)\b/,
  );
  if (listSortActive) {
    const sortFailure =
      /\b(not|no|without)\b[^.]{0,30}\b(sorted|ordered|ascending|descending|changed|updated)\b/.test(
        summary,
      );
    const sortInterim =
      /\b(opened|visible|ready|loaded|displayed|showing|viewing)\b[^.]{0,80}\b(list|table|records?|rows?)\b/.test(
        summary,
      ) ||
      /\b(list|table|records?|rows?)\b[^.]{0,80}\b(open|opened|visible|ready|loaded|displayed|shown)\b/.test(
        summary,
      );
    const sortComplete =
      /\b(sorted|sort applied|ordered|order by|ascending|descending|aria-sort|sort state|header indicates)\b/.test(
        summary,
      );
    const requestedSortLabels = extractRequestedSortLabels(queryText);
    const missingSortLabels = requestedSortLabels.filter(
      (label) => !summary.includes(label),
    );
    if (missingSortLabels.length > 0) {
      return {
        blocked: true,
        reason: `List sort task still needs evidence for requested sort field(s): ${missingSortLabels.join(", ")}.`,
      };
    }
    // ServiceNow-specific evidence bar lives in the quarantined adapter.
    const serviceNowListSort = isServiceNowListSortQuery(queryText);
    const durableServiceNowSortEvidence =
      hasDurableServiceNowSortEvidence(summary);
    if (serviceNowListSort && sortComplete && !durableServiceNowSortEvidence) {
      return {
        blocked: true,
        reason:
          "ServiceNow list sort completion needs durable sort evidence such as sysparm_query, ORDERBY, aria-sort, or explicit sort state.",
      };
    }
    if (sortFailure || (sortInterim && !sortComplete)) {
      return {
        blocked: true,
        reason:
          "List sort task requires verified sort state before completion.",
      };
    }
  }

  const catalogActive = workflowSkillOrQueryMatches(
    skillId,
    "catalog-order-workflow",
    guardIntentText,
    /\b(service catalog|catalog item|request item|standard laptop|add to cart|order now|place order|submit order)\b/,
  );
  if (catalogActive) {
    const catalogInterim =
      /\b(opened|reached|loaded|visible|displayed|showing|viewing)\b[^.]{0,90}\b(product|catalog item|item detail|detail page|configuration|options|form)\b/.test(
        summary,
      ) ||
      /\b(product|catalog item|item detail|detail page|configuration|options|form)\b[^.]{0,90}\b(open|opened|visible|ready|loaded|displayed|shown)\b/.test(
        summary,
      );
    const catalogComplete =
      /\b(ordered|order submitted|order placed|order confirmed|request submitted|request placed|request confirmed|request number|cart|checkout|submitted|confirmation|thank you|req\d+|ritm\d+)\b/.test(
        summary,
      );
    const onRequestedItemDetail =
      /\brequested item\b/.test(currentPageText) ||
      /\bsc_req_item\.do\b/.test(currentPageText);
    if (catalogComplete && onRequestedItemDetail) {
      return {
        blocked: true,
        reason:
          "Catalog order completion should remain on the request/order confirmation page, not a requested-item detail page.",
      };
    }
    const quantityConflict = detectCatalogQuantityConflict(
      summary,
      extractCatalogRequestedQuantity(queryText),
    );
    if (quantityConflict) {
      return {
        blocked: true,
        reason: quantityConflict,
      };
    }
    if (catalogInterim && !catalogComplete) {
      return {
        blocked: true,
        reason:
          "Catalog order task requires submitted request, cart, or confirmation evidence before completion.",
      };
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Detect when the LLM's text output contains an admission of success or failure.
 * Returns null if the text is normal reasoning without an admission.
 */
export function detectAdmission(text: string): AdmissionResult | null {
  for (const pattern of SUCCESS_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return { type: "success", match: match[0] };
    }
  }
  for (const pattern of FAILURE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return { type: "failure", match: match[0] };
    }
  }
  return null;
}
