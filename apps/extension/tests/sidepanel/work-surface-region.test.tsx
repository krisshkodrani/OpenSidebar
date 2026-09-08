import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { AgentStatus } from "../../src/types";
import { createFakeStorageArea } from "../fakes/persistence";
import { REMOTE_MISSION_LOCAL_STATUS_KEY } from "../../src/remote-mission-local-status";
import { WorkSurfaceRegion } from "../../src/sidepanel/components/WorkSurfaceRegion";
import { useStore } from "../../src/sidepanel/store";
import { chromeUiRuntimePort, setUiRuntimePortForTesting } from "../../src/sidepanel/runtime";

describe("task-centered work surface", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restore: () => void;
  const local = createFakeStorageArea();
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  const props = {
    isPlanExpanded: false,
    onTogglePlan: vi.fn(),
    onSkillRecordingHelp: vi.fn(),
  };

  beforeEach(() => {
    local.store.clear();
    sendMessage.mockClear();
    useStore.setState({
      activeWorkspaceId: "ws-test",
      messages: [],
      isAgentRunning: false,
      agentStatus: AgentStatus.IDLE,
      statusDetail: "",
      taskCompletion: null,
      taskProgress: null,
      turnProgress: null,
      pendingApproval: null,
      pendingEscalation: null,
      pendingPlanConfirmation: null,
      pendingClarification: null,
      stagnationState: null,
      durableRunStatus: null,
      latestStepLabel: null,
      actionPresentation: null,
      isPlanning: false,
      passiveStatus: null,
      skillRecordingStatus: "idle",
    });
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
    vi.useRealTimers();
  });

  test("shows one remote task and keeps its mission ID in details", async () => {
    const missionId = "123e4567-e89b-42d3-a456-426614174001";
    await local.set({
      [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
        missionId,
        state: "running",
        updatedAt: new Date().toISOString(),
        instructionSummary: "Read the visible page heading",
      },
    });
    await act(async () => {
      root.render(<WorkSurfaceRegion {...props} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Working in this browser");
    expect(container.textContent).toContain("Read the visible page heading");
    expect(container.textContent).not.toContain(missionId);

    const details = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Details"));
    await act(async () => details?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain(missionId);
  });

  test("routes the explicit remote approval denial", async () => {
    const missionId = "123e4567-e89b-42d3-a456-426614174001";
    await local.set({
      [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
        missionId,
        state: "approval_required",
        updatedAt: new Date().toISOString(),
        instructionSummary: "Review the prepared update",
        approval: {
          approvalId: "approval-1",
          question: "Submit the prepared update?",
          actionDigest: "digest-1",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    });
    await act(async () => {
      root.render(<WorkSurfaceRegion {...props} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Submit the prepared update?");
    const deny = [...container.querySelectorAll("button")].find((button) => button.textContent === "Deny");
    await act(async () => {
      deny?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "REMOTE_MISSION_DENY",
      payload: { missionId },
    }));
  });

  test("keeps queued remote work in the inbox while local work controls the workspace", async () => {
    useStore.setState({
      isAgentRunning: true,
      agentStatus: AgentStatus.THINKING,
      statusDetail: "Planning next step",
    });
    await local.set({
      [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
        missionId: "123e4567-e89b-42d3-a456-426614174001",
        state: "queued",
        updatedAt: new Date().toISOString(),
        instructionSummary: "Read another page",
      },
    });
    await act(async () => {
      root.render(<WorkSurfaceRegion {...props} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Remote task waiting: Read another page");
    expect(container.textContent).toContain("Starts when free");
    expect(container.textContent).toContain("Planning next step");
  });
});
