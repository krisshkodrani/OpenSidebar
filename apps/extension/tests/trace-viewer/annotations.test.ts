import { describe, expect, test } from "vitest";
import "../setup";
import {
  annotationKey,
  normalizeAnnotationInput,
  dedupeAnnotationsLatestWins,
  parseAnnotationsJsonl,
  type RunAnnotationRecord,
} from "../../../../scripts/log-server-helpers";
import { buildEvalCase, goldenFileName } from "../../src/trace-viewer/analysis";
import type { RunAnnotation } from "../../src/trace-viewer/store/types";

function record(overrides: Partial<RunAnnotationRecord> = {}): RunAnnotationRecord {
  return {
    id: "a1",
    sessionId: "s1",
    annotatedAt: "2026-07-10T10:00:00.000Z",
    verdict: "agree",
    ...overrides,
  };
}

describe("annotation validation", () => {
  test("rejects a missing sessionId", () => {
    const r = normalizeAnnotationInput({ verdict: "agree" });
    expect(r.ok).toBe(false);
  });

  test("rejects an unknown verdict", () => {
    const r = normalizeAnnotationInput({ sessionId: "s1", verdict: "meh" });
    expect(r.ok).toBe(false);
  });

  test("requires correctedOutcome on disagree", () => {
    const r = normalizeAnnotationInput({ sessionId: "s1", verdict: "disagree" });
    expect(r.ok).toBe(false);
    const ok = normalizeAnnotationInput({
      sessionId: "s1",
      verdict: "disagree",
      correctedOutcome: "failure",
    });
    expect(ok.ok).toBe(true);
  });

  test("coerces and trims optional fields", () => {
    const r = normalizeAnnotationInput({
      sessionId: "s1",
      runId: "r1",
      verdict: "agree",
      note: "looks right",
      criteriaOverrides: [
        { nodeId: "n1", criterionId: "c1", pass: true },
        { nodeId: "", criterionId: "c2", pass: false }, // dropped: no nodeId
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.runId).toBe("r1");
      expect(r.value.criteriaOverrides).toHaveLength(1);
    }
  });
});

describe("annotation keying + dedup", () => {
  test("keys by run when present, else session", () => {
    expect(annotationKey({ runId: "r1", sessionId: "s1" })).toBe("run:r1");
    expect(annotationKey({ sessionId: "s1" })).toBe("session:s1");
  });

  test("latest annotation per key wins", () => {
    const records: RunAnnotationRecord[] = [
      record({ id: "old", runId: "r1", annotatedAt: "2026-07-10T09:00:00Z", verdict: "agree" }),
      record({ id: "new", runId: "r1", annotatedAt: "2026-07-10T11:00:00Z", verdict: "disagree" }),
      record({ id: "s-only", sessionId: "s2", annotatedAt: "2026-07-10T10:00:00Z" }),
    ];
    const deduped = dedupeAnnotationsLatestWins(records);
    expect(deduped).toHaveLength(2);
    const run = deduped.find((r) => annotationKey(r) === "run:r1");
    expect(run?.id).toBe("new");
    expect(run?.verdict).toBe("disagree");
  });

  test("parseAnnotationsJsonl skips blank and torn lines", () => {
    const text = [
      JSON.stringify(record({ id: "a" })),
      "",
      "{ not json",
      JSON.stringify(record({ id: "b", sessionId: "s2" })),
    ].join("\n");
    const parsed = parseAnnotationsJsonl(text);
    expect(parsed.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("EvalCase export", () => {
  const session = { query: "Order a laptop", startUrl: "https://x" };

  test("agree → expected outcome is the computed one", () => {
    const ann: RunAnnotation = {
      id: "a1",
      sessionId: "s1",
      runId: "r1",
      annotatedAt: "2026-07-10T10:00:00.000Z",
      verdict: "agree",
      computed: { outcome: "completed" },
    };
    const c = buildEvalCase(ann, session);
    expect(c.expected.outcome).toBe("completed");
    expect(c.humanVerdict).toBe("agree");
    expect(c.source.annotationId).toBe("a1");
    expect(c.id).toBe("adj-a1");
  });

  test("disagree → expected outcome is the human correction", () => {
    const ann: RunAnnotation = {
      id: "a2",
      sessionId: "s1",
      annotatedAt: "2026-07-10T10:00:00.000Z",
      verdict: "disagree",
      correctedOutcome: "failure",
      computed: { outcome: "completed" },
      note: "no REQ number was created",
    };
    const c = buildEvalCase(ann, session);
    expect(c.expected.outcome).toBe("failure");
    expect(c.computedOutcome).toBe("completed");
    expect(c.expected.note).toBe("no REQ number was created");
  });

  test("goldenFileName buckets by day", () => {
    expect(goldenFileName("2026-07-10T10:00:00.000Z")).toBe("adjudicated-2026-07-10");
  });
});
