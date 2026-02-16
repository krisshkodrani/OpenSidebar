import { describe, test, expect } from "bun:test";
import "../setup";
import {
  getToolMeta,
  DOM_MODIFYING_TOOLS,
  SEQUENTIAL_TOOLS,
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
      expect(DOM_MODIFYING_TOOLS.has(ToolName.TAKE_SCREENSHOT)).toBe(false);
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
    test("contains navigate, done, take_screenshot, escalate, execute_js, upload_file, go_back, go_forward, transcribe_audio", () => {
      expect(SEQUENTIAL_TOOLS.has(ToolName.NAVIGATE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.DONE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.TAKE_SCREENSHOT)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.ESCALATE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.EXECUTE_JS)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.UPLOAD_FILE)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.GO_BACK)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.GO_FORWARD)).toBe(true);
      expect(SEQUENTIAL_TOOLS.has(ToolName.TRANSCRIBE_AUDIO)).toBe(true);
    });

    test("has exactly 20 entries", () => {
      expect(SEQUENTIAL_TOOLS.size).toBe(20);
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
});
