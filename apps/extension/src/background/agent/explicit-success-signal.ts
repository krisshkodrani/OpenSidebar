/**
 * Explicit success-signal detection (RFC LP-16 Phase 3 — loop.ts landmine
 * decomposition).
 *
 * When the active task/step asks to "verify the page shows '…'", the loop can
 * accept completion the moment that literal string appears in the page snapshot.
 * This module resolves the active success context (from the running plan step or
 * the original query) and tests a snapshot against it. Pure reads over plan
 * state, so it takes a narrow read-only host via the dispatch-host idiom.
 */

export interface ExplicitSuccessSignalHost {
  readonly planSubtasks: ReadonlyArray<{
    status: string;
    description?: string;
  }>;
  readonly planSteps: ReadonlyArray<{
    objective?: string;
    successCriteria?: string;
    verifyAfter?: { trigger?: string };
  }>;
  readonly originalQuery: string;
  readonly lastPlanIndex: number;
}

/** The active objective/criteria text that an explicit success signal is drawn from. */
export function getActiveExplicitSuccessContext(
  host: ExplicitSuccessSignalHost,
): string {
  const hasPlanContext =
    host.planSubtasks.length > 0 || host.planSteps.length > 0;
  if (!hasPlanContext) return host.originalQuery || "";

  const runningIdx = host.planSubtasks.findIndex(
    (subtask) => subtask.status === "running",
  );
  const stepIndex =
    runningIdx >= 0
      ? runningIdx
      : host.lastPlanIndex >= 0
        ? host.lastPlanIndex
        : -1;
  if (stepIndex < 0) return "";

  const currentStep = host.planSteps[stepIndex];
  const currentSubtask = host.planSubtasks[stepIndex];
  return [
    currentStep?.objective,
    currentStep?.successCriteria,
    currentStep?.verifyAfter?.trigger,
    currentSubtask?.description,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The explicit success string if the snapshot already shows it, else null. */
export function detectExplicitSuccessSignalInSnapshot(
  host: ExplicitSuccessSignalHost,
  snap: {
    title?: string;
    url?: string;
    pageContent?: string;
    visibleContent?: string;
  },
): string | null {
  const query = getActiveExplicitSuccessContext(host);
  const quotedMatch =
    query.match(/verify the page shows ['"]([^'"]+)['"]/i) ??
    query.match(/page shows ['"]([^'"]+)['"]/i);
  const signal = quotedMatch?.[1]?.trim();
  if (!signal) return null;

  const haystacks = [
    snap.title ?? "",
    snap.pageContent ?? "",
    snap.visibleContent ?? "",
    snap.url ?? "",
  ];

  return haystacks.some((text) => text.includes(signal)) ? signal : null;
}
