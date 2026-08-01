import React, { useMemo } from "react";
import type { TraceEntry, TraceSession } from "../../../../types/traces";
import { buildTraceEvidenceTimeline } from "../../../analysis";
import type {
  InvestigationSeverity,
  TraceEvidenceSignal,
} from "../../../analysis/types";
import { screenshotUrl } from "../../../api";
import { useStore } from "../../../store";
import { truncate } from "../../../utils";
import Badge from "../../Badge";

const MAX_EVIDENCE_TURNS = 5;

function screenshotSource(entry: TraceEntry): string | null {
  if (entry.perception?.screenshotStatus === "pruned") return null;
  const capture =
    entry.perception?.pageStateRef === "preDecision"
      ? entry.pageState?.preDecision
      : (entry.pageState?.postTool ?? entry.pageState?.preDecision);
  const viewport = capture?.screenshots?.find(
    (shot) => shot.kind === "viewport" && shot.dataUrl,
  );
  return (
    viewport?.dataUrl ??
    entry.perception?.screenshotDataUrl ??
    screenshotUrl(entry.sessionId, entry.turnNumber)
  );
}

function signalClass(severity: InvestigationSeverity): string {
  if (severity === "error") {
    return "border-state-error/30 bg-state-error/10 text-state-error";
  }
  if (severity === "warning") {
    return "border-state-warning/30 bg-state-warning/10 text-state-warning";
  }
  return "border-trace-border bg-trace-bg text-trace-subtle";
}

interface EvidenceItem {
  entry: TraceEntry;
  signals: TraceEvidenceSignal[];
}

export function selectKeyEvidenceTurns(
  entries: TraceEntry[],
  signalsByTurn: Map<number, TraceEvidenceSignal[]>,
): EvidenceItem[] {
  if (entries.length === 0) return [];
  const selected = new Map<number, EvidenceItem>();
  const add = (entry: TraceEntry | undefined) => {
    if (!entry || selected.size >= MAX_EVIDENCE_TURNS) return;
    selected.set(entry.turnNumber, {
      entry,
      signals: signalsByTurn.get(entry.turnNumber) ?? [],
    });
  };
  const withSeverity = (severity: InvestigationSeverity) =>
    entries.filter((entry) =>
      (signalsByTurn.get(entry.turnNumber) ?? []).some(
        (signal) => signal.severity === severity,
      ),
    );

  for (const entry of withSeverity("error")) add(entry);
  for (const entry of withSeverity("warning")) add(entry);
  add(entries.at(-1));
  for (const entry of entries.filter(
    (candidate) => (candidate.toolExecutions ?? []).length > 0,
  )) {
    add(entry);
  }
  add(entries[0]);

  return [...selected.values()].sort(
    (a, b) => a.entry.turnNumber - b.entry.turnNumber,
  );
}

