import { describe, it, expect, beforeEach } from "vitest";
import { StagnationMonitor } from "../../src/background/agent/stagnation";
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
    visibleContent: "Hello world",
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
function feedStale(tracker: StagnationMonitor, snap: DomSnapshot, count: number) {
  let signal = null;
  for (let i = 0; i < count; i++) {
    signal = tracker.onSnapshotRefresh(snap);
  }
  return signal;
}

describe("StagnationMonitor", () => {
  let tracker: StagnationMonitor;

  beforeEach(() => {
    tracker = new StagnationMonitor();
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
    expect(signal!.stagnantTurns).toBe(5);
  });

  it("returns null between thresholds (stale 1-4)", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 1
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 2
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 3
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 4
  });

  it("repeats escalation after the repeat interval", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    feedStale(tracker, snap, 4); // stale 1-4
    const first = tracker.onSnapshotRefresh(snap); // stale 5 → escalate
    expect(first!.type).toBe("escalate");

    // Further stale turns are quiet until the repeat interval elapses.
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 6
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 7
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 8
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 9
    expect(tracker.onSnapshotRefresh(snap)).toBeNull(); // stale 10
    const repeated = tracker.onSnapshotRefresh(snap); // stale 11
    expect(repeated).not.toBeNull();
    expect(repeated!.type).toBe("escalate");
    expect(repeated!.stagnantTurns).toBe(11);
  });

  it("does not fire between repeat escalation intervals", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline

    feedStale(tracker, snap, 10); // stale 5 fires, stale 6-10 quiet
    const repeated = tracker.onSnapshotRefresh(snap); // stale 11
    expect(repeated).not.toBeNull();
    expect(repeated!.stagnantTurns).toBe(11);

    const quiet = tracker.onSnapshotRefresh(snap); // stale 12
    expect(quiet).toBeNull();
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
    // stagnantTurns is now 0, but lastSignatures still match snap.

    // 4 more stale turns — no signal yet
    feedStale(tracker, snap, 4); // stale 1-4
    // stale 5 → escalate fires again (because flag was cleared)
    const esc2 = tracker.onSnapshotRefresh(snap);
    expect(esc2).not.toBeNull();
    expect(esc2!.type).toBe("escalate");
    expect(esc2!.stagnantTurns).toBe(5);
  });

  it("URL-only change halves stale count instead of resetting", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline

    // Build up 6 stale turns on same URL + same content
    for (let i = 0; i < 6; i++) {
      tracker.onSnapshotRefresh(snap1);
    }
    // stagnantTurns = 6 (escalation already fired at 5)

    // Navigate to different URL with same content → halve to 3
    const snap2 = makeSnap({ url: "https://other.com" });
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).toBeNull();
    // stagnantTurns = 3 after halving
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
    // stagnantTurns = 2, navigate away → halve to 1
    const snapOther = makeSnap({ url: "https://other.com" });
    tracker.onSnapshotRefresh(snapOther);
    // stagnantTurns = 1, navigate back → halve to 0
    tracker.onSnapshotRefresh(snap1);
    // stagnantTurns = 0, keep going stale on same URL
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
    // stagnantTurns = 6, URL change halves to 3
    tracker.onSnapshotRefresh(snap2);
    // 1 more stale → stagnantTurns = 4
    // 2 more stale → stagnantTurns = 5 → escalation would fire but already fired at 5
    // Since escalationFired is true, no signal
    const signal = tracker.onSnapshotRefresh(snap2);
    expect(signal).toBeNull();
  });
});

