import type { TaskRunProgressInput } from "@shared-types/progress";

export function getFleetTelemetryRuntimeContext(): {
  eventId: string;
  extensionVersion: string;
  extensionChannel: "stable" | "dev";
  browserMajor: number;
  osFamily: string;
} {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browserMajor = Number(
    /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent)?.[1] ?? 0,
  );
  const lowerUserAgent = userAgent.toLowerCase();
  const osFamily = lowerUserAgent.includes("windows")
    ? "windows"
    : lowerUserAgent.includes("mac os")
      ? "macos"
      : lowerUserAgent.includes("cros")
        ? "chromeos"
        : lowerUserAgent.includes("linux")
          ? "linux"
          : "other";
  return {
    eventId: crypto.randomUUID(),
    extensionVersion: chrome.runtime.getManifest().version,
    extensionChannel: __DEV__ ? "dev" : "stable",
    browserMajor,
    osFamily,
  };
}

export function cloneStructuredProgress(
  progress: Record<string, TaskRunProgressInput> | undefined,
): Record<string, TaskRunProgressInput> | undefined {
  if (!progress) return undefined;
  const entries = Object.entries(progress).map(([key, value]) => [
    key,
    JSON.parse(JSON.stringify(value)) as TaskRunProgressInput,
  ]);
  return Object.fromEntries(entries);
}
