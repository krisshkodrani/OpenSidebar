import type { VerificationGate } from "../orchestrator/types";

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
    const urlContainsMatch = gate.trigger.match(
      /url\s+contains?\s+(\S+)/i,
    );
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
  const corpusWithUrl = currentUrl
    ? corpus + "\nURL: " + currentUrl
    : corpus;
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
