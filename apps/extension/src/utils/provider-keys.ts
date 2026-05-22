import type { UserSettings } from "../types";

export type ProviderMode = NonNullable<UserSettings["providerMode"]>;

export interface ProviderKeyStatus {
  mode: ProviderMode;
  activeKey?: string;
  activeKeyName: string;
  missingKeyNames: string[];
  hasRequiredKeys: boolean;
}

export function getProviderKeyStatus(
  settings: Pick<
    UserSettings,
    | "providerMode"
    | "openRouterApiKey"
    | "openaiApiKey"
    | "groqApiKey"
    | "fireworksApiKey"
    | "deepseekApiKey"
    | "kimiApiKey"
    | "xiaomiApiKey"
  >,
): ProviderKeyStatus {
  const mode = settings.providerMode ?? "fireworks";

  if (mode === "fireworks-deepseek") {
    const missingKeyNames: string[] = [];
    if (!settings.fireworksApiKey) missingKeyNames.push("Fireworks AI");
    if (!settings.deepseekApiKey) missingKeyNames.push("DeepSeek");
    return {
      mode,
      activeKey:
        missingKeyNames.length === 0 ? settings.fireworksApiKey : undefined,
      activeKeyName: "Fireworks AI and DeepSeek",
      missingKeyNames,
      hasRequiredKeys: missingKeyNames.length === 0,
    };
  }

  if (mode === "openrouter-groq" || mode === "openai-groq") {
    const executorKey =
      mode === "openai-groq"
        ? settings.openaiApiKey
        : settings.openRouterApiKey;
    const executorKeyName =
      mode === "openai-groq" ? "OpenAI" : "OpenRouter";
    const missingKeyNames: string[] = [];
    if (!executorKey) missingKeyNames.push(executorKeyName);
    if (!settings.groqApiKey) missingKeyNames.push("Groq");
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
      ? settings.fireworksApiKey
      : mode === "moonshot"
        ? settings.kimiApiKey
        : mode === "xiaomi"
          ? settings.xiaomiApiKey
          : settings.openRouterApiKey;
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
