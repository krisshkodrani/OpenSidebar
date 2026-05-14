import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  assessMissingToolEscalation,
  buildToolCapabilityCatalog,
  getToolCapabilities,
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
