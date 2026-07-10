export const TRACE_SCHEMA_VERSION = "2026-02-19" as const;

export interface TraceEntryLike extends Record<string, unknown> {
  llmRequest?: {
    model?: string;
    modelTier?: "executor" | "planner";
    provider?: string;
  };
}

export interface TraceSessionLike extends Record<string, unknown> {
  startTime?: number;
  startUrl?: string;
  outcome?: string;
  sessionId?: string;
  query?: string;
  runId?: string;
  models?: string[];
  metrics?: {
    modelBreakdown?: Record<string, unknown>;
  } | null;
  _entries?: TraceEntryLike[];
}

export interface TraceSearchFiltersLike {
  day?: string | null;
  from?: string | null;
  to?: string | null;
  domain?: string;
  outcome?: string;
  sessionPrefix?: string;
  mode?: string;
  model?: string;
  q?: string;
  runId?: string;
  tier?: string;
}

export interface TraceSearchResultLike extends TraceSessionLike {
  day: string | null;
  domain: string | null;
}

export function toRecordedAt(value: unknown, fallbackMs?: number): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof fallbackMs === "number" && Number.isFinite(fallbackMs)) {
    return new Date(fallbackMs).toISOString();
  }
  return new Date().toISOString();
}

export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isIsoDay(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function extractDomain(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    const host = new URL(rawUrl).hostname || "";
    return host.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function normalizeTraceModelId(model: string): string {
  return model
    .trim()
    .replace(/^accounts\/[^/]+\/routers\//, "")
    .replace(/:nitro$/, "");
}

export function getSessionModels(
  session: Pick<TraceSessionLike, "models" | "metrics">,
): string[] {
  const storedModels = Array.isArray(session.models)
    ? session.models.filter(
        (model): model is string => typeof model === "string" && model.length > 0,
      )
    : [];
  const breakdownModels =
    session.metrics?.modelBreakdown &&
    typeof session.metrics.modelBreakdown === "object"
      ? Object.keys(session.metrics.modelBreakdown)
      : [];
  return Array.from(
    new Set(
      [...storedModels, ...breakdownModels]
        .map(normalizeTraceModelId)
        .filter((model) => model.length > 0),
    ),
  );
}

export function normalizeAgentTurnRecord(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const runId =
    typeof entry.runId === "string" && entry.runId.length > 0
      ? entry.runId
      : undefined;
  const sessionId =
    typeof entry.sessionId === "string" && entry.sessionId.length > 0
      ? entry.sessionId
      : undefined;
  const correlationId =
    typeof entry.correlationId === "string" && entry.correlationId.length > 0
      ? entry.correlationId
      : runId ?? sessionId;

  return {
    schemaVersion: entry.schemaVersion ?? TRACE_SCHEMA_VERSION,
    traceKind: entry.traceKind ?? "agent.turn",
    recordedAt: toRecordedAt(entry.recordedAt, entry.timestamp as number | undefined),
    producer: entry.producer ?? "background.agent.trace-recorder",
    ...(runId ? { runId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(typeof entry.parentRunId === "string" && entry.parentRunId.length > 0
      ? { parentRunId: entry.parentRunId }
      : runId
        ? { parentRunId: runId }
        : {}),
    ...entry,
  };
}

export function normalizeAgentSessionRecord(
  session: Record<string, unknown>,
): TraceSessionLike {
  const runId =
    typeof session.runId === "string" && session.runId.length > 0
      ? session.runId
      : undefined;
  const sessionId =
    typeof session.sessionId === "string" && session.sessionId.length > 0
      ? session.sessionId
      : undefined;
  const correlationId =
    typeof session.correlationId === "string" && session.correlationId.length > 0
      ? session.correlationId
      : runId ?? sessionId;
  const models = getSessionModels(session as TraceSessionLike);

  return {
    schemaVersion: session.schemaVersion ?? TRACE_SCHEMA_VERSION,
    traceKind: session.traceKind ?? "agent.session",
    recordedAt: toRecordedAt(
      session.recordedAt,
      (session.endTime as number | undefined) ??
        (session.startTime as number | undefined),
    ),
    producer: session.producer ?? "background.agent.trace-recorder",
    ...(runId ? { runId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(typeof session.parentRunId === "string" && session.parentRunId.length > 0
      ? { parentRunId: session.parentRunId }
      : runId
        ? { parentRunId: runId }
        : {}),
    ...session,
    ...(models.length > 0 ? { models } : {}),
  };
}

export function normalizeRunEventRecord(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const runId =
    typeof event.runId === "string" && event.runId.length > 0
      ? event.runId
      : undefined;

  return {
    schemaVersion: event.schemaVersion ?? TRACE_SCHEMA_VERSION,
    traceKind: event.traceKind ?? "orchestrator.run.event",
    recordedAt: toRecordedAt(event.recordedAt),
    producer: event.producer ?? "background.orchestrator.run-trace-writer",
    ...(runId ? { runId } : {}),
    ...(typeof event.correlationId === "string" && event.correlationId.length > 0
      ? { correlationId: event.correlationId }
      : runId
        ? { correlationId: runId }
        : {}),
    ...event,
  };
}

export function normalizeRunManifestRecord(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const runId =
    typeof manifest.runId === "string" && manifest.runId.length > 0
      ? manifest.runId
      : undefined;

  return {
    schemaVersion: manifest.schemaVersion ?? TRACE_SCHEMA_VERSION,
    traceKind: manifest.traceKind ?? "orchestrator.run.manifest",
    recordedAt: toRecordedAt(manifest.recordedAt),
    producer: manifest.producer ?? "background.orchestrator.run-trace-writer",
    ...(runId ? { runId } : {}),
    ...(typeof manifest.correlationId === "string" &&
    manifest.correlationId.length > 0
      ? { correlationId: manifest.correlationId }
      : runId
        ? { correlationId: runId }
        : {}),
    ...manifest,
  };
}

export function hasModelTier(
  session: TraceSessionLike,
  tier: string,
  entries?: TraceEntryLike[],
): boolean {
  if (!tier || tier === "all") return true;
  const sourceEntries = Array.isArray(entries)
    ? entries
    : Array.isArray(session._entries)
      ? session._entries
      : [];
  return sourceEntries.some((entry) => entry?.llmRequest?.modelTier === tier);
}

export function matchesTraceFilters(
  session: TraceSessionLike,
  filters: TraceSearchFiltersLike,
  entries?: TraceEntryLike[],
): boolean {
  const startTime =
    typeof session.startTime === "number" ? session.startTime : null;
  const domainValue = extractDomain(session.startUrl);
  const dayValue = startTime != null ? localDayKey(startTime) : null;
  const sessionId =
    typeof session.sessionId === "string" ? session.sessionId : "";
  const query = typeof session.query === "string" ? session.query.toLowerCase() : "";
  const startUrl =
    typeof session.startUrl === "string" ? session.startUrl.toLowerCase() : "";
  const outcomeValue =
    typeof session.outcome === "string" ? session.outcome : "";
  const domain = (filters.domain || "").toLowerCase().trim();
  const q = (filters.q || "").toLowerCase().trim();
  const model = normalizeTraceModelId((filters.model || "").trim());
  const mode = (filters.mode || "").trim();
  const runId = (filters.runId || "").trim();
  const tier = (filters.tier || "").trim();
  const outcome = (filters.outcome || "").trim();
  const sessionPrefix = (filters.sessionPrefix || "").trim();

  if (filters.day && filters.day !== "all" && dayValue !== filters.day) return false;
  if (isIsoDay(filters.from ?? null) && (!dayValue || dayValue < filters.from)) {
    return false;
  }
  if (isIsoDay(filters.to ?? null) && (!dayValue || dayValue > filters.to)) {
    return false;
  }
  if (domain) {
    if (!domainValue) return false;
    if (!domainValue.includes(domain)) return false;
  }
  if (outcome && outcome !== "all" && outcomeValue !== outcome) return false;
  if (sessionPrefix && !sessionId.startsWith(sessionPrefix)) return false;
  if (mode && mode !== "all") {
    const models = getSessionModels(session);
    const hasRecording = models.includes("recording");
    const hasManual = models.includes("manual");
    if (mode === "recording" && !hasRecording) return false;
    if (mode === "manual" && !hasManual) return false;
    if (mode === "agent" && (hasRecording || hasManual)) return false;
  }
  if (model && model !== "all" && !getSessionModels(session).includes(model)) {
    return false;
  }
  if (
    q &&
    !(query.includes(q) || startUrl.includes(q) || sessionId.includes(q.toLowerCase()))
  ) {
    return false;
  }
  if (runId && !String(session.runId || "").startsWith(runId)) return false;
  if (!hasModelTier(session, tier, entries)) return false;
  return true;
}

export function serializeTraceSearchSession(
  session: TraceSessionLike,
): TraceSearchResultLike {
  const { _entries, ...rest } = session;
  return {
    ...rest,
    day:
      typeof session.startTime === "number" ? localDayKey(session.startTime) : null,
    domain: extractDomain(session.startUrl),
  };
}

// ── Human adjudication annotations ──────────────────────────────
// A human's verdict on a run's outcome (does the run's computed outcome match
// what actually happened?). Persisted append-only to evals/annotations.jsonl;
// the latest annotation per run (keyed runId ?? sessionId) wins. These helpers
// are pure (no fs / no clock) so the route handler stays thin and testable.

export type AnnotationVerdict = "agree" | "disagree" | "unsure";

export interface RunAnnotationRecord extends Record<string, unknown> {
  id: string;
  sessionId: string;
  runId?: string;
  annotatedAt: string;
  annotator?: string;
  verdict: AnnotationVerdict;
  correctedOutcome?: string;
  note?: string;
  criteriaOverrides?: Array<{
    nodeId: string;
    criterionId: string;
    pass: boolean;
    note?: string;
  }>;
  computed?: Record<string, unknown>;
  exported?: Record<string, unknown>;
}

const ANNOTATION_VERDICTS = new Set<AnnotationVerdict>([
  "agree",
  "disagree",
  "unsure",
]);

/** The dedup key: a run when present, else the individual session. */
export function annotationKey(a: {
  runId?: string;
  sessionId?: string;
}): string {
  return a.runId && a.runId.length > 0 ? `run:${a.runId}` : `session:${a.sessionId}`;
}

/**
 * Validate + coerce an incoming annotation body. Returns the normalized record
 * (minus server-stamped id/annotatedAt) or a reason string. A `disagree`
 * verdict must supply the corrected outcome — that is the whole point of
 * disagreeing.
 */
export function normalizeAnnotationInput(
  body: unknown,
): { ok: true; value: Omit<RunAnnotationRecord, "id" | "annotatedAt"> } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Expected an annotation object" };
  }
  const b = body as Record<string, unknown>;
  const sessionId = typeof b.sessionId === "string" ? b.sessionId : "";
  if (!sessionId) return { ok: false, error: "sessionId is required" };
  const verdict = b.verdict;
  if (typeof verdict !== "string" || !ANNOTATION_VERDICTS.has(verdict as AnnotationVerdict)) {
    return { ok: false, error: "verdict must be agree | disagree | unsure" };
  }
  const correctedOutcome =
    typeof b.correctedOutcome === "string" ? b.correctedOutcome : undefined;
  if (verdict === "disagree" && !correctedOutcome) {
    return { ok: false, error: "correctedOutcome is required when verdict is disagree" };
  }
  const overrides = Array.isArray(b.criteriaOverrides)
    ? (b.criteriaOverrides as Array<Record<string, unknown>>)
        .map((o) => ({
          nodeId: String(o.nodeId ?? ""),
          criterionId: String(o.criterionId ?? ""),
          pass: o.pass === true,
          note: typeof o.note === "string" ? o.note : undefined,
        }))
        .filter((o) => o.nodeId && o.criterionId)
    : undefined;
  return {
    ok: true,
    value: {
      sessionId,
      runId: typeof b.runId === "string" && b.runId ? b.runId : undefined,
      annotator: typeof b.annotator === "string" ? b.annotator : undefined,
      verdict: verdict as AnnotationVerdict,
      correctedOutcome,
      note: typeof b.note === "string" ? b.note.slice(0, 2000) : undefined,
      criteriaOverrides: overrides,
      computed:
        b.computed && typeof b.computed === "object"
          ? (b.computed as Record<string, unknown>)
          : undefined,
      exported:
        b.exported && typeof b.exported === "object"
          ? (b.exported as Record<string, unknown>)
          : undefined,
    },
  };
}

/**
 * Collapse an append-only annotation log to the latest annotation per key.
 * Later records in the array win (the file is appended chronologically);
 * `annotatedAt` breaks ties when present.
 */
export function dedupeAnnotationsLatestWins(
  records: RunAnnotationRecord[],
): RunAnnotationRecord[] {
  const byKey = new Map<string, RunAnnotationRecord>();
  for (const rec of records) {
    const key = annotationKey(rec);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, rec);
      continue;
    }
    const prevAt = Date.parse(prev.annotatedAt) || 0;
    const curAt = Date.parse(rec.annotatedAt) || 0;
    // Later timestamp wins; equal/invalid timestamps → later array position wins.
    if (curAt >= prevAt) byKey.set(key, rec);
  }
  return [...byKey.values()];
}

/** Parse a JSONL annotation file body into records (skips blank/garbage lines). */
export function parseAnnotationsJsonl(text: string): RunAnnotationRecord[] {
  const out: RunAnnotationRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as RunAnnotationRecord;
      if (rec && typeof rec.sessionId === "string" && typeof rec.verdict === "string") {
        out.push(rec);
      }
    } catch {
      // tolerate a torn final line / hand-edits
    }
  }
  return out;
}
