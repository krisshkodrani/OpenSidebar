import React, { useEffect, useMemo, useState } from "react";
import type { TraceSession } from "../../../types/traces";
import {
  createTraceBugBrief,
  createTraceResearchSeed,
  fetchTraceDiagnosis,
  type TraceBugBriefResult,
  type TraceDiagnosis,
  type TraceDiagnosisSummary,
} from "../../api";
import { useStore } from "../../store";
import Badge from "../Badge";
import LoadingSpinner from "../LoadingSpinner";

interface DiagnosisPanelProps {
  session: TraceSession;
}

function outcomeVariant(
  outcome: string,
): "completed" | "stopped" | "error" | "max_turns" | "category" {
  if (outcome === "completed") return "completed";
  if (outcome === "stopped") return "stopped";
  if (outcome === "error") return "error";
  if (outcome === "max_turns") return "max_turns";
  return "category";
}

function formatCountList(
  items: Array<{ value: string; count: number }>,
  fallback: string,
): string {
  if (!items || items.length === 0) return fallback;
  return items
    .slice(0, 3)
    .map((item) => `${item.value} (${item.count})`)
    .join(", ");
}

function shortSummary(text: string, maxLen = 140): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLen
    ? `${normalized.slice(0, maxLen - 3)}...`
    : normalized;
}

function formatRecordedAt(value: string | null | undefined): string {
  if (!value) return "unknown";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function SimilarFailureRow({
  item,
  compareReady,
  onOpenSession,
  onCompareSession,
}: {
  item: TraceDiagnosisSummary;
  compareReady: boolean;
  onOpenSession: (sessionId: string) => void;
  onCompareSession: (sessionId: string) => void;
}) {
  return (
    <div className="rounded border border-trace-border/70 bg-black/10 px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-trace-text">
          {item.fixture || item.domain || item.session_id.slice(0, 8)}
        </span>
        <Badge variant={outcomeVariant(item.outcome)}>{item.outcome}</Badge>
        {item.failure_code && item.failure_code !== "none" && (
          <Badge variant="error">{item.failure_code}</Badge>
        )}
        <span className="ml-auto text-[10px] text-trace-dim">
          {item.turn_count} turns
        </span>
      </div>
      <div className="mt-1 text-[11px] text-trace-muted">
        {shortSummary(item.summary)}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onOpenSession(item.session_id)}
          className="text-[10px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
        >
          Open
        </button>
        <button
          onClick={() => onCompareSession(item.session_id)}
          disabled={!compareReady}
          className="text-[10px] rounded px-2 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-trace-accent/30 text-trace-accent-light hover:bg-trace-accent/10"
          title={
            compareReady
              ? "Queue this session for compare view"
              : "This session is not loaded in the current session list"
          }
        >
          Compare
        </button>
      </div>
    </div>
  );
}

