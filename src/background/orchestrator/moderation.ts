export type ModerationSeverity = "low" | "medium" | "high";
export type ModerationCategory =
  | "violence"
  | "self_harm"
  | "illegal_activity"
  | "pii_exposure"
  | "sexual_content";

export interface ModerationDecision {
  allowed: boolean;
  category?: ModerationCategory;
  severity?: ModerationSeverity;
  reason?: string;
}

// --- Pattern lists per category ---

interface CategoryPattern {
  category: ModerationCategory;
  severity: ModerationSeverity;
  pattern: RegExp;
  strictOnly?: boolean;
}

const PATTERNS: CategoryPattern[] = [
  // Violence
  { category: "violence", severity: "high", pattern: /\b(how to (make|build|create) (a |an )?(bomb|explosive|weapon))\b/i },
  { category: "violence", severity: "high", pattern: /\b(kill|murder|assassinate) (someone|a person|people|him|her|them)\b/i },
  { category: "violence", severity: "medium", pattern: /\b(attack|hurt|harm) (someone|a person|people)\b/i, strictOnly: true },

  // Self-harm
  { category: "self_harm", severity: "high", pattern: /\b(how to (commit |)suicide)\b/i },
  { category: "self_harm", severity: "high", pattern: /\b(ways to (kill|harm|hurt) (myself|yourself|oneself))\b/i },
  { category: "self_harm", severity: "medium", pattern: /\b(self[- ]harm(ing)?|cut(ting)? myself)\b/i, strictOnly: true },

  // Illegal activity
  { category: "illegal_activity", severity: "high", pattern: /\b(how to (hack|break into|crack) (a |an )?(bank|account|system|password))\b/i },
  { category: "illegal_activity", severity: "high", pattern: /\b(synthesize|manufacture|cook) (meth|cocaine|heroin|drugs|fentanyl)\b/i },
  { category: "illegal_activity", severity: "medium", pattern: /\b(steal|shoplift|counterfeit)\b/i, strictOnly: true },

  // Sexual content
  { category: "sexual_content", severity: "high", pattern: /\b(child|minor|underage)\b.*\b(porn|sexual|nude|naked)\b/i },
  { category: "sexual_content", severity: "medium", pattern: /\b(generate|create|write) (explicit |)(porn|erotica|sexual content)\b/i, strictOnly: true },
];

// PII patterns — used for output moderation only
const PII_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, label: "SSN" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, label: "credit card" },
];

function checkPatterns(
  text: string,
  strictness: "standard" | "strict",
): ModerationDecision {
  for (const entry of PATTERNS) {
    if (entry.strictOnly && strictness !== "strict") continue;
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(text)) {
      return {
        allowed: false,
        category: entry.category,
        severity: entry.severity,
        reason: `Matched content policy: ${entry.category}`,
      };
    }
  }
  return { allowed: true };
}

function checkPII(text: string): ModerationDecision {
  for (const { pattern, label } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return {
        allowed: false,
        category: "pii_exposure",
        severity: "high",
        reason: `Potential ${label} detected in output`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Moderate user input before processing.
 * Deterministic regex-based check — zero latency, no LLM calls.
 */
export function moderateUserInput(
  text: string,
  strictness: "standard" | "strict" = "standard",
): ModerationDecision {
  if (!text || text.length === 0) return { allowed: true };
  return checkPatterns(text, strictness);
}

/**
 * Moderate final output before sending to user.
 * Checks content policy patterns + PII leakage (SSN, credit card).
 */
export function moderateFinalOutput(
  text: string,
  strictness: "standard" | "strict" = "standard",
): ModerationDecision {
  if (!text || text.length === 0) return { allowed: true };

  // Content policy check
  const contentResult = checkPatterns(text, strictness);
  if (!contentResult.allowed) return contentResult;

  // PII check (output only)
  return checkPII(text);
}
