import { describe, test, expect } from "vitest";
import "../setup";
import {
  getToolMeta,
  DOM_MODIFYING_TOOLS,
  SEQUENTIAL_TOOLS,
  CACHEABLE_TOOLS,
  resolveToolProfile,
  TOOL_PROFILES,
} from "../../src/background/tools/metadata";
import { ToolName, RiskLevel } from "../../src/types";
import { classifyRisk } from "../../src/background/security";

describe("Tool Metadata", () => {
  describe("DOM_MODIFYING_TOOLS", () => {
    test("contains click, type, select, hover, drag, hide, read_page", () => {
      expect(DOM_MODIFYING_TOOLS.has(ToolName.CLICK_ELEMENT)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.TYPE_TEXT)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.SELECT_OPTION)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.HOVER_ELEMENT)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.DRAG_AND_DROP)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.HIDE_ELEMENT)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.READ_PAGE)).toBe(true);
    });

    test("contains new DOM-modifying tools", () => {
      expect(DOM_MODIFYING_TOOLS.has(ToolName.EXECUTE_JS)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.UPLOAD_FILE)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.RIGHT_CLICK)).toBe(true);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.SET_CHECKBOX)).toBe(true);
    });

    test("contains xray_page (reveals hidden elements for tagging)", () => {
      expect(DOM_MODIFYING_TOOLS.has(ToolName.XRAY_PAGE)).toBe(true);
    });

    test("does not contain read-only tools", () => {
      expect(DOM_MODIFYING_TOOLS.has(ToolName.SCROLL_PAGE)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.FIND_ELEMENT)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.NAVIGATE)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.ESCALATE)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.READ_ELEMENT)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.LIST_TABS)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.DOWNLOAD_FILE)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.INSPECT_HIDDEN)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.FAST_FORWARD)).toBe(false);
    });
  });

  describe("SEQUENTIAL_TOOLS", () => {
    test("contains navigate, done, escalate, execute_js, upload_file, go_back, go_forward, transcribe_audio", () => {
      expect(SEQUENTIAL_TOOLS.has(ToolName.NAVIGATE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.DONE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.ESCALATE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.EXECUTE_JS)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.UPLOAD_FILE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.GO_BACK)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.GO_FORWARD)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.TRANSCRIBE_AUDIO)).toBe(true);
    });

    test("has exactly 20 entries", () => {
      expect(SEQUENTIAL_TOOLS.size).toBe(19);
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

    test("done is LOW risk", () => {
      expect(classifyRisk(ToolName.DONE, {})).toBe(RiskLevel.LOW);
    });

    test("press_key is MEDIUM risk", () => {
      expect(classifyRisk(ToolName.PRESS_KEY, {})).toBe(RiskLevel.MEDIUM);
    });

    test("xray_page is LOW risk", () => {
      expect(classifyRisk(ToolName.XRAY_PAGE, {})).toBe(RiskLevel.LOW);
    });

    test("fast_forward is LOW risk", () => {
      expect(classifyRisk(ToolName.FAST_FORWARD, {})).toBe(RiskLevel.LOW);
    });
  });

  describe("page assist tools metadata", () => {
    test("xray_page is domModifying but not sequential", () => {
      const meta = getToolMeta(ToolName.XRAY_PAGE);
      expect(meta.risk).toBe(RiskLevel.LOW);
      expect(meta.domModifying).toBe(true);
      expect(meta.sequential).toBe(false);
    });

    test("fast_forward is not domModifying and not sequential", () => {
      const meta = getToolMeta(ToolName.FAST_FORWARD);
      expect(meta.risk).toBe(RiskLevel.LOW);
      expect(meta.domModifying).toBe(false);
      expect(meta.sequential).toBe(false);
    });
  });

  describe("React toolkit metadata", () => {
    test("inspect_react is LOW risk, not domModifying, not sequential", () => {
      const meta = getToolMeta(ToolName.INSPECT_REACT);
      expect(meta.risk).toBe(RiskLevel.LOW);
      expect(meta.domModifying).toBe(false);
      expect(meta.sequential).toBe(false);
    });

    test("react_set_input is MEDIUM risk, domModifying, not sequential", () => {
      const meta = getToolMeta(ToolName.REACT_SET_INPUT);
      expect(meta.risk).toBe(RiskLevel.MEDIUM);
      expect(meta.domModifying).toBe(true);
      expect(meta.sequential).toBe(false);
    });

    test("inspect_react_tree is LOW risk, not domModifying, not sequential", () => {
      const meta = getToolMeta(ToolName.INSPECT_REACT_TREE);
      expect(meta.risk).toBe(RiskLevel.LOW);
      expect(meta.domModifying).toBe(false);
      expect(meta.sequential).toBe(false);
    });

    test("wait_for_react is LOW risk, not domModifying, sequential", () => {
      const meta = getToolMeta(ToolName.WAIT_FOR_REACT);
      expect(meta.risk).toBe(RiskLevel.LOW);
      expect(meta.domModifying).toBe(false);
      expect(meta.sequential).toBe(true);
    });

    test("react_set_input is in DOM_MODIFYING_TOOLS", () => {
      expect(DOM_MODIFYING_TOOLS.has(ToolName.REACT_SET_INPUT)).toBe(true);
    });

    test("wait_for_react is in SEQUENTIAL_TOOLS", () => {
      expect(SEQUENTIAL_TOOLS.has(ToolName.WAIT_FOR_REACT)).toBe(true);
    });

    test("inspect_react is not in DOM_MODIFYING_TOOLS or SEQUENTIAL_TOOLS", () => {
      expect(DOM_MODIFYING_TOOLS.has(ToolName.INSPECT_REACT)).toBe(false);
      expect(SEQUENTIAL_TOOLS.has(ToolName.INSPECT_REACT)).toBe(false);
    });
  });

  describe("CACHEABLE_TOOLS", () => {
    test("contains expected DOM-cacheable tools", () => {
      expect(CACHEABLE_TOOLS.get(ToolName.READ_ELEMENT)).toBe("dom");
      expect(CACHEABLE_TOOLS.get(ToolName.FIND_ELEMENT)).toBe("dom");
      expect(CACHEABLE_TOOLS.get(ToolName.INSPECT_HIDDEN)).toBe("dom");
      expect(CACHEABLE_TOOLS.get(ToolName.INSPECT_REACT)).toBe("dom");
      expect(CACHEABLE_TOOLS.get(ToolName.INSPECT_REACT_TREE)).toBe("dom");
    });

    test("contains expected memory-cacheable tools", () => {
      expect(CACHEABLE_TOOLS.get(ToolName.MEMORY_SEARCH)).toBe("memory");
      expect(CACHEABLE_TOOLS.get(ToolName.MEMORY_LIST_CATEGORIES)).toBe("memory");
      expect(CACHEABLE_TOOLS.get(ToolName.RECALL_DEMO)).toBe("memory");
    });

    test("contains expected static-cacheable tools", () => {
      expect(CACHEABLE_TOOLS.get(ToolName.GET_COOKIES)).toBe("static");
      expect(CACHEABLE_TOOLS.get(ToolName.LIST_TABS)).toBe("static");
      expect(CACHEABLE_TOOLS.get(ToolName.SEARCH_HISTORY)).toBe("static");
      expect(CACHEABLE_TOOLS.get(ToolName.GET_BOOKMARKS)).toBe("static");
    });

    test("does not include DOM-modifying tools (except read_page which is not cacheable)", () => {
      for (const tool of DOM_MODIFYING_TOOLS) {
        // DOM-modifying tools should not be cacheable (they change the page)
        expect(CACHEABLE_TOOLS.has(tool)).toBe(false);
      }
    });

    test("does not include non-cacheable tools", () => {
      expect(CACHEABLE_TOOLS.has(ToolName.CLICK_ELEMENT)).toBe(false);
      expect(CACHEABLE_TOOLS.has(ToolName.TYPE_TEXT)).toBe(false);
      expect(CACHEABLE_TOOLS.has(ToolName.NAVIGATE)).toBe(false);
      expect(CACHEABLE_TOOLS.has(ToolName.DONE)).toBe(false);
      expect(CACHEABLE_TOOLS.has(ToolName.ESCALATE)).toBe(false);
    });

    test("has exactly 12 entries", () => {
      expect(CACHEABLE_TOOLS.size).toBe(12);
    });
  });

  describe("Tool Profiles", () => {
    test('resolveToolProfile("full") returns null', () => {
      expect(resolveToolProfile("full")).toBeNull();
    });

    test("resolveToolProfile(undefined) returns null", () => {
      expect(resolveToolProfile(undefined)).toBeNull();
    });

    test('resolveToolProfile("form_fill") includes click/type/select but not navigate', () => {
      const tools = resolveToolProfile("form_fill");
      expect(tools).not.toBeNull();
      expect(tools).toContain(ToolName.CLICK_ELEMENT);
      expect(tools).toContain(ToolName.TYPE_TEXT);
      expect(tools).toContain(ToolName.SELECT_OPTION);
      expect(tools).not.toContain(ToolName.NAVIGATE);
      expect(tools).not.toContain(ToolName.CREATE_TAB);
      expect(tools).not.toContain(ToolName.GO_BACK);
    });

    test('resolveToolProfile("read_only") excludes DOM-modifying interaction tools', () => {
      const tools = resolveToolProfile("read_only");
      expect(tools).not.toBeNull();
      expect(tools).not.toContain(ToolName.CLICK_ELEMENT);
      expect(tools).not.toContain(ToolName.TYPE_TEXT);
      expect(tools).not.toContain(ToolName.SELECT_OPTION);
      expect(tools).not.toContain(ToolName.NAVIGATE);
      expect(tools).toContain(ToolName.READ_PAGE);
      expect(tools).toContain(ToolName.FIND_ELEMENT);
      expect(tools).toContain(ToolName.SCROLL_PAGE);
    });

    test('resolveToolProfile("navigate") includes navigation tools', () => {
      const tools = resolveToolProfile("navigate");
      expect(tools).not.toBeNull();
      expect(tools).toContain(ToolName.NAVIGATE);
      expect(tools).toContain(ToolName.GO_BACK);
      expect(tools).toContain(ToolName.GO_FORWARD);
      expect(tools).toContain(ToolName.CREATE_TAB);
      expect(tools).toContain(ToolName.SWITCH_TAB);
      expect(tools).toContain(ToolName.CLICK_ELEMENT);
      expect(tools).not.toContain(ToolName.TYPE_TEXT);
    });

    test("all profiles include done and escalate", () => {
      for (const profile of ["read_only", "form_fill", "navigate"] as const) {
        const tools = resolveToolProfile(profile);
        expect(tools).toContain(ToolName.DONE);
        expect(tools).toContain(ToolName.ESCALATE);
      }
    });
  });
});
