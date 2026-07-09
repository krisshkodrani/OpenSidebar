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
  type ProviderMode = NonNullable<UserSettings["providerMode"]>;
  const pickFallbackProvider = (): {
    mode: ProviderMode;
    activeKey: string;
  } | null => {
    const candidateModes: ProviderMode[] = [
      "openrouter",
      "fireworks-deepseek",
      "fireworks",
      "moonshot",
      "xiaomi",
      "openai-groq",
    ];
    for (const mode of candidateModes) {
      const status = getProviderKeyStatus({
        ...settings,
        providerMode: mode,
      });
      if (status.hasRequiredKeys && status.activeKey) {
        return { mode, activeKey: status.activeKey };
      }
    }
    return null;
  };
  const configuredMode: ProviderMode =
    settings.providerMode ??
    (settings.openRouterApiKey
      ? "openrouter"
      : settings.fireworksApiKey && settings.deepseekApiKey
        ? "fireworks-deepseek"
        : settings.kimiApiKey
          ? "moonshot"
          : settings.xiaomiApiKey
            ? "xiaomi"
            : "fireworks");
  const configuredStatus = getProviderKeyStatus({
    ...settings,
    providerMode: configuredMode,
  });
  const provider =
    configuredStatus.hasRequiredKeys && configuredStatus.activeKey
      ? { mode: configuredMode, activeKey: configuredStatus.activeKey }
      : pickFallbackProvider();
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
