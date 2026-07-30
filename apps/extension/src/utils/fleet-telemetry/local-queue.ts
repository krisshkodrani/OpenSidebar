import {
  isFleetTelemetryEnvelopeV1,
  type FleetTelemetryEnvelopeV1,
} from "@observability-schema";
import type { FleetTelemetryStorageArea } from "./consent";

export const FLEET_TELEMETRY_QUEUE_STORAGE_KEY =
  "opensidebar:fleet-telemetry-queue:v1";
export const FLEET_TELEMETRY_LAST_PAYLOAD_STORAGE_KEY =
  "opensidebar:fleet-telemetry-last-payload:v1";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface FleetTelemetryQueueLimits {
  maxRecords: number;
  maxBytes: number;
  maxAgeMs: number;
}

export const DEFAULT_FLEET_TELEMETRY_QUEUE_LIMITS: FleetTelemetryQueueLimits = {
  maxRecords: 20,
  maxBytes: 512 * 1_024,
  maxAgeMs: 7 * DAY_MS,
};

export interface FleetTelemetryQueueRecord {
  envelope: FleetTelemetryEnvelopeV1;
  queuedAt: number;
  attemptCount: number;
}

export interface FleetTelemetryLastPayload {
  envelope: FleetTelemetryEnvelopeV1;
  generatedAt: number;
}

export async function loadFleetTelemetryQueue(
  storage: FleetTelemetryStorageArea,
  now = Date.now(),
  limits = DEFAULT_FLEET_TELEMETRY_QUEUE_LIMITS,
): Promise<FleetTelemetryQueueRecord[]> {
  const stored = await storage.get(FLEET_TELEMETRY_QUEUE_STORAGE_KEY);
  const value = stored[FLEET_TELEMETRY_QUEUE_STORAGE_KEY];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    await storage.set({ [FLEET_TELEMETRY_QUEUE_STORAGE_KEY]: [] });
    return [];
  }
  const queue = boundQueue(value.filter(isQueueRecord), now, limits);
  if (JSON.stringify(queue) !== JSON.stringify(value)) {
    await storage.set({ [FLEET_TELEMETRY_QUEUE_STORAGE_KEY]: queue });
  }
  return queue;
}

export async function enqueueFleetTelemetry(
  storage: FleetTelemetryStorageArea,
  envelope: FleetTelemetryEnvelopeV1,
  now = Date.now(),
  limits = DEFAULT_FLEET_TELEMETRY_QUEUE_LIMITS,
): Promise<{ stored: boolean; queue: FleetTelemetryQueueRecord[] }> {
  if (!isFleetTelemetryEnvelopeV1(envelope)) {
    return {
      stored: false,
      queue: await loadFleetTelemetryQueue(storage, now, limits),
    };
  }

  const current = await loadFleetTelemetryQueue(storage, now, limits);
  const withoutDuplicate = current.filter(
    (record) => record.envelope.eventId !== envelope.eventId,
  );
  const queue = boundQueue(
    [
      ...withoutDuplicate,
      { envelope, queuedAt: now, attemptCount: 0 },
    ],
    now,
    limits,
  );
  const stored = queue.some(
    (record) => record.envelope.eventId === envelope.eventId,
  );

  await storage.set({
    [FLEET_TELEMETRY_QUEUE_STORAGE_KEY]: queue,
    [FLEET_TELEMETRY_LAST_PAYLOAD_STORAGE_KEY]: {
      envelope,
      generatedAt: now,
    } satisfies FleetTelemetryLastPayload,
  });
  return { stored, queue };
}

export async function loadLastFleetTelemetryPayload(
  storage: FleetTelemetryStorageArea,
  now = Date.now(),
  maxAgeMs = DEFAULT_FLEET_TELEMETRY_QUEUE_LIMITS.maxAgeMs,
): Promise<FleetTelemetryLastPayload | null> {
  const stored = await storage.get(FLEET_TELEMETRY_LAST_PAYLOAD_STORAGE_KEY);
  const value = stored[FLEET_TELEMETRY_LAST_PAYLOAD_STORAGE_KEY];
  if (value === undefined) return null;
  if (
    !isLastPayload(value) ||
    value.generatedAt > now ||
    now - value.generatedAt > maxAgeMs
  ) {
    await storage.remove(FLEET_TELEMETRY_LAST_PAYLOAD_STORAGE_KEY);
    return null;
  }
  return value;
}

export async function removeFleetTelemetryRecords(
  storage: FleetTelemetryStorageArea,
  eventIds: readonly string[],
  now = Date.now(),
): Promise<void> {
  const removed = new Set(eventIds);
  const queue = (await loadFleetTelemetryQueue(storage, now)).filter(
    (record) => !removed.has(record.envelope.eventId),
  );
  await storage.set({ [FLEET_TELEMETRY_QUEUE_STORAGE_KEY]: queue });
}

export async function clearLocalFleetTelemetry(
  storage: FleetTelemetryStorageArea,
): Promise<void> {
  await storage.remove([
    FLEET_TELEMETRY_QUEUE_STORAGE_KEY,
    FLEET_TELEMETRY_LAST_PAYLOAD_STORAGE_KEY,
  ]);
}

function boundQueue(
  records: FleetTelemetryQueueRecord[],
  now: number,
  limits: FleetTelemetryQueueLimits,
): FleetTelemetryQueueRecord[] {
  const maxRecords = Math.max(0, Math.floor(limits.maxRecords));
  const maxBytes = Math.max(0, Math.floor(limits.maxBytes));
  const maxAgeMs = Math.max(0, limits.maxAgeMs);
  const fresh = records.filter(
    (record) =>
      record.queuedAt <= now && now - record.queuedAt <= maxAgeMs,
  );
  const bounded = maxRecords === 0 ? [] : fresh.slice(-maxRecords);

  while (bounded.length > 0 && serializedBytes(bounded) > maxBytes) {
    bounded.shift();
  }
  return bounded;
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isQueueRecord(value: unknown): value is FleetTelemetryQueueRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    isFleetTelemetryEnvelopeV1(record.envelope) &&
    typeof record.queuedAt === "number" &&
    Number.isFinite(record.queuedAt) &&
    record.queuedAt >= 0 &&
    Number.isInteger(record.attemptCount) &&
    (record.attemptCount as number) >= 0
  );
}

function isLastPayload(value: unknown): value is FleetTelemetryLastPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    isFleetTelemetryEnvelopeV1(record.envelope) &&
    typeof record.generatedAt === "number" &&
    Number.isFinite(record.generatedAt) &&
    record.generatedAt >= 0
  );
}
