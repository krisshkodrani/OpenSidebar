import { describe, expect, it, vi } from "vitest";
import {
  SIDEPANEL_PATH,
  setWorkspacePanelVisibility,
} from "../../src/background/side-panel-visibility";

describe("workspace side-panel visibility", () => {
  it("enables the product panel only for a workspace tab", async () => {
    const setOptions = vi.fn().mockResolvedValue(undefined);

    await setWorkspacePanelVisibility({ setOptions }, 41, true);

    expect(setOptions).toHaveBeenCalledWith({
      tabId: 41,
      path: SIDEPANEL_PATH,
      enabled: true,
    });
  });

  it("disables the panel for a tab outside the workspace", async () => {
    const setOptions = vi.fn().mockResolvedValue(undefined);

    await setWorkspacePanelVisibility({ setOptions }, 42, false);

    expect(setOptions).toHaveBeenCalledWith({ tabId: 42, enabled: false });
  });
});
