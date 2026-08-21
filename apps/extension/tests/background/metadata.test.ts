import { describe, test, expect } from "vitest";
import "../setup";
import {
  getToolMeta,
  DOM_MODIFYING_TOOLS,
  SEQUENTIAL_TOOLS,
  CACHEABLE_TOOLS,
  resolveToolProfile,
  getToolNodeConcurrencyMeta,
  getToolProfileNodeConcurrency,
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

    test("contains wait", () => {
      expect(SEQUENTIAL_TOOLS.has(ToolName.WAIT)).toBe(true);
    });

    test("contains compose_text", () => {
      expect(SEQUENTIAL_TOOLS.has(ToolName.COMPOSE_TEXT)).toBe(true);
    });

    test("has exactly 22 entries", () => {
      expect(SEQUENTIAL_TOOLS.size).toBe(22);
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

  describe("node concurrency metadata", () => {
    test("returns scheduler-facing concurrency metadata for every ToolName", () => {
      for (const name of Object.values(ToolName)) {
        const meta = getToolNodeConcurrencyMeta(name as ToolName);
        expect(meta).toBeDefined();
        expect(meta.scope).toMatch(
          /^(same_page|same_origin|separate_tab|never)$/,
        );
        expect(meta.access).toMatch(
          /^(read|write|navigate|approval|external)$/,
        );
      }
    });

    test("covers each node-level concurrency classification", () => {
      const scopes = new Set(
        Object.values(ToolName).map(
          (name) => getToolNodeConcurrencyMeta(name as ToolName).scope,
        ),
      );

      expect(scopes.has("same_page")).toBe(true);
      expect(scopes.has("same_origin")).toBe(true);
      expect(scopes.has("separate_tab")).toBe(true);
      expect(scopes.has("never")).toBe(true);
    });

    test("classifies representative tools by coexistence scope", () => {
      expect(getToolNodeConcurrencyMeta(ToolName.READ_PAGE)).toMatchObject({
        scope: "same_page",
        access: "read",
      });
      expect(getToolNodeConcurrencyMeta(ToolName.NAVIGATE)).toMatchObject({
        scope: "separate_tab",
        access: "navigate",
      });
      expect(getToolNodeConcurrencyMeta(ToolName.SET_COOKIE)).toMatchObject({
        scope: "same_origin",
        access: "write",
      });
      expect(getToolNodeConcurrencyMeta(ToolName.EXECUTE_JS)).toMatchObject({
        scope: "never",
        access: "write",
      });
    });

    test("summarizes tool profiles for scheduler defaults", () => {
      expect(getToolProfileNodeConcurrency("read_only")).toMatchObject({
        access: "read",
      });
      expect(getToolProfileNodeConcurrency("form_fill")).toMatchObject({
        access: "write",
      });
      expect(getToolProfileNodeConcurrency("navigation_only")).toMatchObject({
        access: "navigate",
      });
      expect(getToolProfileNodeConcurrency("recover_from_stuck")).toMatchObject(
        {
          scope: "never",
          access: "write",
        },
      );
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

    test("get_profile_fields is LOW risk for non-sensitive fields", () => {
      expect(
        classifyRisk(ToolName.GET_PROFILE_FIELDS, {
          fields: ["identity.first_name"],
        }),
      ).toBe(RiskLevel.LOW);
    });

    test("get_profile_fields becomes HIGH risk for sensitive fields", () => {
      expect(
        classifyRisk(ToolName.GET_PROFILE_FIELDS, {
          fields: ["sensitive.date_of_birth"],
        }),
      ).toBe(RiskLevel.HIGH);
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
      expect(CACHEABLE_TOOLS.get(ToolName.INSPECT_CHART)).toBe("dom");
      expect(CACHEABLE_TOOLS.get(ToolName.INSPECT_TABLE)).toBe("dom");
      expect(CACHEABLE_TOOLS.get(ToolName.INSPECT_FILTER_STATE)).toBe("dom");
      expect(CACHEABLE_TOOLS.get(ToolName.INSPECT_CATALOG_ITEM)).toBe("dom");
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

    test("has exactly 11 entries", () => {
      expect(CACHEABLE_TOOLS.size).toBe(11);
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
      expect(tools).toContain(ToolName.APPLY_LIST_FILTER);
      expect(tools).toContain(ToolName.GET_PROFILE_FIELDS);
      expect(tools).toContain(ToolName.UPLOAD_FILE);
      expect(tools).toContain(ToolName.EXTRACT_FORM_STATE);
      expect(tools).not.toContain(ToolName.NAVIGATE);
      expect(tools).not.toContain(ToolName.CREATE_TAB);
      expect(tools).not.toContain(ToolName.GO_BACK);
    });

    test('resolveToolProfile("edit_surface") keeps inline-edit actions and drops heavy exploration', () => {
      const tools = resolveToolProfile("edit_surface");
      expect(tools).not.toBeNull();
      expect(tools).toContain(ToolName.RIGHT_CLICK);
      expect(tools).toContain(ToolName.CLICK_ELEMENT);
      expect(tools).toContain(ToolName.TYPE_TEXT);
      expect(tools).toContain(ToolName.PRESS_KEY);
      expect(tools).not.toContain(ToolName.EXECUTE_JS);
      expect(tools).not.toContain(ToolName.CLICK_COORDINATES);
      expect(tools).not.toContain(ToolName.NAVIGATE);
    });

    test('resolveToolProfile("read_only") excludes DOM-modifying interaction tools', () => {
      const tools = resolveToolProfile("read_only");
      expect(tools).not.toBeNull();
      expect(tools).not.toContain(ToolName.CLICK_ELEMENT);
      expect(tools).not.toContain(ToolName.TYPE_TEXT);
      expect(tools).not.toContain(ToolName.SELECT_OPTION);
      expect(tools).not.toContain(ToolName.NAVIGATE);
      expect(tools).toContain(ToolName.READ_PAGE);
      expect(tools).toContain(ToolName.SEARCH_KNOWLEDGE_BASE);
      expect(tools).toContain(ToolName.FIND_ELEMENT);
      expect(tools).toContain(ToolName.SCROLL_PAGE);
      expect(tools).toContain(ToolName.EXTRACT_FORM_STATE);
    });

    test('resolveToolProfile("navigate") includes navigation tools', () => {
      const tools = resolveToolProfile("navigate");
      expect(tools).not.toBeNull();
      expect(tools).toContain(ToolName.OPEN_SERVICENOW_MODULE);
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
      expect(tools).toContain(ToolName.UPLOAD_FILE);
      expect(tools).toContain(ToolName.EXTRACT_FORM_STATE);
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
        "edit_surface",
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
