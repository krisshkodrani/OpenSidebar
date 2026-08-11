import type { UserSettings } from "../types";
import { DEFAULT_PROVIDER_MODE } from "./executor-model-policy";

export type ProviderMode = NonNullable<UserSettings["providerMode"]>;
export type StableProviderMode = "openrouter" | "fireworks";

export type ProviderCredentialSettings = Pick<
  UserSettings,
  | "providerMode"
  | "inferenceMode"
  | "openRouterApiKey"
  | "openaiApiKey"
  | "groqApiKey"
  | "fireworksApiKey"
  | "deepseekApiKey"
  | "kimiApiKey"
  | "xiaomiApiKey"
  | "cerebrasApiKey"
>;

type ProviderKeyField = Exclude<
  keyof ProviderCredentialSettings,
  "providerMode" | "inferenceMode"
>;

export interface ProviderStackOption {
  mode: StableProviderMode;
  label: string;
  description: string;
  kind: "single" | "hybrid";
  recommended?: boolean;
  requiredKeys: readonly ProviderKeyField[];
}

/**
 * Release-verified stacks shown in Settings. Experimental and legacy modes
 * remain understood by the runtime and migrations, but are not advertised.
 */
export const PROVIDER_STACK_OPTIONS: readonly ProviderStackOption[] = [
  {
    mode: "openrouter",
    label: "OpenRouter",
    description: "Executor, planner, and verifier with a live model catalog.",
    kind: "single",
    recommended: true,
    requiredKeys: ["openRouterApiKey"],
  },
  {
    mode: "fireworks",
    label: "Fireworks AI",
    description: "Executor, planner, and verifier with curated models.",
    kind: "single",
    requiredKeys: ["fireworksApiKey"],
  },
];

function configuredKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getAvailableProviderStacks(
  settings: ProviderCredentialSettings,
): ProviderStackOption[] {
  if (settings.inferenceMode === "cloud") return [...PROVIDER_STACK_OPTIONS];
  return PROVIDER_STACK_OPTIONS.filter((option) =>
    option.requiredKeys.every((key) => configuredKey(settings[key])),
  );
}

export function resolveAvailableProviderMode(
  settings: ProviderCredentialSettings,
): StableProviderMode | undefined {
  const available = getAvailableProviderStacks(settings);
  const current = settings.providerMode;
  const currentOption = available.find((option) => option.mode === current);
  if (currentOption) return currentOption.mode;

  const relatedFallback =
    current === "openrouter-groq"
      ? "openrouter"
      : current === "fireworks-deepseek" || current === "cerebras-fireworks"
        ? "fireworks"
        : undefined;
  if (
    relatedFallback &&
    available.some((option) => option.mode === relatedFallback)
  ) {
    return relatedFallback;
  }
  return available[0]?.mode;
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
  delete next.executorModel;
  delete next.plannerModel;
  delete next.writerModel;
  return next;
}

export function reconcileProviderSelection(
  settings: UserSettings,
): UserSettings {
  const availableMode = resolveAvailableProviderMode(settings);
  if (!availableMode || availableMode === settings.providerMode)
    return settings;
  return clearProviderModelOverrides({
    ...settings,
    providerMode: availableMode,
  });
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
  const mode = settings.providerMode ?? DEFAULT_PROVIDER_MODE;

  if (settings.inferenceMode === "cloud" && (mode === "openrouter" || mode === "fireworks")) {
    return { mode, activeKey: "__opensidebar_cloud__", activeKeyName: "OpenSidebar Cloud", missingKeyNames: [], hasRequiredKeys: true };
  }

  if (mode === "cerebras-fireworks") {
    const missingKeyNames: string[] = [];
    const cerebrasKey = configuredKey(settings.cerebrasApiKey);
    const fireworksKey = configuredKey(settings.fireworksApiKey);
    if (!cerebrasKey) missingKeyNames.push("Cerebras");
    if (!fireworksKey) missingKeyNames.push("Fireworks AI");
    return {
      mode,
      activeKey: missingKeyNames.length === 0 ? cerebrasKey : undefined,
      activeKeyName: "Cerebras and Fireworks AI",
      missingKeyNames,
      hasRequiredKeys: missingKeyNames.length === 0,
    };
  }

  if (mode === "fireworks-deepseek") {
    const missingKeyNames: string[] = [];
    const fireworksKey = configuredKey(settings.fireworksApiKey);
    const deepseekKey = configuredKey(settings.deepseekApiKey);
    if (!fireworksKey) missingKeyNames.push("Fireworks AI");
    if (!deepseekKey) missingKeyNames.push("DeepSeek");
    return {
      mode,
      activeKey: missingKeyNames.length === 0 ? fireworksKey : undefined,
      activeKeyName: "Fireworks AI and DeepSeek",
      missingKeyNames,
      hasRequiredKeys: missingKeyNames.length === 0,
    };
  }

  if (mode === "openrouter-groq" || mode === "openai-groq") {
    const executorKey =
      mode === "openai-groq"
        ? configuredKey(settings.openaiApiKey)
        : configuredKey(settings.openRouterApiKey);
    const groqKey = configuredKey(settings.groqApiKey);
    const executorKeyName = mode === "openai-groq" ? "OpenAI" : "OpenRouter";
    const missingKeyNames: string[] = [];
    if (!executorKey) missingKeyNames.push(executorKeyName);
    if (!groqKey) missingKeyNames.push("Groq");
    return {
      mode,
      activeKey: missingKeyNames.length === 0 ? executorKey : undefined,
      activeKeyName: `${executorKeyName} and Groq`,
      missingKeyNames,
      hasRequiredKeys: missingKeyNames.length === 0,
    };
  }

  const activeKey =
    mode === "fireworks"
      ? configuredKey(settings.fireworksApiKey)
      : mode === "moonshot"
        ? configuredKey(settings.kimiApiKey)
        : mode === "xiaomi"
          ? configuredKey(settings.xiaomiApiKey)
          : configuredKey(settings.openRouterApiKey);
  const activeKeyName =
    mode === "fireworks"
      ? "Fireworks AI"
      : mode === "moonshot"
        ? "Moonshot AI"
        : mode === "xiaomi"
          ? "Xiaomi MiMo"
          : "OpenRouter";
  const missingKeyNames = activeKey ? [] : [activeKeyName];

  return {
    mode,
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
