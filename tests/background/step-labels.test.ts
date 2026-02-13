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

    test("read_element shows text by default", () => {
        expect(formatStepLabel(ToolName.READ_ELEMENT, { id: 5 })).toBe('Read text of [5]');
    });

    test("read_element with attribute", () => {
        expect(formatStepLabel(ToolName.READ_ELEMENT, { id: 3, attribute: "href" })).toBe('Read "href" of [3]');
    });

    test("execute_js shows code preview", () => {
        const label = formatStepLabel(ToolName.EXECUTE_JS, { code: "document.title" });
        expect(label).toContain("document.title");
    });

    test("execute_js truncates long code", () => {
        const label = formatStepLabel(ToolName.EXECUTE_JS, { code: "a".repeat(50) });
        expect(label).toContain("...");
    });

    test("upload_file shows tag ID", () => {
        expect(formatStepLabel(ToolName.UPLOAD_FILE, { id: 8 })).toBe("Upload file to [8]");
    });

    test("go_back", () => {
        expect(formatStepLabel(ToolName.GO_BACK, {})).toBe("Go back");
    });

    test("go_forward", () => {
        expect(formatStepLabel(ToolName.GO_FORWARD, {})).toBe("Go forward");
    });

    test("list_tabs", () => {
        expect(formatStepLabel(ToolName.LIST_TABS, {})).toBe("List tabs");
    });

    test("right_click shows tag ID", () => {
        expect(formatStepLabel(ToolName.RIGHT_CLICK, { id: 4 })).toBe("Right-click [4]");
    });

    test("set_checkbox shows tag ID and value", () => {
        expect(formatStepLabel(ToolName.SET_CHECKBOX, { id: 2, checked: true })).toBe("Set checkbox [2] = true");
    });

    test("download_file shows hostname", () => {
        const label = formatStepLabel(ToolName.DOWNLOAD_FILE, { url: "https://example.com/file.pdf" });
        expect(label).toBe("Download from example.com");
    });

    test("download_file without url", () => {
        expect(formatStepLabel(ToolName.DOWNLOAD_FILE, {})).toBe("Download file");
    });
});
