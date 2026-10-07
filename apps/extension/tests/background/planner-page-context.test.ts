import { describe, test, expect, vi } from "vitest";
import { getOrchestratorSnapshot, plannerPageState } from "../../src/background/orchestrator/page-context";
import type { DomSnapshot } from "../../src/types";

describe("planner page evidence", () => {
  test.each(["Record INC-302: add a work note", "Project Beacon: edit project update"])("preserves open-form evidence for %s", (content) => {
    const snapshot = { pageContent: content, elements: [{ tag: 1, tagName: "textarea", text: "", attributes: { label: "Note text" }, isVisible: true }] } as DomSnapshot;
    const rendered = plannerPageState(snapshot)!;
    expect(rendered).toContain(content);
    expect(rendered).toContain("textarea");
    expect(rendered).toContain("Note text");
    expect(rendered).toContain("untrusted");
  });
  test("missing observations do not invent page evidence", () => {
    expect(plannerPageState()).toBeUndefined();
  });
  test("limits text and controls while preserving each evidence budget", () => {
    const rendered = plannerPageState({ pageContent: "x".repeat(100000), elements: [{ tag: 1, tagName: "input", text: "", attributes: { label: "Current form" } }] } as DomSnapshot)!;
    expect(rendered.length).toBeLessThan(13000);
    expect(rendered).toContain("Current form");
  });
  test("read-only snapshot uses the content bridge without dismissing dialogs", async () => {
    const snapshot = { title: "Edit", url: "https://example.test/edit", elements: [] };
    const bridge = { getContentScriptFiles: () => ["content.js"], executeContentScripts: vi.fn(async () => {}), sendMessage: vi.fn(async () => ({ payload: { snapshot } })) };
    const ready = vi.fn(async () => true);
    expect(await getOrchestratorSnapshot(7, ready, bridge as never)).toEqual(snapshot);
    expect(ready).toHaveBeenCalledWith(7, 3000);
    expect(bridge.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ payload: { refresh: true, autoDismiss: false } }));
  });
  test("bridge failure leaves evidence absent so execution can re-ground", async () => {
    const bridge = { getContentScriptFiles: () => [], sendMessage: vi.fn(async () => { throw new Error("document replaced"); }) };
    expect(await getOrchestratorSnapshot(7, async () => true, bridge as never)).toBeUndefined();
  });
});
