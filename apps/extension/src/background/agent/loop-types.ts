/**
 * Agent loop types — result interface and type aliases
 */

import { SessionMetrics, TraceFailureInfo } from "../../types";

/** Result of a completed agent loop run */
export interface LoopResult {
  outcome: "completed" | "stopped" | "max_turns" | "error";
  turnCount: number;
  /** Summary from done() tool, or error message */
  summary: string;
  /** Normalized failure info for trace/session rollups */
  failure?: TraceFailureInfo;
  /** Session token/cost/time metrics */
  metrics?: SessionMetrics;
  /** Condensed action history for handoff to next node on the same tab.
   *  Produced by summarizeHistory() — e.g. "T1: click [39] → Added to cart." */
  trajectory?: string[];
}
