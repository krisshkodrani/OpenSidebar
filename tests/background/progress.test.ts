import { describe, it, expect, beforeEach } from "bun:test";
import { ProgressTracker } from "../../src/background/agent/progress";
import { DomSnapshot } from "../../src/types";

function makeSnap(overrides?: Partial<DomSnapshot>): DomSnapshot {
  return {
    title: "Test Page",
    url: "https://example.com",
    elements: [
      {
        tag: 1,
        tagName: "button",
        role: "button",
        text: "Click me",
        attributes: {},
        rect: { x: 0, y: 0, width: 100, height: 30 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    viewportText: "Hello world",
    viewport: { width: 1024, height: 768 },
    scroll: { x: 0, y: 0, maxY: 1000 },
    ...overrides,
  };
}

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  it("returns null on first call (baseline)", () => {
    const signal = tracker.onSnapshotRefresh(makeSnap());
    expect(signal).toBeNull();
  });

  it("returns null when fingerprint changes (progress)", () => {
    tracker.onSnapshotRefresh(makeSnap());
    const changed = makeSnap({
      elements: [
        {
          tag: 1,
          tagName: "button",
          role: "button",
          text: "Updated text",
          attributes: {},
          rect: { x: 0, y: 0, width: 100, height: 30 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });
    expect(tracker.onSnapshotRefresh(changed)).toBeNull();
  });

  it("returns nudge at 3 stale turns", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 2; i++) {
      tracker.onSnapshotRefresh(snap); // stale 1-2
    }
    const signal = tracker.onSnapshotRefresh(snap); // stale 3
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("nudge");
    expect(signal!.staleTurns).toBe(3);
  });

  it("returns null between thresholds (stale 1-2)", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 2; i++) {
      const signal = tracker.onSnapshotRefresh(snap);
      expect(signal).toBeNull();
    }
  });

  it("returns pivot at 6 stale turns", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 5; i++) {
      tracker.onSnapshotRefresh(snap); // stale 1-5 (nudge fires at 3)
    }
    const signal = tracker.onSnapshotRefresh(snap); // stale 6
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("pivot");
    expect(signal!.staleTurns).toBe(6);
  });

  it("returns escalation at 9 stale turns", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 8; i++) {
      tracker.onSnapshotRefresh(snap); // stale 1-8 (nudge at 3, pivot at 6)
    }
    const signal = tracker.onSnapshotRefresh(snap); // stale 9
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
    expect(signal!.staleTurns).toBe(9);
  });

  it("fires escalation only once", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 8; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    const first = tracker.onSnapshotRefresh(snap); // stale 9 → escalate
    expect(first!.type).toBe("escalate");

    // Stale 10-11 should be silent (nudge fires every 3, but 10 and 11 aren't multiples)
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 10
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 11

    // Stale 12 → nudge (12 % 3 === 0)
    const second = tracker.onSnapshotRefresh(snap);
    expect(second).not.toBeNull();
    expect(second!.type).toBe("nudge");
    expect(second!.staleTurns).toBe(12);
  });

  it("continues nudging every 3 turns after escalation", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline

    // Drive to stale 15
    for (let i = 0; i < 14; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    const signal = tracker.onSnapshotRefresh(snap); // stale 15
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("nudge");
    expect(signal!.staleTurns).toBe(15);
  });

  it("treats text change on same URL as progress", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Same URL but different element text
    const snap2 = makeSnap({
      elements: [
        {
          tag: 1,
          tagName: "button",
          role: "button",
          text: "New label",
          attributes: {},
          rect: { x: 0, y: 0, width: 100, height: 30 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    // Build up 2 stale on snap1
    for (let i = 0; i < 2; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // snap2 resets stale counter
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).toBeNull();

    // 2 more stale won't trigger nudge (counter was reset)
    for (let i = 0; i < 2; i++) {
      expect(tracker.onSnapshotRefresh(snap2)).toBeNull();
    }
  });

  it("treats attribute change as progress (e.g. disabled→enabled)", () => {
    const snap1 = makeSnap({
      elements: [
        {
          tag: 1,
          tagName: "button",
          role: "button",
          text: "Submit",
          attributes: { disabled: "true" },
          rect: { x: 0, y: 0, width: 100, height: 30 },
          isVisible: true,
          isDisabled: true,
        },
      ],
    });
    tracker.onSnapshotRefresh(snap1); // baseline

    // Same element but attribute changed
    const snap2 = makeSnap({
      elements: [
        {
          tag: 1,
          tagName: "button",
          role: "button",
          text: "Submit",
          attributes: {},
          rect: { x: 0, y: 0, width: 100, height: 30 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    // Build 2 stale on snap1 (would nudge at 3 if no change)
    for (let i = 0; i < 2; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // snap2 has different attributes → resets stale counter
    expect(tracker.onSnapshotRefresh(snap2)).toBeNull();
  });

  it("reset() clears all state", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 8; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    // stale 9 would escalate
    tracker.reset();

    // After reset, baseline again
    const signal = tracker.onSnapshotRefresh(snap);
    expect(signal).toBeNull();
  });

  it("resetEscalation() clears pivot and escalation flags", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline

    // Drive to pivot at 6
    for (let i = 0; i < 5; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    const pivot = tracker.onSnapshotRefresh(snap); // stale 6 → pivot
    expect(pivot!.type).toBe("pivot");

    // Reset escalation state (as strategy pivot does)
    tracker.resetEscalation();
    // staleTurns is now 0, but lastFingerprint is still snap's fingerprint.
    // So subsequent calls with the same snap see no content change and increment stale.

    // 5 more stale turns: stale 1-5 (nudge fires at 3)
    for (let i = 0; i < 5; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    // stale 6 → pivot fires again (because pivotFired was cleared)
    const pivot2 = tracker.onSnapshotRefresh(snap);
    expect(pivot2).not.toBeNull();
    expect(pivot2!.type).toBe("pivot");
    expect(pivot2!.staleTurns).toBe(6);
  });

  it("URL-only change halves stale count instead of resetting", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Build up 4 stale turns on same URL + same content
    for (let i = 0; i < 4; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // staleTurns = 4

    // Navigate to different URL with same content → halve to 2
    const snap2 = makeSnap({ url: "https://other.com" });
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).toBeNull();

    // 1 more stale → staleTurns = 3 → nudge
    const nudge = tracker.onSnapshotRefresh(snap2);
    expect(nudge).not.toBeNull();
    expect(nudge!.type).toBe("nudge");
    expect(nudge!.staleTurns).toBe(3);
  });

  it("content change still fully resets stale count to 0", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Build up 2 stale turns
    for (let i = 0; i < 2; i++) {
      tracker.onSnapshotRefresh(snap1);
    }

    // Content change on different URL → full reset
    const snap2 = makeSnap({
      url: "https://other.com",
      elements: [
        {
          tag: 2,
          tagName: "input",
          role: "textbox",
          text: "Different element",
          attributes: {},
          rect: { x: 0, y: 0, width: 200, height: 30 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });
    expect(tracker.onSnapshotRefresh(snap2)).toBeNull();

    // 2 more stale turns should NOT trigger nudge (counter was reset to 0)
    for (let i = 0; i < 2; i++) {
      expect(tracker.onSnapshotRefresh(snap2)).toBeNull();
    }
  });

  it("URL change does not prevent eventual nudge/pivot if content stays stale", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Build stale turns, periodically changing URL with same content
    for (let i = 0; i < 2; i++) {
      tracker.onSnapshotRefresh(snap1); // staleTurns 1-2
    }
    // staleTurns = 2, navigate away → halve to 1
    const snapOther = makeSnap({ url: "https://other.com" });
    tracker.onSnapshotRefresh(snapOther);
    // staleTurns = 1, navigate back → halve to 0
    tracker.onSnapshotRefresh(snap1);
    // staleTurns = 0, keep going stale on same URL
    for (let i = 0; i < 2; i++) {
      tracker.onSnapshotRefresh(snap1); // staleTurns 1-2
    }
    const signal = tracker.onSnapshotRefresh(snap1); // staleTurns = 3 → nudge
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("nudge");
  });

  it("URL-only change does not count as content change (fingerprint excludes URL)", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Same content, different URL — should NOT fully reset stale count
    const snap2 = makeSnap({ url: "https://different.com" });

    // Build 4 stale turns
    for (let i = 0; i < 4; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // staleTurns = 4, URL change halves to 2
    tracker.onSnapshotRefresh(snap2);
    // 1 more stale → staleTurns = 3 → nudge
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("nudge");
  });
});
