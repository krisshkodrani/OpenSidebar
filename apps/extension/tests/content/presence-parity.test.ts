/**
 * LP-24 §8 integration guard for principle 1 (presentation-only): with the
 * presence layer ACTIVE, executeAction must dispatch the exact same event
 * sequence to the page as with presence off. The choreography may only add
 * time and shadow-DOM pixels — never events.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { executeAction } from "../../src/content/actions";
import { resetStableIds, tagElements } from "../../src/content/tagging";
import { getPresenceCoordinator } from "../../src/content/presence";
import {
  resolveVisualAnchor,
  resolveVisualTarget,
} from "../../src/content/presence/choreography";

const OBSERVED_EVENTS = [
  "pointerover",
  "mouseover",
  "mousemove",
  "pointerdown",
  "mousedown",
  "focus",
  "pointerup",
  "mouseup",
  "click",
  "input",
  "change",
  "keydown",
  "keyup",
];

function recordEvents(el: Element, log: string[]): void {
  for (const type of OBSERVED_EVENTS) {
    el.addEventListener(type, () => log.push(type));
  }
}

async function runClickScenario(): Promise<string[]> {
  document.body.innerHTML = `<button id="target">Advance</button>`;
  resetStableIds();
  tagElements();
  const button = document.getElementById("target")!;
  const log: string[] = [];
  recordEvents(button, log);
  const tagged = Number(button.getAttribute("data-os-tag"));
  const result = await executeAction(ToolName.CLICK_ELEMENT, { id: tagged });
  expect(result.success).toBe(true);
  return log;
}

describe("presence parity (LP-24 principle 1)", () => {
  beforeEach(() => {
    getPresenceCoordinator().setMode("off");
  });
  afterEach(() => {
    getPresenceCoordinator().setMode("off");
    document.body.innerHTML = "";
  });

  test("click dispatches an identical event sequence with presence on vs off", async () => {
    const offLog = await runClickScenario();
    expect(offLog).toContain("click");

    getPresenceCoordinator().setMode("subtle");
    const onLog = await runClickScenario();

    expect(onLog).toEqual(offLog);
  });

  test("presence failure feedback dispatches no page events", async () => {
    document.body.innerHTML = `<button id="only">A</button>`;
    resetStableIds();
    tagElements();
    const button = document.getElementById("only")!;
    const log: string[] = [];
    recordEvents(button, log);
    recordEvents(document.body, log);

    getPresenceCoordinator().setMode("subtle");
    // Stale id → grounding-style failure → errorPulse path runs.
    const result = await executeAction(ToolName.CLICK_ELEMENT, { id: 9999 });
    expect(result.success).toBe(false);
    expect(log).toEqual([]);
  });

  test("label clicks retarget the visual to the toggle control", () => {
    document.body.innerHTML = `
      <label id="wrap"><input type="radio" id="opt" name="g" />Business</label>`;
    const label = document.getElementById("wrap")!;
    const radio = document.getElementById("opt")!;
    expect(resolveVisualTarget(label)).toBe(radio);
    expect(resolveVisualTarget(radio)).toBe(radio);
  });

  test("visual anchor: visible control → its center; hidden control → start of its label; nothing → null", () => {
    document.body.innerHTML = `
      <label id="lab"><input type="radio" id="r" name="g" />Customer data</label>`;
    const label = document.getElementById("lab")!;
    const radio = document.getElementById("r")!;
    const stub = (el: Element, rect: Partial<DOMRect>) => {
      (el as HTMLElement).getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, ...rect }) as DOMRect;
    };

    // Custom-widget case: the input is hidden, only the label has geometry.
    stub(radio, { width: 0, height: 0 });
    stub(label, { left: 50, top: 50, width: 140, height: 22 });
    const fromLabel = resolveVisualAnchor(radio, "checkbox")!;
    expect(fromLabel.point).toEqual({ x: 64, y: 61 }); // start of the label
    expect(fromLabel.width).toBe(48);

    // Native case: the radio itself is visible → land dead-center on it.
    stub(radio, { left: 60, top: 55, width: 16, height: 16 });
    const fromControl = resolveVisualAnchor(label, "click")!;
    expect(fromControl.point).toEqual({ x: 68, y: 63 });

    // Nothing measurable → no anchor, glide is skipped (never fly to 0,0).
    stub(radio, { width: 0, height: 0 });
    stub(label, { width: 0, height: 0 });
    document.body.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }) as DOMRect;
    expect(resolveVisualAnchor(radio, "checkbox")).toBeNull();
  });
});
