import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import "../setup";
import { ApprovalOverlay } from "../../src/sidepanel/components/ApprovalOverlay";
import { useStore } from "../../src/sidepanel/store";
import { RiskLevel, ToolName } from "../../src/types";

afterEach(() => {
  vi.restoreAllMocks();
  useStore.setState({
    backgroundConnection: "connected",
    pendingApproval: null,
  });
});

test("retains approval after failed delivery and blocks decisions while reconnecting", async () => {
  const send = vi
    .spyOn(chrome.runtime, "sendMessage")
    .mockRejectedValueOnce(new Error("disconnected"));
  useStore.setState({
    backgroundConnection: "connected",
    pendingApproval: {
      approvalId: "approval-1",
      toolName: ToolName.NAVIGATE,
      args: { url: "https://example.com" },
      risk: RiskLevel.MEDIUM,
      context: "Check the supplier page",
      requestedAt: Date.now(),
      timeoutMs: 60000,
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ApprovalOverlay />));
    const approve = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Approve:"),
    )!;
    expect(approve.textContent).toContain("example.com");
    await act(async () => approve.click());
    expect(useStore.getState().pendingApproval?.approvalId).toBe("approval-1");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "not sent",
    );
    await act(async () =>
      useStore.setState({ backgroundConnection: "reconnecting" }),
    );
    expect(approve.disabled).toBe(true);
    await act(async () => approve.click());
    expect(send).toHaveBeenCalledTimes(1);
    send.mockResolvedValueOnce(undefined);
    await act(async () =>
      useStore.setState({ backgroundConnection: "connected" }),
    );
    await act(async () => approve.click());
    expect(useStore.getState().pendingApproval).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
