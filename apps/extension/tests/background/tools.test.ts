import { describe, test, expect, beforeAll, beforeEach, vi } from "vitest";
import "../setup";
import { toolRegistry } from "../../src/background/tools/registry";
import { registerTools } from "../../src/background/tools";
import { ToolName } from "../../src/types";

// Register all tools once
beforeAll(() => {
    toolRegistry.clear();
    registerTools();
});

beforeEach(() => {
    (chrome.webNavigation as any).onCompleted = {
        addListener: (cb: (details: { tabId: number; frameId: number }) => void) =>
            setTimeout(() => cb({ tabId: 123, frameId: 0 }), 0),
        removeListener: () => {},
    };
    (chrome.webNavigation as any).onErrorOccurred = {
        addListener: () => {},
        removeListener: () => {},
    };
    (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
        id: 123,
        url: "https://example.com/start",
        title: "Start",
        groupId: -1,
    }));
    (chrome.tabs as any).goBack = vi.fn(async () => {});
    (chrome.scripting as any).executeScript = vi.fn(async () => [{ result: undefined }]);
    (chrome.tabs as any).sendMessage = vi.fn(async (tabId: number, message: any) => {
        if (message?.type === "DOM_READY_PROBE") {
            return { payload: { waitedMs: 10, elementCount: 4 } };
        }
        return { payload: { result: "ok", success: true } };
    });
    (chrome.storage.sync as any).get = vi.fn(async () => ({ userSettings: {} }));
});

