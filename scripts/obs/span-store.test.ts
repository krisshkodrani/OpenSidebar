import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterAll, describe, expect, it } from "vitest";

import {
  putBlob,
  readSessionEntries,
  readSessionSpans,
  readSpineRunEvents,
  readSpineSessions,
  writeEntryRecord,
  writeRunEvents,
  writeSessionRecord,
} from "./span-store";
import { traceEntryToSpans } from "../../packages/observability-schema/src/map-trace-entry";
import type { TraceEntry } from "../../apps/extension/src/types/traces";

const root = join(tmpdir(), "obs-span-store-test");
const spanDir = join(root, "spans");
const blobDir = join(root, "blobs");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const entry = {
  sessionId: "sess-x",
  correlationId: "corr-x",
  turnNumber: 1,
  timestamp: 1000,
  snapshot: {
    url: "https://ex.com",
    title: "Ex",
    elementCount: 4,
    visibleContentLength: 50,
    scrollY: 0,
  },
  elements: [],
  llmRequest: {
    model: "m",
    modelTier: "executor",
    messageCount: 1,
    toolCount: 1,
    compressionLevel: "NONE",
    // a field OTel spans deliberately drop — proves the spine is lossless
    messages: [{ role: "user", content: "hi" }],
  },
  llmResponse: {
    content: "ok",
    toolCalls: [],
    finishReason: "stop",
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    durationMs: 30,
  },
  toolExecutions: [
    {
      toolCallId: "t1",
      toolName: "read_page",
      args: {},
      result: "ok",
      success: true,
      durationMs: 5,
      riskLevel: "LOW",
    },
  ],
  events: [],
  progressState: { stagnantTurns: 0, signal: null },
  perception: {
    interpretation: "page",
    model: "vlm",
    durationMs: 10,
    cached: false,
    screenshotDataUrl:
      "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  },
} as unknown as TraceEntry;

describe("span-store", () => {
  it("dual-read parity — the spine losslessly round-trips the full entry", () => {
    writeEntryRecord(entry, spanDir, blobDir);
    const [readEntry] = readSessionEntries("sess-x", spanDir);
    // Deep-equals the original, including fields OTel spans drop (messages).
    expect(readEntry).toEqual(entry);
    expect(readEntry.llmRequest.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("derives spans from the spine matching the deterministic mapper", () => {
    writeEntryRecord(entry, spanDir, blobDir);
    const spans = readSessionSpans("sess-x", spanDir);
    // Same shape as projecting directly (screenshot ref is rewritten to CAS).
    expect(spans.map((s) => s.kind)).toEqual(
      traceEntryToSpans(entry).map((s) => s.kind),
    );
    expect(spans.some((s) => s.kind === "agent.turn")).toBe(true);
  });

  it("is idempotent — replay produces identical records", () => {
    const first = writeEntryRecord(entry, spanDir, blobDir);
    const second = writeEntryRecord(entry, spanDir, blobDir);
    expect(second).toEqual(first);
    expect(readSessionEntries("sess-x", spanDir)).toEqual([entry]);
  });

  it("externalizes the screenshot to a content-addressed blob", () => {
    const record = writeEntryRecord(entry, spanDir, blobDir);
    const ref = record.spans
      .flatMap((s) => s.blobs ?? [])
      .find((b) => b.kind === "screenshot")?.ref;
    expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(existsSync(join(blobDir, ref!.replace("sha256:", "")))).toBe(true);
  });

  it("putBlob dedups identical content to the same ref", () => {
    const a = putBlob(Buffer.from("hello"), blobDir);
    const b = putBlob(Buffer.from("hello"), blobDir);
    expect(a).toBe(b);
  });

  it("round-trips a session record (sessions lens)", () => {
    writeSessionRecord(
      { sessionId: "sess-x", outcome: "completed", runId: "r1" },
      spanDir,
    );
    const found = readSpineSessions(spanDir).find(
      (s) => s.sessionId === "sess-x",
    );
    expect(found?.outcome).toBe("completed");
  });

  it("round-trips run events (run-events lens)", () => {
    const runDir = join(root, "runs");
    writeRunEvents(
      "r1",
      [
        { runId: "r1", type: "node_started" },
        { runId: "r1", type: "node_completed" },
      ],
      runDir,
    );
    expect(readSpineRunEvents("r1", runDir).map((e) => e.type)).toEqual([
      "node_started",
      "node_completed",
    ]);
  });
});
