/**
 * Agent loop types — result interface and type aliases
 */

import {
  EvidenceEvent,
  PartialProgressHandoff,
  SessionMetrics,
  ToolName,
  TraceFailureInfo,
} from "../../types";
import type { ForwardedApprovalDryRun } from "@shared-types/browser-bridge";
import type { SideEffectEntry } from "./checkpoint-types";
import type { CompletionEnvelope } from "./completion-kernel";

export interface PendingApprovalInteraction {
  kind: "approval";
  nodeId: string | null;
  requestedAt: number;
  approvalId: string;
  toolName: ToolName;
  args: Record<string, unknown>;
  context: string;
  timeoutMs: number;
  approved?: boolean;
  /**
   * Phase 8 dry-run evidence for a consequential form submit, forwarded with
   * the approval so an external caller (pi-backend Phase 4) can byte-check
   * the live form against the values it supplied before approving.
   */
  dryRun?: ForwardedApprovalDryRun;
}

export interface PendingClarificationInteraction {
  kind: "clarification";
  nodeId: string | null;
  requestedAt: number;
  clarificationId: string;
  question: string;
  suggestions?: string[];
  timeoutMs: number;
  answer?: string;
}

export type PendingUserInteraction =
  | PendingApprovalInteraction
  | PendingClarificationInteraction;

/** Result of a completed agent loop run */
export interface LoopResult {
  outcome:
    | "completed"
    | "stopped"
    | "max_turns"
    | "error"
    | "awaiting_approval"
    | "awaiting_clarification";
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
  /** Pending user interaction that paused execution. */
  pendingInteraction?: PendingUserInteraction;
  /** Durable side-effect log captured by the loop for failure reporting. */
  sideEffectsLog?: SideEffectEntry[];
  /** Trusted typed evidence emitted by tools during the run. */
  evidence?: EvidenceEvent[];
  /** Structured metadata explaining why completion was accepted. */
  completionEnvelope?: CompletionEnvelope;
  /** Structured continuation artifact for incomplete-but-useful exits. */
  partialHandoff?: PartialProgressHandoff;
}
