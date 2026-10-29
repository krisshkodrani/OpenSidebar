import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const moduleDir = import.meta.url.startsWith("file:")
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const REPO_ENV_PATH = resolve(moduleDir, "../../../../../.env");

export interface E2EProviderDiagnostic {
  severity: "info" | "warning";
  source: "e2e-provider-config";
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface E2EProviderConfig {
  apiKey: string | undefined;
  diagnostics: E2EProviderDiagnostic[];
}

interface ProviderConfigOptions {
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

export function resolveE2EProviderConfig(
  options: ProviderConfigOptions = {},
): E2EProviderConfig {
  const apiKey = loadApiKey(options);
  const diagnostics: E2EProviderDiagnostic[] = [];

  if (!apiKey) {
    diagnostics.push(
      diagnostic("warning", "OPENROUTER_API_KEY is not configured."),
    );
  }

  return { apiKey, diagnostics };
}
