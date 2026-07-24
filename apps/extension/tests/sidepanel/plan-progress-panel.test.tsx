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

  test("compacts internal context in plan row labels", async () => {
    const rows: PlanRow[] = [
      {
        id: "task:n1",
        nodeId: "n1",
        description: [
          "Objective: Complete the workflow for the original request:",
          "RECENT WORKSPACE CONVERSATION:",
          "- Assistant: Senior Product Engineer @ Langfuse summary",
          "PROFILE DIGEST CONTEXT:",
          "- Fact: Email = jordan.rivera@example.com",
          "CURRENT REQUEST:",
          "Fill the profile",
          "Execution policy:",
          "- Call done only when complete.",
        ].join("\n"),
        status: "running",
        turnsUsed: 0,
        workerStatus: "running",
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

    expect(container.textContent).toContain("Fill the profile");
    expect(container.textContent).not.toContain(
      "RECENT WORKSPACE CONVERSATION",
    );
    expect(container.textContent).not.toContain("PROFILE DIGEST CONTEXT");
  });

  const LONG_INSTRUCTION =
    "Complete these steps in order on the current page: Close any popup, modal, or overlay dialogs currently visible on the page; Set the notification email field to the requested address; Click the delete account button to remove the account";

  function renderRows(rows: PlanRow[]) {
    return act(async () => {
      root.render(
        <PlanProgressPanel
          canSkip={false}
          onResumeRecoveredTask={() => {}}
          onSkipCurrentStep={() => {}}
          recovery={null}
          rows={rows}
          runningRef={() => {}}
        />,
      );
    });
  }

  test("a planner label replaces the instruction on screen but keeps it on hover", async () => {
    await renderRows([
      {
        id: "task:n1",
        description: LONG_INSTRUCTION,
        label: "Dismiss popups · Set email · Delete account",
        status: "running",
        turnsUsed: 0,
      },
    ]);

    expect(container.textContent).toContain(
      "Dismiss popups · Set email · Delete account",
    );
    expect(container.textContent).not.toContain("Complete these steps in order");
    // The precise instruction stays one hover away.
    const holder = container.querySelector(`[title*="Complete these steps"]`);
    expect(holder).not.toBeNull();
    // A labelled row needs no expander.
    expect(container.textContent).not.toContain("more");
  });

  test("an unlabelled long instruction clamps with a working more/less toggle", async () => {
    await renderRows([
      {
        id: "task:n1",
        description: LONG_INSTRUCTION,
        status: "running",
        turnsUsed: 0,
      },
    ]);

    const toggle = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "more",
    );
    expect(toggle).toBeDefined();
    // Collapsed: the text is present (clamping is CSS) inside a line-clamp box.
    expect(container.querySelector(".line-clamp-2")).not.toBeNull();

    await act(async () => {
      toggle!.click();
    });
    expect(container.querySelector(".line-clamp-2")).toBeNull();
    const less = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "less",
    );
    expect(less).toBeDefined();
  });

  test("a short unlabelled row gets neither clamp nor toggle", async () => {
    await renderRows([
      {
        id: "task:n1",
        description: "Read the dashboard",
        status: "running",
        turnsUsed: 0,
      },
    ]);
    expect(container.querySelector(".line-clamp-2")).toBeNull();
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "more",
      ),
    ).toBe(false);
  });
});
