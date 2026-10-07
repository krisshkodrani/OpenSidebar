import { describe, expect, test, vi } from "vitest";
import { ToolName, type ToolDefinition } from "../../src/types";
import { registerTools, toolRegistry } from "../../src/background/tools";
import { handleEscalateToolCall, type AgentLoopToolHandlerHost } from "../../src/background/agent/loop-tool-handlers";
import { requestedRecoveryTools, restoreRecoveryTools } from "../../src/background/agent/capability-recovery";
import { assessMissingToolEscalation, buildToolCapabilityCatalog } from "../../src/background/agent/tool-capabilities";

const request = {
  reason: "The regular HTML form needs type_text or click_element; no generic interaction tools are available.",
  reasonCode: "missing_tool",
  requiredCapability: "fill_text_fields",
};
const active = [ToolName.READ_PAGE, ToolName.CONFIGURE_SERVICENOW_FORM];

describe("missing-tool recovery", () => {
  test("platform adapters do not falsely promise generic form capabilities", () => {
    const catalog = buildToolCapabilityCatalog(active);
    expect(catalog).toContain("service_now_forms: configure_servicenow_form");
    expect(catalog).not.toContain("fill_text_fields");
    expect(assessMissingToolEscalation({ args: request, availableToolNames: active }).reason)
      .toBe("capability_unavailable");
  });

  test("restores permitted named tools and capabilities without exposing unrelated tools", () => {
    expect(requestedRecoveryTools(request, active, [
      ...active, ToolName.TYPE_TEXT, ToolName.CLICK_ELEMENT, ToolName.EXECUTE_JS,
    ])).toEqual([ToolName.TYPE_TEXT, ToolName.CLICK_ELEMENT]);
  });

  test("does not expand the enforced read-only ceiling or unrelated reasoning escalations", () => {
    expect(requestedRecoveryTools(request, active, [ToolName.READ_PAGE])).toEqual([]);
    expect(requestedRecoveryTools({ reason: "Need help reasoning", reasonCode: "complex_reasoning" },
      active, [ToolName.TYPE_TEXT])).toEqual([]);
  });

  test("escalation restores the next turn's actual tools instead of changing models", async () => {
    registerTools();
    const permitted = new Set([...active, ToolName.TYPE_TEXT, ToolName.CLICK_ELEMENT]);
    const disabledTools = new Set(Object.values(ToolName).filter((name) => !permitted.has(name)));
    const messages: unknown[] = [];
    const escalateModel = vi.fn();
    const toolAvailability = { active, requested: new Set<ToolName>() };
    const host = {
      disabledTools, toolAvailability, getActiveToolNamesForTurn: () => active,
      context: { addMessage: (message: unknown) => messages.push(message) },
      turnCount: 14, escalateModel,
      traceRecorder: { recordEvent: vi.fn() },
    } as unknown as AgentLoopToolHandlerHost;
    const result = await handleEscalateToolCall(host, "request-tools", request, 1, 6, 0, 0, false);
    expect(result.escalationTier).toBe(0);
    expect(escalateModel).not.toHaveBeenCalled();
    expect(messages).toEqual([expect.objectContaining({ content: expect.stringContaining("Restored tools") })]);
    const permittedDefinitions = toolRegistry.getDefinitions(disabledTools);
    const selected = permittedDefinitions.filter((tool) => active.includes(tool.function.name as ToolName));
    const nextTurn = restoreRecoveryTools(selected, permittedDefinitions, toolAvailability.requested);
    expect(nextTurn.map((tool) => tool.function.name)).toEqual(expect.arrayContaining([
      ToolName.TYPE_TEXT, ToolName.CLICK_ELEMENT,
    ]));
    expect(buildToolCapabilityCatalog(nextTurn)).toContain("fill_text_fields: type_text");
    expect(nextTurn.some((tool) => tool.function.name === ToolName.EXECUTE_JS)).toBe(false);
    // A later authorization change still wins over an earlier recovery request.
    expect(restoreRecoveryTools([], [] as ToolDefinition[], toolAvailability.requested)).toEqual([]);
  });
});
