import type { VerificationGate } from "../orchestrator/types";
import { tokenizeStepText } from "./loop-helpers";

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
  /unable\s+to/i,
  /(?:fail|error|issue|problem)\s+(?:with|in|during|while)/i,
];

/** Strong success signals that override failure patterns (reduces false positives). */
const DONE_SUCCESS_OVERRIDES: RegExp[] = [
  /successfully\s+(added|completed|submitted|applied|removed|updated|placed)/i,
  /\b(done|finished|completed)\s+(the|this)\s+step/i,
  /\bis\s+(now|already)\s+(in|on|at|applied|selected|checked|submitted)/i,
  /\bhas\s+been\s+(added|applied|selected|submitted|completed|updated)/i,
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
