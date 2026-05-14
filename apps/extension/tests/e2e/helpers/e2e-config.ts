export const PUBLIC_E2E_ENV_VARS = [
  "E2E_PROFILE",
  "E2E_PROVIDER",
  "E2E_MODEL",
  "E2E_PERCEPTION_MODE",
  "E2E_SUITE_FLAGS",
  "E2E_ARTIFACTS",
] as const;

export type PublicE2EEnvVar = (typeof PUBLIC_E2E_ENV_VARS)[number];
export type E2EProfileName = "local" | "ci" | "debug" | "video" | "headed";
export type E2EPanelMode = "overlay" | "detached" | "off";

export interface E2EConfig {
  profile: E2EProfileName;
  provider: string;
  model: string | undefined;
  perceptionMode: string | undefined;
  suiteFlags: Set<string>;
  diagnostic: boolean;
  browser: {
    headless: boolean;
    singleProcess: boolean;
    panelMode: E2EPanelMode;
  };
  artifacts: {
    finalScreenshot: boolean;
    recordVideo: boolean;
    videoFrameIntervalMs: number;
    mediaToolTimeoutMs: number;
    ffmpegPath: string;
    ffprobePath: string;
  };
  runtime: {
    temperature: number | undefined;
  };
  deprecatedEnvWarnings: string[];
}

type E2EEnv = Record<string, string | undefined>;

interface ProfileDefaults {
  provider: string;
  headless: boolean;
  singleProcess: boolean;
  panelMode: E2EPanelMode;
  finalScreenshot: boolean;
  recordVideo: boolean;
  videoFrameIntervalMs: number;
  mediaToolTimeoutMs: number;
  ffmpegPath: string;
  ffprobePath: string;
  diagnostic: boolean;
}

export interface ReadE2EConfigOptions {
  env?: E2EEnv;
  defaultProfile?: E2EProfileName;
}

const PROFILE_DEFAULTS: Record<E2EProfileName, ProfileDefaults> = {
  local: {
    provider: "fireworks",
    headless: false,
    singleProcess: false,
    panelMode: "overlay",
    finalScreenshot: true,
    recordVideo: false,
    videoFrameIntervalMs: 1000,
    mediaToolTimeoutMs: 180_000,
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    diagnostic: false,
  },
  ci: {
    provider: "fireworks",
    headless: true,
    singleProcess: false,
    panelMode: "off",
    finalScreenshot: true,
    recordVideo: false,
    videoFrameIntervalMs: 1000,
    mediaToolTimeoutMs: 180_000,
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    diagnostic: false,
  },
  debug: {
    provider: "fireworks",
    headless: false,
    singleProcess: false,
    panelMode: "overlay",
    finalScreenshot: true,
    recordVideo: false,
    videoFrameIntervalMs: 1000,
    mediaToolTimeoutMs: 180_000,
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    diagnostic: true,
  },
  video: {
    provider: "fireworks",
    headless: false,
    singleProcess: false,
    panelMode: "overlay",
    finalScreenshot: true,
    recordVideo: true,
    videoFrameIntervalMs: 1000,
    mediaToolTimeoutMs: 180_000,
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    diagnostic: false,
  },
  headed: {
    provider: "fireworks",
    headless: false,
    singleProcess: false,
    panelMode: "overlay",
    finalScreenshot: true,
    recordVideo: false,
    videoFrameIntervalMs: 1000,
    mediaToolTimeoutMs: 180_000,
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    diagnostic: false,
  },
};

