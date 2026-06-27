import React, { useEffect, useState } from "react";
import type { RlTrajectory } from "@observability-schema";
import type { TraceSession } from "../../../types/traces";
import { fetchRlTrajectory } from "../../api";

interface TrajectoryTabProps {
  session: TraceSession;
}

/**
 * RL Trajectory tab (RFC LP-7, Stage B4). Fetches the OpenClaw
 * (state, action, reward) projection for the selected session and renders the
 * terminal 1–5 reward plus each step's state/action/reward. Distinct from the
 * "Trajectory" (turns) tab, which is the human turn-by-turn timeline.
 */
export default function TrajectoryTab({ session }: TrajectoryTabProps) {
  const [trajectory, setTrajectory] = useState<RlTrajectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setTrajectory(null);
    fetchRlTrajectory(session.sessionId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setTrajectory(result);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session.sessionId]);

  if (loading) {
    return (
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4 text-sm text-trace-muted">
        Building RL trajectory…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-trace-panel border border-state-error/25 rounded-lg p-4 text-sm text-state-error">
        Failed to load RL trajectory: {error}
      </div>
    );
  }
  if (!trajectory || trajectory.steps.length === 0) {
    return (
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4 text-sm text-trace-muted">
        No RL trajectory available for this session.
      </div>
    );
  }

  const rewardTone =
    trajectory.reward >= 5
      ? "text-state-success"
      : trajectory.reward >= 3
        ? "text-state-warning"
        : "text-state-error";

  return (
    <div className="space-y-4">
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <span className="text-[11px] uppercase tracking-wide text-trace-muted">
            RL Trajectory
          </span>
          <span className={`text-lg font-semibold ${rewardTone}`}>
            Reward {trajectory.reward}/5
          </span>
          <span className="px-2 py-0.5 rounded bg-trace-border/30 text-trace-muted text-[11px] uppercase">
            {trajectory.verdict}
          </span>
          <span className="px-2 py-0.5 rounded bg-trace-border/30 text-trace-muted text-[11px]">
            {trajectory.taskType.replace("_", " ")}
          </span>
        </div>
        <div className="text-[11px] text-trace-muted">
          Graded on the OpenClaw 1–5 grade-to-lowest rubric · {trajectory.steps.length}{" "}
          step(s)
        </div>
      </div>

      <div className="space-y-2">
        {trajectory.steps.map((step) => (
          <div
            key={step.turn}
            className="bg-trace-bg border border-trace-border/50 rounded p-3"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-medium text-trace-text">
                Turn {step.turn}
              </span>
              <span
                className={`text-[11px] ${
                  step.reward > 0
                    ? "text-state-success"
                    : step.reward < 0
                      ? "text-state-error"
                      : "text-trace-muted"
                }`}
              >
                reward {step.reward}
              </span>
            </div>
            {step.state.url && (
              <div className="text-[11px] text-trace-muted truncate">
                {step.state.url}
              </div>
            )}
            {step.state.perception && (
              <div className="text-[11px] text-trace-subtle mt-1">
                {step.state.perception.slice(0, 200)}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              {step.action.tools.length === 0 ? (
                <span className="text-[11px] text-trace-muted italic">
                  no tools
                </span>
              ) : (
                step.action.tools.map((tool, index) => (
                  <span
                    key={`${step.turn}:${index}:${tool.name}`}
                    className={`px-2 py-0.5 rounded text-[11px] ${
                      tool.success
                        ? "bg-state-success/10 text-state-success"
                        : "bg-state-error/10 text-state-error"
                    }`}
                  >
                    {tool.name} <span className="opacity-60">{tool.tier}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
