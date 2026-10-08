import { beforeAll, describe, expect, test, vi } from "vitest";
import { ToolName } from "../../src/types";
import { registerTools, toolRegistry } from "../../src/background/tools";
import { applySkillToolRanking } from "../../src/background/agent/loop-skill-tools";
import { runPrepareModelTurnPhase, type PrepareModelTurnHost } from "../../src/background/agent/turn-phases/prepare-model-turn";
import { buildRoleExecutionContract } from "../../src/background/orchestrator/contracts";

const capture = vi.hoisted(() => ({ tools: [] as string[] }));
vi.mock("../../src/background/agent/loop-turn-preparation", () => ({
  prepareLlmTurnRequest: vi.fn(async (deps) => {
    const tools = deps.selectTools(deps.allTools);
    capture.tools = tools.map((tool: { function: { name: string } }) => tool.function.name);
    return { tools, messages: [], previousElementCount: 0, promptFingerprint: "test" };
  }),
}));
vi.mock("../../src/background/agent/turn-completion", () => ({
  completeTurnWithRetries: vi.fn(async () => ({ kind: "early_result", result: {} })),
}));

beforeAll(() => registerTools());

async function selectedTools(profile: string | undefined, disabledTools = new Set<ToolName>()) {
  const skillHost = {
    context: {
      getPlanStatusRaw: () => profile ? { subtasks: [{ description: "Read the page", status: "running", toolProfile: profile }] } : null,
      getSnapshot: () => ({ elements: [] }),
      hasSpawnedTabs: () => false,
    },
    limits: { stepWarnTurns: 10 }, turnsOnCurrentStep: 0,
    originalQuery: "Read the page", planSteps: [], planSubtasks: [], selectedSkillId: null,
    turnCount: 1, log: { info: vi.fn() },
  };
  const host = {
    ...skillHost,
    disabledTools,
    toolAvailability: { active: [] },
    telemetry: { turnCarry: {} },
    perception: { getCurrentObservation: () => null },
    abortController: new AbortController(),
    applySkillToolRanking: (tools: Parameters<typeof applySkillToolRanking>[1]) => applySkillToolRanking(skillHost, tools),
    stepHandler: vi.fn(),
  } as unknown as PrepareModelTurnHost;
  await runPrepareModelTurnPhase(host, 0);
  return { tools: capture.tools, active: host.toolAvailability.active };
}

describe("model turn tool availability", () => {
  test.each(["read_only", "navigate", undefined])("profile %s does not hide permitted actions", async (profile) => {
    const { tools, active } = await selectedTools(profile);
    expect(tools).toEqual(toolRegistry.getDefinitions().map(tool => tool.function.name));
    expect(active).toEqual(tools);
    expect(tools).toContain(ToolName.SWITCH_TAB);
    expect(tools).toContain(ToolName.LIST_TABS);
    expect(tools).toContain(ToolName.UPLOAD_FILE);
    expect(tools).toContain(ToolName.TYPE_TEXT);
  });

  test("enforced read-only access still excludes mutations from the actual model request", async () => {
    const contract = buildRoleExecutionContract("executor", { allowNavigation: true } as never, {
      allowedTools: Object.values(ToolName),
    } as never, "read_only");
    const { tools } = await selectedTools("form_fill", contract.disabledTools);
    expect(tools).toContain(ToolName.READ_PAGE);
    expect(tools).not.toContain(ToolName.TYPE_TEXT);
    expect(tools).not.toContain(ToolName.CLICK_ELEMENT);
  });

  test("user-disabled navigation is not restored by a navigation profile", async () => {
    const { tools } = await selectedTools("navigate", new Set([ToolName.NAVIGATE]));
    expect(tools).not.toContain(ToolName.NAVIGATE);
  });
});
