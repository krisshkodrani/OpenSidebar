import type { FleetTelemetryEnvelopeV1 } from "@observability-schema";
import {
  clearLocalFleetTelemetry,
  loadFleetTelemetryConsent,
  loadFleetTelemetryQueue,
  loadLastFleetTelemetryPayload,
  saveFleetTelemetryConsent,
} from "../utils/fleet-telemetry";
import { uiRuntime } from "./runtime";

export async function getFleetTelemetrySettingsSnapshot(
  now = Date.now(),
): Promise<{
  enabled: boolean;
  requiresRenewal: boolean;
  queuedCount: number;
  lastPayload: FleetTelemetryEnvelopeV1 | null;
}> {
  const storage = uiRuntime.storage.local;
  const consent = await loadFleetTelemetryConsent(storage);
  if (consent.status !== "enabled") {
    await clearLocalFleetTelemetry(storage);
    return {
      enabled: false,
      requiresRenewal: consent.status === "stale",
      queuedCount: 0,
      lastPayload: null,
    };
  }
  const [queue, lastPayload] = await Promise.all([
    loadFleetTelemetryQueue(storage, now),
    loadLastFleetTelemetryPayload(storage, now),
  ]);
  return {
    enabled: true,
    requiresRenewal: false,
    queuedCount: queue.length,
    lastPayload: lastPayload?.envelope ?? null,
  };
}

export async function updateFleetTelemetryConsent(
  enabled: boolean,
  decidedAt = Date.now(),
): Promise<void> {
  const storage = uiRuntime.storage.local;
  await saveFleetTelemetryConsent(storage, enabled, decidedAt);
  if (!enabled) await clearLocalFleetTelemetry(storage);
}

export async function clearFleetTelemetrySettingsData(): Promise<void> {
  await clearLocalFleetTelemetry(uiRuntime.storage.local);
}
