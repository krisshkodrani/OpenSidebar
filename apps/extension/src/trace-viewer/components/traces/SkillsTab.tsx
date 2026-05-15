import React, { useState } from "react";
import type { TraceEntry, TraceSession } from "../../../types/traces";
import {
  extractSkillEvents,
  type SkillTraceEventView,
} from "../../analysis/skill-events";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import CollapsibleSection from "../CollapsibleSection";

interface SkillsTabProps {
  session: TraceSession;
  entries: TraceEntry[];
}

export default function SkillsTab({ session, entries }: SkillsTabProps) {
  const metrics = session.skillToolMetrics;
  const extraction = extractSkillEvents(entries);

  if (!metrics && extraction.events.length === 0) {
    return (
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4 text-sm text-trace-muted">
        No skill metrics or skill events were recorded for this session.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {metrics ? (
        <SkillMetricsCard metrics={metrics} />
      ) : (
        <div className="bg-trace-panel border border-trace-border rounded-lg p-4 text-sm text-trace-muted">
          No aggregate skill metrics available for this session.
        </div>
      )}
      <SkillEventStream events={extraction.events} />
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

function SkillEventStream({ events }: { events: SkillTraceEventView[] }) {
  const [filter, setFilter] = useState<"all" | "ranking" | "selection">("all");

  const filteredEvents =
    filter === "all"
      ? events
      : events.filter((e) =>
          filter === "ranking"
            ? e.kind === "ranking_applied"
            : e.kind === "selected",
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
        {filteredEvents.map((event) => (
          <SkillEventRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

function SkillEventRow({ event }: { event: SkillTraceEventView }) {
  const isRanking = event.kind === "ranking_applied";

  return (
    <div className="flex items-start gap-2 p-2 bg-trace-bg border border-trace-border/50 rounded">
      <div
        className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${
          isRanking
            ? "bg-trace-accent/20 text-trace-accent"
            : event.selectionPreference === "preferred"
              ? "bg-state-success/20 text-state-success"
              : event.selectionPreference === "discouraged"
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
              Selected{" "}
              <span className="font-medium">
                {event.selectedToolName ?? "unknown tool"}
              </span>{" "}
              {event.selectionPreference && (
                <Badge
                  variant={
                    event.selectionPreference === "preferred"
                      ? "completed"
                      : event.selectionPreference === "discouraged"
                        ? "error"
                        : "type"
                  }
                >
                  {event.selectionPreference}
                </Badge>
              )}
              {event.selectionMode && <Badge variant="type">{event.selectionMode}</Badge>}
            </>
          )}
        </div>
        <div className="text-[10px] text-trace-muted mt-0.5">
          Turn {event.turnNumber}
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
              <div>
                <span className="text-trace-muted">Original order:</span>{" "}
                {event.originalOrder?.join(", ") || "None"}
              </div>
              <div>
                <span className="text-trace-muted">Ranked order:</span>{" "}
                {event.rankedOrder?.join(", ") || "None"}
              </div>
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}
