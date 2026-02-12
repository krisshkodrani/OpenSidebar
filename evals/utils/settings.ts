/**
 * Settings Loader
 *
 * Loads API keys from .env file for CLI/evaluation use.
 * Chrome extension uses chrome.storage.sync, but CLI tools need .env
 */

import type { UserSettings } from "../../src/types/index.js";

const ENV_PATH = ".env";

/**
 * Load settings from .env file
 */
export async function loadSettingsFromEnv(): Promise<Partial<UserSettings>> {
  const settings: Partial<UserSettings> = {};

  try {
    const file = Bun.file(ENV_PATH);

    if (!(await file.exists())) {
      console.warn(`No ${ENV_PATH} file found`);
      return settings;
    }

    const content = await file.text();
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Parse KEY=value
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim();
        const value = trimmed.substring(equalIndex + 1).trim();

        // Remove quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, "");

        if (key === "OPENROUTER_API_KEY") {
          settings.openRouterApiKey = cleanValue;
        }
      }
    }
  } catch (error) {
    console.warn(`Error loading ${ENV_PATH}:`, error);
  }

  return settings;
}

/**
 * Get API key for LLM operations (OpenRouter only)
 * Priority: .env file > environment variables
 */
export async function getApiKey(): Promise<{
  apiKey: string;
}> {
  const envSettings = await loadSettingsFromEnv();
  const openRouterKey = envSettings.openRouterApiKey || process.env.OPENROUTER_API_KEY;

  if (openRouterKey) {
    return { apiKey: openRouterKey };
  }

  throw new Error(
    "No API key configured. Please set OPENROUTER_API_KEY " +
      "in .env file or environment variables.",
  );
}

/**
 * Validate that required API keys are present
 */
export async function validateApiKeys(): Promise<{
  valid: boolean;
  openrouter?: string;
  error?: string;
}> {
  try {
    const { apiKey } = await getApiKey();

    return {
      valid: true,
      openrouter: apiKey,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get full settings object for CLI use
 */
export async function loadCliSettings(): Promise<UserSettings> {
  const envSettings = await loadSettingsFromEnv();

  return {
    openRouterApiKey:
      envSettings.openRouterApiKey || process.env.OPENROUTER_API_KEY || "",
    maxTurns: 30,
    contextWindowSize: 128000,
    memoryEnabled: true,
    workspaceEnabled: true,
    theme: "system",
    showElementTags: false,
    visionModel: "google/gemini-2.5-flash-lite",
    confirmPlan: false,
  };
}
