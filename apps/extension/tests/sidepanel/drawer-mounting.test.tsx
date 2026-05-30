import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { SavedPromptsDrawer } from "../../src/sidepanel/components/SavedPromptsDrawer";

// The sidepanel App now mounts each drawer only while it is open (a perf
// optimization: closed drawers no longer run their store subscriptions). That
// relies on each drawer self-guarding with `if (!isOpen) return null`, so the
// closed -> nothing / open -> content contract is what we lock in here.
describe("SavedPromptsDrawer mount contract", () => {
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

  test("renders nothing when closed", async () => {
    await act(async () => {
      root.render(
        <SavedPromptsDrawer
          isOpen={false}
          onClose={vi.fn()}
          onSelectPrompt={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toBe("");
    expect(container.querySelector('[aria-label="Saved Prompts"]')).toBeNull();
  });

  test("renders the panel content when open", async () => {
    await act(async () => {
      root.render(
        <SavedPromptsDrawer
          isOpen
          onClose={vi.fn()}
          onSelectPrompt={vi.fn()}
        />,
      );
    });

    expect(
      container.querySelector('[aria-label="Saved Prompts"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Saved Prompts");
  });
});
