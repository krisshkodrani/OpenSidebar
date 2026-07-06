/**
 * In-memory sink for completion decision records (RFC LP-15, Phase 0).
 *
 * Gated behind a dev flag so it costs nothing in production. The runtime pushes
 * records here from the single choke point (`AgentLoop.handleDoneToolCall`); an
 * e2e helper drains them to `tests/fixtures/completion-corpus/*.json`.
 *
 * chrome-free by construction: the flag is toggled by whoever reads storage
 * (background init / e2e harness), never by this module, so it stays trivially
 * testable and headless-safe.
 */

import type { CompletionDecisionRecord } from "./decision-record";

/** Dev flag key (chrome.storage.local) that enables recording. */
export const RECORD_COMPLETION_DECISIONS_STORAGE_KEY =
  "opensidebar:recordCompletionDecisions";

const buffer: CompletionDecisionRecord[] = [];
let enabled = false;

export function setCompletionDecisionRecordingEnabled(value: boolean): void {
  enabled = value;
}

export function isCompletionDecisionRecordingEnabled(): boolean {
  return enabled;
}

export function recordCompletionDecision(record: CompletionDecisionRecord): void {
  if (!enabled) return;
  buffer.push(record);
}

/** Non-destructive view, for assertions/inspection. */
export function peekCompletionDecisionRecords(): readonly CompletionDecisionRecord[] {
  return buffer;
}

/** Drain and clear — the e2e export path. */
export function drainCompletionDecisionRecords(): CompletionDecisionRecord[] {
  const out = buffer.slice();
  buffer.length = 0;
  return out;
}

export function clearCompletionDecisionRecords(): void {
  buffer.length = 0;
}
