/**
 * Plan display labels — the planner-authored UI summary (owner decision
 * 2026-07-23, from the RunCard screenshot review).
 *
 * The contract under test: `description` stays the precise executor
 * instruction and is NEVER shortened for the model; `label`/`displayLabel` is
 * display-only, sanitized defensively (it is model output), and survives the
 * same-page collapse — the exact path that produced the unreadable
 * "Complete these steps in order…" card.
 */
import { describe, expect, test } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import {
  MAX_PLAN_LABEL_CHARS,
  sanitizePlanLabel,
} from "../../src/background/agent/plan-display-label";
import { collapseSameContextSequentialNodes } from "../../src/background/orchestrator/planner";
import type { TaskNode } from "../../src/background/orchestrator/types";

describe("sanitizePlanLabel", () => {
  test("normalizes whitespace and strips wrapping quotes and trailing periods", () => {
    expect(sanitizePlanLabel('  "Set  the\nnotification email."  ')).toBe(
      "Set the notification email",
    );
  });

  test("rejects non-strings and empty output rather than inventing one", () => {
    expect(sanitizePlanLabel(undefined)).toBeUndefined();
    expect(sanitizePlanLabel(42)).toBeUndefined();
    expect(sanitizePlanLabel('"  ."')).toBeUndefined();
  });

  test("truncates model overrun at a word boundary, visibly", () => {
    const long =
      "Set the notification email field and then click the delete account button to remove it";
    const label = sanitizePlanLabel(long)!;
    expect(label.length).toBeLessThanOrEqual(MAX_PLAN_LABEL_CHARS + 1);
    expect(label.endsWith("…")).toBe(true);
    // Word-boundary cut: what precedes the ellipsis is a whole word from the
    // source, not a fragment, and no trailing space is left behind.
    const kept = label.slice(0, -1);
    expect(kept.endsWith(" ")).toBe(false);
    expect(long.split(" ")).toContain(kept.split(" ").pop());
  });

  test("passes a well-formed label through unchanged", () => {
    expect(sanitizePlanLabel("Dismiss popups")).toBe("Dismiss popups");
  });
});

describe("same-page collapse label", () => {
  function chain(
    entries: Array<{ description: string; displayLabel?: string }>,
  ): TaskNode[] {
    return entries.map((entry, i) => ({
      id: `n${i + 1}`,
      role: "executor" as const,
      description: entry.description,
      ...(entry.displayLabel ? { displayLabel: entry.displayLabel } : {}),
      successCriteria: `${entry.description} is confirmed.`,
      allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
      dependencies: i === 0 ? [] : [`n${i}`],
      assumptions: [],
      handoffArtifacts: [],
      reflexionLog: [],
      handoffDepth: 0,
      status: "pending" as const,
      retries: 0,
    }));
  }

  const collapse = (nodes: TaskNode[]) =>
    collapseSameContextSequentialNodes(
      nodes,
      "Close popups, set the email, delete the account",
      "Settings",
      "https://app.example/settings",
      { enabledSkillPackIds: [] },
    );

  test("joins the step labels when they all exist and fit", () => {
    const merged = collapse(
      chain([
        { description: "Close any popup or overlay dialogs", displayLabel: "Dismiss popups" },
        { description: "Set the notification email field", displayLabel: "Set email" },
        { description: "Click the delete account button", displayLabel: "Delete account" },
      ]),
    );
    expect(merged).toHaveLength(1);
    // The executor material is untouched…
    expect(merged[0].description).toContain("Complete these steps in order");
    // …and the human-facing label is glanceable.
    expect(merged[0].displayLabel).toBe("Dismiss popups · Set email · Delete account");
  });

  test("falls back to first-label-plus-count when the join would not fit", () => {
    const merged = collapse(
      chain([
        { description: "Close any popup dialogs", displayLabel: "Dismiss every popup and overlay" },
        { description: "Set the notification email", displayLabel: "Set the notification email value" },
        { description: "Click delete account", displayLabel: "Delete the whole account" },
      ]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].displayLabel).toBe("Dismiss every popup and overlay +2 more");
  });

  test("emits no label at all when the steps had none — the UI clamp owns it", () => {
    const merged = collapse(
      chain([
        { description: "Close any popup dialogs" },
        { description: "Set the notification email" },
      ]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].displayLabel).toBeUndefined();
  });
});
