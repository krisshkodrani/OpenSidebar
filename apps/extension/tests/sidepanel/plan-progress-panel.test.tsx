import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { PlanProgressPanel } from "../../src/sidepanel/components/plan/PlanProgressPanel";
import type { PlanRow } from "../../src/sidepanel/plan-board-view";

describe("PlanProgressPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("renders worker status and resource-block details", async () => {
    const rows: PlanRow[] = [
      {
        id: "task:n1",
        nodeId: "n1",
        description: "Read alpha dashboard",
        status: "running",
        turnsUsed: 0,
        workerStatus: "running",
        workerStatusDetail: "Using url:alpha.example/dashboard (read)",
        parallelism: "independent",
      },
      {
        id: "task:n2",
        nodeId: "n2",
        description: "Update alpha form",
        status: "pending",
        turnsUsed: 0,
        workerStatus: "blocked",
        workerStatusDetail: "Waiting for Read alpha dashboard",
        parallelism: "resource_bound",
      },
    ];

    await act(async () => {
      root.render(
        <PlanProgressPanel
          canSkip={false}
          onResumeRecoveredTask={vi.fn()}
          onSkipCurrentStep={vi.fn()}
          recovery={null}
          rows={rows}
          runningRef={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Active");
    expect(container.textContent).toContain(
      "Using url:alpha.example/dashboard (read)",
    );
    expect(container.textContent).toContain("Blocked");
    expect(container.textContent).toContain("Waiting for Read alpha dashboard");
  });
});
