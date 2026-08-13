import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { createFakeStorageArea } from "../fakes/persistence";
import { REMOTE_MISSION_LOCAL_STATUS_KEY } from "../../src/remote-mission-local-status";
import { RemoteMissionStatusBanner } from "../../src/sidepanel/components/RemoteMissionStatusBanner";
import { chromeUiRuntimePort, setUiRuntimePortForTesting } from "../../src/sidepanel/runtime";

describe("remote mission status banner", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restore: () => void;
  const local = createFakeStorageArea();
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    local.store.clear();
    sendMessage.mockClear();
    restore = setUiRuntimePortForTesting({
      ...chromeUiRuntimePort,
      sendMessage,
      storage: { ...chromeUiRuntimePort.storage, local },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    restore();
    container.remove();
  });

  test("is hidden without a local remote mission", async () => {
    await act(async () => {
      root.render(<RemoteMissionStatusBanner />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("");
  });

  test("reacts to local running and terminal states without page content", async () => {
    await act(async () => {
      root.render(<RemoteMissionStatusBanner />);
      await Promise.resolve();
      await local.set({
        [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
          missionId: "123e4567-e89b-42d3-a456-426614174001",
          state: "running",
          updatedAt: new Date().toISOString(),
        },
      });
    });
    expect(container.textContent).toContain("Running on this browser");
    expect(container.textContent).not.toContain("Read the visible page heading");

    await act(async () => {
      await local.set({
        [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
          missionId: "123e4567-e89b-42d3-a456-426614174001",
          state: "succeeded",
          updatedAt: new Date().toISOString(),
        },
      });
    });
    expect(container.textContent).toContain("Completed");
  });

  test("shows an acceptance diagnostic stored only in local status", async () => {
    await act(async () => {
      root.render(<RemoteMissionStatusBanner />);
      await Promise.resolve();
      await local.set({
        [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
          missionId: "123e4567-e89b-42d3-a456-426614174001",
          state: "failed",
          updatedAt: new Date().toISOString(),
          diagnostic: "Planner could not create a read-only step.",
        },
      });
    });
    expect(container.textContent).toContain(
      "Local diagnostic: Planner could not create a read-only step.",
    );
  });

  test("shows bounded mission context and routes deny through the runtime", async () => {
    const missionId = "123e4567-e89b-42d3-a456-426614174001";
    await local.set({
      [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
        missionId,
        state: "approval_required",
        updatedAt: new Date().toISOString(),
        requesterLabel: "OpenSidebar account",
        deviceName: "Work laptop",
        instructionSummary: "Review the prepared update",
        targetContext: "existing_tab",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        approval: {
          approvalId: "approval-1",
          question: "Submit the prepared update?",
          actionDigest: "digest-1",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    });
    await act(async () => {
      root.render(<RemoteMissionStatusBanner />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Waiting for your approval");
    expect(container.textContent).toContain("Work laptop");
    expect(container.textContent).toContain("Matching open tab");
    expect(container.textContent).toContain("Review the prepared update");
    expect(container.textContent).toContain("Submit the prepared update?");

    const deny = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Deny",
    );
    await act(async () => {
      deny?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "REMOTE_MISSION_DENY",
        payload: { missionId },
      }),
    );
  });

  test("shows a runtime error when local cancellation fails", async () => {
    sendMessage.mockResolvedValueOnce({ ok: false, detail: "Mission already ended." });
    await local.set({
      [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
        missionId: "123e4567-e89b-42d3-a456-426614174001",
        state: "running",
        updatedAt: new Date().toISOString(),
      },
    });
    await act(async () => {
      root.render(<RemoteMissionStatusBanner />);
      await Promise.resolve();
    });
    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel task",
    );
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Mission already ended.");
  });
});
