// Run-story spine — reshapes an orchestrator run's raw event stream into the
// narrative a HUMAN adjudicator reads: plan -> node segments -> turns ->
// verification -> judge rulings -> reroutes -> completion. The trace viewer
// already fetches ~50 run-event types but renders none of them; this module is
// the single place that maps that firehose into an ordered, bucketed story.
//
// Pure and deterministic (no runtime imports, no clock) so it stays
// environment-agnostic and unit-testable. Everything the UI needs to draw the
// TrajectorySpine + JudgeCallCard comes out of `buildRunStory`. Event types we
// don't specifically model fall into `unknownEvents` (count + sample) rather
// than being silently dropped — silent truncation reads as "nothing happened".

import type { TraceEntry, TraceSession } from "../../types/traces";
import type { RunTraceEvent } from "../../utils/run-trace";

// ── Public shape ────────────────────────────────────────────────

export type SegmentStatus =
  | "completed"
  | "failed"
  | "rerouted"
  | "skipped"
  | "running"
  | "unknown";

export type MarkerSeverity = "info" | "warn" | "error" | "success";

/** A judge adjudication as emitted by high-risk-judge-gate.ts `judge_call`. */
export interface JudgeCallSummary {
  ts?: string;
  nodeId?: string;
  decision?: string; // "accept" | "reroute"
  judged?: boolean;
  verdictSource?: string; // "judge" | "fail_open"
  failureCause?: string;
  failureDetail?: string;
  durationMs?: number;
  model?: string;
  providerId?: string;
  confidence?: number;
  criteria: Array<{ id: string; description: string; required?: boolean }>;
  perCriterion: Array<{ id: string; pass: boolean; rationale?: string }>;
  entailment: Array<{ claimKey: string; label: string }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd?: number;
  };
}

/** A non-segment-defining event surfaced inline (escalation, budget, advisory…). */
export interface SpineMarker {
  kind: string; // raw event type
  label: string; // humanized
  detail?: string;
  severity: MarkerSeverity;
  ts?: string;
  turn?: number;
}

export interface SpineTurnRef {
  turnNumber: number;
  ts?: string;
}

export interface NodeSegment {
  nodeId: string;
  /** Plan order when known (from the plan graph), else appearance order. */
  index: number;
  title: string;
  status: SegmentStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
  verification?: { decision?: string; confidence?: number; failureType?: string };
  failureReason?: string;
  /** Best-effort successor node id when the judge rerouted this node. */
  reroutedTo?: string;
  judgeCalls: JudgeCallSummary[];
  markers: SpineMarker[];
  turns: SpineTurnRef[];
  /** True for the single synthetic segment created when the run had no plan. */
  synthetic?: boolean;
}

export interface PlanSummary {
  present: boolean;
  nodeCount?: number;
  structured?: boolean;
  fallback?: boolean;
  difficulty?: string;
  confirmed?: boolean;
  confirmationDecision?: string;
  /** Subtask objectives from the session's plan decomposition, plan order. */
  subtasks: string[];
  replans: SpineMarker[];
}

export interface CompletionSummary {
  outcome?: string;
  markers: SpineMarker[];
}

export interface UnknownEventBucket {
  type: string;
  count: number;
}

export interface RunStory {
  hasRunEvents: boolean;
  plan: PlanSummary;
  /** Markers that occurred before the first node segment began. */
  preludeMarkers: SpineMarker[];
  segments: NodeSegment[];
  completion: CompletionSummary;
  /** Low-signal infra events, hidden behind the viewer's "system events" drawer. */
  systemEvents: SpineMarker[];
  unknownEvents: UnknownEventBucket[];
  /** Turns not claimed by any segment (rendered loose). */
  looseTurns: SpineTurnRef[];
}

// ── Event classification ────────────────────────────────────────

const PLAN_DECOMPOSE = new Set(["plan_decomposed", "plan_decomposition"]);
const PLAN_CONFIRM = new Set([
  "plan_confirmation",
  "plan_confirmation_cancelled",
]);
const REPLAN = new Set([
  "planner_replan",
  "plan_feedback_replan",
  "horizon_expansion",
  "large_exhaustive_review_graph",
  "replan_budget_exhausted",
]);

