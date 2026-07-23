/**
 * Per-run state that one turn hands to the next purely for measurement.
 *
 * These are diff baselines, not agent state: the previous DOM snapshot (to
 * describe what the last action changed) and the previous prompt fingerprint
 * (to locate where the prompt-cache prefix broke — RFC LP-21 §9). Nothing here
 * influences what the agent does; dropping it degrades telemetry only.
 *
 * It lives in its own module rather than as fields on `AgentLoop` because that
 * file is a decomposition landmine under the ratchet, and observability carry is
 * exactly the kind of incidental state that should not accrete there.
 */

import type { DomSnapshot } from "../../types";
import type { PromptPrefixFingerprint } from "./prompt-prefix-telemetry";

export class TurnCarry {
  /** Snapshot from the previous turn, for the DOM-prompt delta. */
  previousSnapshotForDelta: DomSnapshot | null = null;

  /** Prompt fingerprint from the previous turn, for prefix-divergence. */
  previousPromptFingerprint: PromptPrefixFingerprint | null = null;

  /** Clear between runs so a new run's first turn has no stale baseline. */
  reset(): void {
    this.previousSnapshotForDelta = null;
    this.previousPromptFingerprint = null;
  }
}
