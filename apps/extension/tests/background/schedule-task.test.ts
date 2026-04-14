import { describe, test, expect, beforeAll, vi } from "vitest";
import { toolRegistry } from "../../src/background/tools/registry";
import { registerTools } from "../../src/background/tools";
import { ToolName, RiskLevel } from "../../src/types";
import {
  getToolMeta,
  SEQUENTIAL_TOOLS,
  DOM_MODIFYING_TOOLS,
} from "../../src/background/tools/metadata";

beforeAll(() => {
  // Mock chrome.tabs for tools that need it during registration
  (chrome.tabs as any).get = vi.fn(async () => ({
    id: 123,
    url: "https://example.com",
    title: "Test",
    groupId: -1,
  }));

  toolRegistry.clear();
  registerTools();
});

describe("SCHEDULE_TASK tool", () => {
  test("is registered in the tool registry", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.SCHEDULE_TASK);
    expect(def).toBeDefined();
  });

  test("has correct metadata: LOW risk, not DOM modifying, sequential", () => {
    const meta = getToolMeta(ToolName.SCHEDULE_TASK);
    expect(meta).toBeDefined();
    expect(meta.risk).toBe(RiskLevel.LOW);
    expect(meta.domModifying).toBe(false);
    expect(meta.sequential).toBe(true);
  });

  test("is in SEQUENTIAL_TOOLS set", () => {
    expect(SEQUENTIAL_TOOLS.has(ToolName.SCHEDULE_TASK)).toBe(true);
  });

  test("is not in DOM_MODIFYING_TOOLS set", () => {
    expect(DOM_MODIFYING_TOOLS.has(ToolName.SCHEDULE_TASK)).toBe(false);
  });

  test("requires description and query parameters", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.SCHEDULE_TASK)!;
    expect(def.function.parameters.required).toContain("description");
    expect(def.function.parameters.required).toContain("query");
  });

  test("has schedule, runAt, and tabUrl as optional parameters", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.SCHEDULE_TASK)!;
    const props = def.function.parameters.properties;
    expect(props).toHaveProperty("schedule");
    expect(props).toHaveProperty("runAt");
    expect(props).toHaveProperty("tabUrl");
    // These should NOT be in required
    const required = def.function.parameters.required as string[];
    expect(required).not.toContain("schedule");
    expect(required).not.toContain("runAt");
    expect(required).not.toContain("tabUrl");
  });

  test("definition has descriptive description mentioning scheduling", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.SCHEDULE_TASK)!;
    expect(def.function.description.toLowerCase()).toContain("schedule");
  });

  test("has type 'function' in definition", () => {
    const defs = toolRegistry.getDefinitions();
    const def = defs.find((d) => d.function.name === ToolName.SCHEDULE_TASK)!;
    expect(def.type).toBe("function");
    expect(def.function.name).toBe("schedule_task");
  });
});
