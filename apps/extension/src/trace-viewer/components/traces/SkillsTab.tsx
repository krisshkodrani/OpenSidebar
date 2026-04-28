import React, { useState } from "react";
import type { TraceSession } from "../../../types/traces";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import CollapsibleSection from "../CollapsibleSection";

interface SkillsTabProps {
  session: TraceSession;
}

interface SkillEvent {
  turn: number;
  type: "ranking_applied" | "tool_selected";
  skillId: string;
  toolName?: string;
  preference?: "preferred" | "neutral" | "discouraged";
  preferredTools?: string[];
  discouragedTools?: string[];
}

export default function SkillsTab({ session }: SkillsTabProps) {
  const metrics = session.skillToolMetrics;

  if (!metrics) {
    return (
      <div className="text-sm text-trace-muted p-4">
        No skill metrics available for this session.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SkillMetricsCard metrics={metrics} />
      <SkillEventStream session={session} />
    </div>
  );
}

function SkillMetricsCard({
  metrics,
}: {
  metrics: NonNullable<TraceSession["skillToolMetrics"]>;
}) {
  const {
    skillId,
    rankingApplications,
    totalSelections,
    preferredSelections,
    neutralSelections,
    discouragedSelections,
    preferredSelectionRate,
    discouragedSelectionRate,
  } = metrics;

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-trace-muted uppercase tracking-wide">
          Skill Effectiveness
        </span>
        <Badge variant="type">{skillId}</Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricBox
          label="Rankings Applied"
          value={rankingApplications}
          tooltip="Number of times skill tool rankings were applied"
        />
        <MetricBox
          label="Total Selections"
          value={totalSelections}
          tooltip="Total number of tool selections made"
        />
        <MetricBox
          label="Preferred Rate"
          value={`${Math.round(preferredSelectionRate * 100)}%`}
          tooltip="Percentage of selections from preferred tools"
          highlight={
            preferredSelectionRate > 0.7
              ? "success"
              : preferredSelectionRate > 0.4
                ? "warning"
                : "error"
          }
        />
        <MetricBox
          label="Discouraged Rate"
          value={`${Math.round(discouragedSelectionRate * 100)}%`}
          tooltip="Percentage of selections from discouraged tools"
          highlight={
            discouragedSelectionRate < 0.1
              ? "success"
              : discouragedSelectionRate < 0.3
                ? "warning"
                : "error"
          }
        />
      </div>

      <div className="mt-3 pt-3 border-t border-trace-border/50">
        <div className="text-[11px] text-trace-muted mb-2">
          Selection Breakdown
        </div>
        <div className="flex gap-2">
          <Tooltip content="Tools the skill preferred">
            <span className="px-2 py-1 rounded bg-state-success/10 text-state-success text-[11px]">
              {preferredSelections} preferred
            </span>
          </Tooltip>
          <Tooltip content="Tools with no preference">
            <span className="px-2 py-1 rounded bg-trace-border/30 text-trace-muted text-[11px]">
              {neutralSelections} neutral
            </span>
          </Tooltip>
          <Tooltip content="Tools the skill discouraged">
            <span className="px-2 py-1 rounded bg-state-error/10 text-state-error text-[11px]">
              {discouragedSelections} discouraged
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function MetricBox({
  label,
  value,
  tooltip,
  highlight,
}: {
  label: string;
  value: string | number;
  tooltip: string;
  highlight?: "success" | "warning" | "error";
}) {
  const highlightClasses = {
    success: "text-state-success",
    warning: "text-state-warning",
    error: "text-state-error",
  };

  return (
    <Tooltip content={tooltip}>
      <div className="bg-trace-bg border border-trace-border/50 rounded p-2.5 cursor-help">
        <div className="text-[10px] uppercase tracking-wider text-trace-muted mb-1">
          {label}
        </div>
        <div
          className={`text-lg font-semibold ${
            highlight ? highlightClasses[highlight] : "text-trace-text"
          }`}
        >
          {value}
        </div>
      </div>
    </Tooltip>
  );
}

function SkillEventStream({ session }: { session: TraceSession }) {
  const [filter, setFilter] = useState<"all" | "ranking" | "selection">("all");

  // Extract skill events from trace entries
  const events = extractSkillEvents(session);

  const filteredEvents =
    filter === "all"
      ? events
      : events.filter((e) =>
          filter === "ranking"
            ? e.type === "ranking_applied"
            : e.type === "tool_selected",
        );

  if (events.length === 0) {
    return (
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-2">
          Skill Event Stream
        </div>
        <div className="text-sm text-trace-muted">
          No skill events recorded.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide">
          Skill Event Stream
        </div>
        <div className="flex gap-1">
          {(["all", "ranking", "selection"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                filter === f
                  ? "bg-trace-accent text-white border-trace-accent"
                  : "bg-transparent text-trace-muted border-trace-border hover:text-trace-text"
              }`}
            >
              {f === "all"
                ? "All"
                : f === "ranking"
                  ? "Rankings"
                  : "Selections"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filteredEvents.map((event, i) => (
          <SkillEventRow key={i} event={event} />
        ))}
      </div>
    </div>
  );
}

function SkillEventRow({ event }: { event: SkillEvent }) {
  const isRanking = event.type === "ranking_applied";

  return (
    <div className="flex items-start gap-2 p-2 bg-trace-bg border border-trace-border/50 rounded">
      <div
        className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${
          isRanking
            ? "bg-trace-accent/20 text-trace-accent"
            : event.preference === "preferred"
              ? "bg-state-success/20 text-state-success"
              : event.preference === "discouraged"
                ? "bg-state-error/20 text-state-error"
                : "bg-trace-border/30 text-trace-muted"
        }`}
      >
        {isRanking ? "R" : "S"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-trace-text">
          {isRanking ? (
            <>
              Applied rankings for{" "}
              <span className="font-medium">{event.skillId}</span>
            </>
          ) : (
            <>
              Selected <span className="font-medium">{event.toolName}</span>{" "}
              {event.preference && (
                <Badge
                  variant={
                    event.preference === "preferred"
                      ? "completed"
                      : event.preference === "discouraged"
                        ? "error"
                        : "type"
                  }
                >
                  {event.preference}
                </Badge>
              )}
            </>
          )}
        </div>
        <div className="text-[10px] text-trace-muted mt-0.5">
          Turn {event.turn}
        </div>
        {isRanking && event.preferredTools && (
          <CollapsibleSection
            label={<span className="text-[10px]">Tool preferences</span>}
            className="mt-1"
          >
            <div className="text-[11px] space-y-1 mt-1">
              <div>
                <span className="text-state-success">Preferred:</span>{" "}
                {event.preferredTools?.join(", ") || "None"}
              </div>
              <div>
                <span className="text-state-error">Discouraged:</span>{" "}
                {event.discouragedTools?.join(", ") || "None"}
              </div>
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

function extractSkillEvents(session: TraceSession): SkillEvent[] {
  const events: SkillEvent[] = [];

  // This is a placeholder - in reality, we'd need access to the trace entries
  // For now, we'll create events from the skillToolMetrics if available
  const metrics = session.skillToolMetrics;
  if (metrics) {
    // Add a summary event
    events.push({
      turn: 1,
      type: "ranking_applied",
      skillId: metrics.skillId,
      preferredTools: [],
      discouragedTools: [],
    });
  }

  return events;
}
