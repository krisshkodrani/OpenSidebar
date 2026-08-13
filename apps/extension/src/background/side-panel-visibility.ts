export const SIDEPANEL_PATH = "src/sidepanel/index.html";

type SidePanelOptionsPort = Pick<typeof chrome.sidePanel, "setOptions">;

/**
 * Apply the tab-scoped workspace visibility rule.
 *
 * Disabling a tab is intentional: Chrome hides the panel while that tab is
 * active and restores the previously open panel when the user returns to an
 * enabled tab. Mission execution remains owned by the background worker.
 */
export async function setWorkspacePanelVisibility(
  sidePanel: SidePanelOptionsPort,
  tabId: number,
  visible: boolean,
): Promise<void> {
  await sidePanel.setOptions(
    visible
      ? { tabId, path: SIDEPANEL_PATH, enabled: true }
      : { tabId, enabled: false },
  );
}
