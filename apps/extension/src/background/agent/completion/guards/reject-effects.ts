/**
 * Shared reject-effect builders (RFC LP-15, Phase 7a).
 *
 * Centralizes the two recurring effect shapes the legacy reject methods emit so
 * each guard stays a thin, faithful mirror:
 *   - a plain counter-bumping reject (bump → escalation check → trace → message);
 *   - the same, but with the per-guard "did THIS rejection hit the hard cap?"
 *     branch that swaps in the `done_blocked_max_rejections` trace + message.
 */

import type { CompletionEffect } from "../pipeline-types";

/**
 * The counter-bumping reject shape shared by guards that do NOT embed the
 * max-rejections branch (summary/autocomplete/missing-evidence/workflow/…):
 * `doneRejections++` → `checkAndSetDoneRejectionEscalation()` → trace → message.
 */
export function countingRejectEffects(params: {
  traceEvent: string;
  traceData: Record<string, unknown>;
  summary: string;
  primaryReason: string;
  fallbackInstruction: string;
}): CompletionEffect[] {
  return [
    { type: "increment_done_rejections" },
    { type: "check_done_rejection_escalation" },
    { type: "emit_trace", event: params.traceEvent, data: params.traceData },
    {
      type: "post_rejection_diagnostic",
      summary: params.summary,
      primaryReason: params.primaryReason,
      fallbackInstruction: params.fallbackInstruction,
    },
  ];
}

/**
 * The counter-bumping reject shape for guards that DO embed the max-rejections
 * branch (task-contract, money-table, …). After the bump, if
 * `doneRejections + 1 >= maxDoneRejections` the guard emits the
 * `done_blocked_max_rejections` trace and the "stop calling done()" fallback;
 * otherwise the normal fallback. `source` labels the blocked trace.
 */
export function countingRejectEffectsWithMaxGate(params: {
  doneRejections: number;
  maxDoneRejections: number;
  source: string;
  traceEvent: string;
  traceData: Record<string, unknown>;
  blockedTraceData?: Record<string, unknown>;
  summary: string;
  primaryReason: string;
  normalFallbackInstruction: string;
  maxFallbackInstruction: string;
}): CompletionEffect[] {
  const effects: CompletionEffect[] = [
    { type: "increment_done_rejections" },
    { type: "check_done_rejection_escalation" },
    { type: "emit_trace", event: params.traceEvent, data: params.traceData },
  ];
  const hitsMax = params.doneRejections + 1 >= params.maxDoneRejections;
  if (hitsMax) {
    effects.push({
      type: "emit_trace",
      event: "done_blocked_max_rejections",
      data: { source: params.source, ...(params.blockedTraceData ?? {}) },
    });
    effects.push({
      type: "post_rejection_diagnostic",
      summary: params.summary,
      primaryReason: params.primaryReason,
      fallbackInstruction: params.maxFallbackInstruction,
    });
  } else {
    effects.push({
      type: "post_rejection_diagnostic",
      summary: params.summary,
      primaryReason: params.primaryReason,
      fallbackInstruction: params.normalFallbackInstruction,
    });
  }
  return effects;
}
