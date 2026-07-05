import React, { useMemo } from "react";
import type { TraceSession } from "../../../types/traces";
import {
  ACTION_TIER_LABEL,
  buildTrajectoryScorecard,
} from "../../analysis";
import type {
  ActionTier,
  TrajectoryScore,
  TrajectoryVerdict,
} from "../../analysis";
import { useStore } from "../../store";
import Tooltip from "../Tooltip";
import { Eyebrow } from "../SectionCard";

// Shared tier styling, also used by the per-turn chips in TurnCard.
export const TIER_CHIP_CLASS: Record<ActionTier, string> = {
  T0: "bg-trace-bg text-trace-muted border-trace-border",
  T1: "bg-trace-accent/10 text-trace-accent-light border-trace-accent/25",
  T2: "bg-state-warning/10 text-state-warning border-state-warning/25",
  T3: "bg-state-error/10 text-state-error border-state-error/25",
};

export function ActionTierChip({
  tier,
  title,
  className = "",
}: {
  tier: ActionTier;
  title?: string;
  className?: string;
}) {
  const chip = (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[9px] font-mono font-semibold ${TIER_CHIP_CLASS[tier]} ${className}`}
    >
      {tier}
      <span className="font-sans font-medium opacity-80">
        {ACTION_TIER_LABEL[tier]}
      </span>
    </span>
  );
  return title ? <Tooltip content={title}>{chip}</Tooltip> : chip;
}

const VERDICT_META: Record<
  TrajectoryVerdict,
  { label: string; dot: string; text: string; ring: string }
> = {
  pass: {
    label: "Pass",
    dot: "bg-state-success",
    text: "text-state-success",
    ring: "border-state-success/30 bg-state-success/5",
  },
  non_fail: {
    label: "Non-fail",
    dot: "bg-state-warning",
    text: "text-state-warning",
    ring: "border-state-warning/30 bg-state-warning/5",
  },
  fail: {
    label: "Fail",
    dot: "bg-state-error",
    text: "text-state-error",
    ring: "border-state-error/30 bg-state-error/5",
  },
};

function scoreTone(score: TrajectoryScore): string {
  if (score >= 5) return "bg-state-success";
  if (score >= 3) return "bg-state-warning";
  return "bg-state-error";
}

function DimensionMeter({
  label,
  score,
  rationale,
}: {
  label: string;
  score: TrajectoryScore;
  rationale: string;
}) {
  const tone = scoreTone(score);
  return (
    <Tooltip content={rationale}>
      <div className="min-w-0 cursor-help rounded border border-trace-border/70 bg-trace-bg px-2.5 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[10px] uppercase tracking-wide text-trace-subtle">
            {label}
          </span>
          <span className="shrink-0 text-[11px] font-bold tabular-nums text-trace-text">
            {score}
            <span className="text-trace-dim">/5</span>
          </span>
        </div>
        <div className="mt-1.5 flex gap-0.5" aria-hidden>
          {[1, 2, 3, 4, 5].map((slot) => (
            <span
              key={slot}
              className={`h-1.5 flex-1 rounded-sm ${
                slot <= score ? tone : "bg-trace-border"
              }`}
            />
          ))}
        </div>
      </div>
    </Tooltip>
  );
}

interface TrajectoryScorecardProps {
  session: TraceSession;
}

export default function TrajectoryScorecard({
  session,
}: TrajectoryScorecardProps) {
  const entries = useStore((s) => s.currentEntries);

  const scorecard = useMemo(
    () => buildTrajectoryScorecard({ session, entries }),
    [session, entries],
  );

  if (entries.length === 0) return null;

  const verdict = VERDICT_META[scorecard.verdict];
  const ungated = scorecard.unescalatedHighTierTurns;

  return (
    <div
      className={`mb-4 rounded-lg border ${verdict.ring} px-4 py-3`}
      data-testid="trajectory-scorecard"
    >
      {/* Verdict row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Eyebrow>Trajectory</Eyebrow>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${verdict.dot}`} />
          <span className={`text-sm font-bold ${verdict.text}`}>
            {verdict.label}
          </span>
          <span className="text-sm font-bold tabular-nums text-trace-text">
            {scorecard.overallScore}
            <span className="text-trace-dim">/5</span>
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-trace-muted">
          <span>{String(scorecard.outcome).replace(/_/g, " ")}</span>
          <span className="text-trace-dim">·</span>
          <span>{scorecard.turnCount} turns</span>
          <span className="text-trace-dim">·</span>
          <span>{scorecard.taskType.replace(/_/g, "-")}</span>
        </span>
      </div>

      {/* Dimension meters — graded to the lowest (overall = min) */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {scorecard.dimensions.map((d) => (
          <DimensionMeter
            key={d.key}
            label={d.label}
            score={d.score}
            rationale={d.rationale}
          />
        ))}
      </div>

      {/* Action-tier summary */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-trace-muted">Peak action</span>
        <ActionTierChip
          tier={scorecard.highestActionTier}
          title={`Highest action tier reached across the trajectory`}
        />
        {ungated.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-state-error">
            <span aria-hidden>⚠</span>
            {ungated.length} ungated high-tier{" "}
            {ungated.length === 1 ? "turn" : "turns"}
            <span className="font-mono text-trace-muted">
              (#{ungated.slice(0, 4).join(", #")}
              {ungated.length > 4 ? "…" : ""})
            </span>
          </span>
        ) : (
          <span className="text-trace-muted">· no ungated high-tier actions</span>
        )}
      </div>
    </div>
  );
}
