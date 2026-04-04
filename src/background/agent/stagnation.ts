import { DomSnapshot } from "../../types";
import { STUCK_THRESHOLDS } from "./constants";

export interface StagnationSignal {
  type: "escalate";
  message: string;
  stagnantTurns: number;
}

/** Result of comparing two consecutive DOM snapshots after a tool execution. */
export interface ActionEffect {
  /** Fraction of element signatures that changed (0.0–1.0) */
  deltaPercent: number;
  /** Whether the page URL changed between snapshots */
  urlChanged: boolean;
  prevUrl?: string;
  currentUrl: string;
  /** Elements present in current but not previous snapshot */
  elementsAdded: number;
  /** Elements present in previous but not current snapshot */
  elementsRemoved: number;
  prevCount: number;
  currentCount: number;
  /** Signature strings of elements that appeared (new in current, absent in previous). Capped at 15. */
  addedSignatures: string[];
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
export function computeElementSignatures(snap: DomSnapshot): Set<string> {
  const sigs = new Set<string>();
  for (const e of snap.elements) {
    const attrSig = STATE_ATTRS.filter((a) => a in e.attributes)
      .map((a) => `${a}=${e.attributes[a]}`)
      .join(",");
    sigs.add(`${e.tagName}:${e.text.slice(0, 30)}:${attrSig}`);
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

/**
 * Compute a cache-key fingerprint for a DOM snapshot.
 * Used by the perception layer to avoid redundant vision calls.
 */
export function computeSnapshotFingerprint(snap: DomSnapshot): string {
  const sigs = computeElementSignatures(snap);
  // Sort for deterministic hash, then join
  const sorted = [...sigs].sort();
  // Simple FNV-1a-style hash of the sorted signatures
  let hash = 2166136261;
  for (const sig of sorted) {
    for (let i = 0; i < sig.length; i++) {
      hash ^= sig.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
  }
  return `${snap.url}|${snap.title || ""}|${snap.elements.length}|${hash.toString(36)}`;
}

const STUCK_ESCALATE_MSG =
  "No progress detected. Escalating to next model tier.";

export class StagnationMonitor {
  private lastSignatures = new Set<string>();
  private lastUrl = "";
  private stagnantTurns = 0;
  private escalationFired = false;
  private _sameUrlTurns = 0;
  private _lastActionEffect: ActionEffect | null = null;

  /** Turns spent on the same URL, independent of DOM delta. Resets on URL change. */
  get sameUrlTurns(): number {
    return this._sameUrlTurns;
  }

  /** Last computed action effect — null before first snapshot pair. */
  get lastActionEffect(): ActionEffect | null {
    return this._lastActionEffect;
  }

  onSnapshotRefresh(snap: DomSnapshot): StagnationSignal | null {
    const currSigs = computeElementSignatures(snap);
    const url = snap.url || "";
    const delta = signatureDelta(this.lastSignatures, currSigs);
    const urlChanged = url !== this.lastUrl;

    // Compute action effect from symmetric diff (cheap — sets are already built)
    let added = 0;
    let removed = 0;
    const addedSigs: string[] = [];
    for (const sig of currSigs) {
      if (!this.lastSignatures.has(sig)) {
        added++;
        if (addedSigs.length < 15) addedSigs.push(sig);
      }
    }
    for (const sig of this.lastSignatures) {
      if (!currSigs.has(sig)) removed++;
    }
    this._lastActionEffect = {
      deltaPercent: delta,
      urlChanged,
      prevUrl: this.lastUrl || undefined,
      currentUrl: url,
      elementsAdded: added,
      elementsRemoved: removed,
      prevCount: this.lastSignatures.size,
      currentCount: currSigs.size,
      addedSignatures: addedSigs,
    };

    this.lastSignatures = currSigs;

    // Same-URL counter: tracks turns on the same URL without meaningful DOM change.
    // Reset when the DOM changes significantly (SPA form steps, tab switches, etc.)
    // to avoid false-positive escalations on single-page apps.
    if (url === this.lastUrl) {
      if (delta >= PROGRESS_DELTA_THRESHOLD) {
        this._sameUrlTurns = 0; // real DOM change on same URL → not stuck
      } else {
        this._sameUrlTurns++;
      }
    } else {
      this._sameUrlTurns = 0;
    }
    this.lastUrl = url;

    // Meaningful content change — above noise threshold
    if (delta >= PROGRESS_DELTA_THRESHOLD) {
      this.stagnantTurns = 0;
      return null;
    }

    if (urlChanged) {
      // URL changed but content barely differs — halve stagnant count (partial credit)
      this.stagnantTurns = Math.floor(this.stagnantTurns / 2);
      return null;
    }

    // Same content, same URL — stagnant
    this.stagnantTurns++;

    if (
      this.stagnantTurns >= STUCK_THRESHOLDS.ESCALATE &&
      !this.escalationFired
    ) {
      this.escalationFired = true;
      return {
        type: "escalate",
        message: STUCK_ESCALATE_MSG,
        stagnantTurns: this.stagnantTurns,
      };
    }
    return null;
  }

  /** Reset all tracking state (new session) */
  reset() {
    this.lastSignatures = new Set<string>();
    this.lastUrl = "";
    this.stagnantTurns = 0;
    this.escalationFired = false;
    this._sameUrlTurns = 0;
    this._lastActionEffect = null;
  }

  /** Reset escalation flag and stagnant counter so escalation can fire again for the next tier */
  resetEscalation() {
    this.escalationFired = false;
    this.stagnantTurns = 0;
  }

  /**
   * Returns true if the monitor is in a stagnant state (stagnantTurns > 0) but no
   * signal was emitted — either because escalation already fired or because
   * stagnantTurns hasn't reached the threshold yet.  The loop uses this to
   * distinguish "null because page actually changed" from "null but still stagnant."
   */
  isStillStuck(): boolean {
    return this.stagnantTurns > 0;
  }
}
