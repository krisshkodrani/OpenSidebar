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

    test("memory_update shows memory id", () => {
        expect(formatStepLabel(ToolName.MEMORY_UPDATE, { id: "mem-1" })).toBe("Update memory [mem-1]");
    });

    test("memory_delete shows memory id", () => {
        expect(formatStepLabel(ToolName.MEMORY_DELETE, { id: "mem-2" })).toBe("Delete memory [mem-2]");
    });

    test("memory_list_categories label", () => {
        expect(formatStepLabel(ToolName.MEMORY_LIST_CATEGORIES, {})).toBe("List memory categories");
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

    test("inspect_hidden with pattern", () => {
        const label = formatStepLabel(ToolName.INSPECT_HIDDEN, { pattern: "secret" });
        expect(label).toBe('Inspect hidden: "secret"');
    });

    test("inspect_hidden without pattern", () => {
        expect(formatStepLabel(ToolName.INSPECT_HIDDEN, {})).toBe("Inspect hidden elements");
    });

    test("xray_page", () => {
        expect(formatStepLabel(ToolName.XRAY_PAGE, {})).toBe("Toggle X-ray mode");
    });

    test("fast_forward", () => {
        expect(formatStepLabel(ToolName.FAST_FORWARD, {})).toBe("Toggle fast-forward");
    });

    // React toolkit tools
    test("inspect_react shows tag ID", () => {
        expect(formatStepLabel(ToolName.INSPECT_REACT, { id: 5 })).toBe("Inspect React state [5]");
    });

    test("inspect_react with missing id", () => {
        expect(formatStepLabel(ToolName.INSPECT_REACT, {})).toBe("Inspect React state [?]");
    });

    test("react_set_input shows value and tag ID", () => {
        const label = formatStepLabel(ToolName.REACT_SET_INPUT, { id: 3, value: "hello" });
        expect(label).toContain('"hello"');
        expect(label).toContain("[3]");
        expect(label).toContain("React set input");
    });

    test("react_set_input truncates long value", () => {
        const label = formatStepLabel(ToolName.REACT_SET_INPUT, { id: 1, value: "a".repeat(30) });
        expect(label).toContain("...");
    });

    test("inspect_react_tree without filter", () => {
        expect(formatStepLabel(ToolName.INSPECT_REACT_TREE, {})).toBe("Inspect React tree");
    });

    test("inspect_react_tree with filter", () => {
        const label = formatStepLabel(ToolName.INSPECT_REACT_TREE, { filter: "Button" });
        expect(label).toBe('React tree: "Button"');
    });

    test("wait_for_react shows default timeout", () => {
        expect(formatStepLabel(ToolName.WAIT_FOR_REACT, {})).toBe("Wait for React (3000ms)");
    });

    test("wait_for_react shows custom timeout", () => {
        expect(formatStepLabel(ToolName.WAIT_FOR_REACT, { timeout: 5000 })).toBe("Wait for React (5000ms)");
    });
});
