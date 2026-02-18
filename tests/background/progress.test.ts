import { describe, it, expect, beforeEach } from "bun:test";
import { ProgressTracker } from "../../src/background/agent/progress";
import { DomSnapshot, TaggedElement } from "../../src/types";

function makeElement(overrides?: Partial<TaggedElement>): TaggedElement {
  return {
    tag: 1,
    tagName: "button",
    role: "button",
    text: "Click me",
    attributes: {},
    rect: { x: 0, y: 0, width: 100, height: 30 },
    isVisible: true,
    isDisabled: false,
    ...overrides,
  };
}

function makeSnap(overrides?: Partial<DomSnapshot>): DomSnapshot {
  return {
    title: "Test Page",
    url: "https://example.com",
    elements: [makeElement()],
    viewportText: "Hello world",
    viewport: { width: 1024, height: 768 },
    scroll: { x: 0, y: 0, maxY: 1000 },
    ...overrides,
  };
}

/** Build a snapshot with N identical-structure elements plus optional extra elements */
function makeManyElementSnap(
  count: number,
  extras?: TaggedElement[],
  url = "https://example.com",
): DomSnapshot {
  const elements: TaggedElement[] = [];
  for (let i = 0; i < count; i++) {
    elements.push(
      makeElement({ tag: i + 1, text: `Element ${i + 1}` }),
    );
  }
  if (extras) elements.push(...extras);
  return makeSnap({ elements, url });
}

