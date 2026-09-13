import { describe, expect, it, vi } from "vitest";
import type { PortableCheckpointV1 } from "@shared-types/cloud-sessions";
import { PortableCheckpointCoordinator } from "../../src/background/orchestrator/portable-restore";
import {
  CloudRestoreController,
  buildPortableRestoreQuery,
} from "../../src/background/orchestrator/cloud-restore-controller";

const checkpoint: PortableCheckpointV1 = {
  schemaVersion: 1,
  sessionId: "99c726ba-fbcb-40dd-8fe4-51567e9af832",
  checkpointId: "c043caa0-2a3b-4233-98ac-c896d25d9bf8",
  revision: 2,
  createdAt: "2026-08-09T10:00:00.000Z",
  runtimeVersion: "0.7.3",
  reason: "pause",
  objective: {
    originalRequest: "Finish the form",
    currentInterpretation: "Finish the form safely",
    successCriteria: ["Form is complete"],
    userConstraints: [],
  },
  conversation: { messages: [] },
  execution: {
    plan: [
      { stepId: "one", description: "Open form", status: "completed", evidenceRefs: [] },
      { stepId: "two", description: "Complete form", status: "pending", evidenceRefs: [] },
    ],
    completedActions: [],
    unresolvedFacts: [],
  },
  grounding: {
    lastKnownUrl: "https://example.test/form",
    expectedOrigins: ["https://example.test"],
    pageTitle: "Form",
    userVisibleStateSummary: "A form",
    requiredCapabilities: ["forms"],
  },
  pending: { kind: "none" },
  usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0, imageTokenEstimate: 0, turns: 1 },
};

function coordinator() {
  return new PortableCheckpointCoordinator(
    { save: vi.fn(), load: vi.fn().mockResolvedValue(null), delete: vi.fn() },
    { enabled: true, upload: vi.fn(), restore: vi.fn().mockResolvedValue(checkpoint) },
    "0.7.3",
  );
}

function controller(enabled = true, overrides: { authorized?: boolean; snapshot?: unknown; tab?: { url?: string; title?: string } } = {}) {
  const continued = vi.fn().mockResolvedValue({ workspaceId: "restored-workspace" });
  const getTab = vi.fn().mockResolvedValue(overrides.tab ?? { url: "https://example.test/form", title: "Form" });
  const sendMessage = vi.fn().mockResolvedValue(overrides.snapshot !== undefined ? overrides.snapshot : { payload: { snapshot: { url: "https://example.test/form", title: "Form", elements: [], text: "", scroll: { x: 0, y: 0, width: 1, height: 1, viewportWidth: 1, viewportHeight: 1 } } } });
  const value = new CloudRestoreController({
    enabled,
    cloud: { request: vi.fn() } as never,
    checkpoints: coordinator(),
    pages: {
      getTab,
    } as never,
    content: {
      sendMessage,
    } as never,
    isPageAuthorized: vi.fn().mockResolvedValue(overrides.authorized ?? true),
    continueRestore: continued,
  });
  return { value, continued, getTab, sendMessage };
}

describe("cloud restore controller", () => {
  it("does no cloud or browser work while the build gate is disabled", async () => {
    const { value } = controller(false);
    await expect(value.list()).resolves.toMatchObject({ ok: false, disabled: true });
    await expect(value.prepare({ sessionId: checkpoint.sessionId, checkpointId: checkpoint.checkpointId, tabId: 4 }))
      .resolves.toMatchObject({ ok: false, disabled: true });
  });

  it("freshly observes, previews paused, and executes only after Continue", async () => {
    const { value, continued } = controller();
    const prepared = await value.prepare({
      sessionId: checkpoint.sessionId,
      checkpointId: checkpoint.checkpointId,
      tabId: 4,
    });
    expect(prepared).toMatchObject({ ok: true, preview: { state: "restored_paused", grounding: "matched" } });
    expect(continued).not.toHaveBeenCalled();
    if (!prepared.ok) throw new Error("prepare failed");
    await expect(value.continue(prepared.restoreId)).resolves.toMatchObject({ ok: true });
    expect(continued).toHaveBeenCalledOnce();
    await expect(value.continue(prepared.restoreId)).resolves.toMatchObject({ ok: false });
    expect(continued).toHaveBeenCalledOnce();
  });

  it("carries completed and remaining state into a safe continuation query", () => {
    const query = buildPortableRestoreQuery({
      checkpoint,
      localWorkspaceId: "workspace",
      runId: "run",
      requiresFreshApproval: false,
      requiresOutcomeClarification: false,
    });
    expect(query).toContain("- Open form");
    expect(query).toContain("- Complete form");
    expect(query).toContain("do not reuse historical element references");
  });

  it("requires a new preview if the page navigates before Continue", async () => {
    const { value, continued, getTab } = controller();
    const prepared = await value.prepare({ sessionId: checkpoint.sessionId, checkpointId: checkpoint.checkpointId, tabId: 4 });
    if (!prepared.ok) throw new Error("prepare failed");
    getTab.mockResolvedValue({ url: "https://example.test/other", title: "Other" });
    await expect(value.continue(prepared.restoreId)).resolves.toMatchObject({
      ok: false,
      detail: expect.stringContaining("page changed"),
    });
    expect(continued).not.toHaveBeenCalled();
  });

  it("does not start or consume a restore when a pre-start safety gate fails", async () => {
    const { value, continued } = controller();
    const prepared = await value.prepare({
      sessionId: checkpoint.sessionId,
      checkpointId: checkpoint.checkpointId,
      tabId: 4,
    });
    if (!prepared.ok) throw new Error("prepare failed");
    const beforeStart = vi.fn().mockRejectedValue(new Error("takeover_gate_clear_failed"));

    await expect(
      value.continue(prepared.restoreId, undefined, beforeStart),
    ).resolves.toMatchObject({ ok: false });
    expect(beforeStart).toHaveBeenCalledOnce();
    expect(continued).not.toHaveBeenCalled();

    await expect(value.continue(prepared.restoreId)).resolves.toMatchObject({
      ok: true,
    });
    expect(continued).toHaveBeenCalledOnce();
  });

  it.each([
    ["unavailable", { snapshot: null }],
    ["unauthorized", { authorized: false }],
    ["changed", { tab: { url: "https://example.test/other", title: "Other" } }],
  ] as const)("classifies a %s live page and remains paused", async (grounding, overrides) => {
    const { value, continued } = controller(true, overrides);
    const result = await value.prepare({ sessionId: checkpoint.sessionId, checkpointId: checkpoint.checkpointId, tabId: 9 });
    expect(result).toMatchObject({ ok: true, preview: { state: "restored_paused", grounding } });
    expect(continued).not.toHaveBeenCalled();
    if (result.ok && grounding !== "changed") {
      await expect(value.continue(result.restoreId)).resolves.toMatchObject({
        ok: false,
      });
      expect(continued).not.toHaveBeenCalled();
    }
  });
});
