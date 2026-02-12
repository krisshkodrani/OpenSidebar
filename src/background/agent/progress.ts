import { DomSnapshot } from "../../types";

export interface ProgressSignal {
  type: "nudge" | "escalate";
  message: string;
  staleTurns: number;
}

/** Key attributes that indicate meaningful state changes */
const STATE_ATTRS = ["disabled", "checked", "aria-expanded", "value", "selected", "aria-selected"];

/** Cheap fingerprint — changes iff page meaningfully changed */
function snapshotFingerprint(snap: DomSnapshot): string {
  const elSigs = snap.elements
    .map((e) => {
      const attrSig = STATE_ATTRS
        .filter((a) => a in e.attributes)
        .map((a) => `${a}=${e.attributes[a]}`)
        .join(",");
      return `${e.tagName}:${e.text.slice(0, 30)}:${e.isVisible ? 1 : 0}:${attrSig}`;
    })
    .sort()
    .join("|");
  return `${snap.url}|${snap.elements.length}|${elSigs}`;
}

const STALE_NUDGE = 6;
const STALE_ESCALATE = 12;

const STUCK_NUDGE_MSG =
  "STUCK: Your last 6 actions changed nothing. STOP and apply the Verify step:\n1. What did you EXPECT to happen after your last action?\n2. What ACTUALLY happened? (Compare expected vs actual.)\n3. Why the mismatch?\nThen try ONE different approach:\n- take_screenshot — see what the page actually looks like\n- scroll_page — target might be off-screen\n- press_key — some UIs respond to keyboard only\n- find_element — search for the element by text\nDo NOT repeat any action you already tried.";

const STUCK_ESCALATE_MSG =
  "STUCK ESCALATION: 12+ actions failed. A stronger model is taking over. Start fresh:\n1. take_screenshot to see the page visually.\n2. Re-read Viewport Text — what does the page ACTUALLY say?\n3. Think: What do I see? What specific element advances the task? What should happen when I act?\n4. Try ONE action and verify the result next turn.";

export class ProgressTracker {
  private lastFingerprint = "";
  private staleTurns = 0;
  private escalationFired = false;

  onSnapshotRefresh(snap: DomSnapshot): ProgressSignal | null {
    const fp = snapshotFingerprint(snap);
    if (fp !== this.lastFingerprint) {
      this.staleTurns = 0;
      this.lastFingerprint = fp;
      return null;
    }
    this.staleTurns++;
    this.lastFingerprint = fp;

    if (this.staleTurns >= STALE_ESCALATE && !this.escalationFired) {
      this.escalationFired = true;
      return {
        type: "escalate",
        message: STUCK_ESCALATE_MSG,
        staleTurns: this.staleTurns,
      };
    }
    if (this.staleTurns >= STALE_NUDGE && this.staleTurns % STALE_NUDGE === 0) {
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
    this.staleTurns = 0;
    this.escalationFired = false;
  }
}
