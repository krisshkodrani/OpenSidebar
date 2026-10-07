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
  | "cerebras-fireworks"
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
  cerebrasKey?: string;
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
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
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

/** Development inference uses the same OpenRouter-only boundary as production. */
export function detectProviderMode(provider: string): ProviderMode {if(provider.toLowerCase() !== "openrouter") throw new Error("Only OpenRouter is supported; set E2E_PROVIDER=openrouter"); return "openrouter";}
export function deriveLane(_providerMode: ProviderMode): E2ELane {return "dev";}
export function loadProviderKeys(_providerMode: ProviderMode,options:ProviderConfigOptions={}): E2EProviderKeys {return {openRouterKey:loadApiKey(options)};}
export function loadActiveProviderApiKey(_providerMode: ProviderMode,options:ProviderConfigOptions={}):string|undefined {return loadApiKey(options);}

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
