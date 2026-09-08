import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";

describe("cloud sessions restore UI", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreRuntime: () => void;
  let CloudSessionsRestore: React.ComponentType;
  const sendMessage = vi.fn();

  beforeEach(async () => {
    vi.stubEnv("VITE_CLOUD_SESSIONS_ENABLED", "true");
    vi.stubEnv("VITE_CHECKPOINT_RESTORE_ENABLED", "true");
    vi.stubEnv("VITE_DEVICE_COMMANDS_ENABLED", "true");
    vi.stubEnv("VITE_DEVICE_TAKEOVER_ENABLED", "true");
    vi.resetModules();
    sendMessage.mockReset();
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "CLOUD_RESTORE_LIST_REQUEST")
        return {
          ok: true,
          sessions: [
            {
              session: {
                schemaVersion: 1,
                sessionId: "99c726ba-fbcb-40dd-8fe4-51567e9af832",
                title: "Finish the form",
                mode: "cloud_checkpointed",
                status: "paused",
                revision: 2,
                latestCheckpointId: "c043caa0-2a3b-4233-98ac-c896d25d9bf8",
                latestCheckpointRevision: 2,
                createdAt: "2026-08-09T10:00:00.000Z",
                updatedAt: "2026-08-09T10:01:00.000Z",
                lastActivityAt: "2026-08-09T10:01:00.000Z",
                pinned: false,
                runtimeVersion: "0.7.3",
                checkpointSchemaVersion: 1,
                sizeBytes: 100,
              },
              checkpoint: {
                checkpointId: "c043caa0-2a3b-4233-98ac-c896d25d9bf8",
              },
            },
          ],
        };
      if (message.type === "CLOUD_RESTORE_PREPARE")
        return {
          ok: true,
          restoreId: "restore-id",
          preview: {
            state: "restored_paused",
            objective: "Finish the form safely",
            completed: ["Open form"],
            remaining: ["Complete form"],
            grounding: "matched",
            pageTitle: "Form",
            changedStateWarning: false,
            requiresFreshApproval: false,
            requiresOutcomeClarification: false,
          },
        };
      if (message.type === "CLOUD_RESTORE_CONTINUE")
        return { ok: true, workspaceId: "restored-workspace" };
      if (message.type === "CLOUD_DEVICE_RECONNECT")
        return {
          ok: true,
          state: "needs_takeover",
          takeoverId: "takeover-id",
          previousDeviceName: "Office Chrome",
        };
      if (message.type === "CLOUD_DEVICE_TAKEOVER")
        return {
          ok: true,
          state: "takeover_paused",
          restoreId: "takeover-restore-id",
          preview: {
            state: "restored_paused",
            objective: "Finish the form safely",
            completed: ["Open form"],
            remaining: ["Complete form"],
            grounding: "matched",
            pageTitle: "Form",
            changedStateWarning: false,
            requiresFreshApproval: true,
            requiresOutcomeClarification: false,
          },
        };
      if (message.type === "CLOUD_DEVICE_TAKEOVER_CONTINUE")
        return { ok: true, workspaceId: "takeover-workspace" };
      return undefined;
    });
    const runtime = await import("../../src/sidepanel/runtime");
    restoreRuntime = runtime.setUiRuntimePortForTesting({
      ...runtime.chromeUiRuntimePort,
      sendMessage,
      getActiveTab: async () => ({ id: 8, url: "https://example.test/form" }),
    });
    ({ CloudSessionsRestore } = await import(
      "../../src/sidepanel/components/settings/CloudSessionsRestore"
    ));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    restoreRuntime();
    container.remove();
    vi.unstubAllEnvs();
  });

  test("shows a paused preview and sends Continue only after the click", async () => {
    await act(async () => {
      root.render(<CloudSessionsRestore />);
      await Promise.resolve();
    });
    const session = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Restore here",
    );
    await act(async () => {
      session?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Ready, but paused");
    expect(
      sendMessage.mock.calls.some(([message]) =>
        message.type === "CLOUD_RESTORE_CONTINUE"),
    ).toBe(false);
    const continueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Continue",
    );
    await act(async () => {
      continueButton?.click();
      await Promise.resolve();
    });
    expect(
      sendMessage.mock.calls.filter(([message]) =>
        message.type === "CLOUD_RESTORE_CONTINUE").length,
    ).toBe(1);
  });

  test("requires explicit takeover confirmation and a second Continue", async () => {
    await act(async () => {
      root.render(<CloudSessionsRestore />);
      await Promise.resolve();
    });
    const reconnect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Reconnect",
    );
    await act(async () => {
      reconnect?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Office Chrome currently controls this session");
    expect(
      sendMessage.mock.calls.some(([message]) =>
        message.type === "CLOUD_DEVICE_TAKEOVER"),
    ).toBe(false);
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Take over and inspect",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Ready, but paused");
    expect(container.textContent).toContain("require new approval");
    expect(
      sendMessage.mock.calls.some(([message]) =>
        message.type === "CLOUD_DEVICE_TAKEOVER_CONTINUE"),
    ).toBe(false);
    const continueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Continue",
    );
    await act(async () => {
      continueButton?.click();
      await Promise.resolve();
    });
    expect(
      sendMessage.mock.calls.filter(([message]) =>
        message.type === "CLOUD_DEVICE_TAKEOVER_CONTINUE").length,
    ).toBe(1);
  });

  test("requires an explicit one-time local approval before a cloud click", async () => {
    await act(async () => {
      root.render(<CloudSessionsRestore />);
      await Promise.resolve();
    });
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "CLOUD_DEVICE_RECONNECT")
        return {
          ok: true,
          state: "approval_required",
          approvalId: "command-approval-id",
          action: {
            kind: "click",
            target: "Show details",
            origin: "https://example.test",
            expectedResult: "The matched control disappears.",
            risk: "sensitive_write",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        };
      if (message.type === "CLOUD_DEVICE_COMMAND_APPROVAL_DECISION")
        return { ok: true, state: "connected", lastSequence: 1, processedCommands: 1 };
      return undefined;
    });
    const reconnect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Reconnect",
    );
    await act(async () => {
      reconnect?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Allow this click on this device?");
    expect(container.textContent).toContain("Show details");
    expect(container.textContent).toContain("marked sensitive");
    expect(sendMessage.mock.calls.some(([message]) =>
      message.type === "CLOUD_DEVICE_COMMAND_APPROVAL_DECISION"),
    ).toBe(false);

    const allow = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Allow once",
    );
    await act(async () => {
      allow?.click();
      await Promise.resolve();
    });
    expect(sendMessage.mock.calls.filter(([message]) =>
      message.type === "CLOUD_DEVICE_COMMAND_APPROVAL_DECISION").length,
    ).toBe(1);
  });
});
