import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import {
  AGENT_BORDER_ID,
  AGENT_BORDER_STYLE_ID,
  ensureAgentBorderVisible,
  removeAgentBorder,
  setAgentBorderVisualState,
} from "../../src/content/in-page-ui/agent-border";

describe("Agent Border Overlay", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
  });

  test("creates overlay element", () => {
    const el = ensureAgentBorderVisible("active");

    expect(el.id).toBe(AGENT_BORDER_ID);
    expect(el.style.position).toBe("fixed");
    expect(el.style.pointerEvents).toBe("none");
    expect(el.style.zIndex).toBe("2147483646");
  });

  test("removes overlay element", () => {
    ensureAgentBorderVisible("active");
    expect(document.getElementById(AGENT_BORDER_ID)).not.toBeNull();

    removeAgentBorder();
    expect(document.getElementById(AGENT_BORDER_ID)).toBeNull();
  });

  test("is idempotent and updates visual state", () => {
    const first = ensureAgentBorderVisible("active");
    const second = ensureAgentBorderVisible("settle");

    expect(first).toBe(second);
    expect(document.querySelectorAll(`#${AGENT_BORDER_ID}`)).toHaveLength(1);
    expect(second.getAttribute("data-state")).toBe("settle");

    setAgentBorderVisualState("active");
    expect(second.getAttribute("data-state")).toBe("active");
  });

  test("injects reduced-motion styles", () => {
    ensureAgentBorderVisible("active");
    const style = document.getElementById(AGENT_BORDER_STYLE_ID);

    expect(style?.textContent).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
  });

  test("does not start fade animation when reduced motion is requested", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    const el = ensureAgentBorderVisible("active");

    expect(el.style.opacity).toBe("1");
  });
});
