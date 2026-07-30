import { describe, expect, test } from "vitest";
import {
  buildTrajectory,
  type TrajectoryTurn,
} from "../../../../scripts/bench/trajectory";

/**
 * Regression cover for the 2026-07-26 judge-blindness defect: a correct Hacker
 * News answer scored as a failure because the rendered trajectory carried no
 * observation for WebJudge to check the answer against.
 */
describe("bench trajectory rendering", () => {
  test("keeps narration on turns that also called a tool", () => {
    // The real shape of the failing turn: answered from perception, so the
    // narration is the ONLY evidence the agent looked at the page.
    const turns: TrajectoryTurn[] = [
      {
        turnNumber: 1,
        llmContent:
          "The Hacker News front page is already loaded and the #1 story is visible at the top.",
        toolCalls: [
          { name: "done", args: { summary: "The #1 story is Ruff v0.16.0" } },
        ],
        toolResults: [],
        url: "https://news.ycombinator.com/",
      },
    ];
    const lines = buildTrajectory(turns);
    expect(lines.some((l) => l.includes("agent-claim"))).toBe(true);
    expect(lines.join("\n")).toContain("already loaded");
    expect(lines.some((l) => l.startsWith("T1 done("))).toBe(true);
  });

  test("emits tool results, not just tool calls", () => {
    const turns: TrajectoryTurn[] = [
      {
        turnNumber: 2,
        toolCalls: [{ name: "read_element", args: { id: 206 } }],
        toolResults: [
          {
            name: "read_element",
            success: true,
            result: '[206] <a> "typescript": typescript',
          },
        ],
        url: "https://github.com/",
      },
    ];
    const joined = buildTrajectory(turns).join("\n");
    expect(joined).toContain("read_element(id=206)");
    expect(joined).toContain("typescript");
  });

  test("surfaces tool errors distinctly from successes", () => {
    const turns: TrajectoryTurn[] = [
      {
        turnNumber: 3,
        toolCalls: [{ name: "click_element", args: { id: 9 } }],
        toolResults: [
          {
            name: "click_element",
            success: false,
            result: "",
            error: "element 9 not found",
          },
        ],
      },
    ];
    const joined = buildTrajectory(turns).join("\n");
    expect(joined).toContain("ERROR");
    expect(joined).toContain("element 9 not found");
  });

  test("does not clip a done summary to the old 40-char budget", () => {
    const summary =
      "The number one story on the Hacker News front page is Ruff v0.16.0 with 413 default rules";
    const lines = buildTrajectory([
      { turnNumber: 1, toolCalls: [{ name: "done", args: { summary } }] },
    ]);
    expect(lines[0]).toContain("413 default rules");
  });

  test("renders one line per event so the judge line cap stays predictable", () => {
    const turns: TrajectoryTurn[] = [
      {
        turnNumber: 1,
        llmContent: "looking",
        toolCalls: [{ name: "read_page", args: {} }],
        toolResults: [
          { name: "read_page", success: true, result: "some\npage\ntext" },
        ],
      },
    ];
    const lines = buildTrajectory(turns);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).not.toContain("\n");
  });

  test("grounds a perception-only turn in observed page text", () => {
    // The HN case: answered from perception, no read tool. The observed text is
    // harness-recorded, so it is evidence the model cannot fabricate.
    const lines = buildTrajectory([
      {
        turnNumber: 1,
        llmContent: "The #1 story is visible at the top.",
        toolCalls: [{ name: "done", args: { summary: "Ruff v0.16.0" } }],
        toolResults: [],
        observedText: ["Hacker News", "Ruff v0.16.0 – 413 default rules", "astral.sh"],
      },
    ]);
    const joined = lines.join("\n");
    expect(joined).toContain("saw (page text)");
    expect(joined).toContain("413 default rules");
    // Observed evidence must be distinguishable from the model's own account.
    expect(joined).toContain("agent-claim");
    expect(joined.indexOf("saw (page text)")).toBeLessThan(
      joined.indexOf("agent-claim"),
    );
  });

  test("omits the perception digest when the turn already has tool results", () => {
    // Tool results are stronger evidence; the digest exists only to cover turns
    // that would otherwise carry none, so the judge prompt stays bounded.
    const joined = buildTrajectory([
      {
        turnNumber: 2,
        toolCalls: [{ name: "read_element", args: { id: 1 } }],
        toolResults: [{ name: "read_element", success: true, result: "hello" }],
        observedText: ["lots", "of", "page", "text"],
      },
    ]).join("\n");
    expect(joined).not.toContain("saw (page text");
    expect(joined).toContain("hello");
  });

  test("flags how much observed text was dropped by the cap", () => {
    const many = Array.from({ length: 75 }, (_, i) => `item-${i}`);
    const joined = buildTrajectory([
      { turnNumber: 1, toolCalls: [], toolResults: [], observedText: many },
    ]).join("\n");
    expect(joined).toContain("+15 more");
  });

  test("records a placeholder for a turn with no recorded action", () => {
    expect(buildTrajectory([{ turnNumber: 4, toolCalls: [] }])).toEqual([
      "T4 (no action recorded)",
    ]);
  });
});