describe("StagnationMonitor — isStillStuck", () => {
  let tracker: StagnationMonitor;

  beforeEach(() => {
    tracker = new StagnationMonitor();
  });

  it("returns false before any snapshots", () => {
    expect(tracker.isStillStuck()).toBe(false);
  });

  it("returns false after baseline snapshot", () => {
    tracker.onSnapshotRefresh(makeSnap());
    expect(tracker.isStillStuck()).toBe(false);
  });

  it("returns true when stale but below escalation threshold", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    tracker.onSnapshotRefresh(snap); // stale 1
    expect(tracker.isStillStuck()).toBe(true);
  });

  it("returns true after escalation fires (stale continues)", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    feedStale(tracker, snap, 5); // stale 1-5, escalation fires at 5
    expect(tracker.isStillStuck()).toBe(true);
  });

  it("returns false after real content change resets stagnantTurns", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline
    feedStale(tracker, snap1, 5); // escalation fires

    // Real content change
    const snap2 = makeSnap({ elements: [makeElement({ text: "New content" })] });
    tracker.onSnapshotRefresh(snap2);
    expect(tracker.isStillStuck()).toBe(false);
  });

  it("returns true after resetEscalation followed by new stale turns", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    feedStale(tracker, snap, 5); // escalation fires

    tracker.resetEscalation(); // stagnantTurns = 0
    expect(tracker.isStillStuck()).toBe(false);

    // New stale turn — still stuck but below threshold, no signal emitted
    tracker.onSnapshotRefresh(snap); // stale 1
    expect(tracker.isStillStuck()).toBe(true);
  });

  it("prevents false recovery: stale after resetEscalation is not progress", () => {
    // This is the exact bug scenario: escalation fires, resetEscalation() called,
    // then stale turns return null — loop must NOT treat these as recovery.
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap); // baseline
    feedStale(tracker, snap, 5); // escalation fires at stale 5

    tracker.resetEscalation();
    // 2 more stale turns — both return null but isStillStuck() is true
    tracker.onSnapshotRefresh(snap); // stale 1 → null
    expect(tracker.isStillStuck()).toBe(true);
    tracker.onSnapshotRefresh(snap); // stale 2 → null
    expect(tracker.isStillStuck()).toBe(true);
  });
});

