import { describe, expect, test } from "bun:test";
import "../setup";
import { ToolName, UserSettings } from "../../src/types";
import { TaskNode } from "../../src/background/orchestrator/types";
import { buildRoleExecutionContract } from "../../src/background/orchestrator/contracts";

const baseSettings: UserSettings = {
  openRouterApiKey: "test",
  groqApiKey: "",
  cerebrasApiKey: "",
  maxTurns: 30,
  contextWindowSize: 32000,
  memoryEnabled: true,
  workspaceEnabled: true,
  theme: "system",
  showElementTags: false,
  visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
  showSessionMetrics: false,
  disableScreenshot: false,
  disableNavigation: false,
  bypassApprovals: false,
  speechProvider: "browser",
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
    handoffDepth: 0,
    status: "pending",
    retries: 0,
  };
}

describe("Orchestrator role contracts", () => {
  test("planner and verifier use smart tier with no tool access", () => {
    const planner = buildRoleExecutionContract("planner", baseSettings);
    const verifier = buildRoleExecutionContract("verifier", baseSettings);

    expect(planner.modelTier).toBe("smart");
    expect(verifier.modelTier).toBe("smart");
    expect(planner.allowedTools).toHaveLength(0);
    expect(verifier.allowedTools).toHaveLength(0);
  });

  test("executor uses fast tier with node-scoped tools", () => {
    const node = makeNode([ToolName.READ_PAGE, ToolName.CLICK_ELEMENT]);
    const contract = buildRoleExecutionContract("executor", baseSettings, node);

    expect(contract.modelTier).toBe("fast");
    expect(contract.allowedTools.includes(ToolName.READ_PAGE)).toBe(true);
    expect(contract.allowedTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(contract.allowedTools.includes(ToolName.DONE)).toBe(true);
    expect(contract.disabledTools.has(ToolName.NAVIGATE)).toBe(true);
  });

  test("executor contract respects global disable flags", () => {
    const node = makeNode([ToolName.NAVIGATE, ToolName.TAKE_SCREENSHOT, ToolName.DONE]);
    const contract = buildRoleExecutionContract(
      "executor",
      {
        ...baseSettings,
        disableNavigation: true,
        disableScreenshot: true,
      },
      node,
    );

    expect(contract.allowedTools.includes(ToolName.NAVIGATE)).toBe(false);
    expect(contract.allowedTools.includes(ToolName.TAKE_SCREENSHOT)).toBe(false);
    expect(contract.disabledTools.has(ToolName.NAVIGATE)).toBe(true);
    expect(contract.disabledTools.has(ToolName.TAKE_SCREENSHOT)).toBe(true);
  });
});