const NODE_START = new Set(["node_started"]);
const NODE_DONE = new Set(["node_completed"]);
const NODE_VERIFIED = new Set(["node_verified"]);
const NODE_FAIL = new Set(["node_failure_attribution"]);
const NODE_SKIP = new Set([
  "user_skipped_node",
  "node_already_terminal",
  "skip_node",
]);

const JUDGE_CALL = "judge_call";
const JUDGE_REROUTE = "judge_gate_reroute";

const COMPLETION = new Set([
  "task_completed",
  "task_completion_payload_completed",
  "completion_scope_transition",
  "global_goal_gate",
  "global_goal_already_achieved",
  "navigation_goal_gate",
  "navigation_goal_already_achieved",
  "accepted_terminal_completion_after_executor_timeout",
  "task_stopped",
  "task_stop_requested",
  "task_stop_forced",
]);

// Segment-attached markers (nearest preceding segment).
const SEGMENT_MARKER = new Set([
  "escalation_requested",
  "escalation_decision_received",
  "escalation_timeout",
  "budget_limit_adjusted",
  "budget_warning",
  "advisory_issued",
  "reflexion_recorded",
  "cross_role_reflexion",
  "evidence_attached",
  "partial_handoff_created",
  "checkpoint",
  "checkpoint_turn_discarded",
  "checkpoint_turn_restored",
  "task_resumed_from_checkpoint",
  "task_resume_source_selected",
  "task_resume_backend_accepted",
  "task_resume_rebinding_rejected",
  "pending_interaction_restored",
  "pending_interaction_restored_from_backend",
  "pending_interaction_timed_out",
  "scheduler_deadlock",
  "verifier_accept",
  "verifier_advisory",
  "verifier_reroute",
  "verifier_retry",
  "completion_envelope_verification",
]);

// Low-signal infra events → "system events" drawer.
const SYSTEM_EVENT = new Set([
  "worker_created",
  "worker_queued",
  "worker_started",
  "worker_blocked_resource",
  "worker_released",
  "worker_released_resource",
  "worker_cancelled",
  "worker_result_ignored",
  "scheduler_executor_lane_retry",
  "scheduler_executor_lane_wait",
  "scheduler_dependency_failed",
  "tab_coordination_state",
  "executor_started",
  "executor_finished",
  "executor_loop_completed",
  "executor_lane_isolation",
  "lane_isolated",
  "node_bound",
  "planner_llm_call",
]);

// Run-scoped bookkeeping we intentionally ignore (not "unknown").
const IGNORED = new Set(["task_started"]);

// ── Helpers ─────────────────────────────────────────────────────

function humanize(type: string): string {
  return type.replace(/_/g, " ");
}

function severityFor(type: string, data: Record<string, unknown>): MarkerSeverity {
  const hay = `${type} ${JSON.stringify(data ?? {})}`.toLowerCase();
  if (/(fail|error|deadlock|timeout|rejected|exhaust|blocked)/.test(hay)) {
    return "error";
  }
  if (/(reroute|warning|budget|escalat|advisory|retry|skip|reflexion)/.test(hay)) {
    return "warn";
  }
  if (/(complete|verified|accept|restored|achieved)/.test(hay)) return "success";
  return "info";
}

