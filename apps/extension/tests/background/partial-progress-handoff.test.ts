import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  buildPartialProgressHandoff,
  createProgressLedger,
  formatPartialProgressHandoffSummary,
  hasUsefulPartialProgressHandoff,
  recordProgressLedgerToolResult,
  updateProgressLedgerState,
} from "../../src/background/agent/partial-progress-handoff";
import {
  planTerminationMessage,
  successfulTaskCompletionMessage,
} from "../../src/background/agent/agent-broadcast";
import { emptySessionMetrics } from "../../src/background/agent/agent-telemetry";

describe("partial progress handoff", () => {
  test("builds deterministic handoff from page evidence without an LLM", () => {
    const ledger = createProgressLedger();
    updateProgressLedgerState(
      ledger,
      {
        title: "Transformer Notes",
        url: "https://example.test/transformers",
        elements: [],
        visibleContent: "Attention, encoder-decoder, positional encoding",
        viewport: { width: 1280, height: 720 },
        scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
      },
      "Summarize the page",
    );
    recordProgressLedgerToolResult(ledger, {
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content: Transformers use attention, an encoder-decoder structure, and positional encoding.",
      turn: 1,
      url: "https://example.test/transformers",
    });

    const handoff = buildPartialProgressHandoff({
      ledger,
      task: "Read this page and summarize the main points.",
      reason: "max_turns",
      turnsUsed: 1,
      maxTurns: 1,
      generatedAt: "2026-05-26T00:00:00.000Z",
    });

    expect(handoff).toMatchObject({
      schemaVersion: "2026-05-26",
      status: "partial_handoff",
      reason: "max_turns",
      turnsUsed: 1,
      maxTurns: 1,
      currentState: {
        title: "Transformer Notes",
        url: "https://example.test/transformers",
      },
    });
    expect(handoff.evidence[0]?.value).toContain("attention");
    expect(handoff.remaining[0]?.text).toContain("Summarize the page");
    expect(handoff.suggestedContinuationPrompt).toContain(
      "Continue from the previous partial handoff",
    );

    const summary = formatPartialProgressHandoffSummary(handoff);
    expect(summary).toContain("Status: Partial - turn budget exhausted");
    expect(summary).toContain("This is incomplete");
    expect(summary).toContain("Suggested continuation:");
  });

  test("empty ledger is honest and does not fabricate progress", () => {
    const handoff = buildPartialProgressHandoff({
      ledger: createProgressLedger(),
      task: "Find details on the page.",
      reason: "max_turns",
      turnsUsed: 0,
      maxTurns: 0,
      generatedAt: "2026-05-26T00:00:00.000Z",
    });

    expect(handoff.completed).toEqual([]);
    expect(handoff.evidence).toEqual([]);
    expect(handoff.uncertainty.map((item) => item.text).join("\n")).toContain(
      "No durable page evidence was captured",
    );
    expect(handoff.suggestedContinuationPrompt).toContain(
      "No durable evidence was captured",
    );
    expect(hasUsefulPartialProgressHandoff(handoff)).toBe(false);

    const summary = formatPartialProgressHandoffSummary(handoff);
    expect(summary).toContain("Status: Incomplete - turn budget exhausted");
    expect(summary).toContain("No durable progress was captured");
  });

  test("page state alone is not treated as useful partial progress", () => {
    const ledger = createProgressLedger();
    updateProgressLedgerState(ledger, {
      title: "Knowledge Base",
      url: "https://example.test/kb",
      elements: [],
      visibleContent: "Troubleshooting article",
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });
    const handoff = buildPartialProgressHandoff({
      ledger,
      task: "Read the page.",
      reason: "max_turns",
      turnsUsed: 1,
      maxTurns: 1,
      generatedAt: "2026-05-26T00:00:00.000Z",
    });

    expect(handoff.currentState).toMatchObject({
      title: "Knowledge Base",
      url: "https://example.test/kb",
    });
    expect(hasUsefulPartialProgressHandoff(handoff)).toBe(false);

    const message = planTerminationMessage({
      taskId: "task-1",
      subtasks: [
        {
          description: "Read the page",
          status: "running",
          turnsUsed: 1,
          result: "",
        },
      ],
      outcome: "max_turns",
      summary: formatPartialProgressHandoffSummary(handoff),
      turnCount: 1,
      maxTurns: 1,
      totalTimeMs: 1000,
      urlHistory: [],
      metrics: emptySessionMetrics(),
      partialHandoff: handoff,
    });

    expect(message?.payload.status).toBe("failed");
  });

  test("plan termination attaches empty handoff without marking it partial", () => {
    const handoff = buildPartialProgressHandoff({
      ledger: createProgressLedger(),
      task: "Read the page.",
      reason: "max_turns",
      turnsUsed: 1,
      maxTurns: 1,
      generatedAt: "2026-05-26T00:00:00.000Z",
    });

    const message = planTerminationMessage({
      taskId: "task-1",
      subtasks: [
        {
          description: "Read the page",
          status: "running",
          turnsUsed: 1,
          result: "",
        },
      ],
      outcome: "max_turns",
      summary: formatPartialProgressHandoffSummary(handoff),
      turnCount: 1,
      maxTurns: 1,
      totalTimeMs: 1000,
      urlHistory: [],
      metrics: emptySessionMetrics(),
      partialHandoff: handoff,
    });

    expect(message?.payload.status).toBe("failed");
    expect(message?.payload.partialHandoff).toBe(handoff);
  });

  test("plan termination marks useful max-turn handoff partial", () => {
    const ledger = createProgressLedger();
    updateProgressLedgerState(ledger, {
      title: "Knowledge Base",
      url: "https://example.test/kb",
      elements: [],
      visibleContent: "Troubleshooting article",
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });
    recordProgressLedgerToolResult(ledger, {
      toolName: ToolName.READ_PAGE,
      args: {},
      result: "Page content: Troubleshooting article with restart steps.",
      turn: 1,
      url: "https://example.test/kb",
    });
    const handoff = buildPartialProgressHandoff({
      ledger,
      task: "Read the page.",
      reason: "max_turns",
      turnsUsed: 1,
      maxTurns: 1,
      generatedAt: "2026-05-26T00:00:00.000Z",
    });

    const message = planTerminationMessage({
      taskId: "task-1",
      subtasks: [
        {
          description: "Read the page",
          status: "running",
          turnsUsed: 1,
          result: "",
        },
      ],
      outcome: "max_turns",
      summary: formatPartialProgressHandoffSummary(handoff),
      turnCount: 1,
      maxTurns: 1,
      totalTimeMs: 1000,
      urlHistory: [],
      metrics: emptySessionMetrics(),
      partialHandoff: handoff,
    });

    expect(hasUsefulPartialProgressHandoff(handoff)).toBe(true);
    expect(message?.payload.status).toBe("partial");
  });

  test("successful completion message does not emit partial handoff", () => {
    const message = successfulTaskCompletionMessage({
      taskId: "task-1",
      subtasks: [
        {
          description: "Read the page",
          status: "completed",
          turnsUsed: 1,
          result: "Done",
        },
      ],
      turnCount: 1,
      totalTimeMs: 1000,
      summary: "Done",
      urlHistory: [],
    });

    expect(message?.payload.status).toBe("completed");
    expect(message?.payload.partialHandoff).toBeUndefined();
  });
});
