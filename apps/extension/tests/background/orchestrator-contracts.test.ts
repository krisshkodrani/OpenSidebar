import { describe, expect, test } from "vitest";
import "../setup";
import { ToolName, UserSettings, type ToolDefinition } from "../../src/types";
import { TaskNode } from "../../src/background/orchestrator/types";
import { buildRoleExecutionContract } from "../../src/background/orchestrator/contracts";
import { getSkillToolPolicy } from "../../src/background/orchestrator/skills";

import { applySkillToolRanking, type AgentLoopSkillToolsHost } from "../../src/background/agent/loop-skill-tools";

function visibleSkillTools(node: TaskNode, permitted: ToolName[]): ToolName[] {
  // Skill advice must preserve every role-permitted tool.
  expect(permitted).toEqual(expect.arrayContaining(node.allowedTools));
  const host = {
    selectedSkillId: node.selectedSkillId, turnCount: 1,
    log: { info: () => {} },
  } as unknown as AgentLoopSkillToolsHost;
  const definitions = permitted.map((name) => ({
    type: "function", function: { name, description: "", parameters: {} },
  })) as ToolDefinition[];
  return applySkillToolRanking(host, definitions).map((tool) => tool.function.name as ToolName);
}

const baseSettings: UserSettings = {
  openRouterApiKey: "test",
  maxTurns: 30,
  theme: "system",
  showSessionMetrics: false,
  requireApprovals: true,
  allowNavigation: true,
};