export default function DiagnosisPanel({ session }: DiagnosisPanelProps) {
  const [diagnosis, setDiagnosis] = useState<TraceDiagnosis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [bugBriefPending, setBugBriefPending] = useState(false);
  const [bugBriefResult, setBugBriefResult] =
    useState<TraceBugBriefResult | null>(null);
  const [bugBriefCopied, setBugBriefCopied] = useState(false);
  const [seedPending, setSeedPending] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const sessions = useStore((s) => s.sessions);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const setCompareViewActive = useStore((s) => s.setCompareViewActive);
  const clearCompareSessions = useStore((s) => s.clearCompareSessions);
  const toggleCompareSession = useStore((s) => s.toggleCompareSession);
  const setTraceListMode = useStore((s) => s.setTraceListMode);
  const setFilter = useStore((s) => s.setFilter);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDiagnosis(null);
    setBugBriefResult(null);
    setBugBriefCopied(false);
    setSeedResult(null);

    fetchTraceDiagnosis(session.sessionId)
      .then((result) => {
        if (!cancelled) {
          setDiagnosis(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session.sessionId]);

  const openSession = (sessionId: string) => {
    if (!sessionId || sessionId === session.sessionId) return;
    setCurrentSessionId(sessionId);
    setCurrentEntries([]);
    setSearchQuery("");
    setActiveSubview("turns");
    setCompareViewActive(false);
  };

  const compareLoadedSession = (sessionId: string) => {
    if (!sessions.some((item) => item.sessionId === sessionId)) return;
    clearCompareSessions();
    toggleCompareSession(session.sessionId);
    if (sessionId !== session.sessionId) {
      toggleCompareSession(sessionId);
    }
    setCompareViewActive(true);
  };

  const openCohort = () => {
    if (!diagnosis) return;
    setCurrentSessionId(null);
    setCurrentEntries([]);
    setSearchQuery("");
    setTraceListMode("sessions");
    setFilter("day", "all");
    setFilter("domain", diagnosis.pathologyScope.domain || "");
    setFilter(
      "outcome",
      session.outcome && session.outcome !== "completed" ? session.outcome : "all",
    );
  };

  const createResearchSeed = async () => {
    setSeedPending(true);
    setSeedResult(null);
    try {
      const result = await createTraceResearchSeed(session.sessionId);
      setSeedResult(result.output || result.title);
    } catch (err) {
      setSeedResult(
        `Failed to create research seed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setSeedPending(false);
    }
  };

  const copyBugBrief = async (brief: TraceBugBriefResult) => {
    try {
      await navigator.clipboard.writeText(brief.content);
      setBugBriefCopied(true);
      window.setTimeout(() => setBugBriefCopied(false), 1500);
    } catch {
      setBugBriefCopied(false);
    }
  };

  const createBugBrief = async () => {
    setBugBriefPending(true);
    setBugBriefResult(null);
    setBugBriefCopied(false);
    try {
      const result = await createTraceBugBrief(session.sessionId);
      setBugBriefResult(result);
      await copyBugBrief(result);
    } catch (err) {
      setBugBriefResult({
        title: "Bug brief unavailable",
        content: `Failed to create bug brief: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setBugBriefPending(false);
    }
  };

  const summaryItems = useMemo(() => {
    if (!diagnosis) return [];
    return [
      {
        label: "Imported trace",
        value: diagnosis.session.slug,
      },
      {
        label: "Recorded",
        value: formatRecordedAt(diagnosis.session.session.recordedAt),
      },
      {
        label: "Failure",
        value: diagnosis.session.session.failureCode || "none",
      },
      {
        label: "Related failures",
        value: String(diagnosis.similarFailures.total_matches),
      },
    ];
  }, [diagnosis]);

  return (
    <div className="px-5 py-3 border-b border-trace-border bg-[linear-gradient(180deg,rgba(124,58,237,0.05),rgba(12,16,22,0))] shrink-0">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-[0.18em] text-trace-muted font-medium">
          Diagnosis
        </span>
        {session.failureCode && session.failureCode !== "none" && (
          <Badge variant="error">{session.failureCode}</Badge>
        )}
        {session.failureCategory && session.failureCategory !== "none" && (
          <Badge variant="category">{session.failureCategory}</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <button
            onClick={createBugBrief}
            disabled={bugBriefPending}
            className="text-[10px] rounded px-2 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-trace-border text-trace-muted hover:text-trace-text hover:border-trace-accent/40"
          >
            {bugBriefPending
              ? "Creating bug brief..."
              : bugBriefCopied
                ? "Bug brief copied"
                : "Create bug brief"}
          </button>
          <button
            onClick={() => setSummaryOpen((open) => !open)}
            className="text-[10px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
          >
            {summaryOpen ? "Hide pathology summary" : "Open pathology summary"}
          </button>
          <button
            onClick={createResearchSeed}
            disabled={seedPending}
            className="text-[10px] rounded px-2 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-trace-accent/30 text-trace-accent-light hover:bg-trace-accent/10"
          >
            {seedPending ? "Creating seed..." : "Create research seed"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-2">
          <LoadingSpinner message="Building diagnosis from lab traces..." />
        </div>
      ) : error ? (
        <div className="rounded border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-300/90">
          Diagnosis unavailable: {error}
        </div>
      ) : !diagnosis ? (
        <div className="rounded border border-trace-border/70 bg-black/10 px-3 py-2 text-[11px] text-trace-muted">
          No diagnosis data available.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-3">
            <div className="rounded border border-trace-border bg-trace-panel px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-trace-dim mb-2">
                Trace Summary
              </div>
              <div className="space-y-2">
                {summaryItems.map((item) => (
                  <div key={item.label} className="text-[11px]">
                    <div className="text-trace-dim">{item.label}</div>
                    <div className="text-trace-text break-words">{item.value}</div>
                  </div>
                ))}
                <div className="pt-2 border-t border-trace-border/50 text-[11px] text-trace-muted leading-relaxed">
                  {shortSummary(diagnosis.session.session.summary, 220)}
                </div>
                <div className="pt-2 border-t border-trace-border/50 flex gap-2">
                  <button
                    onClick={openCohort}
                    className="text-[10px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
                  >
                    Open cohort
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded border border-trace-border bg-trace-panel px-3 py-3 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="text-[10px] uppercase tracking-[0.18em] text-trace-dim">
                  Similar Failures
                </div>
                <span className="text-[10px] text-trace-muted">
                  {diagnosis.similarFailures.total_matches} match
                  {diagnosis.similarFailures.total_matches === 1 ? "" : "es"}
                </span>
              </div>
              {diagnosis.similarFailures.results.length === 0 ? (
                <div className="text-[11px] text-trace-muted">
                  No related failures were found in the imported lab traces.
                </div>
              ) : (
                <div className="space-y-2">
                  {diagnosis.similarFailures.results.slice(0, 3).map((item) => (
                    <SimilarFailureRow
                      key={item.slug}
                      item={item}
                      compareReady={sessions.some((entry) => entry.sessionId === item.session_id)}
                      onOpenSession={openSession}
                      onCompareSession={compareLoadedSession}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded border border-trace-border bg-trace-panel px-3 py-3 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-trace-dim mb-2">
                Cohort Signals
              </div>
              <div className="space-y-2 text-[11px]">
                <div>
                  <div className="text-trace-dim">Scope</div>
                  <div className="text-trace-text">
                    {diagnosis.pathologyScope.domain || "(unknown domain)"}
                    {diagnosis.pathologyScope.fixture
                      ? ` / ${diagnosis.pathologyScope.fixture}`
                      : ""}
                  </div>
                </div>
                <div>
                  <div className="text-trace-dim">Failure codes</div>
                  <div className="text-trace-text">
                    {formatCountList(
                      diagnosis.pathologySummary.failure_codes,
                      "No failures recorded",
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-trace-dim">Failed tools</div>
                  <div className="text-trace-text">
                    {formatCountList(
                      diagnosis.pathologySummary.recurring_tools_in_failed_sessions,
                      "No repeated failed tools",
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-trace-dim">Failed events</div>
                  <div className="text-trace-text">
                    {formatCountList(
                      diagnosis.pathologySummary.recurring_events_in_failed_sessions,
                      "No repeated failed events",
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {(bugBriefResult || seedResult) && (
            <div className="mt-3 grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] gap-3">
              {bugBriefResult && (
                <div className="rounded border border-trace-border bg-trace-panel px-3 py-3 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-trace-dim">
                      Bug Brief
                    </div>
                    <button
                      onClick={() => copyBugBrief(bugBriefResult)}
                      className="ml-auto text-[10px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
                    >
                      {bugBriefCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="text-[11px] text-trace-text font-medium mb-2">
                    {bugBriefResult.title}
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-trace-muted font-mono">
                    {bugBriefResult.content}
                  </pre>
                </div>
              )}

              {seedResult && (
                <div className="rounded border border-trace-border/70 bg-black/10 px-3 py-3 text-[11px] text-trace-muted">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-trace-dim mb-2">
                    Research Seed
                  </div>
                  {seedResult}
                </div>
              )}
            </div>
          )}

          {summaryOpen && (
            <div className="mt-3 rounded border border-trace-border bg-trace-panel px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-trace-dim mb-2">
                Pathology Summary
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div className="rounded border border-trace-border/70 bg-black/10 px-3 py-2">
                  <div className="text-trace-dim">Sessions in scope</div>
                  <div className="mt-1 text-trace-text">
                    {diagnosis.pathologySummary.total_sessions} total,{" "}
                    {diagnosis.pathologySummary.failed_sessions} failed,{" "}
                    {diagnosis.pathologySummary.completed_sessions} completed
                  </div>
                </div>
                <div className="rounded border border-trace-border/70 bg-black/10 px-3 py-2">
                  <div className="text-trace-dim">Outcomes</div>
                  <div className="mt-1 text-trace-text">
                    {formatCountList(
                      diagnosis.pathologySummary.outcomes,
                      "No outcomes recorded",
                    )}
                  </div>
                </div>
                <div className="rounded border border-trace-border/70 bg-black/10 px-3 py-2">
                  <div className="text-trace-dim">Failure categories</div>
                  <div className="mt-1 text-trace-text">
                    {formatCountList(
                      diagnosis.pathologySummary.failure_categories,
                      "No failure categories",
                    )}
                  </div>
                </div>
                <div className="rounded border border-trace-border/70 bg-black/10 px-3 py-2">
                  <div className="text-trace-dim">Fixtures</div>
                  <div className="mt-1 text-trace-text">
                    {formatCountList(
                      diagnosis.pathologySummary.fixtures,
                      "No fixtures",
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
