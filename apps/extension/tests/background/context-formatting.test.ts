/**
 * Tests for context deduplication: deduplicateInvisibleElements and compressRepetitiveContent
 */

import { describe, test, expect } from "vitest";
import {
  deduplicateInvisibleElements,
  compressRepetitiveContent,
  repairToolCallPairing,
} from "../../src/background/agent/context-formatting";
import { TaggedElement } from "../../src/types";

/** Helper to create a TaggedElement with optional invisible-text attributes */
function makeElement(
  tag: number,
  tagName: string,
  text: string,
  opts: { invisible?: boolean; textColor?: string; bgColor?: string } = {},
): TaggedElement {
  const attributes: Record<string, string> = {};
  if (opts.invisible) {
    attributes["text-color"] = opts.textColor || "#fff";
    attributes["bg-color"] = opts.bgColor || "#fff";
  } else if (opts.textColor || opts.bgColor) {
    if (opts.textColor) attributes["text-color"] = opts.textColor;
    if (opts.bgColor) attributes["bg-color"] = opts.bgColor;
  }
  return {
    tag,
    tagName,
    role: tagName,
    text,
    attributes,
    rect: { x: 0, y: 0, width: 100, height: 30 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("deduplicateInvisibleElements", () => {
  test("20 invisible buttons → 1 group line with IDs and sample texts", () => {
    const elements = Array.from({ length: 20 }, (_, i) =>
      makeElement(100 + i, "button", `Decoy ${i}`, { invisible: true }),
    );
    const { visible, groups } = deduplicateInvisibleElements(elements);

    expect(visible).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain("20× button");
    expect(groups[0]).toContain("[invisible-text group]");
    expect(groups[0]).toMatch(/IDs: 100,101,102/);
    expect(groups[0]).toContain('"Decoy 0"');
  });

  test("mixed visible/invisible → visible kept individually, invisible grouped", () => {
    const elements = [
      makeElement(1, "button", "Real Button"),
      makeElement(2, "a", "Real Link"),
      ...Array.from({ length: 5 }, (_, i) =>
        makeElement(10 + i, "button", `Hidden ${i}`, { invisible: true }),
      ),
    ];
    const { visible, groups } = deduplicateInvisibleElements(elements);

    expect(visible).toHaveLength(2);
    expect(visible[0].tag).toBe(1);
    expect(visible[1].tag).toBe(2);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain("5× button");
  });

  test("<3 invisible same-type → returned as visible (no grouping)", () => {
    const elements = [
      makeElement(1, "button", "Hidden A", { invisible: true }),
      makeElement(2, "button", "Hidden B", { invisible: true }),
    ];
    const { visible, groups } = deduplicateInvisibleElements(elements);

    expect(visible).toHaveLength(2);
    expect(groups).toHaveLength(0);
  });

  test("different tagNames → separate groups", () => {
    const buttons = Array.from({ length: 4 }, (_, i) =>
      makeElement(10 + i, "button", `Btn ${i}`, { invisible: true }),
    );
    const links = Array.from({ length: 3 }, (_, i) =>
      makeElement(20 + i, "a", `Link ${i}`, { invisible: true }),
    );
    const { visible, groups } = deduplicateInvisibleElements([
      ...buttons,
      ...links,
    ]);

    expect(visible).toHaveLength(0);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.includes("4× button"))).toBeTruthy();
    expect(groups.find((g) => g.includes("3× a"))).toBeTruthy();
  });

  test("elements without text-color/bg-color → treated as visible", () => {
    const elements = [
      makeElement(1, "button", "Normal"),
      makeElement(2, "button", "Also Normal", {
        textColor: "#000",
        bgColor: "#fff",
      }),
    ];
    const { visible, groups } = deduplicateInvisibleElements(elements);

    expect(visible).toHaveLength(2);
    expect(groups).toHaveLength(0);
  });

  test("group line shows up to 5 sample texts", () => {
    const elements = Array.from({ length: 10 }, (_, i) =>
      makeElement(i, "span", `Text ${i}`, { invisible: true }),
    );
    const { groups } = deduplicateInvisibleElements(elements);

    expect(groups).toHaveLength(1);
    // Should have 5 quoted texts max
    const quoteMatches = groups[0].match(/"/g);
    // 5 texts × 2 quotes each = 10
    expect(quoteMatches!.length).toBe(10);
  });
});

describe("compressRepetitiveContent", () => {
  test("100 'Section N: filler' lines → 3 shown + suppression notice", () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `Section ${i + 1}: filler content here`,
    );
    const input = lines.join("\n");
    const result = compressRepetitiveContent(input);

    const outputLines = result.split("\n");
    // First 3 original lines preserved
    expect(outputLines[0]).toBe("Section 1: filler content here");
    expect(outputLines[1]).toBe("Section 2: filler content here");
    expect(outputLines[2]).toBe("Section 3: filler content here");
    // Suppression notice
    expect(outputLines).toContainEqual(
      expect.stringContaining("omitting 97 instances"),
    );
    // Much shorter than original
    expect(outputLines.length).toBeLessThan(10);
  });

  test("all unique content → preserved unchanged", () => {
    const input = "First line\nSecond line\nThird line";
    const result = compressRepetitiveContent(input);
    expect(result).toBe(input);
  });

  test("mixed repetitive + unique → unique preserved, repetitive compressed", () => {
    const lines = [
      "Unique header",
      "Item 1: same pattern",
      "Item 2: same pattern",
      "Item 3: same pattern",
      "Item 4: same pattern",
      "Item 5: same pattern",
      "Unique footer",
    ];
    const result = compressRepetitiveContent(lines.join("\n"));
    const outputLines = result.split("\n");

    expect(outputLines).toContain("Unique header");
    expect(outputLines).toContain("Unique footer");
    expect(outputLines).toContain("Item 1: same pattern");
    expect(outputLines).toContain("Item 2: same pattern");
    expect(outputLines).toContain("Item 3: same pattern");
    // Items 4 and 5 suppressed
    expect(outputLines).not.toContain("Item 4: same pattern");
    expect(outputLines).not.toContain("Item 5: same pattern");
    expect(outputLines).toContainEqual(
      expect.stringContaining("omitting 2 instances"),
    );
  });

  test("empty input → empty output", () => {
    expect(compressRepetitiveContent("")).toBe("");
  });

  test("custom maxRepetitions parameter", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Row ${i + 1}: data`);
    const result = compressRepetitiveContent(lines.join("\n"), 5);
    const outputLines = result.split("\n");

    // First 5 preserved
    for (let i = 0; i < 5; i++) {
      expect(outputLines).toContain(`Row ${i + 1}: data`);
    }
    // 6-10 suppressed
    expect(outputLines).toContainEqual(
      expect.stringContaining("omitting 5 instances"),
    );
  });
});

/**
 * repairToolCallPairing — the OpenAI tool-call protocol invariant.
 *
 * Regression origin: a medium e2e run on Cerebras produced 189 HTTP 400s
 * ("assistant message with 'tool_calls' must be followed by tool messages
 * responding to each 'tool_call_id'"). The old sanitizer validated by set
 * membership, so narration appended between an assistant and its results
 * passed as valid. Lenient backends accepted it; Cerebras did not.
 */
describe("repairToolCallPairing", () => {
  const asst = (...ids: string[]) => ({
    role: "assistant" as const,
    content: "",
    tool_calls: ids.map((id) => ({
      id,
      type: "function" as const,
      function: { name: "click_element", arguments: "{}" },
    })),
  });
  const result = (id: string) => ({
    role: "tool" as const,
    content: "ok",
    tool_call_id: id,
  });
  const user = (content: string) => ({ role: "user" as const, content });

  /**
   * The invariant the API enforces, both directions: every assistant call has
   * a contiguously-following result, AND every tool result is part of such a
   * run. The second half matters — stripping an assistant's tool_calls while
   * leaving its partial results produces the mirror-image violation.
   */
  function assertPaired(messages: any[]): void {
    const claimed = new Set<number>();
    for (let i = 0; i < messages.length; i++) {
      const calls = messages[i].tool_calls;
      if (!calls?.length) continue;
      const following: string[] = [];
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role !== "tool") break;
        following.push(messages[j].tool_call_id);
        claimed.add(j);
      }
      for (const tc of calls) expect(following).toContain(tc.id);
    }
    messages.forEach((m, i) => {
      if (m.role === "tool") expect(claimed.has(i)).toBe(true);
    });
  }

  test("hoists a result past narration injected between call and result", () => {
    const out = repairToolCallPairing([
      asst("tc1"),
      user("Preflight warning: element moved"),
      result("tc1"),
    ]);
    assertPaired(out);
    expect(out[0].tool_calls).toHaveLength(1);
    expect(out[1].tool_call_id).toBe("tc1");
    // Narration is preserved, just moved after the results it describes.
    expect(out[2].content).toContain("Preflight warning");
  });

  test("handles narration landing mid-run of parallel tool calls", () => {
    const out = repairToolCallPairing([
      asst("tc1", "tc2"),
      result("tc1"),
      user("Preflight warning"),
      result("tc2"),
    ]);
    assertPaired(out);
    expect(out.filter((m: any) => m.role === "tool")).toHaveLength(2);
  });

  test("strips tool_calls when a result is missing, orphaning nothing", () => {
    const out = repairToolCallPairing([asst("tc1", "tc2"), result("tc1")]);
    assertPaired(out);
    expect(out[0].tool_calls).toBeUndefined();
    // The partial result must go too, or it becomes an orphan.
    expect(out.some((m: any) => m.role === "tool")).toBe(false);
  });

  test("drops a tool result whose assistant fell outside the window", () => {
    const out = repairToolCallPairing([user("goal"), result("gone")]);
    assertPaired(out);
    expect(out.some((m: any) => m.role === "tool")).toBe(false);
  });

  test("leaves an already-valid conversation untouched", () => {
    const input = [user("goal"), asst("tc1"), result("tc1"), asst("tc2"), result("tc2")];
    const out = repairToolCallPairing(input);
    assertPaired(out);
    expect(out).toEqual(input);
  });

  test("does not hoist results across a later tool-calling turn", () => {
    // tc1's result sits past the next assistant turn — unreachable, so tc1
    // must lose its tool_calls rather than emit an unanswerable message.
    const out = repairToolCallPairing([asst("tc1"), asst("tc2"), result("tc2"), result("tc1")]);
    assertPaired(out);
  });
});
