import React, { useState } from "react";
import type { TraceEvent, TraceEventPayloadByType } from "../../../types/traces";
import Badge from "../Badge";
import { summarizeEventData } from "../../utils";

// ── Typed event card renderers ─────────────────────────────────────────────

function DoneRejectedCard({
  data,
}: {
  data: TraceEventPayloadByType["done_rejected"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="error">done_rejected</Badge>
      <span className="text-[11px] font-mono text-state-error">
        ×{data.rejections}
      </span>
      <span className="text-[11px] text-trace-muted">{data.reason}</span>
      {data.advancedTo != null && (
        <span className="text-[10px] text-trace-dim">→ turn {data.advancedTo}</span>
      )}
    </div>
  );
}

function CompletionDecisionCard({
  data,
}: {
  data: TraceEventPayloadByType["completion_decision"];
}) {
  const accepted = data.status === "accepted";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={accepted ? "success" : "error"}>
        completion {data.status}
      </Badge>
      {data.contractKind && (
        <span className="text-[11px] font-mono text-trace-subtle">
          {data.contractKind}
        </span>
      )}
      <span className="text-[10px] text-trace-dim">{data.source}</span>
      <span className="text-[11px] text-trace-muted">{data.reason}</span>
    </div>
  );
}

function PlanMonitorCard({
  data,
}: {
  data: TraceEventPayloadByType["plan_monitor"];
}) {
  const alignColor =
    data.alignment === "aligned"
      ? "completed"
      : data.alignment === "progressing"
        ? "type"
        : data.alignment === "deviated"
          ? "max_turns"
          : "error";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="event-plan_monitor">plan_monitor</Badge>
      <span className="text-[10px] text-trace-muted">step {data.stepIndex}</span>
      <Badge variant={alignColor as "completed" | "type" | "max_turns" | "error"}>
        {data.alignment}
      </Badge>
      {data.heuristicHit && (
        <span className="text-[9px] text-trace-dim border border-trace-border rounded px-1 py-0.5">
          heuristic
        </span>
      )}
      {data.reason && (
        <span className="text-[11px] text-trace-muted">{data.reason}</span>
      )}
    </div>
  );
}

