import React, { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import ViewerHeader from "../../src/trace-viewer/components/ViewerHeader";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("ViewerHeader backend toggle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  function findButton(text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;
  }

  test("exposes a Backend affordance that toggles the panel", async () => {
    // Regression: the backend (memory + scheduling) panel was only reachable by
    // manually typing #view=backend — there was no UI affordance to reach it.
    const onToggleBackend = vi.fn();
    await act(async () => {
      root.render(
        <ViewerHeader backendActive={false} onToggleBackend={onToggleBackend} />,
      );
    });

    const button = findButton("Backend");
    expect(button).toBeTruthy();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggleBackend).toHaveBeenCalledTimes(1);
  });

  test("shows a return-to-traces label while the backend panel is active", async () => {
    await act(async () => {
      root.render(
        <ViewerHeader backendActive onToggleBackend={vi.fn()} />,
      );
    });
    expect(findButton("Traces")).toBeTruthy();
    expect(findButton("Backend")).toBeFalsy();
  });

  test("hides the toggle entirely when no handler is provided", async () => {
    await act(async () => {
      root.render(<ViewerHeader />);
    });
    expect(findButton("Backend")).toBeFalsy();
  });
});
