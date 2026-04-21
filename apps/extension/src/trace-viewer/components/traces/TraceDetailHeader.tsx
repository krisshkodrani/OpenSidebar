import React, { useState, useMemo } from "react";
import type { TraceSession } from "../../../types/traces";
import { useStore } from "../../store";
import { computeSessionDiagnostics } from "../../diagnostics";
import Badge from "../Badge";
import CollapsibleSection from "../CollapsibleSection";
import {
  outcomeClass,
  formatDuration,
  formatCost,
  formatTokens,
  truncate,
  extractQueryTitle,
  getSessionModels,
} from "../../utils";

interface TraceDetailHeaderProps {
  session: TraceSession;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export default function TraceDetailHeader({ session }: TraceDetailHeaderProps) {
  const currentEntries = useStore((s) => s.currentEntries);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const outcome = session.outcome;
  const metrics = session.metrics;
  const duration = formatDuration(
    (session.endTime || 0) - (session.startTime || 0),
  );

  let cost = "";
  let tokens = "";
  if (metrics) {
    if (metrics.totalCost) cost = formatCost(metrics.totalCost);
    if (metrics.totalTokens)
      tokens = `${formatTokens(metrics.totalTokens)} tokens`;
  }

  // Compute latency percentiles from turn durations
  const latencyStats = useMemo(() => {
    const durations = currentEntries
      .map((e) => e.llmResponse?.durationMs ?? 0)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (durations.length === 0) return null;
    return {
      min: durations[0],
      median: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: durations[durations.length - 1],
      count: durations.length,
    };
  }, [currentEntries]);
  const diagnostics = useMemo(
    () => computeSessionDiagnostics(session, currentEntries),
    [session, currentEntries],
  );
  const models = getSessionModels(session);

  const handleCopy = () => {
    navigator.clipboard.writeText(session.sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.hash = `session=${session.sessionId}`;
    navigator.clipboard.writeText(url.toString());
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1200);
  };

  const handleExport = () => {
    const lines = [JSON.stringify(session)];
    for (const entry of currentEntries) {
      lines.push(JSON.stringify(entry));
    }
    const blob = new Blob([lines.join("\n") + "\n"], {
      type: "application/x-ndjson",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.sessionId}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-5 py-3.5 border-b border-trace-border shrink-0 bg-trace-panel">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-xs text-trace-muted font-mono">
          {session.sessionId}
        </span>
        <button
          className="text-trace-muted hover:text-trace-text transition-colors p-0.5 -ml-1.5"
          title="Copy session ID"
          onClick={handleCopy}
        >
          {copied ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
        <Badge
          variant={
            outcomeClass(outcome) as
              | "completed"
              | "stopped"
              | "error"
              | "max_turns"
          }
        >
          {outcome}
        </Badge>
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-0.5 transition-colors"
            title="Copy shareable link"
            onClick={handleCopyLink}
          >
            {linkCopied ? "Copied!" : "Copy Link"}
          </button>
          <button
            className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-0.5 transition-colors"
            title="Export session as JSONL"
            onClick={handleExport}
          >
            Export JSONL
          </button>
        </div>
      </div>
      <QueryTitle query={session.query || ""} />
      <div className="flex gap-4 text-[11px] text-trace-muted mt-1.5 flex-wrap">
        <span>{session.turnCount || 0} turns</span>
        <span>{duration}</span>
        <span>{models.length} model{models.length === 1 ? "" : "s"}</span>
        {tokens && <span>{tokens}</span>}
        {cost && <span>{cost}</span>}
        {session.startUrl && <span>{truncate(session.startUrl, 50)}</span>}
      </div>

      {/* Latency stats strip */}
      {latencyStats && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-trace-border/50 text-[10px] font-mono text-trace-muted">
          <span className="text-[9px] font-bold uppercase tracking-widest text-trace-accent-light/70">
            Latency
          </span>
          <span>
            min <span className="text-trace-subtle">{formatDuration(latencyStats.min)}</span>
          </span>
          <span>
            p50 <span className="text-trace-subtle">{formatDuration(latencyStats.median)}</span>
          </span>
          <span>
            p95 <span className="text-trace-subtle">{formatDuration(latencyStats.p95)}</span>
          </span>
          <span>
            max <span className="text-trace-subtle">{formatDuration(latencyStats.max)}</span>
          </span>
          <span className="text-trace-muted">({latencyStats.count} calls)</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Badge variant="type">{diagnostics.productiveTurns} productive</Badge>
        {diagnostics.wastedTurns > 0 && (
          <Badge variant="event-stuck_signal">
            {diagnostics.wastedTurns} wasted
          </Badge>
        )}
        {diagnostics.loopTurns > 0 && (
          <Badge variant="event-circuit_breaker">
            {diagnostics.loopTurns} loop turns
          </Badge>
        )}
        {diagnostics.escalations > 0 && (
          <Badge variant="event-escalation">
            {diagnostics.escalations} escalations
          </Badge>
        )}
        {diagnostics.failovers > 0 && (
          <Badge variant="category">{diagnostics.failovers} failovers</Badge>
        )}
        {diagnostics.contextHotTurns > 0 && (
          <Badge variant="tier-planner">
            {diagnostics.contextHotTurns} context hot
          </Badge>
        )}
        {diagnostics.perceptionCalls > 0 && (
          <Badge variant="cached">
            {diagnostics.perceptionCacheHits}/{diagnostics.perceptionCalls} cached perception
          </Badge>
        )}
        {diagnostics.structuredPerceptionTurns > 0 && (
          <Badge variant="type">
            {diagnostics.structuredPerceptionTurns} structured
          </Badge>
        )}
        {diagnostics.vlScreenshotTurns > 0 && (
          <Badge variant="category">
            {diagnostics.vlScreenshotTurns} VL screenshot
          </Badge>
        )}
        {diagnostics.elementOnlyTurns > 0 && (
          <Badge variant="event-stuck_signal">
            {diagnostics.elementOnlyTurns} element-only
          </Badge>
        )}
      </div>

      <SkillPolicySection session={session} />
      <PlanSection session={session} />
    </div>
  );
}

// ── Query title ─────────────────────────────────────────────────────

function QueryTitle({ query }: { query: string }) {
  const [expanded, setExpanded] = useState(false);
  const { title, hasMore } = extractQueryTitle(query);

  return (
    <div>
      <div className="text-sm text-trace-text font-medium break-words">
        {title}
        {hasMore && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="ml-1.5 text-[11px] text-trace-accent hover:underline font-normal"
          >
            more
          </button>
        )}
      </div>
      {expanded && (
        <pre
          className="mt-1.5 text-[11px] text-trace-muted leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-[rgba(0,0,0,0.2)] rounded px-2 py-1.5 scrollbar-thin cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          {query}
        </pre>
      )}
    </div>
  );
}

// ── Plan section ────────────────────────────────────────────────────

function SkillPolicySection({ session }: { session: TraceSession }) {
  const metrics = session.skillToolMetrics;
  if (!metrics) return null;

  return (
    <div className="border-t border-trace-border mt-2.5 pt-2.5">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[11px] text-trace-subtle font-medium uppercase tracking-wide">
          Skill Policy
        </span>
        <span className="px-1.5 py-0.5 text-[9px] rounded bg-[rgba(139,92,246,0.15)] text-[#a78bfa] font-medium">
          {metrics.skillId}
        </span>
        <Badge variant="type">{metrics.rankingApplications} rankings</Badge>
        <Badge variant="type">{metrics.totalSelections} picks</Badge>
      </div>
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 text-[11px]">
        <MetricCard
          label="Preferred"
          value={`${Math.round(metrics.preferredSelectionRate * 100)}%`}
          hint={`${metrics.preferredSelections} selections`}
        />
        <MetricCard
          label="Neutral"
          value={`${metrics.neutralSelections}`}
          hint="middle-path picks"
        />
        <MetricCard
          label="Discouraged"
          value={`${Math.round(metrics.discouragedSelectionRate * 100)}%`}
          hint={`${metrics.discouragedSelections} selections`}
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded border border-trace-border/70 bg-black/10 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-trace-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-trace-text">{value}</div>
      <div className="mt-1 text-[10px] text-trace-muted">{hint}</div>
    </div>
  );
}

function PlanSection({ session }: { session: TraceSession }) {
  const plan = session.planDecomposition;
  const difficulty = session.difficultyAssessment;

  if (!plan && !difficulty) return null;

  const subtasks = plan?.subtasks ?? [];
  const steps = plan?.steps;

  const difficultyVariant = difficulty
    ? (`difficulty-${difficulty.toLowerCase()}` as const)
    : undefined;

  const usedSkills = [
    ...new Set(
      (steps ?? [])
        .map((s) => s.selectedSkillId)
        .filter((id): id is string => !!id),
    ),
  ];

  return (
    <div className="border-t border-trace-border mt-2.5 pt-2.5">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[11px] text-trace-subtle font-medium uppercase tracking-wide">
          Plan
        </span>
        {difficultyVariant && (
          <Badge variant={difficultyVariant}>{difficulty}</Badge>
        )}
        {usedSkills.map((skillId) => (
          <span
            key={skillId}
            className="px-1.5 py-0.5 text-[9px] rounded bg-[rgba(139,92,246,0.15)] text-[#a78bfa] font-medium"
          >
            {skillId}
          </span>
        ))}
      </div>
      {subtasks.length > 0 && (
        <ol className="list-decimal list-inside text-[12px] text-trace-muted leading-relaxed pl-1 mb-1.5">
          {subtasks.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {steps && steps.length > 0 && (
        <CollapsibleSection
          label={
            <span className="text-[11px]">Step details ({steps.length})</span>
          }
          className="mt-1"
        >
          <div className="pl-3 pt-1.5 space-y-2 text-[11px] text-trace-muted">
            {steps.map((step, i) => (
              <div key={i} className="border-l-2 border-trace-border pl-2">
                <div className="text-trace-subtle font-medium">
                  {i + 1}. {step.objective ?? "(no objective)"}
                  {step.selectedSkillId && (
                    <span className="ml-1.5 px-1 py-0.5 text-[9px] rounded bg-[rgba(139,92,246,0.15)] text-[#a78bfa] font-normal">
                      {step.selectedSkillId}
                    </span>
                  )}
                </div>
                {step.successCriteria && (
                  <div className="text-[10px]">
                    Success: {step.successCriteria}
                  </div>
                )}
                {step.dependencies && step.dependencies.length > 0 && (
                  <div className="text-[10px]">
                    Deps: [{step.dependencies.join(", ")}]
                  </div>
                )}
                {step.toolProfile && (
                  <div className="text-[10px]">Tools: {step.toolProfile}</div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