function PlanReplanCard({
  data,
}: {
  data: TraceEventPayloadByType["plan_replan"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="event-plan_replan">plan_replan</Badge>
      <span className="text-[10px] text-trace-muted font-mono">
        #{data.replanNumber} · step {data.fromIndex} → {data.newStepCount} steps
      </span>
      {data.reason && (
        <span className="text-[11px] text-trace-muted">{data.reason}</span>
      )}
    </div>
  );
}

function CircuitBreakerCard({
  data,
}: {
  data: TraceEventPayloadByType["circuit_breaker"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="event-circuit_breaker">circuit_breaker</Badge>
      {data.reason === "consecutive_all_fail" ? (
        <span className="text-[11px] text-trace-muted font-mono">
          {data.consecutiveAllFailTurns} consecutive fail turns
        </span>
      ) : (
        <span className="text-[11px] text-trace-muted font-mono">
          {data.tool} ×{data.count}
        </span>
      )}
    </div>
  );
}

function StuckSignalCard({
  data,
}: {
  data: TraceEventPayloadByType["stuck_signal"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="event-stuck_signal">stuck_signal</Badge>
      <span className="text-[11px] text-trace-muted">
        {data.stagnantTurns} stagnant turns
      </span>
      <Badge variant="max_turns">{data.type}</Badge>
    </div>
  );
}

function ApprovalCard({ data }: { data: TraceEventPayloadByType["approval"] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="event-approval">approval</Badge>
      <Badge variant="type">{data.stage}</Badge>
      {"toolName" in data && (
        <span className="text-[11px] text-trace-muted font-mono">
          {data.toolName}
        </span>
      )}
      {"outcome" in data && (
        <Badge
          variant={
            data.outcome === "approved"
              ? "completed"
              : data.outcome === "rejected"
                ? "error"
                : "stopped"
          }
        >
          {data.outcome}
        </Badge>
      )}
      {"timeoutMs" in data && data.timeoutMs != null && (
        <span className="text-[10px] text-trace-dim">
          timeout {data.timeoutMs / 1000}s
        </span>
      )}
    </div>
  );
}

function BridgeRecoveryCard({
  data,
}: {
  data: TraceEventPayloadByType["bridge_recovery_result"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="event-bridge_recovery_result">bridge_recovery</Badge>
      <Badge variant="type">{data.phase}</Badge>
      <Badge variant={data.success ? "completed" : "error"}>
        {data.success ? "success" : "failed"}
      </Badge>
      {data.context && (
        <span className="text-[10px] text-trace-dim">{data.context}</span>
      )}
      {!data.success && data.error && (
        <span className="text-[11px] text-state-error font-mono">{data.error}</span>
      )}
    </div>
  );
}

function EscalationCard({
  data,
}: {
  data: TraceEventPayloadByType["escalation"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="event-escalation">escalation</Badge>
      {data.voluntary && <Badge variant="type">voluntary</Badge>}
      {data.reason && (
        <span className="text-[11px] text-trace-muted">{data.reason}</span>
      )}
    </div>
  );
}

function SafetyGateCard({
  data,
}: {
  data: TraceEventPayloadByType["safety_gate_blocked"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="error">safety_gate_blocked</Badge>
      <span className="text-[11px] text-trace-muted font-mono">{data.tool}</span>
      <Badge variant="type">{data.phase}</Badge>
      {data.reason && (
        <span className="text-[11px] text-trace-muted">{data.reason}</span>
      )}
    </div>
  );
}

function SkillToolCard({
  data,
}: {
  data: TraceEventPayloadByType["skill_tool_selected"];
}) {
  const prefColor =
    data.preference === "preferred"
      ? "completed"
      : data.preference === "discouraged"
        ? "error"
        : "type";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="event-skill_tool_selected">skill_tool_selected</Badge>
      <span className="text-[11px] text-trace-muted font-mono">{data.toolName}</span>
      <Badge variant={prefColor as "completed" | "error" | "type"}>
        {data.preference}
      </Badge>
      <span className="text-[10px] text-trace-dim">{data.skillId}</span>
    </div>
  );
}

// ── Generic fallback with expandable JSON payload ──────────────────────────

function GenericEventCard({ ev }: { ev: TraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload =
    ev.data &&
    typeof ev.data === "object" &&
    Object.keys(ev.data).length > 0;
  const summary = hasPayload
    ? summarizeEventData({ data: ev.data as Record<string, unknown> })
    : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={`event-${ev.type}` as `event-${string}`}>
          {ev.type}
        </Badge>
        {summary && (
          <span className="text-[11px] text-trace-muted font-mono break-all">
            {summary}
          </span>
        )}
        {hasPayload && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[9px] text-trace-dim hover:text-trace-muted border border-trace-border rounded px-1 py-0.5 transition-colors"
          >
            {expanded ? "▲ hide" : "▼ json"}
          </button>
        )}
      </div>
      {expanded && hasPayload && (
        <pre className="text-[10px] text-trace-muted font-mono bg-trace-bg border border-trace-border rounded p-2 whitespace-pre-wrap break-all overflow-auto max-h-48 mt-1">
          {JSON.stringify(ev.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Main dispatcher ────────────────────────────────────────────────────────

function renderEventCard(ev: TraceEvent, index: number): React.ReactNode {
  const data = ev.data as Record<string, unknown>;
  switch (ev.type) {
    case "done_rejected":
      return (
        <DoneRejectedCard
          key={index}
          data={data as TraceEventPayloadByType["done_rejected"]}
        />
      );
    case "completion_decision":
      return (
        <CompletionDecisionCard
          key={index}
          data={data as unknown as TraceEventPayloadByType["completion_decision"]}
        />
      );
    case "plan_monitor":
      return (
        <PlanMonitorCard
          key={index}
          data={data as TraceEventPayloadByType["plan_monitor"]}
        />
      );
    case "plan_replan":
      return (
        <PlanReplanCard
          key={index}
          data={data as TraceEventPayloadByType["plan_replan"]}
        />
      );
    case "circuit_breaker":
      return (
        <CircuitBreakerCard
          key={index}
          data={data as TraceEventPayloadByType["circuit_breaker"]}
        />
      );
    case "stuck_signal":
      return (
        <StuckSignalCard
          key={index}
          data={data as TraceEventPayloadByType["stuck_signal"]}
        />
      );
    case "approval":
      return (
        <ApprovalCard
          key={index}
          data={data as TraceEventPayloadByType["approval"]}
        />
      );
    case "bridge_recovery_result":
      return (
        <BridgeRecoveryCard
          key={index}
          data={data as TraceEventPayloadByType["bridge_recovery_result"]}
        />
      );
    case "escalation":
      return (
        <EscalationCard
          key={index}
          data={data as TraceEventPayloadByType["escalation"]}
        />
      );
    case "safety_gate_blocked":
      return (
        <SafetyGateCard
          key={index}
          data={data as TraceEventPayloadByType["safety_gate_blocked"]}
        />
      );
    case "skill_tool_selected":
      return (
        <SkillToolCard
          key={index}
          data={data as TraceEventPayloadByType["skill_tool_selected"]}
        />
      );
    default:
      return <GenericEventCard key={index} ev={ev} />;
  }
}

// ── Public component ───────────────────────────────────────────────────────

export default function TurnEventsSection({
  events,
}: {
  events: TraceEvent[];
}) {
  if (events.length === 0) return null;
  return (
    <div className="mb-2.5">
      <div className="text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1.5">
        Events
      </div>
      <div className="space-y-1.5">
        {events.map((ev, i) => (
          <div key={i} className="py-0.5">
            {renderEventCard(ev, i)}
          </div>
        ))}
      </div>
    </div>
  );
}
