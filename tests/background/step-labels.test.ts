import { describe, test, expect } from "bun:test";
import "../setup";
import { formatStepLabel } from "../../src/background/agent/step-labels";
import { ToolName } from "../../src/types";

describe("formatStepLabel", () => {
    test("escalate with reason shows truncated reason", () => {
        const label = formatStepLabel(ToolName.ESCALATE, { reason: "This riddle requires multi-step logical reasoning" });
        expect(label).toContain("Escalate:");
        expect(label).toContain("riddle");
    });

    test("escalate without reason shows default label", () => {
        const label = formatStepLabel(ToolName.ESCALATE, {});
        expect(label).toBe("Escalate to smarter model");
    });

    test("find_element with text", () => {
        const label = formatStepLabel(ToolName.FIND_ELEMENT, { text: "Submit" });
        expect(label).toBe('Find "Submit"');
    });

    test("find_element without text", () => {
        const label = formatStepLabel(ToolName.FIND_ELEMENT, {});
        expect(label).toBe("Find element");
    });

    test("done returns Task complete", () => {
        expect(formatStepLabel(ToolName.DONE, { summary: "all done" })).toBe("Task complete");
    });

    test("click_element shows tag ID", () => {
        expect(formatStepLabel(ToolName.CLICK_ELEMENT, { id: 7 })).toBe("Click element [7]");
    });

    test("navigate shows hostname", () => {
        const label = formatStepLabel(ToolName.NAVIGATE, { url: "https://example.com/path" });
        expect(label).toBe("Navigate to example.com");
    });

    test("type_text shows text preview and tag", () => {
        const label = formatStepLabel(ToolName.TYPE_TEXT, { id: 3, text: "hello" });
        expect(label).toContain('"hello"');
        expect(label).toContain("[3]");
    });

    test("type_text truncates long text", () => {
        const label = formatStepLabel(ToolName.TYPE_TEXT, { id: 1, text: "a".repeat(50) });
        expect(label).toContain("...");
    });

    test("read_page", () => {
        expect(formatStepLabel(ToolName.READ_PAGE, {})).toBe("Read page content");
    });

    test("hide_element shows tag ID", () => {
        expect(formatStepLabel(ToolName.HIDE_ELEMENT, { id: 12 })).toBe("Hide element [12]");
    });

    test("update_plan shows step progress", () => {
        const label = formatStepLabel(ToolName.UPDATE_PLAN, {
            subtasks: ["Search Google", "Open result", "Find info"],
            currentIndex: 1,
        });
        expect(label).toBe("Plan: step 2 of 3");
    });

    test("update_plan without args shows default label", () => {
        const label = formatStepLabel(ToolName.UPDATE_PLAN, {});
        expect(label).toBe("Update plan");
    });
});
