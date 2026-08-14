import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { SettingsDrawer } from "../../src/sidepanel/components/SettingsDrawer";
import { ComposerBox } from "../../src/sidepanel/components/input/ComposerBox";
import { useStore } from "../../src/sidepanel/store";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store/settings-slice";

describe("removed voice and JobAgent MCP surfaces", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStore.setState({ settings: DEFAULT_SETTINGS } as any);
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

  test("settings drawer has no Voice tab or JobAgent MCP controls", async () => {
    await act(async () => {
      root.render(
        <SettingsDrawer
          isOpen
          activeTab="account"
          onActiveTabChange={() => {}}
          onClose={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("account");
    expect(container.textContent).toContain("agent");
    expect(container.textContent).toContain("browser");
    expect(container.textContent).toContain("advanced");
    expect(container.textContent).not.toContain("voice");
    expect(container.textContent).not.toContain("JobAgent MCP");
    expect(container.textContent).not.toContain("MCP URL");
    expect(container.textContent).not.toContain("Clear Chat History");
    expect(container.textContent).not.toContain("Clear Local Logs");
    expect(container.textContent).not.toContain("Clear All Local Data");
    expect(container.textContent).not.toContain("Export Logs");
    expect(container.textContent).not.toContain("named tester");
    expect(container.textContent).not.toContain("trace recovery");
    expect(container.textContent).not.toContain("upload queue");
  });

  test("composer renders without mic or Realtime controls", async () => {
    const inputRef = React.createRef<HTMLTextAreaElement>();

    await act(async () => {
      root.render(
        <ComposerBox
          hasText={false}
          inputRef={inputRef}
          isGuidance={false}
          onBlur={() => {}}
          onChange={() => {}}
          onFocus={() => {}}
          onKeyDown={() => {}}
          onSubmit={() => {}}
          placeholder="What can I help with?"
          value=""
        />,
      );
    });

    expect(
      container.querySelector('[aria-label="Start Realtime voice"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Realtime");
    expect(container.querySelector('[aria-label="Send message"]')).toBeTruthy();
  });
});
