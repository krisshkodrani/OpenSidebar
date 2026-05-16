import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readE2EConfig, type E2EConfig } from "./e2e-config";

const moduleDir = import.meta.url.startsWith("file:")
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const REPO_ENV_PATH = resolve(moduleDir, "../../../../../.env");

export type ProviderMode =
  | "openrouter"
  | "openrouter-groq"
  | "openai-groq"
  | "fireworks"
  | "fireworks-deepseek"
  | "moonshot"
  | "xiaomi";

export type E2ELane = "dev" | "validation";

export interface E2EProviderKeys {
  openRouterKey?: string;
  groqKey?: string;
  openAiKey?: string;
  fireworksKey?: string;
  deepseekKey?: string;
  kimiKey?: string;
  xiaomiKey?: string;
}

export interface E2EProviderDiagnostic {
  severity: "info" | "warning";
  source: "e2e-provider-config";
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface E2EProviderConfig {
  providerMode: ProviderMode;
  lane: E2ELane;
  apiKey: string | undefined;
  keys: E2EProviderKeys;
  diagnostics: E2EProviderDiagnostic[];
}

interface ProviderConfigOptions {
  config?: E2EConfig;
  env?: Record<string, string | undefined>;
  envFilePath?: string;
}

function readEnvFile(envFilePath: string): Record<string, string> {
  if (!existsSync(envFilePath)) return {};
  const values: Record<string, string> = {};
  const content = readFileSync(envFilePath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim();
  }
  return values;
}

function envValue(
  name: string,
  options: ProviderConfigOptions = {},
): string | undefined {
  const direct = options.env?.[name] ?? process.env[name];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const fileValues = readEnvFile(options.envFilePath ?? REPO_ENV_PATH);
  const fromFile = fileValues[name];
  return typeof fromFile === "string" && fromFile.trim()
    ? fromFile.trim()
    : undefined;
}

function diagnostic(
  severity: E2EProviderDiagnostic["severity"],
  message: string,
  context?: Record<string, unknown>,
): E2EProviderDiagnostic {
  return {
    severity,
    source: "e2e-provider-config",
    timestamp: new Date().toISOString(),
    message,
    ...(context ? { context } : {}),
  };
}

export function loadApiKey(
  options: ProviderConfigOptions = {},
): string | undefined {
  return envValue("OPENROUTER_API_KEY", options);
}

export function loadGroqApiKey(
  options: ProviderConfigOptions = {},
): string | undefined {
  return envValue("GROQ_API_KEY", options);
}

export function loadOpenAiApiKey(
  options: ProviderConfigOptions = {},
): string | undefined {
  return envValue("OPENAI_API_KEY", options);
}

export function loadFireworksApiKey(
  options: ProviderConfigOptions = {},
): string | undefined {
  return envValue("FIREWORKS_API_KEY", options);
}

export function loadDeepSeekApiKey(
  options: ProviderConfigOptions = {},
): string | undefined {
  return envValue("DEEPSEEK_API_KEY", options);
}

export function loadKimiApiKey(
  options: ProviderConfigOptions = {},
): string | undefined {
  return envValue("KIMI_API_KEY", options);
}

export function loadXiaomiApiKey(
  options: ProviderConfigOptions = {},
): string | undefined {
  return envValue("XIAOMI_API_KEY", options);
}

/** Detect provider mode from E2E config (default: fireworks). */
export function detectProviderMode(provider: string): ProviderMode {
  const normalized = provider.toLowerCase();
  if (normalized === "deepseek" || normalized === "fireworks-deepseek") {
    return "fireworks-deepseek";
  }
  if (normalized === "moonshot" || normalized === "kimi") return "moonshot";
  if (normalized === "xiaomi" || normalized === "mimo") return "xiaomi";
  if (normalized === "groq" || normalized === "openrouter-groq") {
    return "openrouter-groq";
  }
  if (normalized === "openai-groq") return "openai-groq";
  if (normalized === "openrouter") return "openrouter";
  return "fireworks";
}

export function deriveLane(providerMode: ProviderMode): E2ELane {
  return providerMode === "fireworks" ||
    providerMode === "fireworks-deepseek" ||
    providerMode === "moonshot" ||
    providerMode === "xiaomi"
    ? "dev"
    : "validation";
}

export function loadProviderKeys(
  providerMode: ProviderMode,
  options: ProviderConfigOptions = {},
): E2EProviderKeys {
  return {
    ...(providerMode === "openrouter" || providerMode === "openrouter-groq"
      ? { openRouterKey: loadApiKey(options) }
      : {}),
    ...(providerMode === "openrouter-groq" || providerMode === "openai-groq"
      ? { groqKey: loadGroqApiKey(options) }
      : {}),
    ...(providerMode === "openai-groq"
      ? { openAiKey: loadOpenAiApiKey(options) }
      : {}),
    ...(providerMode === "fireworks" || providerMode === "fireworks-deepseek"
      ? { fireworksKey: loadFireworksApiKey(options) }
      : {}),
    ...(providerMode === "fireworks-deepseek"
      ? { deepseekKey: loadDeepSeekApiKey(options) }
      : {}),
    ...(providerMode === "moonshot" ? { kimiKey: loadKimiApiKey(options) } : {}),
    ...(providerMode === "xiaomi"
      ? { xiaomiKey: loadXiaomiApiKey(options) }
      : {}),
  };
}

export function loadActiveProviderApiKey(
  providerMode: ProviderMode,
  options: ProviderConfigOptions = {},
): string | undefined {
  if (providerMode === "fireworks-deepseek") {
    const fireworksKey = loadFireworksApiKey(options);
    const deepseekKey = loadDeepSeekApiKey(options);
    return fireworksKey && deepseekKey ? fireworksKey : undefined;
  }
  if (providerMode === "fireworks") return loadFireworksApiKey(options);
  if (providerMode === "moonshot") return loadKimiApiKey(options);
  if (providerMode === "xiaomi") return loadXiaomiApiKey(options);
  if (providerMode === "openai-groq") return loadOpenAiApiKey(options);
  return loadApiKey(options);
}

export function resolveE2EProviderConfig(
  options: ProviderConfigOptions = {},
): E2EProviderConfig {
  const config = options.config ?? readE2EConfig({ env: options.env });
  const providerMode = detectProviderMode(config.provider);
  const lane = deriveLane(providerMode);
  const keys = loadProviderKeys(providerMode, options);
  const apiKey = loadActiveProviderApiKey(providerMode, options);
  const diagnostics: E2EProviderDiagnostic[] = [];

  if (!apiKey) {
    diagnostics.push(
      diagnostic("warning", "Active E2E provider API key is not configured.", {
        providerMode,
        lane,
      }),
    );
  }

  return {
    providerMode,
    lane,
    apiKey,
    keys,
    diagnostics,
  };
}
