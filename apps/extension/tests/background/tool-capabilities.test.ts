import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import type { LLMMessage } from "../../src/background/llm/types";
import type { ToolDefinition } from "../../src/types";
import {
  assessMissingToolEscalation,
  buildToolCapabilityCatalog,
  getToolCapabilities,
  withToolCapabilityCatalog,
} from "../../src/background/agent/tool-capabilities";

describe("tool capability catalog", () => {
  test("maps common form tools to user-level capabilities", () => {
    const capabilities = getToolCapabilities([
      ToolName.READ_PAGE,
      ToolName.TYPE_TEXT,
      ToolName.CLICK_ELEMENT,
      ToolName.SET_CHECKBOX,
    ]);

    expect(capabilities.has("read_page_state")).toBe(true);
    expect(capabilities.has("fill_text_fields")).toBe(true);
    expect(capabilities.has("click_elements")).toBe(true);
    expect(capabilities.has("set_binary_controls")).toBe(true);
    expect(capabilities.has("submit_forms")).toBe(true);
  });

  test("builds a concise prompt catalog from active tool names", () => {
    const catalog = buildToolCapabilityCatalog([
      ToolName.TYPE_TEXT,
      ToolName.CLICK_ELEMENT,
    ]);

    expect(catalog).toContain("## Available Tool Capabilities");
    expect(catalog).toContain("fill_text_fields: type_text");
    expect(catalog).toContain("click_elements: click_element");
  });

  // Issue #107. The catalog's bytes change with the tool SET, so where it sits
  // decides how much cached prefix a tool-set change destroys. Appended to the
  // system message it sat ahead of all history and cost the entire history
  // prefix — 21% of warm turns in the LP-21 step-2 window.
  describe("catalog placement (prompt-cache prefix)", () => {
    const tool = (name: ToolName): ToolDefinition =>
      ({
        type: "function",
        function: { name, description: "", parameters: {} },
      }) as unknown as ToolDefinition;

    const basePrompt = (): LLMMessage[] => [
      { role: "system", content: "STATIC RULES" },
      { role: "user", content: "the goal" },
      { role: "assistant", content: "a previous turn" },
      { role: "user", content: "## Page Context\nvolatile page state" },
    ];

    test("appends the catalog last and leaves the system message untouched", () => {
      const result = withToolCapabilityCatalog(basePrompt(), [
        tool(ToolName.CLICK_ELEMENT),
      ]);

      expect(result).toHaveLength(basePrompt().length + 1);
      expect(result[result.length - 1].content).toContain(
        "## Available Tool Capabilities",
      );
      expect(result[0].content).toBe("STATIC RULES");
    });

    test("a tool-SET change leaves every preceding message byte-identical", () => {
      // The invariant that matters: everything before the catalog keeps its
      // bytes, so the cached prefix survives a tool-set change.
      const before = withToolCapabilityCatalog(basePrompt(), [
        tool(ToolName.CLICK_ELEMENT),
      ]);
      const after = withToolCapabilityCatalog(basePrompt(), [
        tool(ToolName.CLICK_ELEMENT),
        tool(ToolName.TYPE_TEXT),
      ]);

      expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
      // ...and the catalog itself really did change, or the test proves nothing.
      expect(after[after.length - 1].content).not.toEqual(
        before[before.length - 1].content,
      );
    });

    test("tool REORDERING does not change the prompt at all", () => {
      // buildToolCapabilityCatalog sorts and dedupes, so skill-based ranking is
      // already harmless. Pinned so a future refactor cannot silently drop it.
      const a = withToolCapabilityCatalog(basePrompt(), [
        tool(ToolName.CLICK_ELEMENT),
        tool(ToolName.TYPE_TEXT),
      ]);
      const b = withToolCapabilityCatalog(basePrompt(), [
        tool(ToolName.TYPE_TEXT),
        tool(ToolName.CLICK_ELEMENT),
      ]);

      expect(b).toEqual(a);
    });

    test("returns the prompt unchanged when no tools are selected", () => {
      const prompt = basePrompt();
      expect(withToolCapabilityCatalog(prompt, [])).toBe(prompt);
    });
  });

  test("rejects missing-tool escalation when the active tool set has the requested capability", () => {
    const assessment = assessMissingToolEscalation({
      args: {
        reason:
          "I cannot complete the login form because I do not have type_text or click_element tools.",
        reasonCode: "missing_tool",
        requiredCapability: "fill_text_fields",
      },
      availableToolNames: [
        ToolName.READ_PAGE,
        ToolName.TYPE_TEXT,
        ToolName.CLICK_ELEMENT,
      ],
    });

    expect(assessment.decision).toBe("reject");
    expect(assessment.reason).toBe("capability_available");
    if (assessment.decision === "reject") {
      expect(assessment.requiredCapability).toBe("fill_text_fields");
      expect(assessment.correction).toContain("Escalation rejected");
      expect(assessment.correction).toContain("type_text");
    }
  });

  test("allows missing-tool escalation when the capability is absent", () => {
    const assessment = assessMissingToolEscalation({
      args: {
        reason:
          "I need to run JavaScript to inspect a custom shadow DOM state, but no JavaScript tool is available.",
        reasonCode: "missing_tool",
        requiredCapability: "execute_javascript",
      },
      availableToolNames: [ToolName.READ_PAGE, ToolName.CLICK_ELEMENT],
    });

    expect(assessment.decision).toBe("allow");
    expect(assessment.reason).toBe("capability_unavailable");
  });

  test("allows normal stuck escalations", () => {
    const assessment = assessMissingToolEscalation({
      args: {
        reason:
          "The puzzle requires multi-step reasoning after two failed attempts.",
        reasonCode: "complex_reasoning",
      },
      availableToolNames: [ToolName.READ_PAGE, ToolName.CLICK_ELEMENT],
    });

    expect(assessment.decision).toBe("allow");
    expect(assessment.reason).toBe("not_missing_tool_claim");
  });
});
