import type { UserSettings } from "../types";

export type ProviderCredentialSettings = Pick<
  UserSettings,
  "inferenceMode" | "openRouterApiKey"
>;

const CLOUD_PLACEHOLDER_KEY = "__opensidebar_cloud__";

function configuredKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** True when the user can send LLM requests: OpenSidebar Cloud or an OpenRouter key. */
export function hasProviderCredentials(
  settings: ProviderCredentialSettings,
): boolean {
  return (
    settings.inferenceMode === "cloud" ||
    configuredKey(settings.openRouterApiKey) !== undefined
  );
}

export interface ProviderKeyStatus {
  activeKey?: string;
  activeKeyName: string;
  missingKeyNames: string[];
  hasRequiredKeys: boolean;
}

export function getProviderKeyStatus(
  settings: ProviderCredentialSettings,
): ProviderKeyStatus {
  if (settings.inferenceMode === "cloud") {
    return {
      activeKey: CLOUD_PLACEHOLDER_KEY,
      activeKeyName: "OpenSidebar Cloud",
      missingKeyNames: [],
      hasRequiredKeys: true,
    };
  }

  const activeKey = configuredKey(settings.openRouterApiKey);
  const activeKeyName = "OpenRouter";
  const missingKeyNames = activeKey ? [] : [activeKeyName];
  return {
    activeKey,
    activeKeyName,
    missingKeyNames,
    hasRequiredKeys: missingKeyNames.length === 0,
  };
}

export function formatMissingProviderKeys(status: ProviderKeyStatus): string {
  return status.missingKeyNames.length > 0
    ? status.missingKeyNames.join(" and ")
    : status.activeKeyName;
}
