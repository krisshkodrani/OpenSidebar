/**
 * Per-task safety profile for unattended live-web benchmark runs (RFC LP-1).
 *
 * Implements the RFC's live-web rails:
 *  - navigation is scoped to the task's site (host + its registrable domain),
 *  - payment/checkout submission is refused,
 *  - tasks whose instruction implies mutating third-party state (purchase,
 *    booking, posting, account changes) are SKIPPED and counted as skipped,
 *    not failed.
 *
 * Pure and deterministic so the policy is unit-testable. No product imports.
 */

import type {
  BenchRefusedToolClass,
  BenchSafetyProfile,
  BenchTask,
} from "./types";

const REFUSED_TOOL_CLASSES: BenchRefusedToolClass[] = [
  "payment",
  "checkout",
  "account_mutation",
];

/**
 * Phrases that indicate a task would mutate third-party state beyond a
 * benchmark's read/navigate protocol. Conservative by design: when in doubt,
 * skip rather than perform a real-world side effect on a live site.
 */
const WRITE_MUTATION_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(buy|purchase|check\s?out|place (an? )?order|add to (cart|bag|basket))\b/i, reason: "purchase/checkout" },
  { re: /\b(book|reserve|rent|order)\b.*\b(flight|hotel|room|car|table|ticket|appointment|ride)\b/i, reason: "booking/reservation" },
  { re: /\b(pay|payment|donate|subscribe|checkout|complete (the )?payment)\b/i, reason: "payment" },
  { re: /\b(sign ?up|register|create (an? )?account|log ?in|sign ?in)\b/i, reason: "account creation/login" },
  { re: /\b(post|publish|comment|review|rate|upload|tweet|reply|send (a )?message|submit (a )?(form|application|request))\b/i, reason: "content posting/submission" },
  { re: /\b(delete|remove|cancel|unsubscribe|update (my )?(profile|settings|password))\b/i, reason: "account mutation" },
  { re: /\b(apply (for|to)|enroll|join)\b/i, reason: "application/enrollment" },
];

/** Extract the hostname from a URL, or null if it cannot be parsed. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Best-effort registrable domain (eTLD+1) for a hostname. This is a heuristic
 * that covers common single- and two-label public suffixes (co.uk, com.au,
 * etc.) without bundling the full public-suffix list. The allowlist is a rail,
 * not a security boundary — a slightly broad match is acceptable; a too-narrow
 * one would break legitimate same-site subdomain navigation.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  const labels = host.split(".");
  if (labels.length <= 2) return host;

  const twoLabelSuffixes = new Set([
    "co.uk", "org.uk", "gov.uk", "ac.uk", "co.jp", "co.kr", "co.in",
    "com.au", "net.au", "org.au", "com.br", "com.cn", "com.mx", "com.tr",
    "co.nz", "co.za", "com.sg", "com.hk",
  ]);
  const lastTwo = labels.slice(-2).join(".");
  if (twoLabelSuffixes.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

/** Detect whether a task instruction implies mutating live third-party state. */
export function detectWriteMutation(instruction: string): string | null {
  for (const { re, reason } of WRITE_MUTATION_PATTERNS) {
    if (re.test(instruction)) return reason;
  }
  return null;
}

export interface SafetyProfileOptions {
  /**
   * When true, write-mutating tasks are skipped (default). Set false only for
   * a sandbox/benchmark whose protocol explicitly sanctions the mutation.
   */
  skipWriteMutations?: boolean;
  /** Extra hostnames to allow (e.g. a known auth/CDN host for the task site). */
  extraAllowedHosts?: string[];
}

/** Build the safety profile for a single task. */
export function buildSafetyProfile(
  task: BenchTask,
  options: SafetyProfileOptions = {},
): BenchSafetyProfile {
  const skipWriteMutations = options.skipWriteMutations ?? true;
  const host = hostnameOf(task.website);
  const allow = new Set<string>();
  if (host) {
    allow.add(host);
    allow.add(registrableDomain(host));
  }
  for (const extra of options.extraAllowedHosts ?? []) {
    const normalized = extra.trim().toLowerCase();
    if (normalized) allow.add(normalized);
  }

  const mutationReason = detectWriteMutation(task.confirmed_task);
  const skip = skipWriteMutations && mutationReason != null;

  return {
    domainAllowlist: [...allow].sort(),
    allowNavigation: true,
    refusedToolClasses: [...REFUSED_TOOL_CLASSES],
    skip,
    skipReason: skip ? `write-mutating task (${mutationReason})` : undefined,
  };
}