describe("StagnationMonitor — delta threshold", () => {
  let tracker: StagnationMonitor;

  beforeEach(() => {
    tracker = new StagnationMonitor();
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
    expect(signal!.stagnantTurns).toBe(5);
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
    expect(signal!.stagnantTurns).toBe(5);
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

  it("large transient-only DOM change does not reset stale count", () => {
    const snap1 = makeManyElementSnap(20);
    tracker.onSnapshotRefresh(snap1); // baseline
    feedStale(tracker, snap1, 4); // stale 1-4

    const transientExtras = Array.from({ length: 6 }, (_, i) =>
      makeElement({
        tag: 100 + i,
        tagName: "div",
        text: `Loading spinner ${i + 1}`,
      }),
    );
    const snapWithSpinner = makeManyElementSnap(20, transientExtras);

    const signal = tracker.onSnapshotRefresh(snapWithSpinner);
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
    expect(signal!.stagnantTurns).toBe(5);
    expect(tracker.sameUrlTurns).toBe(5);
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

  it("scroll-only visibility changes do NOT reset stale count", () => {
    // 10 elements, change only isVisible on 5 of them (simulates scroll)
    const elements = Array.from({ length: 10 }, (_, i) =>
      makeElement({ tag: i + 1, text: `Item ${i + 1}`, isVisible: true }),
    );
    const snap1 = makeSnap({ elements });
    tracker.onSnapshotRefresh(snap1); // baseline

    feedStale(tracker, snap1, 4); // stale 1-4

    // Only isVisible changes (scroll moved viewport) — should NOT reset stale count
    const scrolledElements = elements.map((e, i) => ({
      ...e,
      isVisible: i >= 5, // top 5 scrolled out, bottom 5 scrolled in
    }));
    const snap2 = makeSnap({ elements: scrolledElements });
    const signal = tracker.onSnapshotRefresh(snap2); // stale 5 → escalate
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("escalate");
    expect(signal!.stagnantTurns).toBe(5);
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
    expect(signal!.stagnantTurns).toBe(5);
  });
});

describe("StagnationMonitor — sameUrlTurns", () => {
  let tracker: StagnationMonitor;

  beforeEach(() => {
    tracker = new StagnationMonitor();
  });

  it("sameUrlTurns resets on meaningful DOM change even on same URL", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline — sameUrlTurns = 0 (first call, no prev URL)
    expect(tracker.sameUrlTurns).toBe(0);

    // Same URL, same content → increments
    tracker.onSnapshotRefresh(snap1);
    expect(tracker.sameUrlTurns).toBe(1);

    // Same URL, different content → resets (SPA form step change, tab switch, etc.)
    const snap2 = makeSnap({ elements: [makeElement({ text: "Changed" })] });
    tracker.onSnapshotRefresh(snap2);
    expect(tracker.sameUrlTurns).toBe(0);

    // Same URL, same content again → increments from 0
    tracker.onSnapshotRefresh(snap2);
    expect(tracker.sameUrlTurns).toBe(1);
  });

  it("sameUrlTurns resets on URL change", () => {
    const snap1 = makeSnap();
    tracker.onSnapshotRefresh(snap1); // baseline
    tracker.onSnapshotRefresh(snap1); // sameUrlTurns = 1
    tracker.onSnapshotRefresh(snap1); // sameUrlTurns = 2
    expect(tracker.sameUrlTurns).toBe(2);

    // Navigate to different URL
    const snap2 = makeSnap({ url: "https://other.com" });
    tracker.onSnapshotRefresh(snap2);
    expect(tracker.sameUrlTurns).toBe(0);

    // Same new URL
    tracker.onSnapshotRefresh(snap2);
    expect(tracker.sameUrlTurns).toBe(1);
  });

  it("sameUrlTurns still increments on same URL with small DOM changes below threshold", () => {
    // Page with many elements — a tiny text change is below PROGRESS_DELTA_THRESHOLD (0.1)
    // delta = diffCount / max(prev, curr). Need diffCount/size < 0.1.
    // 30 elements, change 1 → diffCount=2 (1 removed + 1 added), delta=2/30≈0.067 < 0.1
    const elements = Array.from({ length: 30 }, (_, i) =>
      makeElement({ text: `Item ${i}` }),
    );
    const snap1 = makeSnap({ elements });
    tracker.onSnapshotRefresh(snap1); // baseline
    expect(tracker.sameUrlTurns).toBe(0);

    const tweaked = [...elements];
    tweaked[0] = makeElement({ text: "Modified" });
    const snap2 = makeSnap({ elements: tweaked });
    tracker.onSnapshotRefresh(snap2);
    expect(tracker.sameUrlTurns).toBe(1); // still increments — change too small
  });

  it("sameUrlTurns resets on full reset() but NOT on resetEscalation()", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap);
    tracker.onSnapshotRefresh(snap);
    tracker.onSnapshotRefresh(snap);
    expect(tracker.sameUrlTurns).toBe(2);

    // resetEscalation should NOT reset sameUrlTurns
    tracker.resetEscalation();
    expect(tracker.sameUrlTurns).toBe(2);

    // full reset should reset sameUrlTurns
    tracker.reset();
    expect(tracker.sameUrlTurns).toBe(0);
  });

  it("resetProgressCounters() clears sameUrlTurns while preserving the snapshot baseline", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap);
    tracker.onSnapshotRefresh(snap);
    tracker.onSnapshotRefresh(snap);
    expect(tracker.sameUrlTurns).toBe(2);

    tracker.resetProgressCounters();
    expect(tracker.sameUrlTurns).toBe(0);
    expect(tracker.isStillStuck()).toBe(false);

    tracker.onSnapshotRefresh(snap);
    expect(tracker.sameUrlTurns).toBe(1);
    expect(tracker.isStillStuck()).toBe(true);
  });
});

