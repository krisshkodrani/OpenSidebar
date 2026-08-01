/**
 * Span spine store (RFC LP-7, Stage B1). The spine is the canonical-capable
 * single source of truth: per turn it persists a FULL-FIDELITY record —
 * `{ v, entry, spans }` — under `traces/spans/<sessionId>/T<turn>.json`, plus a
 * content-addressed blob store under `traces/obs/blobs/<sha256>` for heavy
 * payloads referenced by the spans.
 *
 * Crucially the record stores the complete `TraceEntry` (a strict superset of
 * what the JSONL store holds), so JSONL and the SQLite index are both DERIVABLE
 * from the spine — that is what makes it a single source of truth rather than a
 * lossy projection. The OTel `spans` are the analytics/interop view derived from
 * the same entry.
 *
 * Per-turn files are OVERWRITTEN, so writes are idempotent — safe to replay
 * (backfill) and safe to call repeatedly from the live ingest path. This is the
 * additive dual-write + dual-read-parity phase of the cutover; retiring the old
 * store (repointing every read endpoint) is the subsequent supervised phase.
 */

import { createHash } from "crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";

import { traceEntryToSpans } from "../../packages/observability-schema/src/map-trace-entry";
import type { ObsSpan } from "../../packages/observability-schema/src/spans";
import type { TraceEntry } from "../../apps/extension/src/types/traces";
import { PROJECT_ROOT } from "./paths";

export const SPAN_DIR = join(PROJECT_ROOT, "traces", "spans");
export const BLOB_DIR = join(PROJECT_ROOT, "traces", "obs", "blobs");
export const RUN_DIR = join(SPAN_DIR, "runs");

/** One turn's full-fidelity spine record: canonical entry + derived spans. */
export interface SpineRecord {
  v: 1;
  entry: TraceEntry;
  spans: ObsSpan[];
}

/** Content-addressed blob write. Returns `sha256:<hex>`; dedups by content. */
export function putBlob(content: Buffer, blobDir: string = BLOB_DIR): string {
  const hash = createHash("sha256").update(content).digest("hex");
  mkdirSync(blobDir, { recursive: true });
  const path = join(blobDir, hash);
  if (!existsSync(path)) writeFileSync(path, content);
  return `sha256:${hash}`;
}

function turnOf(filename: string): number {
  const match = filename.match(/^T(\d+)\.json$/);
  return match ? Number(match[1]) : 0;
}

/**
 * Project one turn and write its full-fidelity spine record, externalizing an
 * inline screenshot to CAS when present (true for backfilled/older records; the
 * live ingest strips the data URL before this runs, having already saved the
 * file). The stored entry is NOT mutated, so it stays byte-equal to the JSONL
 * store. The per-turn file is overwritten, making this idempotent.
 */
export function writeEntryRecord(
  entry: TraceEntry,
  spanDir: string = SPAN_DIR,
  blobDir: string = BLOB_DIR,
): SpineRecord {
  const spans = traceEntryToSpans(entry);

  const dataUrl = entry.perception?.screenshotDataUrl;
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
    const base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
    const ref = putBlob(Buffer.from(base64, "base64"), blobDir);
    for (const span of spans) {
      for (const blob of span.blobs ?? []) {
        if (blob.kind === "screenshot") blob.ref = ref;
      }
    }
  }

  const record: SpineRecord = { v: 1, entry, spans };
  const dir = join(spanDir, entry.sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `T${entry.turnNumber}.json`), JSON.stringify(record));
  return record;
}

/** Read all full-fidelity records for a session from the spine, ordered by turn. */
export function readSessionRecords(
  sessionId: string,
  spanDir: string = SPAN_DIR,
): SpineRecord[] {
  const dir = join(spanDir, sessionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^T\d+\.json$/.test(file))
    .sort((a, b) => turnOf(a) - turnOf(b))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf-8")) as SpineRecord);
}

/** Derive the spans for a session from the spine. */
export function readSessionSpans(
  sessionId: string,
  spanDir: string = SPAN_DIR,
): ObsSpan[] {
  return readSessionRecords(sessionId, spanDir).flatMap((record) => record.spans);
}

/** Derive the canonical entries for a session from the spine (JSONL-equivalent). */
export function readSessionEntries(
  sessionId: string,
  spanDir: string = SPAN_DIR,
): TraceEntry[] {
  return readSessionRecords(sessionId, spanDir).map((record) => record.entry);
}

/**
 * Guarded dual-write for the ingest path — must never throw into the caller.
 * Returns the written record so the caller can forward the derived spans
 * (e.g. to the Bluebox OTLP emitter) without re-projecting; null on failure.
 */
export function recordEntrySpansSafe(entry: unknown): SpineRecord | null {
  try {
    return writeEntryRecord(entry as TraceEntry);
  } catch (error) {
    console.error("[obs] span dual-write failed:", (error as Error).message);
    return null;
  }
}

// ---- Session + run-event lenses of the spine --------------------------------
// The spine also persists the session index and orchestrator run events so all
// three read lenses (entries / sessions / run events) can be served from it.

type Loose = Record<string, unknown>;

/** Persist a session record to the spine (overwrite — idempotent). */
export function writeSessionRecord(session: Loose, spanDir: string = SPAN_DIR): void {
  const sessionId =
    typeof session.sessionId === "string" ? session.sessionId : "";
  if (!sessionId) return;
  const dir = join(spanDir, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), JSON.stringify(session));
}

/** Read all session records from the spine. */
export function readSpineSessions(spanDir: string = SPAN_DIR): Loose[] {
  if (!existsSync(spanDir)) return [];
  const sessions: Loose[] = [];
  for (const name of readdirSync(spanDir)) {
    if (name === "runs") continue;
    const file = join(spanDir, name, "session.json");
    if (!existsSync(file)) continue;
    try {
      sessions.push(JSON.parse(readFileSync(file, "utf-8")) as Loose);
    } catch {
      /* skip unreadable */
    }
  }
  return sessions;
}

export function recordSessionSafe(session: unknown): void {
  try {
    writeSessionRecord(session as Loose);
  } catch (error) {
    console.error("[obs] session spine-write failed:", (error as Error).message);
  }
}

function runFile(runId: string, runDir: string): string {
  return join(runDir, `${runId}.jsonl`);
}

/** Append one run event to the spine (live ingest). */
export function appendRunEvent(event: Loose, runDir: string = RUN_DIR): void {
  const runId = typeof event.runId === "string" ? event.runId : "";
  if (!runId) return;
  mkdirSync(runDir, { recursive: true });
  appendFileSync(runFile(runId, runDir), `${JSON.stringify(event)}\n`);
}

/** Overwrite all run events for a run (idempotent backfill). */
export function writeRunEvents(
  runId: string,
  events: Loose[],
  runDir: string = RUN_DIR,
): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    runFile(runId, runDir),
    events.length > 0
      ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
      : "",
  );
}

/** Read a run's events from the spine. */
export function readSpineRunEvents(runId: string, runDir: string = RUN_DIR): Loose[] {
  const file = runFile(runId, runDir);
  if (!existsSync(file)) return [];
  const events: Loose[] = [];
  for (const line of readFileSync(file, "utf-8").trim().split("\n")) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as Loose);
    } catch {
      /* skip */
    }
  }
  return events;
}

export function recordRunEventSafe(event: unknown): void {
  try {
    appendRunEvent(event as Loose);
  } catch (error) {
    console.error("[obs] run-event spine-write failed:", (error as Error).message);
  }
}
