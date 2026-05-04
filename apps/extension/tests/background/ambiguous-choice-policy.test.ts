import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import { assessAmbiguousChoiceClickGuard } from "../../src/background/agent/ambiguous-choice-policy";

describe("assessAmbiguousChoiceClickGuard", () => {
  test("blocks an underspecified option click when page says to ask the user", () => {
    const decision = assessAmbiguousChoiceClickGuard({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 12 },
      originalQuery: "Open the workspace I should use for this project.",
      activeObjective: "Open the workspace I should use for this project.",
      snapshot: {
        visibleContent:
          "Important: The correct workspace is intentionally not specified on this page. Ask the user which workspace to open before clicking either button.",
        elements: [
          {
            tag: 12,
            tagName: "button",
            role: "button",
            text: "Open Beta Workspace",
            attributes: {},
          } as any,
        ],
      } as any,
    });

    expect(decision.blockReason).toContain("Ambiguous choice blocked");
    expect(decision.choiceKind).toBe("workspace");
  });

  test("allows an option click when the user names the target choice", () => {
    const decision = assessAmbiguousChoiceClickGuard({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 12 },
      originalQuery: "Open the Beta workspace.",
      activeObjective: "Open the Beta workspace.",
      snapshot: {
        visibleContent:
          "Important: The correct workspace is intentionally not specified on this page. Ask the user which workspace to open before clicking either button.",
        elements: [
          {
            tag: 12,
            tagName: "button",
            role: "button",
            text: "Open Beta Workspace",
            attributes: {},
          } as any,
        ],
      } as any,
    });

    expect(decision.blockReason).toBeNull();
  });

  test("does not block normal clicks without page-level deferral guidance", () => {
    const decision = assessAmbiguousChoiceClickGuard({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 7 },
      originalQuery: "Open the support dashboard.",
      snapshot: {
        visibleContent: "Dashboard links",
        elements: [
          {
            tag: 7,
            tagName: "button",
            role: "button",
            text: "Open Support Dashboard",
            attributes: {},
          } as any,
        ],
      } as any,
    });

    expect(decision.blockReason).toBeNull();
  });
});
