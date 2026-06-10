import React, { useEffect, useState, useMemo } from "react";
import type {
  TraceEntry,
  TraceEvent,
  TraceSession,
} from "../../../types/traces";
import type { RunTraceEvent } from "../../../utils/run-trace";
import { redactTracePayload } from "../../../utils/trace-protection";
import {
  buildFrozenTraceBundle,
  validateFrozenTraceBundle,
} from "../../analysis";
import { useStore } from "../../store";
import { computeSessionDiagnostics } from "../../diagnostics";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import CollapsibleSection from "../CollapsibleSection";
import {
  outcomeClass,
  formatDuration,
  formatCost,
  formatTokens,
  truncate,
  extractQueryTitle,
  compactTraceTaskLabel,
  getSessionModels,
} from "../../utils";
import type { PartialProgressHandoff } from "../../../types";

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

function PartialHandoffSummary({
  handoff,
}: {
  handoff: PartialProgressHandoff;
}) {
  return (
    <div className="mt-3 rounded border border-state-warning/25 bg-state-warning/5 p-3 text-[11px] text-trace-muted">
      <div className="flex items-center gap-2">
        <Badge variant="max_turns">partial_handoff</Badge>
        <span>
          {handoff.reason} after {handoff.turnsUsed}/{handoff.maxTurns} turns
        </span>
        <span className="ml-auto">
          {handoff.evidence.length} evidence, {handoff.remaining.length} remaining
        </span>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-trace-subtle">
            Evidence
          </div>
          <ul className="space-y-1">
            {handoff.evidence.length > 0 ? (
              handoff.evidence.slice(0, 3).map((item, index) => (
                <li key={index}>
                  <span className="text-trace-subtle">{item.label}:</span>{" "}
                  {truncate(item.value, 160)}
                </li>
              ))
            ) : (
              <li>No durable evidence captured.</li>
            )}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-trace-subtle">
            Remaining
          </div>
          <ul className="space-y-1">
            {handoff.remaining.slice(0, 3).map((item, index) => (
              <li key={index}>{truncate(item.text, 160)}</li>
            ))}
          </ul>
        </div>
      </div>
      {handoff.currentState.url || handoff.currentState.title ? (
        <div className="mt-2 truncate text-trace-subtle">
          Current state:{" "}
          {[handoff.currentState.title, handoff.currentState.url]
            .filter(Boolean)
            .join(" | ")}
        </div>
      ) : null}
    </div>
  );
}

