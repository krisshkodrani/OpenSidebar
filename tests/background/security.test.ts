import { describe, test, expect } from "bun:test";
import { classifyRisk, sanitizeUrl, sanitizeUserInput } from "../../src/background/security";
import { ToolName, RiskLevel } from "../../src/types";

describe("classifyRisk", () => {
    test("read-only tools are LOW risk", () => {
        expect(classifyRisk(ToolName.READ_PAGE, {})).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.SCROLL_PAGE, {})).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.MEMORY_SEARCH, {})).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.MEMORY_LIST_CATEGORIES, {})).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.WAIT, {})).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.TAKE_SCREENSHOT, {})).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.HOVER_ELEMENT, {})).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.FIND_ELEMENT, {})).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.DONE, { summary: "done" })).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.ESCALATE, { reason: "riddle" })).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.READ_ELEMENT, { id: 1 })).toBe(RiskLevel.LOW);
        expect(classifyRisk(ToolName.LIST_TABS, {})).toBe(RiskLevel.LOW);
    });

    test("mutation tools are MEDIUM risk", () => {
        expect(classifyRisk(ToolName.CLICK_ELEMENT, { id: 5 })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.TYPE_TEXT, { id: 1, text: "hello" })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.MEMORY_ADD, { content: "test" })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.MEMORY_UPDATE, { id: "1", content: "updated" })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.MEMORY_DELETE, { id: "1" })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.SWITCH_TAB, { tabId: 1 })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.RIGHT_CLICK, { id: 1 })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.SET_CHECKBOX, { id: 1, checked: true })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.UPLOAD_FILE, { id: 1, url: "https://example.com/file.txt" })).toBe(RiskLevel.MEDIUM);
        expect(classifyRisk(ToolName.DOWNLOAD_FILE, { url: "https://example.com/file.txt" })).toBe(RiskLevel.MEDIUM);
    });

    test("navigation and destructive tools are HIGH risk", () => {
        expect(classifyRisk(ToolName.NAVIGATE, { url: "https://example.com" })).toBe(RiskLevel.HIGH);
        expect(classifyRisk(ToolName.CREATE_TAB, { url: "https://example.com" })).toBe(RiskLevel.HIGH);
        expect(classifyRisk(ToolName.CLOSE_TAB, {})).toBe(RiskLevel.HIGH);
        expect(classifyRisk(ToolName.GO_BACK, {})).toBe(RiskLevel.HIGH);
        expect(classifyRisk(ToolName.GO_FORWARD, {})).toBe(RiskLevel.HIGH);
        expect(classifyRisk(ToolName.EXECUTE_JS, { code: "alert(1)" })).toBe(RiskLevel.HIGH);
    });

    test("unknown tool names default to HIGH", () => {
        expect(classifyRisk("unknown_tool" as ToolName, {})).toBe(RiskLevel.HIGH);
    });
});

describe("sanitizeUrl", () => {
    test("accepts valid https URLs", () => {
        const result = sanitizeUrl("https://example.com/path?q=test");
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe("https://example.com/path?q=test");
    });

    test("accepts valid http URLs", () => {
        const result = sanitizeUrl("http://localhost:3000");
        expect(result.ok).toBe(true);
    });

    test("blocks javascript: protocol", () => {
        const result = sanitizeUrl("javascript:alert(1)");
        expect(result.ok).toBe(false);
    });

    test("blocks data: protocol", () => {
        const result = sanitizeUrl("data:text/html,<h1>hi</h1>");
        expect(result.ok).toBe(false);
    });

    test("blocks file: protocol", () => {
        const result = sanitizeUrl("file:///etc/passwd");
        expect(result.ok).toBe(false);
    });

    test("rejects invalid URLs", () => {
        const result = sanitizeUrl("not a url");
        expect(result.ok).toBe(false);
    });

    test("normalizes URL via new URL()", () => {
        const result = sanitizeUrl("https://EXAMPLE.COM/");
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe("https://example.com/");
    });
});

describe("sanitizeUserInput", () => {
    test("removes null bytes", () => {
        expect(sanitizeUserInput("hello\0world")).toBe("helloworld");
    });

    test("truncates to 10000 chars", () => {
        const long = "a".repeat(15_000);
        expect(sanitizeUserInput(long).length).toBe(10_000);
    });

    test("passes through normal text", () => {
        expect(sanitizeUserInput("hello world")).toBe("hello world");
    });

    test("handles empty string", () => {
        expect(sanitizeUserInput("")).toBe("");
    });
});
