import { describe, expect, test } from "vitest";
import "../setup";
import { ToolName, UserSettings } from "../../src/types";
import { TaskNode } from "../../src/background/orchestrator/types";
import { buildRoleExecutionContract } from "../../src/background/orchestrator/contracts";

const baseSettings: UserSettings = {
  openRouterApiKey: "test",
  groqApiKey: "",
  maxTurns: 30,
  contextWindowSize: 32000,
  memoryEnabled: true,
  workspaceEnabled: true,
  theme: "system",
  visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
  showSessionMetrics: false,
  disableNavigation: false,
  bypassApprovals: false,
  orchestratorMaxWorkers: 3,
};

function makeNode(allowedTools: ToolName[]): TaskNode {
  return {
    id: "node-1",
    role: "executor",
    description: "Test objective",
    successCriteria: "Test success",
    allowedTools,
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status: "pending",
    retries: 0,
  };
}

describe("Orchestrator role contracts", () => {
  test("planner and verifier use planner tier with no tool access", () => {
    const planner = buildRoleExecutionContract("planner", baseSettings);
    const verifier = buildRoleExecutionContract("verifier", baseSettings);

    expect(planner.modelTier).toBe("planner");
    expect(verifier.modelTier).toBe("planner");
    expect(planner.allowedTools).toHaveLength(0);
    expect(verifier.allowedTools).toHaveLength(0);
  });

  test("executor uses executor tier with node-scoped tools", () => {
    const node = makeNode([ToolName.READ_PAGE, ToolName.CLICK_ELEMENT]);
    const contract = buildRoleExecutionContract("executor", baseSettings, node);

    expect(contract.modelTier).toBe("executor");
    expect(contract.allowedTools.includes(ToolName.READ_PAGE)).toBe(true);
    expect(contract.allowedTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(contract.allowedTools.includes(ToolName.DONE)).toBe(true);
    expect(contract.disabledTools.has(ToolName.NAVIGATE)).toBe(true);
  });

  test("executor contract respects global disable flags", () => {
    const node = makeNode([ToolName.NAVIGATE, ToolName.DONE]);
    const contract = buildRoleExecutionContract(
      "executor",
      {
        ...baseSettings,
        disableNavigation: true,
      },
      node,
    );

    expect(contract.allowedTools.includes(ToolName.NAVIGATE)).toBe(false);
    expect(contract.disabledTools.has(ToolName.NAVIGATE)).toBe(true);
  });
});