describe("StagnationMonitor — ActionEffect", () => {
  let tracker: StagnationMonitor;

  beforeEach(() => {
    tracker = new StagnationMonitor();
  });

  it("lastActionEffect is null before any snapshots", () => {
    expect(tracker.lastActionEffect).toBeNull();
  });

  it("computes full effect on first snapshot (prev is empty)", () => {
    const snap = makeManyElementSnap(5);
    tracker.onSnapshotRefresh(snap);
    const effect = tracker.lastActionEffect!;
    expect(effect).not.toBeNull();
    // First call: prev is empty → signatureDelta returns 1.0
    expect(effect.deltaPercent).toBe(1.0);
    // prev URL is "" and current is the URL → urlChanged is true
    expect(effect.urlChanged).toBe(true);
    expect(effect.elementsAdded).toBe(5);
    expect(effect.elementsRemoved).toBe(0);
    expect(effect.prevCount).toBe(0);
    expect(effect.currentCount).toBe(5);
    expect(effect.currentUrl).toBe("https://example.com");
  });

  it("computes zero delta when snapshot is unchanged", () => {
    const snap = makeManyElementSnap(5);
    tracker.onSnapshotRefresh(snap); // baseline
    tracker.onSnapshotRefresh(snap); // identical
    const effect = tracker.lastActionEffect!;
    expect(effect.deltaPercent).toBe(0);
    expect(effect.urlChanged).toBe(false);
    expect(effect.elementsAdded).toBe(0);
    expect(effect.elementsRemoved).toBe(0);
    expect(effect.prevCount).toBe(5);
    expect(effect.currentCount).toBe(5);
  });

  it("detects URL change", () => {
    const snap1 = makeSnap({ url: "https://a.com" });
    tracker.onSnapshotRefresh(snap1);
    const snap2 = makeSnap({ url: "https://b.com" });
    tracker.onSnapshotRefresh(snap2);
    const effect = tracker.lastActionEffect!;
    expect(effect.urlChanged).toBe(true);
    expect(effect.prevUrl).toBe("https://a.com");
    expect(effect.currentUrl).toBe("https://b.com");
  });

  it("counts added and removed elements correctly", () => {
    // Start with 3 elements
    const snap1 = makeManyElementSnap(3);
    tracker.onSnapshotRefresh(snap1);

    // Change to 5 elements: keep 1 original, remove 2, add 4 new
    const elements = [
      makeElement({ tag: 1, text: "Element 1" }), // kept
      makeElement({ tag: 4, text: "Brand new A", tagName: "div" }),
      makeElement({ tag: 5, text: "Brand new B", tagName: "div" }),
      makeElement({ tag: 6, text: "Brand new C", tagName: "div" }),
      makeElement({ tag: 7, text: "Brand new D", tagName: "div" }),
    ];
    const snap2 = makeSnap({ elements });
    tracker.onSnapshotRefresh(snap2);

    const effect = tracker.lastActionEffect!;
    // Element 2 and 3 removed, 4 new elements added
    expect(effect.elementsAdded).toBe(4);
    expect(effect.elementsRemoved).toBe(2);
    expect(effect.prevCount).toBe(3);
    expect(effect.currentCount).toBe(5);
    expect(effect.deltaPercent).toBeGreaterThan(0);
  });

  it("is cleared by reset()", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap);
    expect(tracker.lastActionEffect).not.toBeNull();
    tracker.reset();
    expect(tracker.lastActionEffect).toBeNull();
  });

  it("is NOT cleared by resetEscalation()", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap);
    expect(tracker.lastActionEffect).not.toBeNull();
    tracker.resetEscalation();
    expect(tracker.lastActionEffect).not.toBeNull();
  });

  it("prevUrl is undefined on first snapshot (no previous URL)", () => {
    const snap = makeSnap();
    tracker.onSnapshotRefresh(snap);
    expect(tracker.lastActionEffect!.prevUrl).toBeUndefined();
  });

  it("prevUrl is set on subsequent snapshots", () => {
    tracker.onSnapshotRefresh(makeSnap({ url: "https://first.com" }));
    tracker.onSnapshotRefresh(makeSnap({ url: "https://second.com" }));
    expect(tracker.lastActionEffect!.prevUrl).toBe("https://first.com");
    expect(tracker.lastActionEffect!.currentUrl).toBe("https://second.com");
  });
});