function EvidenceCard({ item }: { item: EvidenceItem }) {
  const navigateToTurn = useStore((state) => state.navigateToTurn);
  const navigateToModelIO = useStore((state) => state.navigateToModelIO);
  const { entry, signals } = item;
  const screenshot = screenshotSource(entry);
  const displayState =
    entry.pageState?.postTool ?? entry.pageState?.preDecision ?? entry.snapshot;
  const tools = entry.toolExecutions ?? [];
  const outcomeExcerpts = tools
    .filter((tool) => tool.error || tool.result)
    .slice(0, 2);

  return (
    <article className="overflow-hidden rounded-lg border border-trace-border bg-trace-panel">
      <div className="flex items-center gap-2 border-b border-trace-border px-3 py-2">
        <button
          type="button"
          onClick={() => navigateToTurn(entry.turnNumber)}
          className="text-xs font-semibold text-trace-accent-light hover:underline"
        >
          Turn {entry.turnNumber}
        </button>
        <button
          type="button"
          onClick={() => navigateToModelIO(entry.turnNumber, "response")}
          className="text-[10px] text-trace-muted hover:text-trace-accent-light hover:underline"
        >
          Model I/O
        </button>
        {signals.slice(0, 2).map((signal) => (
          <span
            key={signal.id}
            className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${signalClass(signal.severity)}`}
            title={signal.detail || signal.label}
          >
            {signal.label}
          </span>
        ))}
        {signals.length > 2 && (
          <span className="text-[9px] text-trace-muted">
            +{signals.length - 2}
          </span>
        )}
        <span className="ml-auto text-[9px] text-trace-muted">
          {tools.length} tool result
          {tools.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        data-evidence-grid
        className={`grid ${
          screenshot
            ? "min-h-[150px] md:grid-cols-[minmax(220px,0.9fr)_minmax(260px,1.1fr)]"
            : "grid-cols-1"
        }`}
      >
        {screenshot && (
          <div
            data-screenshot-panel
            className="flex min-h-[150px] items-center justify-center border-b border-trace-border bg-black/20 md:border-b-0 md:border-r"
          >
            <div className="flex h-full w-full items-center justify-center">
              <img
                src={screenshot}
                alt={`Page evidence from turn ${entry.turnNumber}`}
                className="max-h-[230px] w-full bg-trace-bg object-contain"
                loading="lazy"
                onError={(event) => {
                  const panel = event.currentTarget.closest<HTMLElement>(
                    "[data-screenshot-panel]",
                  );
                  const grid = event.currentTarget.closest<HTMLElement>(
                    "[data-evidence-grid]",
                  );
                  if (panel) panel.style.display = "none";
                  if (grid) grid.style.gridTemplateColumns = "minmax(0, 1fr)";
                }}
              />
            </div>
          </div>
        )}

        <div className="min-w-0 space-y-3 p-3">
          <div>
            <div className="truncate text-xs font-medium text-trace-text">
              {displayState?.title || "Untitled page"}
            </div>
            <div
              className="mt-0.5 break-all font-mono text-[10px] text-trace-muted"
              title={displayState?.url}
            >
              {truncate(displayState?.url || "No URL captured", 110)}
            </div>
          </div>

          {tools.length > 0 && (
            <div>
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
                Exact tool outcomes
              </div>
              <div className="flex flex-wrap gap-1">
                {tools.slice(0, 6).map((tool, index) => (
                  <Badge
                    key={tool.toolCallId || `${tool.toolName}-${index}`}
                    variant={tool.success ? "completed" : "error"}
                  >
                    {tool.toolName}: {tool.success ? "ok" : "failed"}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {outcomeExcerpts.map((tool, index) => (
            <div
              key={tool.toolCallId || `${tool.toolName}-outcome-${index}`}
              className={`rounded border px-2 py-1.5 font-mono text-[10px] ${
                tool.success
                  ? "border-state-success/20 bg-state-success/5 text-trace-subtle"
                  : "border-state-error/25 bg-state-error/5 text-state-error"
              }`}
            >
              <span className="font-semibold">{tool.toolName}: </span>
              {truncate(tool.error || tool.result || "(empty result)", 180)}
            </div>
          ))}

          {signals.length > 0 && (
            <div className="space-y-1">
              {signals.slice(0, 3).map((signal) => (
                <div key={signal.id} className="text-[10px] text-trace-subtle">
                  <span className="font-medium">{signal.label}</span>
                  {signal.detail ? ` — ${truncate(signal.detail, 150)}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function EvidenceBoard({ session }: { session: TraceSession }) {
  const entries = useStore((state) => state.currentEntries);
  const runEvents = useStore((state) => state.currentRunEvents);
  const evidence = useMemo(
    () => buildTraceEvidenceTimeline({ session, entries, runEvents }),
    [entries, runEvents, session],
  );
  const items = useMemo(() => {
    const signalsByTurn = new Map(
      evidence.map((turn) => [turn.turnNumber, turn.signals]),
    );
    return selectKeyEvidenceTurns(entries, signalsByTurn);
  }, [entries, evidence]);
  const toolCount = entries.reduce(
    (count, entry) => count + (entry.toolExecutions ?? []).length,
    0,
  );
  const failureCount = entries.reduce(
    (count, entry) =>
      count +
      (entry.toolExecutions ?? []).filter((tool) => !tool.success).length,
    0,
  );

  if (entries.length === 0) return null;

  return (
    <section data-testid="evidence-board" className="space-y-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <div className="text-xs font-semibold text-trace-text">
            Key evidence
          </div>
          <div className="text-[10px] text-trace-muted">
            Screenshots, source pages, and exact tool outcomes before analysis.
          </div>
        </div>
        <div className="ml-auto flex gap-1.5 text-[9px] text-trace-muted">
          <span className="rounded border border-trace-border px-1.5 py-0.5">
            {items.length}/{entries.length} turns shown
          </span>
          <span className="rounded border border-trace-border px-1.5 py-0.5">
            {toolCount} tool results
          </span>
          {failureCount > 0 && (
            <span className="rounded border border-state-error/30 bg-state-error/10 px-1.5 py-0.5 text-state-error">
              {failureCount} failed
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-2.5 xl:grid-cols-2">
        {items.map((item) => (
          <EvidenceCard key={item.entry.turnNumber} item={item} />
        ))}
      </div>
    </section>
  );
}
