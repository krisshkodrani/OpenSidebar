import { DomSnapshot } from "../../types";

export interface ProgressSignal {
  type: "nudge" | "escalate";
  message: string;
  staleTurns: number;
}

/** Cheap fingerprint — changes iff page meaningfully changed */
function snapshotFingerprint(snap: DomSnapshot): string {
  const elSigs = snap.elements
    .map(
      (e) => `${e.tagName}:${e.text.slice(0, 30)}:${e.isVisible ? 1 : 0}`,
    )
    .sort()
    .join("|");
  return `${snap.url}|${snap.elements.length}|${elSigs}`;
}

const STALE_NUDGE = 6;
const STALE_ESCALATE = 12;

const STUCK_NUDGE_MSG =
  "STUCK DETECTION: Your last several actions had no visible effect on the page. The elements you are interacting with may be decoys or non-functional. Change strategy:\n1. take_screenshot to see the actual visual layout\n2. read_page for full page text content\n3. scroll_page to find hidden or off-screen elements\n4. Look for non-obvious elements: small links, hidden inputs, keyboard shortcuts (press_key)\nDo NOT keep clicking prominent buttons that have no effect.";

const STUCK_ESCALATE_MSG =
  "STUCK DETECTION: 12+ actions with no page change. Switching to a stronger model. Reassess the entire page — your previous approach failed. Start with take_screenshot and read_page before acting.";

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
