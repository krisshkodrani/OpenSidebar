/**
 * Entailment gate (RFC LP-15, Phase 10).
 *
 * A pure, zero-model pre-filter that runs BEFORE the judge. It matches the
 * claims a task must satisfy against the trusted corpus's known facts (by
 * lexical overlap of the claim against each fact's claimKey + text) and resolves
 * the ones a corpus fact already entails. Only the unresolved claims reach the
 * (paid, latency-bearing) judge model — so on the common path where the corpus
 * already knows the answer, the judge is never called.
 *
 * The gate is intentionally conservative: lexical overlap can confidently say
 * "a corpus fact supports this claim" (entailed) but cannot reliably detect
 * contradiction, so it only ever emits `entailed` or leaves a claim unresolved.
 * Contradiction / unsupported adjudication is the judge's job (it does the NLI).
 * Encrypted facts carry no lexical signal (their text is opaque ciphertext), so
 * they never entail a claim here and fall through to the judge.
 */

/** Judge/gate shared entailment vocabulary. The gate emits only the first two. */
export type EntailmentLabel = "entailed" | "contradicted" | "unsupported";

/** A corpus fact flattened for lexical matching (built by the runtime wire). */
export interface CorpusFactRef {
  /** The corpus entry's claimKey (semantic dedup key, e.g. `fact:full-name:h`). */
  claimKey: string;
  /** Human-readable fact text; empty string when the value is encrypted. */
  text: string;
  /** Ciphertext values carry no lexical signal — never entail here. */
  encrypted: boolean;
}

export interface ClaimEntailment {
  claim: string;
  /** The gate only ever concludes `entailed`; everything else is unresolved. */
  label: Extract<EntailmentLabel, "entailed">;
  matchedClaimKey: string;
  score: number;
}

export interface EntailmentGateResult {
  /** Claims a corpus fact lexically entails — resolved; the judge is skipped. */
  entailed: ClaimEntailment[];
  /** Claims with no supporting corpus fact — these must reach the judge. */
  unresolved: string[];
}

export interface EntailmentGateOptions {
  /**
   * Minimum fraction of a claim's significant tokens that must be covered by a
   * single corpus fact to count as entailed. Deliberately high — a false
   * "entailed" silently skips the judge, so we err toward sending to the judge.
   */
  minCoverage?: number;
  /** A claim must have at least this many significant tokens to be matchable. */
  minClaimTokens?: number;
}

const DEFAULT_MIN_COVERAGE = 0.6;
const DEFAULT_MIN_CLAIM_TOKENS = 2;

// Small, deterministic stopword set — enough to stop function words from
// inflating overlap without pulling in a full NLP dependency.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "being", "that", "this", "it", "as", "at",
  "by", "from", "should", "must", "has", "have", "had", "will", "your", "you",
  "user", "users", "value", "field", "page", "task",
]);

/** Lowercase, split on non-alphanumerics, drop stopwords + tokens < 3 chars. */
export function significantTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) tokens.add(raw);
  }
  return tokens;
}

/** Fraction of `claimTokens` present in `factTokens` (0 when the claim is empty). */
function coverage(claimTokens: Set<string>, factTokens: Set<string>): number {
  if (claimTokens.size === 0) return 0;
  let hit = 0;
  for (const token of claimTokens) {
    if (factTokens.has(token)) hit++;
  }
  return hit / claimTokens.size;
}

/**
 * Partition `claims` into those a corpus fact entails and those that must reach
 * the judge. Pure and deterministic — the runtime supplies the corpus facts.
 */
export function runEntailmentGate(
  claims: string[],
  facts: CorpusFactRef[],
  options: EntailmentGateOptions = {},
): EntailmentGateResult {
  const minCoverage = options.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const minClaimTokens = options.minClaimTokens ?? DEFAULT_MIN_CLAIM_TOKENS;

  // Pre-tokenize the facts once (skip encrypted — opaque ciphertext).
  const factTokens = facts
    .filter((fact) => !fact.encrypted)
    .map((fact) => ({
      claimKey: fact.claimKey,
      tokens: significantTokens(`${fact.claimKey} ${fact.text}`),
    }));

  const entailed: ClaimEntailment[] = [];
  const unresolved: string[] = [];

  for (const claim of claims) {
    const claimTokens = significantTokens(claim);
    if (claimTokens.size < minClaimTokens) {
      unresolved.push(claim);
      continue;
    }
    let best: { claimKey: string; score: number } | null = null;
    for (const fact of factTokens) {
      const score = coverage(claimTokens, fact.tokens);
      if (score >= minCoverage && (!best || score > best.score)) {
        best = { claimKey: fact.claimKey, score };
      }
    }
    if (best) {
      entailed.push({
        claim,
        label: "entailed",
        matchedClaimKey: best.claimKey,
        score: best.score,
      });
    } else {
      unresolved.push(claim);
    }
  }

  return { entailed, unresolved };
}
