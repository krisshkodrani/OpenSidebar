import { describe, expect, it } from "vitest";
import { __testOnly as e2eUtilsTestOnly } from "../e2e/helpers/utils";
import { filterTraceFilesByWorkspace } from "../e2e/helpers/diagnostics";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("e2e helper semantics", () => {
  it("treats partial task completion as distinct from completed", () => {
    expect(
      e2eUtilsTestOnly.getLatestTaskCompletionState([
        { type: "TASK_COMPLETION", status: "partial" },
      ]),
    ).toBe("partial");

    expect(
      e2eUtilsTestOnly.getLatestTaskCompletionState([
        { type: "TASK_COMPLETION", status: "completed" },
      ]),
    ).toBe("completed");

    expect(e2eUtilsTestOnly.getLatestTaskCompletionState([])).toBe("none");
  });

  it("filters trace files by workspace id", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-e2e-"));
    try {
      const match = join(dir, "match.jsonl");
      const miss = join(dir, "miss.jsonl");

      writeFileSync(
        match,
        `${JSON.stringify({ workspaceId: "ws-1", turnNumber: 1 })}\n`,
        "utf-8",
      );
      writeFileSync(
        miss,
        `${JSON.stringify({ workspaceId: "ws-2", turnNumber: 1 })}\n`,
        "utf-8",
      );

      expect(filterTraceFilesByWorkspace([match, miss], "ws-1")).toEqual([match]);
      expect(filterTraceFilesByWorkspace([match, miss], null)).toEqual([match, miss]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
