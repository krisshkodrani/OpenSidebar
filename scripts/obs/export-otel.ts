/**
 * Backfill the span spine to Bluebox as OTLP (observability unification).
 * Live runs export automatically via the log-server hook; this CLI replays
 * HISTORICAL sessions from `traces/spans/` — e.g. after enabling Bluebox, or
 * to re-ship a specific run for an investigation.
 *
 * Ids are deterministic (same session ⇒ same trace/span ids as the live
 * path), so a re-export re-sends the SAME spans rather than minting
 * duplicates with new identities — still, avoid re-running over ranges the
 * live hook already shipped.
 *
 * INGEST WINDOW (verified empirically 2026-07-16): Dynatrace accepts the
 * OTLP request but silently DROPS spans whose timestamps are too old (a
 * day-old session exported cleanly yet never appeared; a current-time span
 * through the same path arrived). Backfill is therefore only useful for
 * recent sessions; the CLI warns per session older than an hour.
 *
 * Usage:
 *   pnpm run obs:export-otel -- [--session <id>] [--run <id>]
 *     [--from <iso|ms>] [--to <iso|ms>] [--outcome completed]
 *     [--limit 20] [--dry-run]
 */

import {
  emitObsSpans,
  emitSessionRoots,
  flushSpineOtelExport,
  initSpineOtelExport,
  type SpineSessionRecord,
} from "./otel-emit";
import { readSessionSpans, readSpineSessions } from "./span-store";

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function toMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && value.trim() !== "") return asNumber;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function sessionStart(session: SpineSessionRecord): number {
  return typeof session.startTime === "number" ? session.startTime : 0;
}

export function selectSessions(
  sessions: SpineSessionRecord[],
  opts: {
    session?: string;
    run?: string;
    from?: number;
    to?: number;
    outcome?: string;
    limit: number;
  },
): SpineSessionRecord[] {
  return sessions
    .filter((s) => !opts.session || s.sessionId === opts.session)
    .filter((s) => !opts.run || s.runId === opts.run)
    .filter((s) => !opts.outcome || s.outcome === opts.outcome)
    .filter((s) => opts.from === undefined || sessionStart(s) >= opts.from)
    .filter((s) => opts.to === undefined || sessionStart(s) <= opts.to)
    .sort((a, b) => sessionStart(b) - sessionStart(a))
    .slice(0, opts.limit);
}

async function main(): Promise<void> {
  const dryRun = has("--dry-run");
  const selected = selectSessions(readSpineSessions(), {
    session: flag("--session"),
    run: flag("--run"),
    from: toMs(flag("--from")),
    to: toMs(flag("--to")),
    outcome: flag("--outcome"),
    limit: Number(flag("--limit") ?? "20"),
  });

  if (selected.length === 0) {
    console.log("[obs] no spine sessions match the given filters");
    return;
  }

  let spanCount = 0;
  if (dryRun) {
    for (const session of selected) {
      const spans = readSessionSpans(String(session.sessionId));
      // Roots: agent.session (+ orchestrator.run when the session has a runId).
      spanCount += spans.length + (session.runId ? 2 : 1);
    }
    console.log(
      `[obs] dry-run: would export ${spanCount} spans from ${selected.length} session(s)`,
    );
    return;
  }

  if (!(await initSpineOtelExport())) {
    console.error(
      "[obs] Bluebox export not configured — set OTEL_EXPORTER_OTLP_ENDPOINT " +
        "(or create .env.otel from .env.otel.bluebox-template; see docs/guides/bluebox-otel.md)",
    );
    process.exit(1);
  }

  const staleCutoff = Date.now() - 60 * 60 * 1000;
  for (const session of selected) {
    const sessionId = String(session.sessionId);
    const spans = readSessionSpans(sessionId);
    emitSessionRoots(session);
    emitObsSpans(spans);
    spanCount += spans.length + (session.runId ? 2 : 1);
    const stale = sessionStart(session) < staleCutoff;
    console.log(
      `[obs] queued ${sessionId} (${spans.length} turn-level spans)` +
        (stale
          ? " — WARNING: session is >1h old; Dynatrace may silently drop spans outside its ingest window"
          : ""),
    );
  }
  await flushSpineOtelExport();
  console.log(
    `[obs] exported ${spanCount} spans from ${selected.length} session(s) to Bluebox`,
  );
}

// Auto-run only when executed directly (keeps selectSessions unit-testable).
if (process.argv[1] && /export-otel\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error("[obs] export-otel failed:", error);
    process.exit(1);
  });
}
