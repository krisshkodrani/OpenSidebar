import { describe, test, expect } from "bun:test";
import "../setup";
import {
    getToolMeta,
    DOM_MODIFYING_TOOLS,
    SEQUENTIAL_TOOLS,
    SPEED_MODE_EXCLUDED_TOOLS,
} from "../../src/background/tools/metadata";
import { ToolName, RiskLevel } from "../../src/types";
import { classifyRisk } from "../../src/background/security";

describe("Tool Metadata", () => {
    describe("DOM_MODIFYING_TOOLS", () => {
        test("contains click, type, select, hover, drag, hide", () => {
            expect(DOM_MODIFYING_TOOLS.has(ToolName.CLICK_ELEMENT)).toBe(true);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.TYPE_TEXT)).toBe(true);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.SELECT_OPTION)).toBe(true);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.HOVER_ELEMENT)).toBe(true);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.DRAG_AND_DROP)).toBe(true);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.HIDE_ELEMENT)).toBe(true);
        });

        test("does not contain read-only tools", () => {
            expect(DOM_MODIFYING_TOOLS.has(ToolName.READ_PAGE)).toBe(false);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.SCROLL_PAGE)).toBe(false);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.FIND_ELEMENT)).toBe(false);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.TAKE_SCREENSHOT)).toBe(false);
            expect(DOM_MODIFYING_TOOLS.has(ToolName.NAVIGATE)).toBe(false);
        });
    });

    describe("SEQUENTIAL_TOOLS", () => {
        test("contains navigate and done", () => {
            expect(SEQUENTIAL_TOOLS.has(ToolName.NAVIGATE)).toBe(true);
            expect(SEQUENTIAL_TOOLS.has(ToolName.DONE)).toBe(true);
        });

        test("has exactly 2 entries", () => {
            expect(SEQUENTIAL_TOOLS.size).toBe(2);
        });
    });

    describe("SPEED_MODE_EXCLUDED_TOOLS", () => {
        test("excludes swarm, memory, wait, tab management tools", () => {
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.ACTIVATE_SWARM)).toBe(true);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.MEMORY_ADD)).toBe(true);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.MEMORY_SEARCH)).toBe(true);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.WAIT)).toBe(true);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.CREATE_TAB)).toBe(true);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.CLOSE_TAB)).toBe(true);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.SWITCH_TAB)).toBe(true);
        });

        test("does not exclude core interaction tools", () => {
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.CLICK_ELEMENT)).toBe(false);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.TYPE_TEXT)).toBe(false);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.NAVIGATE)).toBe(false);
            expect(SPEED_MODE_EXCLUDED_TOOLS.has(ToolName.TAKE_SCREENSHOT)).toBe(false);
        });
    });

    describe("getToolMeta", () => {
        test("returns metadata for every ToolName", () => {
            for (const name of Object.values(ToolName)) {
                const meta = getToolMeta(name as ToolName);
                expect(meta).toBeDefined();
                expect(meta.risk).toBeDefined();
                expect(typeof meta.domModifying).toBe("boolean");
                expect(typeof meta.sequential).toBe("boolean");
                expect(typeof meta.excludeInSpeedMode).toBe("boolean");
            }
        });
    });

    describe("classifyRisk uses metadata", () => {
        test("read_page is LOW risk", () => {
            expect(classifyRisk(ToolName.READ_PAGE, {})).toBe(RiskLevel.LOW);
        });

        test("click_element is MEDIUM risk", () => {
            expect(classifyRisk(ToolName.CLICK_ELEMENT, {})).toBe(RiskLevel.MEDIUM);
        });

        test("navigate is HIGH risk", () => {
            expect(classifyRisk(ToolName.NAVIGATE, {})).toBe(RiskLevel.HIGH);
        });

        test("activate_swarm is HIGH risk", () => {
            expect(classifyRisk(ToolName.ACTIVATE_SWARM, {})).toBe(RiskLevel.HIGH);
        });

        test("done is LOW risk", () => {
            expect(classifyRisk(ToolName.DONE, {})).toBe(RiskLevel.LOW);
        });

        test("press_key is MEDIUM risk", () => {
            expect(classifyRisk(ToolName.PRESS_KEY, {})).toBe(RiskLevel.MEDIUM);
        });
    });
});