describe("Tool Registration", () => {
    test("all 39 tools are registered", () => {
        const defs = toolRegistry.getDefinitions();
        expect(defs.length).toBe(39);
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
            // Some tools (e.g. navigate) have no required fields
            if (def.function.parameters.required !== undefined) {
                expect(Array.isArray(def.function.parameters.required)).toBe(true);
            }
        }
    });

    test("navigate tool accepts url or query parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const nav = defs.find(d => d.function.name === ToolName.NAVIGATE);
        expect(nav).toBeDefined();
        expect(nav!.function.parameters.properties).toHaveProperty("url");
        expect(nav!.function.parameters.properties).toHaveProperty("query");
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

    test("hide_element tool requires id parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const hide = defs.find(d => d.function.name === ToolName.HIDE_ELEMENT);
        expect(hide).toBeDefined();
        expect(hide!.function.parameters.required).toContain("id");
        expect(hide!.function.parameters.properties.id.type).toBe("integer");
    });

    test("scroll_page tool has y param and optional id/direction", () => {
        const defs = toolRegistry.getDefinitions();
        const scroll = defs.find(d => d.function.name === ToolName.SCROLL_PAGE);
        expect(scroll).toBeDefined();
        // Neither y nor direction is required — handler validates at runtime
        expect(scroll!.function.parameters.required).toEqual([]);
        expect(scroll!.function.parameters.properties.y).toBeDefined();
        expect(scroll!.function.parameters.properties.y.type).toBe("integer");
        expect(scroll!.function.parameters.properties.direction).toBeDefined();
        expect(scroll!.function.parameters.properties.id).toBeDefined();
        expect(scroll!.function.parameters.properties.id.type).toBe("integer");
    });

    test("escalate tool requires reason parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const escalate = defs.find(d => d.function.name === ToolName.ESCALATE);
        expect(escalate).toBeDefined();
        expect(escalate!.function.parameters.required).toContain("reason");
        expect(escalate!.function.parameters.properties.reason.type).toBe("string");
    });

    test("escalate tool description mentions planner model and puzzles/riddles", () => {
        const defs = toolRegistry.getDefinitions();
        const escalate = defs.find(d => d.function.name === ToolName.ESCALATE);
        expect(escalate).toBeDefined();
        expect(escalate!.function.description).toContain("planner model");
        expect(escalate!.function.description).toContain("riddles");
    });

    test("clarify tool requires question parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const clarify = defs.find(d => d.function.name === ToolName.CLARIFY);
        expect(clarify).toBeDefined();
        expect(clarify!.function.parameters.required).toContain("question");
        expect(clarify!.function.parameters.properties.question.type).toBe("string");
    });

    test("find_element description mentions tag ID", () => {
        const defs = toolRegistry.getDefinitions();
        const find = defs.find(d => d.function.name === ToolName.FIND_ELEMENT);
        expect(find).toBeDefined();
        expect(find!.function.description).toContain("tag ID");
    });

    test("read_element requires id parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.READ_ELEMENT);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("id");
        expect(def!.function.parameters.properties.attribute).toBeDefined();
    });

    test("execute_js requires code parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.EXECUTE_JS);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("code");
    });

    test("upload_file requires id and url parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.UPLOAD_FILE);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("id");
        expect(def!.function.parameters.required).toContain("url");
    });

    test("go_back has no required parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.GO_BACK);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toEqual([]);
    });

    test("list_tabs has no required parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.LIST_TABS);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toEqual([]);
    });

    test("right_click requires id parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.RIGHT_CLICK);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("id");
    });

    test("set_checkbox requires id and checked parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.SET_CHECKBOX);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("id");
        expect(def!.function.parameters.required).toContain("checked");
    });

    test("download_file requires url parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.DOWNLOAD_FILE);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("url");
        expect(def!.function.parameters.properties.filename).toBeDefined();
    });

    test("get_cookies has no required parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.GET_COOKIES);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toEqual([]);
        expect(def!.function.parameters.properties.url).toBeDefined();
    });

    test("set_cookie requires url, name, value", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.SET_COOKIE);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("url");
        expect(def!.function.parameters.required).toContain("name");
        expect(def!.function.parameters.required).toContain("value");
    });

    test("delete_cookie requires url and name", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.DELETE_COOKIE);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("url");
        expect(def!.function.parameters.required).toContain("name");
    });

    test("search_history requires query", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.SEARCH_HISTORY);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("query");
        expect(def!.function.parameters.properties.maxResults).toBeDefined();
    });

    test("inspect_hidden has no required parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.INSPECT_HIDDEN);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toEqual([]);
        expect(def!.function.parameters.properties.pattern).toBeDefined();
        expect(def!.function.parameters.properties.maxResults).toBeDefined();
    });

    test("xray_page has no required parameters and mentions toggle", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.XRAY_PAGE);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toEqual([]);
        expect(Object.keys(def!.function.parameters.properties)).toHaveLength(0);
        expect(def!.function.description).toContain("Toggle");
        expect(def!.function.description).toContain("hidden");
    });

    test("update_notes requires note parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.UPDATE_NOTES);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("note");
        expect(def!.function.parameters.properties.note.type).toBe("string");
        expect(def!.function.description).toContain("persistent working memory");
    });

    test("get_profile_fields requires a fields array", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.GET_PROFILE_FIELDS);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("fields");
        expect(def!.function.parameters.properties.fields.type).toBe("array");
        expect(def!.function.description).toContain("local personal profile");
    });

    test("go_back reports the destination URL after history navigation changes the page", async () => {
        let currentUrl = "https://example.com/step-3";
        (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
            id: 123,
            url: currentUrl,
            title: "History page",
            groupId: -1,
        }));
        (chrome.tabs as any).goBack = vi.fn(async () => {
            currentUrl = "https://example.com/step-2";
        });

        const result = await toolRegistry.execute(
            {
                id: "tool-1",
                type: "function",
                function: {
                    name: ToolName.GO_BACK,
                    arguments: "{}",
                },
            } as any,
            123,
        );

        expect(result).toContain("Navigated back to https://example.com/step-2");
    });

    test("go_back returns an error when browser history stays on the same URL", async () => {
        const currentUrl = "https://example.com/step-2";
        (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
            id: 123,
            url: currentUrl,
            title: "History page",
            groupId: -1,
        }));
        (chrome.tabs as any).goBack = vi.fn(async () => {});

        const result = await toolRegistry.execute(
            {
                id: "tool-2",
                type: "function",
                function: {
                    name: ToolName.GO_BACK,
                    arguments: "{}",
                },
            } as any,
            123,
        );

        expect(result).toContain("browser remained on https://example.com/step-2");
    }, 8000);

    test("go_back falls back to in-page history.back when tabs.goBack does not move", async () => {
        let currentUrl = "https://example.com/step-3";
        (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
            id: 123,
            url: currentUrl,
            title: "History page",
            groupId: -1,
        }));
        (chrome.tabs as any).goBack = vi.fn(async () => {});
        (chrome.scripting as any).executeScript = vi.fn(async () => {
            currentUrl = "https://example.com/step-2";
            return [{ result: undefined }];
        });

        const result = await toolRegistry.execute(
            {
                id: "tool-2b",
                type: "function",
                function: {
                    name: ToolName.GO_BACK,
                    arguments: "{}",
                },
            } as any,
            123,
        );

        expect(chrome.scripting.executeScript).toHaveBeenCalled();
        expect(result).toContain("Navigated back to https://example.com/step-2");
    });

    test("go_back ignores transient about:blank and waits for the final destination URL", async () => {
        const urls = [
            "https://example.com/step-3",
            "about:blank",
            "https://example.com/step-2",
        ];
        (chrome.tabs as any).get = vi.fn(async (_tabId: number) => ({
            id: 123,
            url: urls.length > 1 ? urls.shift() : urls[0],
            title: "History page",
            groupId: -1,
        }));
        (chrome.tabs as any).goBack = vi.fn(async () => {});

        const result = await toolRegistry.execute(
            {
                id: "tool-3",
                type: "function",
                function: {
                    name: ToolName.GO_BACK,
                    arguments: "{}",
                },
            } as any,
            123,
        );

        expect(result).toContain("Navigated back to https://example.com/step-2");
        expect(result).not.toContain("about:blank");
    });

});
