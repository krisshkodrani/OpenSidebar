/**
 * Resume-input builder (RFC LP-16 Phase 5). Reconstructs an
 * OrchestratorStartInput to resume a persisted task, re-resolving provider
 * settings. Pure — verbatim movement of the Orchestrator helper.
 */

import { logger } from "../../utils";
import type { UserSettings } from "../../types";
import { loadSettings } from "../../utils/settings-storage";
import {
  formatMissingProviderKeys,
  getProviderKeyStatus,
} from "../../utils/provider-keys";
import type { OrchestratorStartInput, OrchestratorTask } from "./types";

export async function buildResumeInput(
  task: OrchestratorTask,
  resumeTabId: number,
): Promise<OrchestratorStartInput | null> {
  const settings = (await loadSettings()) ?? ({} as UserSettings);
  const keyStatus = getProviderKeyStatus(settings);
  if (!keyStatus.hasRequiredKeys || !keyStatus.activeKey) {
    logger.warn(
      "orchestrator",
      "Cannot resume task without API key for active provider",
      {
        workspaceId: task.workspaceId,
        missingKeys: formatMissingProviderKeys(keyStatus),
      },
    );
    return null;
  }

  return {
    query: task.query,
    tabId: resumeTabId,
    workspaceId: task.workspaceId,
    settings,
    openRouterApiKey: keyStatus.activeKey,
  };
}
