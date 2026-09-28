import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import "../setup";
import { ApprovalOverlay } from "../../src/sidepanel/components/ApprovalOverlay";
import { useStore } from "../../src/sidepanel/store";
import { RiskLevel, ToolName } from "../../src/types";

describe("approval timer", () => {
  afterEach(() => useStore.getState().clearPendingApproval());

  test("shows the elapsed fraction of a restored approval window", () => {
    useStore.getState().setPendingApproval({
      approvalId: "restored-approval",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 1 },
      risk: RiskLevel.HIGH,
      context: "Confirm the action",
      requestedAt: Date.now(),
      timeoutMs: 21_000,
      totalTimeoutMs: 600_000,
    });

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<ApprovalOverlay />));
    const width = Number(container.querySelector<HTMLElement>("[style*=width]")?.style.width.replace("%", ""));
    expect(width).toBeGreaterThan(3);
    expect(width).toBeLessThan(4);
    expect(container.textContent).toContain("Auto-rejects in 21s");
    act(() => root.unmount());
  });
});
