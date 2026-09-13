import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import { enforceToolProfile } from "../../src/background/orchestrator/enforced-tool-profile";
import { buildRoleExecutionContract } from "../../src/background/orchestrator/contracts";

describe("enforced tool profile", () => {
  test("intersects planner tools and removes skill expansion for remote read-only work", () => {
    const [node] = enforceToolProfile([{
      id: "step-1",
      role: "executor",
      description: "Inspect then edit",
      successCriteria: "Return the heading",
      allowedTools: [ToolName.READ_PAGE, ToolName.CLICK_ELEMENT, ToolName.TYPE_TEXT],
      selectedSkillId: "form-fill",
      selectedSkillReason: "planner",
      dependencies: [],
      assumptions: [],
      handoffArtifacts: [],
      reflexionLog: [],
      handoffDepth: 0,
      status: "pending",
      retries: 0,
    }], "read_only");
    expect(node.allowedTools).toEqual([ToolName.READ_PAGE]);
    expect(node.toolProfile).toBe("read_only");
    expect(node.selectedSkillId).toBeUndefined();
  });

  test("applies the ceiling after a skill attempts to expand executor tools", () => {
    const contract = buildRoleExecutionContract(
      "executor",
      { allowNavigation: true } as never,
      {
        id: "reroute",
        role: "executor",
        description: "A synthesized reroute",
        successCriteria: "Read only",
        allowedTools: [ToolName.READ_PAGE, ToolName.CLICK_ELEMENT, ToolName.TYPE_TEXT],
        dependencies: [], assumptions: [], handoffArtifacts: [], reflexionLog: [],
        handoffDepth: 0, status: "pending", retries: 0,
      },
      "read_only",
    );
    expect(contract.allowedTools).toContain(ToolName.READ_PAGE);
    expect(contract.allowedTools).not.toContain(ToolName.CLICK_ELEMENT);
    expect(contract.allowedTools).not.toContain(ToolName.TYPE_TEXT);
    expect(contract.disabledTools).toContain(ToolName.CLICK_ELEMENT);
  });
});