const LEGACY_E2E_ENV_REPLACEMENTS: Record<string, string> = {
  E2E_HEADLESS: "E2E_PROFILE or E2E_ARTIFACTS",
  E2E_SINGLE_PROCESS: "E2E_SUITE_FLAGS=single-process",
  E2E_SHOW_PANEL: "E2E_PROFILE or E2E_ARTIFACTS=panel/no-panel",
  E2E_PANEL_MODE: "E2E_ARTIFACTS=panel/detached-panel/no-panel",
  E2E_RECORD_VIDEO: "E2E_PROFILE=video or E2E_ARTIFACTS=video",
  E2E_VIDEO: "E2E_PROFILE=video or E2E_ARTIFACTS=video",
  E2E_FINAL_SCREENSHOT: "E2E_ARTIFACTS=screenshots/no-screenshot",
  E2E_VIDEO_FRAME_INTERVAL_MS: "apps/extension/tests/e2e/helpers/e2e-config.ts profile defaults",
  E2E_MEDIA_TOOL_TIMEOUT_MS: "apps/extension/tests/e2e/helpers/e2e-config.ts profile defaults",
  E2E_FFMPEG_PATH: "apps/extension/tests/e2e/helpers/e2e-config.ts profile defaults",
  E2E_FFPROBE_PATH: "apps/extension/tests/e2e/helpers/e2e-config.ts profile defaults",
  E2E_EXECUTOR_MODEL: "E2E_MODEL",
  E2E_TEMPERATURE: "apps/extension/tests/e2e/helpers/e2e-config.ts runtime defaults",
  E2E_USE_VL_EXECUTOR: "E2E_PERCEPTION_MODE=unified_vl",
  E2E_DIAGNOSTIC: "E2E_SUITE_FLAGS=diagnostic",
  E2E_BACKEND_DURABLE: "E2E_SUITE_FLAGS=backend-durable",
  E2E_BACKEND_PROFILE: "E2E_SUITE_FLAGS=backend-profile",
  E2E_MEMORY_LONG: "E2E_SUITE_FLAGS=memory-long",
};

