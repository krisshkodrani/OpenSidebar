import React from "react";
import type { JudgeCallSummary } from "../../../analysis/spine";
import { formatDuration, formatCost, formatTokens } from "../../../utils";
import Badge from "../../Badge";

// Renders one judge adjudication (the `judge_call` run-event, enriched in P1):
// the accept/reroute decision, the model + confidence + latency + cost, the
// per-criterion rulings joined to their descriptions, and entailment labels.
// This is the single most important artifact for a human adjudicating whether
// the run's completion should be trusted — so it shows the judge's reasoning,
// not just its verdict.

const ENTAILMENT_TONE: Record<string, string> = {
  entailed: "text-state-success",
  contradicted: "text-state-error",
  unsupported: "text-trace-muted",
};

export default function JudgeCallCard({ call }: { call: JudgeCallSummary }) {
  const rerouted = call.decision === "reroute";
  const failedOpen = call.verdictSource === "fail_open";
  const descById = new Map(call.criteria.map((c) => [c.id, c.description]));

  const tone = failedOpen
    ? "border-state-warning/30"
    : rerouted
      ? "border-state-error/30"
      : "border-state-success/30";

  return (
    <div className={`rounded-md border ${tone} bg-trace-bg/60 p-3`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
          Judge
        </span>
        <Badge variant={rerouted ? "failure" : failedOpen ? "max_turns" : "success"}>
          {failedOpen ? "failed open" : call.decision || "—"}
        </Badge>
        {call.model && <Badge variant="model">{call.model}</Badge>}
        {typeof call.confidence === "number" && (
          <span className="text-[10px] text-trace-dim">
            conf {call.confidence.toFixed(2)}
          </span>
        )}
        {typeof call.durationMs === "number" && (
          <span className="text-[10px] text-trace-dim">
            {formatDuration(call.durationMs)}
          </span>
        )}
        {call.usage && (
          <span className="text-[10px] text-trace-dim">
            {formatTokens(call.usage.totalTokens)} tok
            {call.usage.costUsd != null && formatCost(call.usage.costUsd)
              ? ` · ${formatCost(call.usage.costUsd)}`
              : ""}
          </span>
        )}
        {call.judged === false && (
          <span className="text-[10px] text-trace-dim">(corpus-entailed, judge skipped)</span>
        )}
      </div>

      {failedOpen && (
        <div className="mb-2 text-[11px] text-state-warning">
          Judge unavailable ({call.failureCause}) — verifier accept stood.
          {call.failureDetail && (
            <span className="text-trace-dim"> {call.failureDetail}</span>
          )}
        </div>
      )}

      {call.perCriterion.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {call.perCriterion.map((c, i) => (
            <div key={`${c.id}-${i}`} className="flex items-start gap-2 text-[11px]">
              <span
                className={`mt-[1px] font-mono ${c.pass ? "text-state-success" : "text-state-error"}`}
                title={c.pass ? "pass" : "fail"}
              >
                {c.pass ? "✓" : "✗"}
              </span>
              <span className="text-trace-subtle">
                <span className="text-trace-text">
                  {descById.get(c.id) || c.id}
                </span>
                {c.rationale && (
                  <span className="text-trace-dim"> — {c.rationale}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Criteria the judge never adjudicated (corpus-entailed) still shown so
          the rubric is complete, not just the judged subset. */}
      {call.criteria
        .filter((c) => !call.perCriterion.some((p) => p.id === c.id))
        .map((c) => (
          <div key={`unj-${c.id}`} className="flex items-start gap-2 text-[11px]">
            <span className="mt-[1px] font-mono text-trace-muted" title="corpus-entailed">
              ○
            </span>
            <span className="text-trace-dim">{c.description}</span>
          </div>
        ))}

      {call.entailment.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-trace-muted">
            Facts
          </span>
          {call.entailment.map((e, i) => (
            <span
              key={`${e.claimKey}-${i}`}
              className={`font-mono text-[10px] ${ENTAILMENT_TONE[e.label] ?? "text-trace-dim"}`}
              title={e.label}
            >
              {e.claimKey}:{e.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
