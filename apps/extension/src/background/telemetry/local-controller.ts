import type { FleetTelemetryEnvelopeV1 } from "@observability-schema";
import {
  clearLocalFleetTelemetry,
  enqueueFleetTelemetry,
  loadFleetTelemetryConsent,
  loadFleetTelemetryQueue,
  loadLastFleetTelemetryPayload,
  recordFleetTelemetryDeliveryFailure,
  removeFleetTelemetryRecords,
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
    const decision = decideFleetTelemetrySampling(consent, random, sampleRate);
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

export interface FleetTelemetryTransport {
  send(envelope: FleetTelemetryEnvelopeV1): Promise<void>;
}

export interface FleetTelemetryRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_FLEET_TELEMETRY_RETRY_POLICY: FleetTelemetryRetryPolicy = {
  maxAttempts: 6,
  baseDelayMs: 60_000,
  maxDelayMs: 60 * 60_000,
};

export interface FleetTelemetryDrainResult {
  attempted: number;
  delivered: number;
  dropped: number;
  remaining: number;
}

export function getFleetTelemetryRetryDelayMs(
  failedAttemptCount: number,
  random = Math.random,
  policy = DEFAULT_FLEET_TELEMETRY_RETRY_POLICY,
): number {
  const exponent = Math.min(30, Math.max(0, failedAttemptCount - 1));
  const baseDelayMs = finiteNonNegative(
    policy.baseDelayMs,
    DEFAULT_FLEET_TELEMETRY_RETRY_POLICY.baseDelayMs,
  );
  const maxDelayMs = finiteNonNegative(
    policy.maxDelayMs,
    DEFAULT_FLEET_TELEMETRY_RETRY_POLICY.maxDelayMs,
  );
  const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const randomValue = random();
  const boundedRandom = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0.5;
  const jitter = 0.5 + 0.5 * boundedRandom;
  return Math.floor(backoffMs * jitter);
}

export async function drainFleetTelemetryToTransport(
  storage: FleetTelemetryStorageArea,
  transport: FleetTelemetryTransport,
  options: {
    now?: number;
    random?: () => number;
    retryPolicy?: FleetTelemetryRetryPolicy;
  } = {},
): Promise<FleetTelemetryDrainResult> {
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random;
  const retryPolicy =
    options.retryPolicy ?? DEFAULT_FLEET_TELEMETRY_RETRY_POLICY;
  const result: FleetTelemetryDrainResult = {
    attempted: 0,
    delivered: 0,
    dropped: 0,
    remaining: 0,
  };

  try {
    const consent = await loadFleetTelemetryConsent(storage);
    if (consent.status !== "enabled") {
      await clearLocalFleetTelemetry(storage);
      return result;
    }

    let queue = await loadFleetTelemetryQueue(storage, now);
    result.remaining = queue.length;
    while (queue.length > 0) {
      result.remaining = queue.length;
      const record = queue[0];
      if (record.nextAttemptAt > now) return result;

      result.attempted += 1;
      try {
        await transport.send(record.envelope);
        result.delivered += 1;
        await removeFleetTelemetryRecords(
          storage,
          [record.envelope.eventId],
          now,
        );
      } catch {
        const failedAttemptCount = record.attemptCount + 1;
        const delayMs = getFleetTelemetryRetryDelayMs(
          failedAttemptCount,
          random,
          retryPolicy,
        );
        const failure = await recordFleetTelemetryDeliveryFailure(
          storage,
          record.envelope.eventId,
          now + delayMs,
          finitePositiveInteger(
            retryPolicy.maxAttempts,
            DEFAULT_FLEET_TELEMETRY_RETRY_POLICY.maxAttempts,
          ),
          now,
        );
        if (failure.outcome === "dropped") result.dropped += 1;
        result.remaining = failure.remaining;
        return result;
      }

      queue = await loadFleetTelemetryQueue(storage, now);
    }
    result.remaining = 0;
    return result;
  } catch {
    return result;
  }
}

function finiteNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function finitePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}
