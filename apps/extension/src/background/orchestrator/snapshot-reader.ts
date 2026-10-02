import type { DomSnapshot } from "../../types";
import { logger } from "../../utils";
import { requestPageSnapshot } from "../perception/frame-snapshot-runtime";

export async function getOrchestratorSnapshot(
  tabId: number,
  waitForContentScriptReady: (tabId: number, timeoutMs: number) => Promise<unknown>,
): Promise<DomSnapshot | undefined> {
  try {
    try {
      const contentScriptPath = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];
      if (contentScriptPath) await chrome.scripting.executeScript({
        target: { tabId }, files: [contentScriptPath],
      });
    } catch {
      // Content script may already be injected.
    }
    await waitForContentScriptReady(tabId, 3000);
    const response = await requestPageSnapshot(tabId, {
      refresh: true, autoDismiss: false,
    });
    return response.payload.snapshot;
  } catch (error) {
    logger.warn("orchestrator", "getSnapshot failed — executor will fetch its own", {
      tabId, error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
