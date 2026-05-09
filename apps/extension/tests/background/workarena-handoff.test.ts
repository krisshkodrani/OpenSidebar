import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import {
  extractSubmittedRecordNumberFromText,
  readTraceMetrics,
  readTraceTerminalFromIndex,
} from "../../../../scripts/workarena-handoff-metrics";

function withTempTrace(lines: unknown[], run: (filePath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "opensidebar-workarena-"));
  try {
    const filePath = join(dir, "trace.jsonl");
    writeFileSync(
      filePath,
      lines.map((line) => JSON.stringify(line)).join("\n"),
      "utf-8",
    );
    run(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("WorkArena handoff trace metrics", () => {
  test("extracts submitted ServiceNow records from helper tool results", () => {
    withTempTrace(
      [
        {
          runId: "run-a",
          turnNumber: 1,
          llmRequest: { messages: [] },
          llmResponse: {
            usage: {
              prompt_tokens: 10,
              completion_tokens: 3,
              total_tokens: 13,
              cost: 0.01,
            },
            toolCalls: [],
          },
          toolExecutions: [
            {
              toolName: "configure_servicenow_form",
              success: true,
              result:
                "Configured ServiceNow form.\nSubmitted ServiceNow form record: inc0046011",
            },
          ],
        },
        {
          runId: "run-a",
          turnNumber: 2,
          llmRequest: { messages: [] },
          llmResponse: {
            usage: {
              prompt_tokens: 6,
              completion_tokens: 2,
              total_tokens: 8,
              cost: 0.005,
            },
            toolCalls: [],
          },
          toolExecutions: [
            {
              toolName: "configure_servicenow_form",
              success: true,
              result:
                "Configured ServiceNow form.\nSubmitted ServiceNow form record: INC0046012",
            },
          ],
        },
      ],
      (filePath) => {
        const metrics = readTraceMetrics([filePath]);
        expect(metrics.submittedRecordNumber).toBe("INC0046011");
        expect(metrics.traceIds).toEqual(["run-a"]);
        expect(metrics.toolExecutions).toBe(2);
        expect(metrics.tokens.total).toBe(21);
      },
    );
  });

  test("keeps event and text extraction compatible with older reset evidence", () => {
    expect(
      extractSubmittedRecordNumberFromText(
        "Submit advanced from populated record CHG0031011 to fresh record form",
      ),
    ).toBe("CHG0031011");
    expect(
      extractSubmittedRecordNumberFromText('{"previousRecordId":"INC0046011"}'),
    ).toBe("INC0046011");
    expect(
      extractSubmittedRecordNumberFromText(
        "Submitted ServiceNow form sys_id: ABCDEF0123456789ABCDEF0123456789",
      ),
    ).toBe("abcdef0123456789abcdef0123456789");
  });

  test("extracts catalog request numbers from order confirmation text", () => {
    expect(
      extractSubmittedRecordNumberFromText(
        "Order Status: REQ0024924 | ServiceNow",
      ),
    ).toBe("REQ0024924");
    expect(
      extractSubmittedRecordNumberFromText(
        "Request Number: req0024925. Quantity 10.",
      ),
    ).toBe("REQ0024925");
  });

  test("reads completed agent sessions as terminal task evidence", () => {
    withTempTrace(
      [
        {
          traceKind: "agent.session",
          workspaceId: "other-workspace",
          outcome: "completed",
          summary: "Other task completed.",
        },
        {
          traceKind: "agent.session",
          workspaceId: "workspace-a",
          runId: "run-a",
          sessionId: "session-a",
          recordedAt: "2026-04-30T10:00:00.000Z",
          outcome: "completed",
          summary: "Trusted helper completed the task.",
        },
      ],
      (filePath) => {
        const terminal = readTraceTerminalFromIndex(filePath, "workspace-a");
        expect(terminal).toMatchObject({
          ok: true,
          reason: "task_completed",
          status: "completed",
          outcome: "completed",
          summary: "Trusted helper completed the task.",
          runId: "run-a",
          sessionId: "session-a",
        });
      },
    );
  });

  test("reads max-turn trace sessions as failed terminal evidence", () => {
    withTempTrace(
      [
        {
          traceKind: "agent.session",
          workspaceId: "workspace-a",
          outcome: "max_turns",
          summary: "Reached turn limit.",
        },
      ],
      (filePath) => {
        const terminal = readTraceTerminalFromIndex(filePath, "workspace-a");
        expect(terminal).toMatchObject({
          ok: false,
          reason: "task_failed",
          status: "failed",
          outcome: "max_turns",
          summary: "Reached turn limit.",
        });
      },
    );
  });
});
