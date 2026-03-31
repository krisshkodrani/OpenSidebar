import { describe, expect, test } from "vitest";
import {
  analyzeAgentRuntimeDiagnostics,
  formatRuntimeDiagnostics,
} from "../../evals/runtime-diagnostics";

describe("runtime diagnostics", () => {
  test("flags mixed workspace IDs in a single trace", () => {
    const diagnostics = analyzeAgentRuntimeDiagnostics([
      { workspaceId: "ws-1", turnNumber: 1, url: "https://example.com/a" },
      { workspaceId: "ws-2", turnNumber: 2, url: "https://example.com/a" },
    ], { expectedWorkspaceId: "ws-1" });

    expect(diagnostics.some((d) => d.type === "mixed_workspace_ids")).toBe(true);
    expect(diagnostics.some((d) => d.type === "unexpected_workspace_id")).toBe(true);
  });

  test("flags repeated done rejection loops", () => {
    const diagnostics = analyzeAgentRuntimeDiagnostics([
      {
        turnNumber: 1,
        url: "https://example.com/report",
        toolCalls: [{ name: "done", args: { summary: "done" } }],
        toolResults: [{ name: "done", success: false, result: "Planner rejected done: task incomplete" }],
      },
      {
        turnNumber: 2,
        url: "https://example.com/report",
        toolCalls: [{ name: "done", args: { summary: "done again" } }],
        toolResults: [{ name: "done", success: false, result: "Planner rejected done: still incomplete" }],
      },
    ]);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "repeated_done_rejection" }),
      ]),
    );
  });

  test("flags stalled right-click loops without menu evidence", () => {
    const diagnostics = analyzeAgentRuntimeDiagnostics([
      {
        turnNumber: 4,
        url: "https://example.com/files",
        title: "Files",
        toolCalls: [{ name: "right_click", args: { id: 8 } }],
        toolResults: [{ name: "right_click", success: true, result: "Dispatched contextmenu on [8]" }],
      },
      {
        turnNumber: 5,
        url: "https://example.com/files",
        title: "Files",
        toolCalls: [{ name: "right_click", args: { id: 8 } }],
        toolResults: [{ name: "right_click", success: true, result: "Dispatched contextmenu on [8]" }],
      },
      {
        turnNumber: 6,
        url: "https://example.com/files",
        title: "Files",
        toolCalls: [{ name: "right_click", args: { id: 8 } }],
        toolResults: [{ name: "right_click", success: true, result: "Dispatched contextmenu on [8]" }],
      },
    ]);

    expect(diagnostics.some((d) => d.type === "stalled_right_click_loop")).toBe(true);
  });

  test("flags stalled scroll loops with minimal movement", () => {
    const diagnostics = analyzeAgentRuntimeDiagnostics([
      {
        turnNumber: 10,
        snapshot: { url: "https://example.com/feed", scroll: { y: 100, maxY: 5000 } },
        toolCalls: [{ name: "scroll_page", args: { direction: "down" } }],
      },
      {
        turnNumber: 11,
        snapshot: { url: "https://example.com/feed", scroll: { y: 140, maxY: 5000 } },
        toolCalls: [{ name: "scroll_page", args: { direction: "down" } }],
      },
      {
        turnNumber: 12,
        snapshot: { url: "https://example.com/feed", scroll: { y: 180, maxY: 5000 } },
        toolCalls: [{ name: "scroll_page", args: { direction: "down" } }],
      },
    ]);

    expect(diagnostics.some((d) => d.type === "stalled_scroll_loop")).toBe(true);
  });

  test("flags repeated go_back without URL change", () => {
    const diagnostics = analyzeAgentRuntimeDiagnostics([
      {
        turnNumber: 7,
        snapshot: { url: "https://example.com/beta" },
        toolCalls: [{ name: "go_back", args: {} }],
      },
      {
        turnNumber: 8,
        snapshot: { url: "https://example.com/beta" },
        toolCalls: [{ name: "go_back", args: {} }],
      },
    ]);

    expect(diagnostics.some((d) => d.type === "stalled_go_back_loop")).toBe(true);
  });

  test("formats diagnostics for trace summaries", () => {
    const text = formatRuntimeDiagnostics([
      {
        type: "stalled_scroll_loop",
        severity: "medium",
        turnNumber: 10,
        message: "scroll_page repeated 3 times on the same URL with only 80px of net scroll progress.",
      },
    ]);

    expect(text).toContain("Runtime diagnostics:");
    expect(text).toContain("stalled_scroll_loop");
    expect(text).toContain("T10");
  });
});
