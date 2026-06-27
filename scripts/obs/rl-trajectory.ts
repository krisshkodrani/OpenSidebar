/**
 * RL trajectory derivation (RFC LP-7, Stage B3). Projects a recorded session
 * into the OpenClaw `(state, action, reward)` data unit. Lives server-side (not
 * in the schema package) because it reuses the trace-viewer scorecard analysis:
 * the terminal reward is the OpenClaw 1–5 "grade to the lowest dimension" score,
 * and per-turn action tiers come from the same `TurnActionProfile`. Blob refs in
 * each state reuse the Stage B0 span mapper, so spans and trajectory agree.
 */

import { analyzeTraceSession } from "../../apps/extension/src/trace-viewer/analysis/analyze";
import { buildTrajectoryScorecard } from "../../apps/extension/src/trace-viewer/analysis/trajectory";
import type {
  TraceEntry,
  TraceSession,
} from "../../apps/extension/src/types/traces";
import { traceEntryToSpans } from "../../packages/observability-schema/src/map-trace-entry";
import type {
  RlStep,
  RlTrajectory,
} from "../../packages/observability-schema/src/rl-trajectory";

export function buildRlTrajectory(
  session: TraceSession,
  entries: TraceEntry[],
): RlTrajectory {
  const investigation = analyzeTraceSession({ session, entries });
  const scorecard = buildTrajectoryScorecard({ session, entries, investigation });

  const byTurn = new Map<number, TraceEntry>();
  for (const entry of entries) byTurn.set(entry.turnNumber, entry);

  const steps: RlStep[] = scorecard.turnProfiles.map((profile) => {
    const entry = byTurn.get(profile.turnNumber);
    const blobs = entry
      ? traceEntryToSpans(entry)
          .flatMap((span) => span.blobs ?? [])
          .map((blob) => blob.ref)
      : [];
    const allSuccess =
      profile.tools.length > 0 && profile.tools.every((tool) => tool.success);
    // Shaped reward: unescalated high-tier action is the safety hotspot OpenClaw
    // flags first; otherwise reward clean all-success turns.
    const reward = profile.unescalatedHighTier ? -1 : allSuccess ? 1 : 0;
    return {
      turn: profile.turnNumber,
      state: {
        url: entry?.snapshot.url,
        perception: entry?.perception?.interpretation,
        blobs,
      },
      action: {
        tools: profile.tools.map((tool) => ({
          name: tool.toolName,
          tier: tool.tier,
          success: tool.success,
        })),
        text: entry?.llmResponse.content ?? undefined,
      },
      reward,
    };
  });

  return {
    sessionId: scorecard.sessionId,
    taskType: scorecard.taskType,
    steps,
    reward: scorecard.overallScore,
    verdict: scorecard.verdict,
    rubric: "openclaw-1-5-grade-to-lowest",
  };
}