export default function TraceDetailHeader({ session }: TraceDetailHeaderProps) {
  const currentEntries = useStore((s) => s.currentEntries);
  const currentRunEvents = useStore((s) => s.currentRunEvents);
  const sessionLogs = useStore((s) => s.sessionLogs);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [frozenExported, setFrozenExported] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
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

  useEffect(() => {
    setDetailsExpanded(false);
  }, [session.sessionId]);

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
    const redactedSession = redactTracePayload(session, { mode: "export" });
    const redactedEntries = currentEntries.map((entry) =>
      redactTracePayload(entry, { mode: "export" }),
    );
    const lines = [JSON.stringify(redactedSession)];
    for (const entry of redactedEntries) {
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

  const handleFreezeExport = () => {
    const bundle = buildFrozenTraceBundle({
      session,
      entries: currentEntries,
      runEvents: currentRunEvents,
      logs: sessionLogs,
    });
    const redactedBundle = {
      ...redactTracePayload(bundle, { mode: "export" }),
      screenshots: bundle.screenshots,
    };
    const issues = validateFrozenTraceBundle(redactedBundle);
    if (issues.some((issue) => issue.severity === "error")) {
      console.warn("Frozen trace bundle validation failed", issues);
    }
    const blob = new Blob([`${JSON.stringify(redactedBundle, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.sessionId}.frozen-trace.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFrozenExported(true);
    setTimeout(() => setFrozenExported(false), 1200);
  };

  return (
    <div className="px-5 py-3.5">
      <div className="flex items-center gap-3 mb-1.5 min-w-0 flex-wrap">
        <span className="min-w-0 flex-1 text-xs text-trace-muted font-mono truncate">
          {session.sessionId}
        </span>
        <button
          className="text-trace-muted hover:text-trace-text transition-colors p-0.5 -ml-1.5"
          title="Copy trace ID"
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
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <button
            className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-0.5 transition-colors"
            title="Copy shareable link"
            onClick={handleCopyLink}
          >
            {linkCopied ? "Copied!" : "Copy Link"}
          </button>
          <button
            className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-0.5 transition-colors"
            title="Export trace as JSONL"
            onClick={handleExport}
          >
            Export JSONL
          </button>
          <button
            className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-0.5 transition-colors"
            title="Freeze this trace as a permanent JSON bundle"
            onClick={handleFreezeExport}
          >
            {frozenExported ? "Frozen" : "Freeze Bundle"}
          </button>
        </div>
      </div>
      <QueryTitle query={session.query || ""} />
      <div className="flex gap-4 text-[11px] text-trace-muted mt-1.5 flex-wrap">
        <span>{session.turnCount || 0} turns</span>
        <span>{duration}</span>
        <span>
          {models.length} model{models.length === 1 ? "" : "s"}
        </span>
        {tokens && <span>{tokens}</span>}
        {cost && <span>{cost}</span>}
        {session.startUrl && <span>{truncate(session.startUrl, 50)}</span>}
        <button
          type="button"
          onClick={() => setDetailsExpanded((value) => !value)}
          aria-expanded={detailsExpanded}
          className="ml-auto text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-0.5 transition-colors"
        >
          {detailsExpanded ? "Hide details" : "Show details"}
        </button>
      </div>

      {session.partialHandoff ? (
        <PartialHandoffSummary handoff={session.partialHandoff} />
      ) : null}

      {detailsExpanded && (
        <>
          {/* Latency stats strip */}
          {latencyStats && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-trace-border/50 text-[10px] font-mono text-trace-muted">
              <span className="text-[9px] font-bold uppercase tracking-widest text-trace-accent-light/70">
                Latency
              </span>
              <span>
                min{" "}
                <span className="text-trace-subtle">
                  {formatDuration(latencyStats.min)}
                </span>
              </span>
              <span>
                p50{" "}
                <span className="text-trace-subtle">
                  {formatDuration(latencyStats.median)}
                </span>
              </span>
              <span>
                p95{" "}
                <span className="text-trace-subtle">
                  {formatDuration(latencyStats.p95)}
                </span>
              </span>
              <span>
                max{" "}
                <span className="text-trace-subtle">
                  {formatDuration(latencyStats.max)}
                </span>
              </span>
              <span className="text-trace-muted">
                ({latencyStats.count} calls)
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <Tooltip content="Turns that resulted in meaningful progress toward the goal">
              <div>
                <Badge variant="type">
                  {diagnostics.productiveTurns} productive
                </Badge>
              </div>
            </Tooltip>
            {diagnostics.wastedTurns > 0 && (
              <Tooltip content="Turns that did not advance the task (stuck signal or loop detected)">
                <div>
                  <Badge variant="event-stuck_signal">
                    {diagnostics.wastedTurns} wasted
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.loopTurns > 0 && (
              <Tooltip content="Turns where the agent repeated the same action pattern">
                <div>
                  <Badge variant="event-circuit_breaker">
                    {diagnostics.loopTurns} loop turns
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.escalations > 0 && (
              <Tooltip content="Times the agent escalated (replan or planner-tier swap)">
                <div>
                  <Badge variant="event-escalation">
                    {diagnostics.escalations} escalations
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.escalationOutcomes.rescued > 0 && (
              <Tooltip content="Escalations followed by verified progress (plan advance, successful mutation, trusted evidence, or new page)">
                <div>
                  <Badge variant="completed">
                    {diagnostics.escalationOutcomes.rescued} rescued
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.escalationOutcomes.failedFast > 0 && (
              <Tooltip content="Runs ended early because an escalation produced no verified progress within the efficacy window">
                <div>
                  <Badge variant="error">
                    {diagnostics.escalationOutcomes.failedFast} failed fast
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.escalationOutcomes.budgetExhausted > 0 && (
              <Tooltip content="Escalations still unresolved when the turn budget ran out">
                <div>
                  <Badge variant="error">
                    {diagnostics.escalationOutcomes.budgetExhausted} budget
                    exhausted
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.failovers > 0 && (
              <Tooltip content="Times the agent failed over to a backup provider">
                <div>
                  <Badge variant="category">
                    {diagnostics.failovers} failovers
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.contextHotTurns > 0 && (
              <Tooltip content="Turns where context window utilization exceeded 85%, triggering compression">
                <div>
                  <Badge variant="tier-planner">
                    {diagnostics.contextHotTurns} context hot
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.perceptionCalls > 0 && (
              <Tooltip content="Perception cache hit rate - lower numbers mean more API calls">
                <div>
                  <Badge variant="cached">
                    {diagnostics.perceptionCacheHits}/
                    {diagnostics.perceptionCalls} cached perception
                  </Badge>
                </div>
              </Tooltip>
            )}
            {diagnostics.elementOnlyTurns > 0 && (
              <Tooltip content="Turns that only used element-level DOM access without full page perception">
                <div>
                  <Badge variant="event-stuck_signal">
                    {diagnostics.elementOnlyTurns} element-only
                  </Badge>
                </div>
              </Tooltip>
            )}
          </div>

          <SkillPolicySection session={session} />
          <CoordinationSection
            entries={currentEntries}
            runEvents={currentRunEvents}
          />
          <PlanSection session={session} />
        </>
      )}
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
        {expanded ? query : `${title}${hasMore ? "..." : ""}`}
        {hasMore && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-1.5 text-[11px] text-trace-accent hover:text-trace-accent-light border border-trace-accent/30 rounded px-1.5 py-0.5 font-medium transition-colors"
          >
            {expanded ? "less" : "more"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Plan section ────────────────────────────────────────────────────

function getAllSkillIds(session: TraceSession): string[] {
  const ids = new Set<string>();
  if (session.skillToolMetrics?.skillId) {
    ids.add(session.skillToolMetrics.skillId);
  }
  if (session.planDecomposition?.steps) {
    for (const step of session.planDecomposition.steps) {
      if (step.selectedSkillId) {
        ids.add(step.selectedSkillId);
      }
    }
  }
  return Array.from(ids);
}

function SkillPolicySection({ session }: { session: TraceSession }) {
  const metrics = session.skillToolMetrics;
  const skillIds = getAllSkillIds(session);
  if (skillIds.length === 0) return null;

  return (
    <div className="border-t border-trace-border mt-2.5 pt-2.5">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[11px] text-trace-subtle font-medium uppercase tracking-wide">
          Skill Policy
        </span>
        {skillIds.map((skillId) => (
          <span
            key={skillId}
            className="px-1.5 py-0.5 text-[9px] rounded bg-brand-live/10 text-brand-live font-medium"
          >
            {skillId}
          </span>
        ))}
        {metrics && (
          <>
            <Badge variant="type">{metrics.rankingApplications} rankings</Badge>
            <Badge variant="type">{metrics.totalSelections} picks</Badge>
          </>
        )}
      </div>
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
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
      )}
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
    <div className="rounded border border-trace-border/70 bg-trace-bg px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-trace-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-trace-text">{value}</div>
      <div className="mt-1 text-[10px] text-trace-muted">{hint}</div>
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function tabRoleCounts(ownedTabs: unknown): string {
  if (!Array.isArray(ownedTabs)) return "0 tabs";
  const counts = new Map<string, number>();
  for (const tab of ownedTabs) {
    const role = stringValue(asRecord(tab)?.role) ?? "unknown";
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries()).map(
    ([role, count]) => `${count} ${role}`,
  );
  return parts.length > 0 ? parts.join(", ") : "0 tabs";
}

function collectAgentEvents(entries: TraceEntry[], type: string): TraceEvent[] {
  return entries.flatMap((entry) =>
    (entry.events ?? []).filter((event) => event.type === type),
  );
}

function CoordinationSection({
  entries,
  runEvents,
}: {
  entries: TraceEntry[];
  runEvents: RunTraceEvent[];
}) {
  const redirectEvents = collectAgentEvents(entries, "workflow_tab_redirect");
  const stateEvents = runEvents.filter(
    (event) => event.type === "tab_coordination_state",
  );
  const rejectedRebinds = runEvents.filter(
    (event) => event.type === "task_resume_rebinding_rejected",
  );

  if (
    redirectEvents.length === 0 &&
    stateEvents.length === 0 &&
    rejectedRebinds.length === 0
  ) {
    return null;
  }

  const latestState = asRecord(stateEvents[stateEvents.length - 1]?.data);
  const latestAction = stringValue(latestState?.action);
  const tabRefs = asRecord(latestState?.tabRefs);
  const previousTabRef = asRecord(
    tabRefs?.previous ?? tabRefs?.lastRebound,
  );
  const previousChromeDebug = asRecord(previousTabRef?.debug);
  const primaryTabId = numberValue(latestState?.primaryTabId);
  const previousTabId =
    numberValue(latestState?.lastReboundTabId) ??
    numberValue(previousChromeDebug?.chromeTabId);
  const ownedTabCount = numberValue(latestState?.ownedTabCount);
  const nodeBindingCount = numberValue(latestState?.nodeBindingCount);
  const latestReason = stringValue(latestState?.reason);
  const controllerCounts = new Map<string, number>();
  for (const event of redirectEvents) {
    const controllerId =
      stringValue(asRecord(event.data)?.controllerId) ?? "unknown";
    controllerCounts.set(
      controllerId,
      (controllerCounts.get(controllerId) ?? 0) + 1,
    );
  }

  return (
    <div className="border-t border-trace-border mt-2.5 pt-2.5">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[11px] text-trace-subtle font-medium uppercase tracking-wide">
          Coordination
        </span>
        {stateEvents.length > 0 && (
          <Badge variant="type">{stateEvents.length} state events</Badge>
        )}
        {redirectEvents.length > 0 && (
          <Badge variant="event-workflow_tab_redirect">
            {redirectEvents.length} redirects
          </Badge>
        )}
        {rejectedRebinds.length > 0 && (
          <Badge variant="event-stuck_signal">
            {rejectedRebinds.length} unsafe rebinds
          </Badge>
        )}
      </div>
      {latestState && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] mb-2">
          <MetricCard
            label="Primary"
            value={primaryTabId == null ? "-" : String(primaryTabId)}
            hint={latestAction ?? "latest state"}
          />
          <MetricCard
            label="Owned Tabs"
            value={ownedTabCount == null ? "0" : String(ownedTabCount)}
            hint={tabRoleCounts(latestState.ownedTabs)}
          />
          <MetricCard
            label="Bindings"
            value={nodeBindingCount == null ? "0" : String(nodeBindingCount)}
            hint="node-tab bindings"
          />
          <MetricCard
            label="Previous"
            value={previousTabId == null ? "-" : String(previousTabId)}
            hint={latestReason ?? "previous task tab"}
          />
        </div>
      )}
      {controllerCounts.size > 0 && (
        <div className="flex gap-1.5 flex-wrap text-[11px] text-trace-muted">
          {Array.from(controllerCounts.entries()).map(
            ([controllerId, count]) => (
              <span
                key={controllerId}
                className="px-1.5 py-0.5 rounded bg-trace-bg border border-trace-border/70"
              >
                {controllerId}: {count}
              </span>
            ),
          )}
        </div>
      )}
      {rejectedRebinds.length > 0 && (
        <div className="mt-1.5 text-[11px] text-trace-muted">
          Last unsafe rebind:{" "}
          {stringValue(
            asRecord(rejectedRebinds[rejectedRebinds.length - 1].data)?.reason,
          ) ?? "reason unavailable"}
        </div>
      )}
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
            className="px-1.5 py-0.5 text-[9px] rounded bg-brand-live/10 text-brand-live font-medium"
          >
            {skillId}
          </span>
        ))}
      </div>
      {subtasks.length > 0 && (
        <ol className="list-decimal list-inside text-[12px] text-trace-muted leading-relaxed pl-1 mb-1.5">
          {subtasks.map((s, i) => {
            const label = compactTraceTaskLabel(s) || s;
            return (
              <li key={i} title={label === s ? undefined : s}>
                {label}
              </li>
            );
          })}
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
            {steps.map((step, i) => {
              const objective =
                compactTraceTaskLabel(step.objective) || "(no objective)";
              return (
                <div key={i} className="border-l-2 border-trace-border pl-2">
                  <div
                    className="text-trace-subtle font-medium"
                    title={
                      objective === step.objective ? undefined : step.objective
                    }
                  >
                    {i + 1}. {objective}
                    {step.selectedSkillId && (
                      <span className="ml-1.5 px-1 py-0.5 text-[9px] rounded bg-brand-live/10 text-brand-live font-normal">
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
                    <div className="text-[10px]">
                      Tools: {step.toolProfile}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
