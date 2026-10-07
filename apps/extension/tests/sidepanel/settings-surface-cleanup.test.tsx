import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { SettingsDrawer } from "../../src/sidepanel/components/SettingsDrawer";
import { useStore } from "../../src/sidepanel/store";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store/settings-slice";

describe("settings surface cleanup", () => {
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

  test("settings drawer omits retired JobAgent MCP and developer controls", async () => {
    await act(async () => {
      root.render(<SettingsDrawer isOpen onClose={() => {}} />);
    });

    expect(container.textContent).toContain("account");
    expect(container.textContent).toContain("agent");
    expect(container.textContent).toContain("browser");
    expect(container.textContent).toContain("advanced");
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
});
