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

    test("contains scroll_page (triggers snapshot refresh for lazy content)", () => {
      expect(DOM_MODIFYING_TOOLS.has(ToolName.SCROLL_PAGE)).toBe(true);
    });

    test("does not contain read-only tools", () => {
      expect(DOM_MODIFYING_TOOLS.has(ToolName.FIND_ELEMENT)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.NAVIGATE)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.ESCALATE)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.READ_ELEMENT)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.LIST_TABS)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.DOWNLOAD_FILE)).toBe(false);
      expect(DOM_MODIFYING_TOOLS.has(ToolName.INSPECT_HIDDEN)).toBe(false);
    });
  });

  describe("SEQUENTIAL_TOOLS", () => {
    test("contains navigate, done, escalate, execute_js, upload_file, go_back", () => {
      expect(SEQUENTIAL_TOOLS.has(ToolName.NAVIGATE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.DONE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.ESCALATE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.EXECUTE_JS)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.UPLOAD_FILE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.GO_BACK)).toBe(true);
    });

    test("contains clarify", () => {
      expect(SEQUENTIAL_TOOLS.has(ToolName.CLARIFY)).toBe(true);
    });

    test("has exactly 15 entries", () => {
      expect(SEQUENTIAL_TOOLS.size).toBe(15);
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

  });

  describe("page assist tools metadata", () => {
    test("xray_page is domModifying but not sequential", () => {
      const meta = getToolMeta(ToolName.XRAY_PAGE);
      expect(meta.risk).toBe(RiskLevel.LOW);
      expect(meta.domModifying).toBe(true);
      expect(meta.sequential).toBe(false);
    });
  });

  describe("CACHEABLE_TOOLS", () => {
    test("contains expected DOM-cacheable tools", () => {
      expect(CACHEABLE_TOOLS.get(ToolName.READ_ELEMENT)).toBe("dom");
      expect(CACHEABLE_TOOLS.get(ToolName.INSPECT_HIDDEN)).toBe("dom");
    });

    test("contains expected static-cacheable tools", () => {
      expect(CACHEABLE_TOOLS.get(ToolName.GET_COOKIES)).toBe("static");
      expect(CACHEABLE_TOOLS.get(ToolName.LIST_TABS)).toBe("static");
      expect(CACHEABLE_TOOLS.get(ToolName.SEARCH_HISTORY)).toBe("static");
    });

    test("does not include DOM-modifying tools (except read_page which is cacheable)", () => {
      for (const tool of DOM_MODIFYING_TOOLS) {
        if (tool === ToolName.READ_PAGE) {
          // read_page is domModifying (re-tags elements) but cacheable (doesn't change the page)
          expect(CACHEABLE_TOOLS.has(tool)).toBe(true);
          continue;
        }
        // scroll_page is domModifying (triggers snapshot refresh for lazy content) but not cacheable
        // Other DOM-modifying tools should not be cacheable (they change the page)
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

    test("has exactly 7 entries", () => {
      expect(CACHEABLE_TOOLS.size).toBe(7);
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
      expect(tools).toContain(ToolName.CREATE_TAB);
      expect(tools).toContain(ToolName.SWITCH_TAB);
      expect(tools).toContain(ToolName.CLICK_ELEMENT);
      expect(tools).not.toContain(ToolName.TYPE_TEXT);
    });

    test('resolveToolProfile("enter_code") keeps typing tools but drops heavy investigation', () => {
      const tools = resolveToolProfile("enter_code");
      expect(tools).not.toBeNull();
      expect(tools).toContain(ToolName.TYPE_TEXT);
      expect(tools).toContain(ToolName.PRESS_KEY);
      expect(tools).toContain(ToolName.CLICK_ELEMENT);
      expect(tools).not.toContain(ToolName.EXECUTE_JS);
      expect(tools).not.toContain(ToolName.XRAY_PAGE);
    });

    test('resolveToolProfile("inspect_hidden_state") keeps investigation tools', () => {
      const tools = resolveToolProfile("inspect_hidden_state");
      expect(tools).not.toBeNull();
      expect(tools).toContain(ToolName.INSPECT_HIDDEN);
      expect(tools).toContain(ToolName.XRAY_PAGE);
      expect(tools).toContain(ToolName.EXECUTE_JS);
      expect(tools).not.toContain(ToolName.TYPE_TEXT);
    });

    test('resolveToolProfile("submit_form") keeps submit actions narrow', () => {
      const tools = resolveToolProfile("submit_form");
      expect(tools).not.toBeNull();
      expect(tools).toContain(ToolName.CLICK_ELEMENT);
      expect(tools).toContain(ToolName.PRESS_KEY);
      expect(tools).toContain(ToolName.TYPE_TEXT);
      expect(tools).not.toContain(ToolName.EXECUTE_JS);
    });

    test('resolveToolProfile("recover_from_stuck") includes recovery tools and escalation', () => {
      const tools = resolveToolProfile("recover_from_stuck");
      expect(tools).not.toBeNull();
      expect(tools).toContain(ToolName.DISMISS_OVERLAYS);
      expect(tools).toContain(ToolName.CLICK_COORDINATES);
      expect(tools).toContain(ToolName.CLICK_ELEMENT);
      expect(tools).toContain(ToolName.EXECUTE_JS);
      expect(tools).toContain(ToolName.ESCALATE);
    });

    test("all profiles include done and escalate", () => {
      for (const profile of [
        "read_only",
        "form_fill",
        "navigate",
        "enter_code",
        "submit_form",
        "inspect_hidden_state",
        "recover_from_stuck",
        "navigation_only",
      ] as const) {
        const tools = resolveToolProfile(profile);
        expect(tools).toContain(ToolName.DONE);
        expect(tools).toContain(ToolName.ESCALATE);
      }
    });
  });
});
