import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import { assessListDetailWorkflow } from "../../src/background/agent/list-detail-policy";

function detailAction(id: number, text: string) {
  return {
    tag: id,
    tagName: "button",
    text,
    attributes: {},
    isVisible: true,
    isDisabled: false,
  };
}

describe("assessListDetailWorkflow", () => {
  test("preserves the highest visible detail action count", () => {
    const decision = assessListDetailWorkflow({
      selectedSkillId: "other-skill",
      query: "Review every listing",
      toolName: ToolName.READ_PAGE,
      args: {},
      snapshot: {
        elements: [detailAction(1, "View details for Alpha")],
      } as any,
      reviewedTargets: [],
      openedTargets: [],
      previousVisibleDetailActionCount: 4,
    });

    expect(decision).toEqual({
      visibleDetailActionCount: 4,
      block: null,
    });
  });

  test("returns a workflow block while broad list details remain unreviewed", () => {
    const decision = assessListDetailWorkflow({
      selectedSkillId: "list-detail-review-loop",
      query: "Review every job listing and recommend the best",
      toolName: ToolName.READ_PAGE,
      args: {},
      snapshot: {
        elements: [
          detailAction(1, "View details for Alpha"),
          detailAction(2, "View details for Beta"),
          detailAction(3, "View details for Gamma"),
        ],
      } as any,
      reviewedTargets: ["Alpha"],
      openedTargets: ["Alpha"],
      previousVisibleDetailActionCount: 0,
    });

    expect(decision.visibleDetailActionCount).toBe(3);
    expect(decision.block).toContain(
      "List-detail review is incomplete: reviewed 1/3 visible detail pages.",
    );
  });
});