function makeNode(
  allowedTools: ToolName[],
  overrides: Partial<TaskNode> = {},
): TaskNode {
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
    ...overrides,
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

  test("executor contract allows selected skill preferred tools", () => {
    const node = makeNode([ToolName.READ_PAGE], {
      selectedSkillId: "search-answer-extraction",
    });
    const contract = buildRoleExecutionContract("executor", baseSettings, node);

    expect(contract.allowedTools.includes(ToolName.SEARCH_KNOWLEDGE_BASE)).toBe(
      true,
    );
    expect(contract.disabledTools.has(ToolName.SEARCH_KNOWLEDGE_BASE)).toBe(
      false,
    );
  });

  test("executor contract respects global disable flags", () => {
    const node = makeNode([ToolName.NAVIGATE, ToolName.DONE]);
    const contract = buildRoleExecutionContract(
      "executor",
      {
        ...baseSettings,
        allowNavigation: false,
      },
      node,
    );

    expect(contract.allowedTools.includes(ToolName.NAVIGATE)).toBe(false);
    expect(contract.disabledTools.has(ToolName.NAVIGATE)).toBe(true);
  });

  test("structured-form-fill keeps press_key available alongside its preferred tools", () => {
    const node = makeNode(
      [
        ToolName.READ_PAGE,
        ToolName.TYPE_TEXT,
        ToolName.PRESS_KEY,
        ToolName.UPDATE_NOTES,
        ToolName.CLARIFY,
      ],
      {
        selectedSkillId: "structured-form-fill",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.PRESS_KEY)).toBe(true);
    expect(contract.disabledTools.has(ToolName.PRESS_KEY)).toBe(false);
    expect(visibleTools.includes(ToolName.DONE)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
    expect(visibleTools.includes(ToolName.CLARIFY)).toBe(true);
  });

  test("progressive-repeatable-form keeps permitted navigation and form tools available", () => {
    const node = makeNode(
      [
        ToolName.READ_PAGE,
        ToolName.CLICK_ELEMENT,
        ToolName.TYPE_TEXT,
        ToolName.NAVIGATE,
        ToolName.OPEN_SERVICENOW_MODULE,
        ToolName.PRESS_KEY,
        ToolName.CLICK_COORDINATES,
        ToolName.UPDATE_NOTES,
      ],
      {
        selectedSkillId: "progressive-repeatable-form",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.READ_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.TYPE_TEXT)).toBe(true);
    expect(visibleTools.includes(ToolName.NAVIGATE)).toBe(true);
    expect(visibleTools.includes(ToolName.OPEN_SERVICENOW_MODULE)).toBe(
      true,
    );
    expect(visibleTools.includes(ToolName.PRESS_KEY)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_COORDINATES)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
  });

  test("multi-step-form-wizard keeps permitted navigation and form tools available", () => {
    const node = makeNode(
      [
        ToolName.READ_PAGE,
        ToolName.CLICK_ELEMENT,
        ToolName.TYPE_TEXT,
        ToolName.SELECT_OPTION,
        ToolName.SET_CHECKBOX,
        ToolName.NAVIGATE,
        ToolName.PRESS_KEY,
        ToolName.CLICK_COORDINATES,
        ToolName.UPDATE_NOTES,
      ],
      {
        selectedSkillId: "multi-step-form-wizard",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.READ_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.TYPE_TEXT)).toBe(true);
    expect(visibleTools.includes(ToolName.SELECT_OPTION)).toBe(true);
    expect(visibleTools.includes(ToolName.SET_CHECKBOX)).toBe(true);
    expect(visibleTools.includes(ToolName.NAVIGATE)).toBe(true);
    expect(visibleTools.includes(ToolName.PRESS_KEY)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_COORDINATES)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
  });

  test("modal-overlay-recovery keeps permitted actions and recovery exits available", () => {
    const node = makeNode(
      [
        ToolName.READ_PAGE,
        ToolName.CLICK_ELEMENT,
        ToolName.DISMISS_OVERLAYS,
        ToolName.NAVIGATE,
        ToolName.TYPE_TEXT,
        ToolName.ESCALATE,
        ToolName.CLARIFY,
        ToolName.UPDATE_NOTES,
      ],
      {
        selectedSkillId: "modal-overlay-recovery",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    // dismiss_overlays is the skill's opening move — it clicks real close
    // buttons and reports which overlays were only CSS-hidden. type_text stays
    // available (ranking demotes it): the matcher applies this skill to mixed
    // "close popups then fill the form" tasks, and suppressing type_text made
    // an agent type an email one press_key at a time (2026-07-23 baseline).
    expect(visibleTools.includes(ToolName.DISMISS_OVERLAYS)).toBe(true);
    expect(visibleTools.includes(ToolName.NAVIGATE)).toBe(true);
    expect(visibleTools.includes(ToolName.TYPE_TEXT)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.ESCALATE)).toBe(true);
    expect(visibleTools.includes(ToolName.CLARIFY)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
    expect(visibleTools.includes(ToolName.DONE)).toBe(true);
    expect(
      getSkillToolPolicy("modal-overlay-recovery")?.discouragedTools,
    ).not.toContain(ToolName.DONE);
  });

  test("inline-edit-surface keeps coordinate fallback and commit tools available", () => {
    const node = makeNode(
      [
        ToolName.CLICK_ELEMENT,
        ToolName.PRESS_KEY,
        ToolName.TYPE_TEXT,
        ToolName.CLICK_COORDINATES,
        ToolName.READ_PAGE,
      ],
      {
        selectedSkillId: "inline-edit-surface",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.CLICK_COORDINATES)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.PRESS_KEY)).toBe(true);
    expect(visibleTools.includes(ToolName.TYPE_TEXT)).toBe(true);
    expect(visibleTools.includes(ToolName.DONE)).toBe(true);
  });

  test("multi-tab-checklist-workflow keeps history navigation and tab workflow tools available", () => {
    const node = makeNode(
      [
        ToolName.READ_PAGE,
        ToolName.CREATE_TAB,
        ToolName.SWITCH_TAB,
        ToolName.CLICK_ELEMENT,
        ToolName.SET_CHECKBOX,
        ToolName.UPDATE_NOTES,
        ToolName.READ_ELEMENT,
        ToolName.LIST_TABS,
        ToolName.INSPECT_HIDDEN,
        ToolName.XRAY_PAGE,
        ToolName.NAVIGATE,
        ToolName.GO_BACK,
        ToolName.CLICK_COORDINATES,
      ],
      {
        selectedSkillId: "multi-tab-checklist-workflow",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.NAVIGATE)).toBe(true);
    expect(visibleTools.includes(ToolName.GO_BACK)).toBe(true);
    expect(visibleTools.includes(ToolName.READ_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.LIST_TABS)).toBe(true);
    expect(visibleTools.includes(ToolName.INSPECT_HIDDEN)).toBe(true);
    expect(visibleTools.includes(ToolName.XRAY_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_COORDINATES)).toBe(true);
    expect(visibleTools.includes(ToolName.CREATE_TAB)).toBe(true);
    expect(visibleTools.includes(ToolName.SWITCH_TAB)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.SET_CHECKBOX)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
    expect(visibleTools.includes(ToolName.DONE)).toBe(true);
  });

  test("list-detail-review-loop keeps permitted navigation and list-review tools", () => {
    const node = makeNode(
      [
        ToolName.CLICK_ELEMENT,
        ToolName.READ_PAGE,
        ToolName.PRESS_KEY,
        ToolName.READ_ELEMENT,
        ToolName.FIND_ELEMENT,
        ToolName.INSPECT_HIDDEN,
        ToolName.XRAY_PAGE,
        ToolName.CLICK_COORDINATES,
        ToolName.GO_BACK,
        ToolName.UPDATE_NOTES,
        ToolName.NAVIGATE,
      ],
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.NAVIGATE)).toBe(true);
    expect(visibleTools.includes(ToolName.GO_BACK)).toBe(true);
    expect(visibleTools.includes(ToolName.PRESS_KEY)).toBe(true);
    expect(visibleTools.includes(ToolName.READ_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.FIND_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.INSPECT_HIDDEN)).toBe(true);
    expect(visibleTools.includes(ToolName.XRAY_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_COORDINATES)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.READ_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
    expect(visibleTools.includes(ToolName.DONE)).toBe(true);
  });

  test("paginated-table-scan keeps permitted search, keyboard, and scan tools", () => {
    const node = makeNode(
      [
        ToolName.READ_PAGE,
        ToolName.CLICK_ELEMENT,
        ToolName.UPDATE_NOTES,
        ToolName.FIND_ELEMENT,
        ToolName.TYPE_TEXT,
        ToolName.PRESS_KEY,
        ToolName.SELECT_OPTION,
        ToolName.SET_CHECKBOX,
        ToolName.READ_ELEMENT,
        ToolName.SCROLL_PAGE,
        ToolName.CREATE_TAB,
        ToolName.CLICK_COORDINATES,
      ],
      {
        selectedSkillId: "paginated-table-scan",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.FIND_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.TYPE_TEXT)).toBe(true);
    expect(visibleTools.includes(ToolName.PRESS_KEY)).toBe(true);
    expect(visibleTools.includes(ToolName.SELECT_OPTION)).toBe(true);
    expect(visibleTools.includes(ToolName.SET_CHECKBOX)).toBe(true);
    expect(visibleTools.includes(ToolName.READ_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.SCROLL_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.CREATE_TAB)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_COORDINATES)).toBe(true);
    expect(visibleTools.includes(ToolName.READ_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
    expect(visibleTools.includes(ToolName.DONE)).toBe(true);
  });

  test("paginated-record-lookup keeps exploratory, search, and pagination tools available", () => {
    const node = makeNode(
      [
        ToolName.READ_PAGE,
        ToolName.FIND_ELEMENT,
        ToolName.TYPE_TEXT,
        ToolName.CLICK_ELEMENT,
        ToolName.READ_ELEMENT,
        ToolName.SCROLL_PAGE,
        ToolName.PRESS_KEY,
        ToolName.INSPECT_HIDDEN,
        ToolName.XRAY_PAGE,
        ToolName.CLICK_COORDINATES,
        ToolName.CREATE_TAB,
        ToolName.UPDATE_NOTES,
      ],
      {
        selectedSkillId: "paginated-record-lookup",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.READ_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.PRESS_KEY)).toBe(true);
    expect(visibleTools.includes(ToolName.INSPECT_HIDDEN)).toBe(true);
    expect(visibleTools.includes(ToolName.XRAY_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_COORDINATES)).toBe(true);
    expect(visibleTools.includes(ToolName.CREATE_TAB)).toBe(true);
    expect(visibleTools.includes(ToolName.READ_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.FIND_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.TYPE_TEXT)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.SCROLL_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
    expect(visibleTools.includes(ToolName.DONE)).toBe(true);
  });

  test("cross-tab-compare keeps history navigation and synthesis tools available", () => {
    const node = makeNode(
      [
        ToolName.READ_PAGE,
        ToolName.READ_ELEMENT,
        ToolName.SWITCH_TAB,
        ToolName.UPDATE_NOTES,
        ToolName.NAVIGATE,
        ToolName.GO_BACK,
        ToolName.CLICK_COORDINATES,
      ],
      {
        selectedSkillId: "cross-tab-compare",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);
    const visibleTools = visibleSkillTools(node, contract.allowedTools);

    expect(visibleTools.includes(ToolName.NAVIGATE)).toBe(true);
    expect(visibleTools.includes(ToolName.GO_BACK)).toBe(true);
    expect(visibleTools.includes(ToolName.CLICK_COORDINATES)).toBe(true);
    expect(visibleTools.includes(ToolName.READ_PAGE)).toBe(true);
    expect(visibleTools.includes(ToolName.READ_ELEMENT)).toBe(true);
    expect(visibleTools.includes(ToolName.SWITCH_TAB)).toBe(true);
    expect(visibleTools.includes(ToolName.UPDATE_NOTES)).toBe(true);
    expect(visibleTools.includes(ToolName.DONE)).toBe(true);
  });

  test("unknown skills do not suppress executor tools", () => {
    const node = makeNode(
      [ToolName.PRESS_KEY, ToolName.DISMISS_OVERLAYS, ToolName.TYPE_TEXT],
      {
        selectedSkillId: "not-a-real-skill",
      },
    );
    const contract = buildRoleExecutionContract("executor", baseSettings, node);

    expect(contract.allowedTools.includes(ToolName.PRESS_KEY)).toBe(true);
    expect(contract.allowedTools.includes(ToolName.DISMISS_OVERLAYS)).toBe(true);
    expect(contract.allowedTools.includes(ToolName.TYPE_TEXT)).toBe(true);
  });
});