function envValue(env: E2EEnv, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeFlag(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function parseFlagSet(value: string | undefined): Set<string> {
  const flags = new Set<string>();
  if (!value) return flags;
  for (const token of value.split(/[,\s]+/)) {
    const flag = normalizeFlag(token);
    if (flag) flags.add(flag);
  }
  return flags;
}

function applySuiteFlag(flags: Set<string>, flag: string): void {
  const normalized = normalizeFlag(flag);
  if (!normalized) return;
  if (normalized.startsWith("no-")) {
    flags.delete(normalized.slice(3));
    return;
  }
  flags.add(normalized);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
  min: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function parseProfile(
  raw: string | undefined,
  fallback: E2EProfileName,
): E2EProfileName {
  const normalized = raw?.toLowerCase();
  if (
    normalized === "local" ||
    normalized === "ci" ||
    normalized === "debug" ||
    normalized === "video" ||
    normalized === "headed"
  ) {
    return normalized;
  }
  return fallback;
}

function parsePanelMode(raw: string | undefined): E2EPanelMode | undefined {
  const normalized = raw?.toLowerCase();
  if (normalized === "overlay" || normalized === "sidepanel") return "overlay";
  if (normalized === "detached" || normalized === "popup") return "detached";
  if (
    normalized === "off" ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no"
  ) {
    return "off";
  }
  return undefined;
}

function warnDeprecated(
  warnings: string[],
  env: E2EEnv,
  name: string,
): string | undefined {
  const value = envValue(env, name);
  if (value === undefined) return undefined;
  warnings.push(
    `${name} is deprecated; use ${LEGACY_E2E_ENV_REPLACEMENTS[name]}.`,
  );
  return value;
}

function applyArtifactFlags(config: E2EConfig, flags: Set<string>): void {
  if (flags.size === 0) return;

  if (flags.has("none")) {
    config.artifacts.recordVideo = false;
    config.artifacts.finalScreenshot = false;
  }
  if (flags.has("video") || flags.has("mp4")) {
    config.artifacts.recordVideo = true;
    config.artifacts.finalScreenshot = true;
  }
  if (flags.has("no-video")) {
    config.artifacts.recordVideo = false;
  }
  if (flags.has("screenshots") || flags.has("screenshot")) {
    config.artifacts.finalScreenshot = true;
  }
  if (flags.has("no-screenshots") || flags.has("no-screenshot")) {
    config.artifacts.finalScreenshot = false;
  }
  if (flags.has("panel") || flags.has("overlay-panel")) {
    config.browser.panelMode = "overlay";
  }
  if (flags.has("detached-panel") || flags.has("popup-panel")) {
    config.browser.panelMode = "detached";
  }
  if (flags.has("no-panel") || flags.has("panel-off")) {
    config.browser.panelMode = "off";
  }
  if (flags.has("headless")) {
    config.browser.headless = true;
  }
  if (flags.has("headed")) {
    config.browser.headless = false;
  }
}

function buildConfigFromDefaults(profile: E2EProfileName): E2EConfig {
  const defaults = PROFILE_DEFAULTS[profile];
  return {
    profile,
    provider: defaults.provider,
    model: undefined,
    perceptionMode: undefined,
    suiteFlags: new Set(),
    diagnostic: defaults.diagnostic,
    browser: {
      headless: defaults.headless,
      singleProcess: defaults.singleProcess,
      panelMode: defaults.panelMode,
    },
    artifacts: {
      finalScreenshot: defaults.finalScreenshot,
      recordVideo: defaults.recordVideo,
      videoFrameIntervalMs: defaults.videoFrameIntervalMs,
      mediaToolTimeoutMs: defaults.mediaToolTimeoutMs,
      ffmpegPath: defaults.ffmpegPath,
      ffprobePath: defaults.ffprobePath,
    },
    runtime: {
      temperature: undefined,
    },
    deprecatedEnvWarnings: [],
  };
}

export function readE2EConfig(
  options: ReadE2EConfigOptions = {},
): E2EConfig {
  const env = options.env ?? process.env;
  const warnings: string[] = [];
  const profile = parseProfile(
    envValue(env, "E2E_PROFILE"),
    options.defaultProfile ?? "local",
  );
  const config = buildConfigFromDefaults(profile);

  config.provider = envValue(env, "E2E_PROVIDER")?.toLowerCase() ?? config.provider;
  config.model =
    envValue(env, "E2E_MODEL") ??
    warnDeprecated(warnings, env, "E2E_EXECUTOR_MODEL");
  config.perceptionMode = envValue(env, "E2E_PERCEPTION_MODE");

  const suiteFlags = parseFlagSet(envValue(env, "E2E_SUITE_FLAGS"));
  for (const flag of suiteFlags) applySuiteFlag(config.suiteFlags, flag);

  applyArtifactFlags(config, parseFlagSet(envValue(env, "E2E_ARTIFACTS")));

  const legacyHeadless = parseBoolean(
    warnDeprecated(warnings, env, "E2E_HEADLESS"),
  );
  if (legacyHeadless !== undefined) config.browser.headless = legacyHeadless;

  const legacySingleProcess = parseBoolean(
    warnDeprecated(warnings, env, "E2E_SINGLE_PROCESS"),
  );
  if (legacySingleProcess !== undefined) {
    config.browser.singleProcess = legacySingleProcess;
    if (legacySingleProcess) applySuiteFlag(config.suiteFlags, "single-process");
  }

  const legacyShowPanel = parseBoolean(
    warnDeprecated(warnings, env, "E2E_SHOW_PANEL"),
  );
  if (legacyShowPanel === false) {
    config.browser.panelMode = "off";
  } else if (legacyShowPanel === true && config.browser.panelMode === "off") {
    config.browser.panelMode = "overlay";
  }

  const legacyPanelMode = parsePanelMode(
    warnDeprecated(warnings, env, "E2E_PANEL_MODE"),
  );
  if (legacyPanelMode) config.browser.panelMode = legacyPanelMode;

  const legacyRecordVideo =
    parseBoolean(warnDeprecated(warnings, env, "E2E_RECORD_VIDEO")) ??
    parseBoolean(warnDeprecated(warnings, env, "E2E_VIDEO"));
  if (legacyRecordVideo !== undefined) {
    config.artifacts.recordVideo = legacyRecordVideo;
  }

  const legacyFinalScreenshot = parseBoolean(
    warnDeprecated(warnings, env, "E2E_FINAL_SCREENSHOT"),
  );
  if (legacyFinalScreenshot !== undefined) {
    config.artifacts.finalScreenshot = legacyFinalScreenshot;
  }

  const legacyFrameInterval = warnDeprecated(
    warnings,
    env,
    "E2E_VIDEO_FRAME_INTERVAL_MS",
  );
  if (legacyFrameInterval !== undefined) {
    config.artifacts.videoFrameIntervalMs = parsePositiveNumber(
      legacyFrameInterval,
      config.artifacts.videoFrameIntervalMs,
      250,
    );
  }

  const legacyMediaTimeout = warnDeprecated(
    warnings,
    env,
    "E2E_MEDIA_TOOL_TIMEOUT_MS",
  );
  if (legacyMediaTimeout !== undefined) {
    config.artifacts.mediaToolTimeoutMs = parsePositiveNumber(
      legacyMediaTimeout,
      config.artifacts.mediaToolTimeoutMs,
      1,
    );
  }

  config.artifacts.ffmpegPath =
    warnDeprecated(warnings, env, "E2E_FFMPEG_PATH") ??
    config.artifacts.ffmpegPath;
  config.artifacts.ffprobePath =
    warnDeprecated(warnings, env, "E2E_FFPROBE_PATH") ??
    config.artifacts.ffprobePath;

  const legacyTemperature = warnDeprecated(warnings, env, "E2E_TEMPERATURE");
  if (legacyTemperature !== undefined) {
    const parsed = Number(legacyTemperature);
    config.runtime.temperature = Number.isFinite(parsed) ? parsed : undefined;
  }

  const legacyUseVl = parseBoolean(
    warnDeprecated(warnings, env, "E2E_USE_VL_EXECUTOR"),
  );
  if (!config.perceptionMode && legacyUseVl) {
    config.perceptionMode = "unified_vl";
  }

  const legacyDiagnostic = parseBoolean(
    warnDeprecated(warnings, env, "E2E_DIAGNOSTIC"),
  );
  if (legacyDiagnostic !== undefined) {
    config.diagnostic = legacyDiagnostic;
    if (legacyDiagnostic) applySuiteFlag(config.suiteFlags, "diagnostic");
  }
  if (config.suiteFlags.has("diagnostic")) config.diagnostic = true;
  if (config.suiteFlags.has("no-diagnostic")) config.diagnostic = false;

  const legacyBackendDurable = parseBoolean(
    warnDeprecated(warnings, env, "E2E_BACKEND_DURABLE"),
  );
  if (legacyBackendDurable) applySuiteFlag(config.suiteFlags, "backend-durable");

  const legacyBackendProfile = parseBoolean(
    warnDeprecated(warnings, env, "E2E_BACKEND_PROFILE"),
  );
  if (legacyBackendProfile) applySuiteFlag(config.suiteFlags, "backend-profile");

  const legacyMemoryLong = parseBoolean(
    warnDeprecated(warnings, env, "E2E_MEMORY_LONG"),
  );
  if (legacyMemoryLong) applySuiteFlag(config.suiteFlags, "memory-long");

  config.deprecatedEnvWarnings = [...new Set(warnings)];
  return config;
}

export function isE2ESuiteFlagEnabled(
  flag: string,
  options: ReadE2EConfigOptions = {},
): boolean {
  return readE2EConfig(options).suiteFlags.has(normalizeFlag(flag));
}

export function serializeE2ESuiteFlags(config: E2EConfig): string {
  return [...config.suiteFlags].sort().join(",");
}

export function serializeE2EArtifacts(config: E2EConfig): string {
  const flags: string[] = [];
  flags.push(config.browser.headless ? "headless" : "headed");
  if (config.browser.panelMode === "overlay") flags.push("panel");
  if (config.browser.panelMode === "detached") flags.push("detached-panel");
  if (config.browser.panelMode === "off") flags.push("no-panel");
  if (config.artifacts.finalScreenshot) flags.push("screenshots");
  if (!config.artifacts.finalScreenshot) flags.push("no-screenshot");
  if (config.artifacts.recordVideo) flags.push("video");
  if (!config.artifacts.recordVideo) flags.push("no-video");
  return flags.join(",");
}

export function withE2EConfigEnv(
  env: NodeJS.ProcessEnv,
  config: E2EConfig,
): NodeJS.ProcessEnv {
  return {
    ...env,
    E2E_PROFILE: config.profile,
    E2E_PROVIDER: config.provider,
    ...(config.model ? { E2E_MODEL: config.model } : {}),
    ...(config.perceptionMode
      ? { E2E_PERCEPTION_MODE: config.perceptionMode }
      : {}),
    E2E_SUITE_FLAGS: serializeE2ESuiteFlags(config),
    E2E_ARTIFACTS: serializeE2EArtifacts(config),
  };
}
