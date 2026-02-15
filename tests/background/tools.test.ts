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
    test("all 45 tools are registered", () => {
        const defs = toolRegistry.getDefinitions();
        expect(defs.length).toBe(45);
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

    test("draw_stroke tool requires id, startX, startY, endX, endY", () => {
        const defs = toolRegistry.getDefinitions();
        const stroke = defs.find(d => d.function.name === ToolName.DRAW_STROKE);
        expect(stroke).toBeDefined();
        expect(stroke!.function.parameters.required).toEqual(
            expect.arrayContaining(["id", "startX", "startY", "endX", "endY"])
        );
    });

    test("hide_element tool requires id parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const hide = defs.find(d => d.function.name === ToolName.HIDE_ELEMENT);
        expect(hide).toBeDefined();
        expect(hide!.function.parameters.required).toContain("id");
        expect(hide!.function.parameters.properties.id.type).toBe("integer");
    });

    test("scroll_page tool has optional id parameter", () => {
        const defs = toolRegistry.getDefinitions();
        const scroll = defs.find(d => d.function.name === ToolName.SCROLL_PAGE);
        expect(scroll).toBeDefined();
        expect(scroll!.function.parameters.required).toContain("direction");
        expect(scroll!.function.parameters.required).not.toContain("id");
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

    test("escalate tool description mentions puzzles/riddles", () => {
        const defs = toolRegistry.getDefinitions();
        const escalate = defs.find(d => d.function.name === ToolName.ESCALATE);
        expect(escalate).toBeDefined();
        expect(escalate!.function.description).toContain("smarter");
        expect(escalate!.function.description).toContain("riddles");
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

    test("go_forward has no required parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.GO_FORWARD);
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

    test("group_tabs requires tabIds and title", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.GROUP_TABS);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("tabIds");
        expect(def!.function.parameters.required).toContain("title");
        expect(def!.function.parameters.properties.color).toBeDefined();
    });

    test("ungroup_tabs requires tabIds", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.UNGROUP_TABS);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("tabIds");
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

    test("copy_to_clipboard requires text", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.COPY_TO_CLIPBOARD);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("text");
    });

    test("read_pdf requires url", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.READ_PDF);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("url");
        expect(def!.function.parameters.properties.maxPages).toBeDefined();
    });

    test("search_history requires query", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.SEARCH_HISTORY);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("query");
        expect(def!.function.parameters.properties.maxResults).toBeDefined();
    });

    test("create_bookmark has no required parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.CREATE_BOOKMARK);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toEqual([]);
        expect(def!.function.parameters.properties.title).toBeDefined();
        expect(def!.function.parameters.properties.url).toBeDefined();
    });

    test("get_bookmarks requires query", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.GET_BOOKMARKS);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("query");
    });

    test("create_window has no required parameters", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.CREATE_WINDOW);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toEqual([]);
        expect(def!.function.parameters.properties.url).toBeDefined();
        expect(def!.function.parameters.properties.incognito).toBeDefined();
    });

    test("send_notification requires title and message", () => {
        const defs = toolRegistry.getDefinitions();
        const def = defs.find(d => d.function.name === ToolName.SEND_NOTIFICATION);
        expect(def).toBeDefined();
        expect(def!.function.parameters.required).toContain("title");
        expect(def!.function.parameters.required).toContain("message");
    });
});