/** Helper: feed N stale snapshots and return the last signal */
function feedStale(tracker: ProgressTracker, snap: DomSnapshot, count: number) {
  let signal = null;
  for (let i = 0; i < count; i++) {
    signal = tracker.onSnapshotRefresh(snap);
  }
  return signal;
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
      elements: [makeElement({ text: "Updated text" })],
    });
    expect(tracker.onSnapshotRefresh(changed)).toBeNull();
  });

  it("returns escalate at 5 stale turns", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    feedStale(tracker, snap, 4); // stale 1-4: null
    const signal = tracker.onSnapshotRefresh(snap); // stale 5
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
    expect(signal!.staleTurns).toBe(5);
  });

  it("returns null between thresholds (stale 1-4)", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 1
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 2
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 3
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 4
  });

  it("fires escalation only once", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    feedStale(tracker, snap, 4); // stale 1-4
    const first = tracker.onSnapshotRefresh(snap); // stale 5 → escalate
    expect(first!.type).toBe("escalate");

    // Further stale turns return null (one-shot)
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 6
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 7
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 8
  });

  it("no further signals after escalation fires", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline

    // Drive to stale 12
    for (let i = 0; i < 11; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    const signal = tracker.onSnapshotRefresh(snap); // stale 12
    // Only the first escalate at 5 fired, everything after is null
    expect(signal).toBeNull();
  });

  it("treats text change on same URL as progress", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Same URL but different element text
    const snap2 = makeSnap({
      elements: [makeElement({ text: "New label" })],
    });

    // Build up 4 stale on snap1
    feedStale(tracker, snap1, 4); // stale 1-4
    // snap2 resets stale counter (content changed)
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).toBeNull();

    // 3 more stale won't trigger escalation (counter was reset, need 5)
    feedStale(tracker, snap2, 3);
    expect(tracker.onSnapshotRefresh(snap2)).toBeNull(); // stale 4, still below threshold
  });

  it("treats attribute change as progress (e.g. disabled→enabled)", () => {
    const snap1 = makeSnap({
      elements: [
        makeElement({ text: "Submit", attributes: { disabled: "true" }, isDisabled: true }),
      ],
    });
    tracker.onSnapshotRefresh(snap1); // baseline

    // Same element but attribute changed
    const snap2 = makeSnap({
      elements: [makeElement({ text: "Submit" })],
    });

    // Build 4 stale on snap1
    feedStale(tracker, snap1, 4); // stale 1-4
    // snap2 has different attributes → resets stale counter
    expect(tracker.onSnapshotRefresh(snap2)).toBeNull();
  });

  it("reset() clears all state", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    for (let i = 0; i < 4; i++) {
      tracker.onSnapshotRefresh(snap);
    }
    // stale 5 would escalate
    tracker.reset();

    // After reset, baseline again
    const signal = tracker.onSnapshotRefresh(snap);
    expect(signal).toBeNull();
  });

  it("resetEscalation() clears escalation flag and stale counter", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline

    // Drive to escalate at 5
    feedStale(tracker, snap, 4); // stale 1-4
    const esc = tracker.onSnapshotRefresh(snap); // stale 5 → escalate
    expect(esc!.type).toBe("escalate");

    // Reset escalation state (as the loop does after handling)
    tracker.resetEscalation();
    // staleTurns is now 0, but lastSignatures still match snap.

    // 4 more stale turns — no signal yet
    feedStale(tracker, snap, 4); // stale 1-4
    // stale 5 → escalate fires again (because flag was cleared)
    const esc2 = tracker.onSnapshotRefresh(snap);
    expect(esc2).not.toBeNull();
    expect(esc2!.type).toBe("escalate");
    expect(esc2!.staleTurns).toBe(5);
  });

  it("URL-only change halves stale count instead of resetting", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Build up 6 stale turns on same URL + same content
    for (let i = 0; i < 6; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // staleTurns = 6 (escalation already fired at 5)

    // Navigate to different URL with same content → halve to 3
    const snap2 = makeSnap({ url: "https://other.com" });
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).toBeNull();
    // staleTurns = 3 after halving
  });

  it("content change still fully resets stale count to 0", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Build up 4 stale turns
    feedStale(tracker, snap1, 4); // stale 1-4

    // Content change on different URL → full reset
    const snap2 = makeSnap({
      url: "https://other.com",
      elements: [
        makeElement({ tag: 2, tagName: "input", role: "textbox", text: "Different element" }),
      ],
    });
    expect(tracker.onSnapshotRefresh(snap2)).toBeNull();

    // 3 more stale turns should NOT trigger escalation (counter was reset to 0, need 5)
    feedStale(tracker, snap2, 3);
    expect(tracker.onSnapshotRefresh(snap2)).toBeNull(); // stale 4, still below threshold
  });

  it("URL change does not prevent eventual escalation if content stays stale", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Build stale turns, periodically changing URL with same content
    tracker.onSnapshotRefresh(snap1); // stale 1
    tracker.onSnapshotRefresh(snap1); // stale 2
    // staleTurns = 2, navigate away → halve to 1
    const snapOther = makeSnap({ url: "https://other.com" });
    tracker.onSnapshotRefresh(snapOther);
    // staleTurns = 1, navigate back → halve to 0
    tracker.onSnapshotRefresh(snap1);
    // staleTurns = 0, keep going stale on same URL
    feedStale(tracker, snap1, 4); // stale 1-4
    const signal = tracker.onSnapshotRefresh(snap1); // stale 5 → escalate
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
  });

  it("URL-only change does not count as content change (fingerprint excludes URL)", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Same content, different URL — should NOT fully reset stale count
    const snap2 = makeSnap({ url: "https://different.com" });

    // Build 6 stale turns
    for (let i = 0; i < 6; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // staleTurns = 6, URL change halves to 3
    tracker.onSnapshotRefresh(snap2);
    // 1 more stale → staleTurns = 4
    // 2 more stale → staleTurns = 5 → escalation would fire but already fired at 5
    // Since escalationFired is true, no signal
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).toBeNull();
  });
});

