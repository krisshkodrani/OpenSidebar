/**
 * RL trajectory shape (RFC LP-7, Stage B3) — the OpenClaw data unit projected
 * from a trace: an ordered sequence of (state, action, reward) steps with a
 * terminal reward graded on the OpenClaw 1-5 "grade to the lowest dimension"
 * rubric. Pure types so the server (derivation), the MCP layer, and the viewer
 * can share them. Derivation lives server-side (scripts/obs/rl-trajectory.ts)
 * because it reuses the trace-viewer scorecard analysis.
 */

export interface RlActionTool {
  name: string;
  /** OpenClaw action tier T0–T3 (read-only → external side effect). */
  tier: string;
  success: boolean;
}

export interface RlStep {
  turn: number;
  /** Observation the model acted on — blobs reference heavy payloads by ref. */
  state: {
    url?: string;
    perception?: string;
    blobs: string[];
  };
  action: {
    tools: RlActionTool[];
    text?: string;
  };
  /** Shaped per-step reward (+1 all-success, -1 unescalated high-tier, else 0). */
  reward: number;
}

export interface RlTrajectory {
  sessionId: string;
  taskType: "single_turn" | "multi_turn";
  steps: RlStep[];
  /** Terminal reward = overall 1–5 score (min across rubric dimensions). */
  reward: number;
  verdict: "pass" | "non_fail" | "fail";
  rubric: "openclaw-1-5-grade-to-lowest";
}
