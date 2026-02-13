import { DomSnapshot } from "../../types";
import { STUCK_THRESHOLDS } from "./constants";

export interface ProgressSignal {
  type: "nudge" | "escalate";
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

/** Cheap content fingerprint — excludes URL so navigation alone doesn't reset stuck detection */
function contentFingerprint(snap: DomSnapshot): string {
  const elSigs = snap.elements
    .map((e) => {
      const attrSig = STATE_ATTRS.filter((a) => a in e.attributes)
        .map((a) => `${a}=${e.attributes[a]}`)
        .join(",");
      return `${e.tagName}:${e.text.slice(0, 30)}:${e.isVisible ? 1 : 0}:${attrSig}`;
    })
    .sort()
    .join("|");
  return `${snap.elements.length}|${elSigs}`;
}

const STUCK_NUDGE_MSG =
  "STUCK: Your last 6 actions changed nothing. STOP and apply the Verify step:\n1. Why did the last action fail?\n2. Is the current plan still valid?\nThen try ONE different approach:\n- take_screenshot — see the reality\n- scroll_page — target might be off-screen\n- update_plan — if the current step is impossible, REVISE the plan (provide a rationale)\n- find_element — search for the element by text";

const STUCK_ESCALATE_MSG =
  "STUCK ESCALATION: 12+ actions failed. A stronger model is taking over. Start fresh:\n1. take_screenshot to see the page visually.\n2. Re-read Viewport Text — what does the page ACTUALLY say?\n3. If the plan is blocked, call update_plan() to pivot to a new strategy.\n4. Try ONE action and verify the result next turn.";

export class ProgressTracker {
  private lastFingerprint = "";
  private lastUrl = "";
  private staleTurns = 0;
  private escalationFired = false;

  onSnapshotRefresh(snap: DomSnapshot): ProgressSignal | null {
    const fp = contentFingerprint(snap);
    const url = snap.url || "";
    const contentChanged = fp !== this.lastFingerprint;
    const urlChanged = url !== this.lastUrl;

    this.lastFingerprint = fp;
    this.lastUrl = url;

    if (contentChanged) {
      this.staleTurns = 0; // Real progress
      return null;
    }

    if (urlChanged) {
      // URL changed but content is similar — halve stale count (partial credit)
      this.staleTurns = Math.floor(this.staleTurns / 2);
      return null;
    }

    // Same content, same URL — stuck
    this.staleTurns++;

    if (this.staleTurns >= STUCK_THRESHOLDS.ESCALATE && !this.escalationFired) {
      this.escalationFired = true;
      return {
        type: "escalate",
        message: STUCK_ESCALATE_MSG,
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

  reset() {
    this.lastFingerprint = "";
    this.lastUrl = "";
    this.staleTurns = 0;
    this.escalationFired = false;
  }
}
