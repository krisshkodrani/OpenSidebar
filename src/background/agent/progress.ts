import { DomSnapshot } from "../../types";
import { STUCK_THRESHOLDS } from "./constants";

export interface ProgressSignal {
  type: "nudge" | "pivot" | "escalate";
  message: string;
  staleTurns: number;
}

/** Key attributes that indicate meaningful state changes */
const STATE_ATTRS = [
  "disabled",
  "checked",
  "aria-expanded",
  "value",
  "selected",
  "aria-selected",
];

/** Minimum fraction of element signatures that must differ to count as progress */
const PROGRESS_DELTA_THRESHOLD = 0.1;

/** Build a set of element signatures from a snapshot */
function contentSignatures(snap: DomSnapshot): Set<string> {
  const sigs = new Set<string>();
  for (const e of snap.elements) {
    const attrSig = STATE_ATTRS.filter((a) => a in e.attributes)
      .map((a) => `${a}=${e.attributes[a]}`)
      .join(",");
    sigs.add(`${e.tagName}:${e.text.slice(0, 30)}:${e.isVisible ? 1 : 0}:${attrSig}`);
  }
  return sigs;
}

/**
 * Compute the fraction of element signatures that differ between two sets.
 * Uses symmetric difference / max(size) — both additions and removals count.
 * Returns 1.0 if either set is empty (treat as full page transition).
 */
function signatureDelta(prev: Set<string>, curr: Set<string>): number {
  if (prev.size === 0 || curr.size === 0) return 1.0;
  let diffCount = 0;
  for (const sig of curr) {
    if (!prev.has(sig)) diffCount++;
  }
  for (const sig of prev) {
    if (!curr.has(sig)) diffCount++;
  }
  return diffCount / Math.max(prev.size, curr.size);
}

const STUCK_NUDGE_MSG =
  "STUCK: Your last actions changed nothing. STOP and apply the Verify step:\n1. Why did the last action fail?\n2. Is the current plan still valid?\nThen try ONE different approach:\n- take_screenshot — see the reality\n- scroll_page — target might be off-screen\n- update_plan — if the current step is impossible, REVISE the plan (provide a rationale)\n- find_element — search for the element by text";

const STUCK_PIVOT_MSG =
  "STRATEGY PIVOT REQUIRED: Multiple actions have failed. The system will clear your failed context and let you start fresh with a different approach.";

const STUCK_ESCALATE_MSG =
  "STUCK ESCALATION: A stronger model is taking over with fresh context. Start with a completely different strategy.";

export class ProgressTracker {
  private lastSignatures = new Set<string>();
  private lastUrl = "";
  private staleTurns = 0;
  private pivotFired = false;
  private escalationFired = false;

  onSnapshotRefresh(snap: DomSnapshot): ProgressSignal | null {
    const currSigs = contentSignatures(snap);
    const url = snap.url || "";
    const delta = signatureDelta(this.lastSignatures, currSigs);
    const urlChanged = url !== this.lastUrl;

    this.lastSignatures = currSigs;
    this.lastUrl = url;

    // Meaningful content change — above noise threshold
    if (delta >= PROGRESS_DELTA_THRESHOLD) {
      this.staleTurns = 0;
      return null;
    }

    if (urlChanged) {
      // URL changed but content barely differs — halve stale count (partial credit)
      this.staleTurns = Math.floor(this.staleTurns / 2);
      return null;
    }

    // Same content, same URL — stuck
    this.staleTurns++;

    // Check in descending order: escalate first, then pivot, then nudge
    if (this.staleTurns >= STUCK_THRESHOLDS.ESCALATE && !this.escalationFired) {
      this.escalationFired = true;
      return {
        type: "escalate",
        message: STUCK_ESCALATE_MSG,
        staleTurns: this.staleTurns,
      };
    }
    if (this.staleTurns >= STUCK_THRESHOLDS.PIVOT && !this.pivotFired) {
      this.pivotFired = true;
      return {
        type: "pivot",
        message: STUCK_PIVOT_MSG,
        staleTurns: this.staleTurns,
      };
    }
    if (
      this.staleTurns >= STUCK_THRESHOLDS.NUDGE &&
      this.staleTurns % STUCK_THRESHOLDS.NUDGE === 0
    ) {
      return {
        type: "nudge",
        message: STUCK_NUDGE_MSG,
        staleTurns: this.staleTurns,
      };
    }
    return null;
  }

  /** Reset all tracking state (new session) */
  reset() {
    this.lastSignatures = new Set<string>();
    this.lastUrl = "";
    this.staleTurns = 0;
    this.pivotFired = false;
    this.escalationFired = false;
  }

  /** Reset escalation/pivot flags so they can fire again (after a pivot clears context) */
  resetEscalation() {
    this.pivotFired = false;
    this.escalationFired = false;
    this.staleTurns = 0;
  }
}
