import type { UserSettings } from "../types";
export type ProviderMode = NonNullable<UserSettings["providerMode"]>;
export type StableProviderMode = "openrouter";
export type ProviderCredentialSettings = Pick<
  UserSettings,
  "providerMode" | "inferenceMode" | "openRouterApiKey"
>;
export interface ProviderStackOption {
  mode: StableProviderMode;
  label: string;
  description: string;
  kind: "single";
  recommended?: boolean;
  requiredKeys: readonly "openRouterApiKey"[];
}
export const PROVIDER_STACK_OPTIONS: readonly ProviderStackOption[] = [
  {
    mode: "openrouter",
    label: "OpenRouter",
    description: "All agent models use OpenRouter.",
    kind: "single",
    recommended: true,
    requiredKeys: ["openRouterApiKey"],
  },
];
export function getAvailableProviderStacks(
  settings: ProviderCredentialSettings,
): ProviderStackOption[] {
  return settings.inferenceMode === "cloud" || settings.openRouterApiKey?.trim()
    ? [...PROVIDER_STACK_OPTIONS]
    : [];
}
export function resolveAvailableProviderMode(
  settings: ProviderCredentialSettings,
): StableProviderMode | undefined {
  return getAvailableProviderStacks(settings).length ? "openrouter" : undefined;
}
export function getProviderStackOption(
  mode: ProviderMode,
): ProviderStackOption | undefined {
  return PROVIDER_STACK_OPTIONS.find((option) => option.mode === mode);
}
export function clearProviderModelOverrides(
  settings: UserSettings,
): UserSettings {
  const next = { ...settings };
  for (const key of [
    "executorModel",
    "plannerModel",
    "writerModel",
    "judgeModel",
    "executorProviderPin",
    "plannerProviderPin",
    "judgeProviderPin",
  ] as const)
    delete next[key];
  return next;
}
export function reconcileProviderSelection(
  settings: UserSettings,
): UserSettings {
  return settings.providerMode === "openrouter"
    ? settings
    : clearProviderModelOverrides({ ...settings, providerMode: "openrouter" });
}
export interface ProviderKeyStatus {
  mode: ProviderMode;
  activeKey?: string;
  activeKeyName: string;
  missingKeyNames: string[];
  hasRequiredKeys: boolean;
}
export function getProviderKeyStatus(
  settings: ProviderCredentialSettings,
): ProviderKeyStatus {
  const activeKey =
    settings.inferenceMode === "cloud"
      ? "__opensidebar_cloud__"
      : settings.openRouterApiKey?.trim();
  return {
    mode: "openrouter",
    activeKey,
    activeKeyName: "OpenRouter",
    missingKeyNames: activeKey ? [] : ["OpenRouter"],
    hasRequiredKeys: !!activeKey,
  };
}
export function formatMissingProviderKeys(status: ProviderKeyStatus): string {
  return status.missingKeyNames.join(" and ") || status.activeKeyName;
}
