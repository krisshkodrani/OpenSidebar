import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import TurnSnapshotSection from "../../src/trace-viewer/components/traces/TurnSnapshotSection";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("TurnSnapshotSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
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

  test("shows a pruned screenshot affordance when the trace says it was pruned", async () => {
    await act(async () => {
      root.render(
        <TurnSnapshotSection
          sessionId="session-1"
          turnNumber={1}
          snapshot={{
            url: "https://example.com",
            title: "Example",
            elementCount: 1,
            visibleContentLength: 10,
            scrollY: 0,
          }}
          perception={{
            interpretation: "page",
            model: "vision",
            durationMs: 1,
            cached: false,
            screenshotStatus: "pruned",
          }}
        />,
      );
    });

    expect(container.textContent).toContain(
      "Screenshot pruned (hot window elapsed)",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  test("shows generic load failure for image errors without calling it pruned", async () => {
    await act(async () => {
      root.render(
        <TurnSnapshotSection
          sessionId="session-1"
          turnNumber={1}
          snapshot={{
            url: "https://example.com",
            title: "Example",
            elementCount: 1,
            visibleContentLength: 10,
            scrollY: 0,
          }}
        />,
      );
    });

    const image = container.querySelector("img");
    expect(image).toBeTruthy();

    await act(async () => {
      image!.dispatchEvent(new Event("error", { bubbles: true }));
    });

    expect(container.textContent).toContain("Screenshot failed to load");
    expect(container.textContent).not.toContain("Screenshot pruned");
  });
});
