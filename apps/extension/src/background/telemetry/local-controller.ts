import type { FleetTelemetryEnvelopeV1 } from "@observability-schema";
import {
  clearLocalFleetTelemetry,
  enqueueFleetTelemetry,
  FLEET_TELEMETRY_QUEUE_STORAGE_KEY,
  loadFleetTelemetryConsent,
  loadFleetTelemetryQueue,
  loadLastFleetTelemetryPayload,
  saveFleetTelemetryConsent,
  type FleetTelemetryStorageArea,
} from "../../utils/fleet-telemetry";
import {
  decideFleetTelemetrySampling,
  type FleetTelemetrySamplingDecision,
} from "./sampling";

export type FleetTelemetryCollectionResult =
  | FleetTelemetrySamplingDecision
  | { collect: false; reason: "invalid_payload" | "storage_error" }
  | { collect: true; reason: "queued" };

/**
 * Project and queue one completed session only after current consent and the
 * session-level sample gate pass. Failures are deliberately swallowed so
 * telemetry can never change the task outcome.
 */
export async function collectFleetTelemetryLocally({
  storage,
  project,
  random = Math.random,
  sampleRate,
  now = Date.now(),
}: {
  storage: FleetTelemetryStorageArea;
  project: () => FleetTelemetryEnvelopeV1;
  random?: () => number;
  sampleRate?: number;
  now?: number;
}): Promise<FleetTelemetryCollectionResult> {
  try {
    const consent = await loadFleetTelemetryConsent(storage);
    if (consent.status !== "enabled") {
      await clearLocalFleetTelemetry(storage);
    }
    const decision = decideFleetTelemetrySampling(
      consent,
      random,
      sampleRate,
    );
    if (!decision.collect) return decision;

    const queued = await enqueueFleetTelemetry(storage, project(), now);
    return queued.stored
      ? { collect: true, reason: "queued" }
      : { collect: false, reason: "invalid_payload" };
  } catch {
    return { collect: false, reason: "storage_error" };
  }
}

export async function setFleetTelemetryConsent(
  storage: FleetTelemetryStorageArea,
  enabled: boolean,
  decidedAt = Date.now(),
): Promise<void> {
  await saveFleetTelemetryConsent(storage, enabled, decidedAt);
  if (!enabled) await clearLocalFleetTelemetry(storage);
}

export async function getFleetTelemetryInspectorSnapshot(
  storage: FleetTelemetryStorageArea,
  now = Date.now(),
): Promise<{
  consent: Awaited<ReturnType<typeof loadFleetTelemetryConsent>>;
  queuedCount: number;
  lastPayload: FleetTelemetryEnvelopeV1 | null;
}> {
  const [consent, queue, lastPayload] = await Promise.all([
    loadFleetTelemetryConsent(storage),
    loadFleetTelemetryQueue(storage, now),
    loadLastFleetTelemetryPayload(storage, now),
  ]);
  return {
    consent,
    queuedCount: queue.length,
    lastPayload: lastPayload?.envelope ?? null,
  };
}

/**
 * Transport boundary for Phase 2 tests. There is intentionally no production
 * implementation and no runtime caller until a later, separately gated phase.
 */
export interface FleetTelemetryTransport {
  send(envelopes: readonly FleetTelemetryEnvelopeV1[]): Promise<void>;
}

export async function drainFleetTelemetryToTransport(
  storage: FleetTelemetryStorageArea,
  transport: FleetTelemetryTransport,
  now = Date.now(),
): Promise<number> {
  const consent = await loadFleetTelemetryConsent(storage);
  if (consent.status !== "enabled") {
    await clearLocalFleetTelemetry(storage);
    return 0;
  }
  const queue = await loadFleetTelemetryQueue(storage, now);
  if (queue.length === 0) return 0;
  await transport.send(queue.map((record) => record.envelope));
  await storage.set({ [FLEET_TELEMETRY_QUEUE_STORAGE_KEY]: [] });
  return queue.length;
}