function toMs(ts: string | undefined): number {
  if (!ts) return NaN;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : NaN;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function markerDetail(data: Record<string, unknown>): string | undefined {
  const reason = asString(data.reason) ?? asString(data.detail);
  if (reason) return reason.slice(0, 200);
  // Fall back to a compact key list so the marker is never empty.
  const keys = Object.keys(data ?? {}).filter(
    (k) => k !== "nodeId" && k !== "taskId",
  );
  return keys.length ? keys.slice(0, 6).join(", ") : undefined;
}

function makeMarker(event: RunTraceEvent): SpineMarker {
  const data = event.data ?? {};
  return {
    kind: event.type,
    label: humanize(event.type),
    detail: markerDetail(data),
    severity: severityFor(event.type, data),
    ts: event.ts,
    turn: event.turn,
  };
}

function parseJudgeCall(event: RunTraceEvent): JudgeCallSummary {
  const d = event.data ?? {};
  const criteria = Array.isArray(d.criteria)
    ? (d.criteria as Array<Record<string, unknown>>).map((c) => ({
        id: String(c.id ?? ""),
        description: asString(c.description) ?? "",
        required: typeof c.required === "boolean" ? c.required : undefined,
      }))
    : [];
  const perCriterion = Array.isArray(d.perCriterion)
    ? (d.perCriterion as Array<Record<string, unknown>>).map((c) => ({
        id: String(c.id ?? ""),
        pass: c.pass === true,
        rationale: asString(c.rationale),
      }))
    : [];
  const entailment = Array.isArray(d.entailment)
    ? (d.entailment as Array<Record<string, unknown>>).map((e) => ({
        claimKey: String(e.claimKey ?? ""),
        label: String(e.label ?? ""),
      }))
    : [];
  const rawUsage = d.usage as Record<string, unknown> | undefined;
  const usage = rawUsage
    ? {
        promptTokens: asNumber(rawUsage.promptTokens) ?? 0,
        completionTokens: asNumber(rawUsage.completionTokens) ?? 0,
        totalTokens: asNumber(rawUsage.totalTokens) ?? 0,
        ...(asNumber(rawUsage.costUsd) != null
          ? { costUsd: asNumber(rawUsage.costUsd) }
          : {}),
      }
    : undefined;
  return {
    ts: event.ts,
    nodeId: asString(d.nodeId),
    decision: asString(d.decision),
    judged: typeof d.judged === "boolean" ? d.judged : undefined,
    verdictSource: asString(d.verdictSource),
    failureCause: asString(d.failureCause),
    failureDetail: asString(d.failureDetail),
    durationMs: asNumber(d.durationMs),
    model: asString(d.model),
    providerId: asString(d.providerId),
    confidence: asNumber(d.confidence),
    criteria,
    perCriterion,
    entailment,
    usage,
  };
}

/** Map nodeId -> plan order from a plan_decomposed graph, when present. */
function planOrderFromGraph(events: RunTraceEvent[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const event of events) {
    if (!PLAN_DECOMPOSE.has(event.type)) continue;
    const graph = (event.data as Record<string, unknown> | undefined)?.graph as
      | { nodes?: Array<{ nodeId?: unknown; index?: unknown }> }
      | undefined;
    for (const n of graph?.nodes ?? []) {
      const id = asString(n.nodeId);
      const idx = asNumber(n.index);
      if (id != null && idx != null && !order.has(id)) order.set(id, idx);
    }
  }
  return order;
}

/** Objective text per plan index, from the session's decomposition. */
function subtasksFromSession(session: TraceSession | null | undefined): string[] {
  const decomp = session?.planDecomposition;
  if (!decomp) return [];
  if (decomp.steps?.length) {
    return decomp.steps.map(
      (s, i) => s.objective || decomp.subtasks?.[i] || "",
    );
  }
  return decomp.subtasks ?? [];
}

// ── Core ────────────────────────────────────────────────────────

export function buildRunStory(
  events: RunTraceEvent[],
  entries: TraceEntry[],
  session: TraceSession | null | undefined,
): RunStory {
  // Stable chronological sort — tolerate missing / out-of-order timestamps by
  // keeping original order as the tiebreak (and for unparseable ts).
  const ordered = events
    .map((event, i) => ({ event, i }))
    .sort((a, b) => {
      const ta = toMs(a.event.ts);
      const tb = toMs(b.event.ts);
      if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return a.i - b.i;
      return ta - tb;
    })
    .map((x) => x.event);

  const planOrder = planOrderFromGraph(ordered);
  const subtasks = subtasksFromSession(session);

  const plan: PlanSummary = { present: false, subtasks, replans: [] };
  const completion: CompletionSummary = {
    outcome: session?.outcome,
    markers: [],
  };
  const preludeMarkers: SpineMarker[] = [];
  const systemEvents: SpineMarker[] = [];
  const unknown = new Map<string, number>();

  const segments: NodeSegment[] = [];
  const byNodeId = new Map<string, NodeSegment>();

  const titleFor = (nodeId: string, order: number): string => {
    const idx = planOrder.get(nodeId);
    const obj = idx != null ? subtasks[idx] : subtasks[order];
    return (obj && obj.trim()) || nodeId;
  };

  const ensureSegment = (nodeId: string): NodeSegment => {
    let seg = byNodeId.get(nodeId);
    if (seg) return seg;
    const order = planOrder.get(nodeId) ?? segments.length;
    seg = {
      nodeId,
      index: order,
      title: titleFor(nodeId, segments.length),
      status: "running",
      judgeCalls: [],
      markers: [],
      turns: [],
    };
    byNodeId.set(nodeId, seg);
    segments.push(seg);
    return seg;
  };

  const lastSegment = (): NodeSegment | undefined =>
    segments[segments.length - 1];

  // Track judge reroutes so we can wire a best-effort successor arrow: the
  // first node started AFTER the reroute event is treated as the successor.
  const pendingReroutes: NodeSegment[] = [];

  for (const event of ordered) {
    const type = event.type;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const nodeId = asString(data.nodeId);

    if (IGNORED.has(type)) continue;

    if (PLAN_DECOMPOSE.has(type)) {
      plan.present = true;
      plan.nodeCount = asNumber(data.nodeCount) ?? plan.nodeCount;
      if (typeof data.structured === "boolean") plan.structured = data.structured;
      if (typeof data.fallback === "boolean") plan.fallback = data.fallback;
      plan.difficulty = asString(data.difficulty) ?? plan.difficulty;
      continue;
    }
    if (PLAN_CONFIRM.has(type)) {
      plan.confirmationDecision = asString(data.decision) ?? plan.confirmationDecision;
      plan.confirmed =
        type === "plan_confirmation" &&
        (asString(data.decision)?.startsWith("approve") ?? false);
      continue;
    }
    if (REPLAN.has(type)) {
      plan.replans.push(makeMarker(event));
      continue;
    }

    if (NODE_START.has(type) && nodeId) {
      const seg = ensureSegment(nodeId);
      seg.startedAt = event.ts;
      // Any reroute waiting for a successor binds to this newly started node.
      while (pendingReroutes.length) {
        const from = pendingReroutes.pop();
        if (from && from.nodeId !== nodeId) from.reroutedTo = nodeId;
      }
      continue;
    }
    if (NODE_DONE.has(type) && nodeId) {
      const seg = ensureSegment(nodeId);
      seg.completedAt = event.ts;
      seg.summary = asString(data.summary);
      seg.durationMs = asNumber(data.durationMs);
      const outcome = asString(data.outcome);
      if (seg.status === "running") {
        seg.status =
          outcome === "failed"
            ? "failed"
            : outcome === "skipped"
              ? "skipped"
              : "completed";
      }
      continue;
    }
    if (NODE_VERIFIED.has(type) && nodeId) {
      const seg = ensureSegment(nodeId);
      seg.verification = {
        decision: asString(data.decision),
        confidence: asNumber(data.confidence),
        failureType: asString(data.failureType),
      };
      continue;
    }
    if (NODE_FAIL.has(type) && nodeId) {
      const seg = ensureSegment(nodeId);
      seg.status = "failed";
      seg.failureReason = asString(data.reason);
      continue;
    }
    if (NODE_SKIP.has(type) && nodeId) {
      const seg = ensureSegment(nodeId);
      if (seg.status === "running") seg.status = "skipped";
      seg.markers.push(makeMarker(event));
      continue;
    }

    if (type === JUDGE_CALL) {
      const call = parseJudgeCall(event);
      const seg = nodeId ? ensureSegment(nodeId) : lastSegment();
      if (seg) {
        seg.judgeCalls.push(call);
        if (call.decision === "reroute") {
          seg.status = "rerouted";
          pendingReroutes.push(seg);
        }
      } else {
        preludeMarkers.push(makeMarker(event));
      }
      continue;
    }
    if (type === JUDGE_REROUTE) {
      const seg = nodeId ? ensureSegment(nodeId) : lastSegment();
      if (seg) {
        seg.status = "rerouted";
        seg.markers.push(makeMarker(event));
        pendingReroutes.push(seg);
      } else {
        preludeMarkers.push(makeMarker(event));
      }
      continue;
    }

    if (COMPLETION.has(type)) {
      completion.markers.push(makeMarker(event));
      continue;
    }

    if (SYSTEM_EVENT.has(type)) {
      systemEvents.push(makeMarker(event));
      continue;
    }

    if (SEGMENT_MARKER.has(type)) {
      const seg = (nodeId && byNodeId.get(nodeId)) || lastSegment();
      if (seg) seg.markers.push(makeMarker(event));
      else preludeMarkers.push(makeMarker(event));
      continue;
    }

    unknown.set(type, (unknown.get(type) ?? 0) + 1);
  }

  // ── Turn assignment ───────────────────────────────────────────
  const sortedEntries = [...entries].sort(
    (a, b) => a.timestamp - b.timestamp || a.turnNumber - b.turnNumber,
  );
  const looseTurns: SpineTurnRef[] = [];

  if (segments.length === 0 && sortedEntries.length > 0) {
    // No plan / no node events: one synthetic root segment covering every turn.
    const root: NodeSegment = {
      nodeId: "(root)",
      index: 0,
      title: session?.query?.slice(0, 120) || "Run",
      status: statusFromOutcome(session?.outcome),
      judgeCalls: [],
      markers: preludeMarkers.splice(0, preludeMarkers.length),
      turns: sortedEntries.map((e) => ({
        turnNumber: e.turnNumber,
        ts: isoOrUndefined(e.timestamp),
      })),
      synthetic: true,
    };
    segments.push(root);
  } else {
    const bounds = segments.map((seg) => ({
      seg,
      start: toMs(seg.startedAt),
      end: toMs(seg.completedAt),
    }));
    for (const entry of sortedEntries) {
      const ref: SpineTurnRef = {
        turnNumber: entry.turnNumber,
        ts: isoOrUndefined(entry.timestamp),
      };
      const seg = assignTurn(entry.timestamp, bounds);
      if (seg) seg.turns.push(ref);
      else looseTurns.push(ref);
    }
  }

  return {
    hasRunEvents: events.length > 0,
    plan,
    preludeMarkers,
    segments,
    completion,
    systemEvents,
    unknownEvents: [...unknown.entries()].map(([type, count]) => ({
      type,
      count,
    })),
    looseTurns,
  };
}

function statusFromOutcome(outcome: string | undefined): SegmentStatus {
  switch (outcome) {
    case "completed":
      return "completed";
    case "error":
    case "max_turns":
    case "stopped":
      return "failed";
    default:
      return "unknown";
  }
}

function isoOrUndefined(ms: number): string | undefined {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/**
 * Assign a turn (by numeric ms timestamp) to the segment whose
 * [startedAt, completedAt] interval contains it; otherwise the nearest segment
 * that had already started. Returns undefined only when no segment had started.
 */
function assignTurn(
  turnMs: number,
  bounds: Array<{ seg: NodeSegment; start: number; end: number }>,
): NodeSegment | undefined {
  let containing: NodeSegment | undefined;
  let nearestBefore: { seg: NodeSegment; start: number } | undefined;
  for (const b of bounds) {
    if (Number.isNaN(b.start)) continue;
    const end = Number.isNaN(b.end) ? Infinity : b.end;
    if (turnMs >= b.start && turnMs <= end) {
      containing = b.seg;
    }
    if (b.start <= turnMs) {
      if (!nearestBefore || b.start > nearestBefore.start) {
        nearestBefore = { seg: b.seg, start: b.start };
      }
    }
  }
  return containing ?? nearestBefore?.seg;
}
