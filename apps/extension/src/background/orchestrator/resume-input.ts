/**
 * Resume-input builder (RFC LP-16 Phase 5). Reconstructs an
 * OrchestratorStartInput to resume a persisted task, re-resolving provider
 * settings + fallbacks. Pure — verbatim movement of the Orchestrator helper.
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
  const configuredMode = "openrouter";
  const configuredStatus = getProviderKeyStatus({...settings,providerMode:configuredMode});
  const provider = configuredStatus.hasRequiredKeys && configuredStatus.activeKey ? {mode:configuredMode,activeKey:configuredStatus.activeKey} as const : null;
  if (!provider) {
    logger.warn(
      "orchestrator",
      "Cannot resume task without API key for active provider",
      {
        workspaceId: task.workspaceId,
        providerMode: configuredMode,
        missingKeys: formatMissingProviderKeys(configuredStatus),
      },
    );
    return null;
  }
  const resumeSettings: UserSettings = {
    ...settings,
    providerMode: provider.mode,
  };

  return {
    query: task.query,
    tabId: resumeTabId,
    workspaceId: task.workspaceId,
    settings: resumeSettings,
    openRouterApiKey: provider.activeKey,
  };
}
