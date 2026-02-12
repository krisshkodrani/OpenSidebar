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

  it("returns nudge at 6 stale turns", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 5; i++) {
      tracker.onSnapshotRefresh(snap); // stale 1-5
    }
    const signal = tracker.onSnapshotRefresh(snap); // stale 6
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("nudge");
    expect(signal!.staleTurns).toBe(6);
  });

  it("returns null between thresholds (stale 1-5)", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 5; i++) {
      const signal = tracker.onSnapshotRefresh(snap);
      expect(signal).toBeNull();
    }
  });

  it("returns escalation at 12 stale turns", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 11; i++) {
      tracker.onSnapshotRefresh(snap); // stale 1-11
    }
    const signal = tracker.onSnapshotRefresh(snap); // stale 12
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
    expect(signal!.staleTurns).toBe(12);
  });

  it("fires escalation only once", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 11; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    const first = tracker.onSnapshotRefresh(snap); // stale 12 → escalate
    expect(first!.type).toBe("escalate");

    // Stale 13-17 should be silent
    for (let i = 0; i < 5; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    // Stale 18 → nudge (not escalate again)
    const second = tracker.onSnapshotRefresh(snap);
    expect(second).not.toBeNull();
    expect(second!.type).toBe("nudge");
    expect(second!.staleTurns).toBe(18);
  });

  it("continues nudging every 6 turns after escalation", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline

    // Drive to stale 24
    for (let i = 0; i < 23; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    const signal = tracker.onSnapshotRefresh(snap); // stale 24
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("nudge");
    expect(signal!.staleTurns).toBe(24);
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

    // Build up 5 stale on snap1
    for (let i = 0; i < 5; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // snap2 resets stale counter
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).toBeNull();

    // 5 more stale won't trigger nudge (counter was reset)
    for (let i = 0; i < 5; i++) {
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

    // Build 5 stale on snap1 (would nudge at 6 if no change)
    for (let i = 0; i < 5; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // snap2 has different attributes → resets stale counter
    expect(tracker.onSnapshotRefresh(snap2)).toBeNull();
  });

  it("reset() clears all state", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 11; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    // stale 12 would escalate
    tracker.reset();

    // After reset, baseline again
    const signal = tracker.onSnapshotRefresh(snap);
    expect(signal).toBeNull();
  });
});