describe("ProgressTracker — delta threshold", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  it("small DOM change (< 10%) does NOT reset stale count", () => {
    // 30 elements, change 1 element text → delta = 2/30 ≈ 6.7% → below threshold → stale
    const snap1 = makeManyElementSnap(30);
    tracker.onSnapshotRefresh(snap1); // baseline

    // Change 1 element out of 30 (simulates a spinner or badge update)
    const elements = snap1.elements.map((e, i) =>
      i === 0 ? { ...e, text: "Spinner loading..." } : e,
    );
    const snap2 = makeSnap({ elements });

    feedStale(tracker, snap1, 4); // stale 1-4

    // Noise change — below 10% threshold → should NOT reset, stale becomes 5 → escalate
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
    expect(signal!.staleTurns).toBe(5);
  });

  it("small DOM change below threshold keeps stale count incrementing", () => {
    const snap1 = makeManyElementSnap(30);
    tracker.onSnapshotRefresh(snap1); // baseline

    // Change 1 of 30 elements (noise)
    const elements = snap1.elements.map((e, i) =>
      i === 0 ? { ...e, text: "Badge: 1 new" } : e,
    );
    const snapNoise = makeSnap({ elements });

    // 4 stale turns on original snap
    feedStale(tracker, snap1, 4); // stale 1-4

    // Noise change — below 10% threshold → should NOT reset, stale becomes 5
    const signal = tracker.onSnapshotRefresh(snapNoise);
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
    expect(signal!.staleTurns).toBe(5);
  });

  it("large DOM change (>= 10%) resets stale count", () => {
    // 20 elements, change 3 → delta = 6/20 = 30% → above threshold → progress
    const snap1 = makeManyElementSnap(20);
    tracker.onSnapshotRefresh(snap1); // baseline

    // Build up 4 stale turns
    feedStale(tracker, snap1, 4); // stale 1-4

    // Change 3 of 20 elements (meaningful page update)
    const elements = snap1.elements.map((e, i) =>
      i < 3 ? { ...e, text: `Updated ${i}` } : e,
    );
    const snap2 = makeSnap({ elements });

    const signal = tracker.onSnapshotRefresh(snap2); // delta = 30% → progress
    expect(signal).toBeNull(); // stale count reset

    // 3 more stale turns should NOT trigger escalation (counter was reset, need 5)
    feedStale(tracker, snap2, 3);
    expect(tracker.onSnapshotRefresh(snap2)).toBeNull(); // stale 4, still below threshold
  });

  it("full page swap always counts as progress", () => {
    const snap1 = makeManyElementSnap(20);
    tracker.onSnapshotRefresh(snap1); // baseline

    tracker.onSnapshotRefresh(snap1); // stale 1
    tracker.onSnapshotRefresh(snap1); // stale 2

    // Completely different page
    const elements = Array.from({ length: 15 }, (_, i) =>
      makeElement({ tag: i + 100, text: `New page item ${i}`, tagName: "div" }),
    );
    const snapNew = makeSnap({ elements });

    const signal = tracker.onSnapshotRefresh(snapNew); // delta = 100% → progress
    expect(signal).toBeNull();
  });

  it("empty page (0 elements) always counts as progress", () => {
    const snap1 = makeManyElementSnap(20);
    tracker.onSnapshotRefresh(snap1); // baseline

    tracker.onSnapshotRefresh(snap1); // stale 1

    // Empty page — signatureDelta returns 1.0
    const emptySnap = makeSnap({ elements: [] });
    const signal = tracker.onSnapshotRefresh(emptySnap);
    expect(signal).toBeNull(); // delta = 1.0 → progress
  });

  it("element count swing from lazy-load (< 10%) stays stale", () => {
    // 50 elements, 3 added → delta = 3/53 ≈ 5.7% → below threshold
    const snap1 = makeManyElementSnap(50);
    tracker.onSnapshotRefresh(snap1); // baseline

    feedStale(tracker, snap1, 4); // stale 1-4

    // 3 new elements appended (lazy load noise)
    const extras = [
      makeElement({ tag: 51, text: "Lazy 1" }),
      makeElement({ tag: 52, text: "Lazy 2" }),
      makeElement({ tag: 53, text: "Lazy 3" }),
    ];
    const snapLazy = makeManyElementSnap(50, extras);

    // delta = 3 new / 53 max = 5.7% → below threshold → stale 5 → escalate
    const signal = tracker.onSnapshotRefresh(snapLazy);
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
    expect(signal!.staleTurns).toBe(5);
  });
});
