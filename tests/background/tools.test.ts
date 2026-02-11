import { describe, test, expect, beforeAll } from "bun:test";
import "../setup";
import { toolRegistry } from "../../src/background/tools/registry";
import { registerTools } from "../../src/background/tools";
import { ToolName } from "../../src/types";

// Register all tools once
beforeAll(() => {
    toolRegistry.clear();
    registerTools();
});

describe("Tool Registration", () => {
    test("all 20 tools are registered", () => {
        const defs = toolRegistry.getDefinitions();
        expect(defs.length).toBe(20);
    });

    test("every ToolName enum value has a registered definition", () => {
        const defs = toolRegistry.getDefinitions();
        const registeredNames = new Set(defs.map(d => d.function.name));
        for (const name of Object.values(ToolName)) {
            expect(registeredNames.has(name)).toBe(true);
        }
    });

    test("all definitions have type=function", () => {
        const defs = toolRegistry.getDefinitions();
        for (const def of defs) {
            expect(def.type).toBe("function");
        }
    });

    test("all definitions have required schema fields", () => {
        const defs = toolRegistry.getDefinitions();
        for (const def of defs) {
            expect(def.function.name).toBeTruthy();
            expect(def.function.description).toBeTruthy();
            expect(def.function.parameters).toBeDefined();
            expect(def.function.parameters.type).toBe("object");
            expect(def.function.parameters.properties).toBeDefined();
            expect(Array.isArray(def.function.parameters.required)).toBe(true);
        }
    });

    test("navigate tool requires url parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const nav = defs.find(d => d.function.name === ToolName.NAVIGATE);
        expect(nav).toBeDefined();
        expect(nav!.function.parameters.required).toContain("url");
    });

    test("done tool requires summary parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const done = defs.find(d => d.function.name === ToolName.DONE);
        expect(done).toBeDefined();
        expect(done!.function.parameters.required).toContain("summary");
    });

    test("close_tab has no required parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const closeTab = defs.find(d => d.function.name === ToolName.CLOSE_TAB);
        expect(closeTab).toBeDefined();
        expect(closeTab!.function.parameters.required).toEqual([]);
    });

    test("press_key tool requires key parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const pressKey = defs.find(d => d.function.name === ToolName.PRESS_KEY);
        expect(pressKey).toBeDefined();
        expect(pressKey!.function.parameters.required).toContain("key");
    });

    test("drag_and_drop tool requires sourceId and targetId", () => {
        const defs = toolRegistry.getDefinitions();
        const dnd = defs.find(d => d.function.name === ToolName.DRAG_AND_DROP);
        expect(dnd).toBeDefined();
        expect(dnd!.function.parameters.required).toContain("sourceId");
        expect(dnd!.function.parameters.required).toContain("targetId");
    });

    test("draw_stroke tool requires id, startX, startY, endX, endY", () => {
        const defs = toolRegistry.getDefinitions();
        const stroke = defs.find(d => d.function.name === ToolName.DRAW_STROKE);
        expect(stroke).toBeDefined();
        expect(stroke!.function.parameters.required).toEqual(
            expect.arrayContaining(["id", "startX", "startY", "endX", "endY"])
        );
    });
});
