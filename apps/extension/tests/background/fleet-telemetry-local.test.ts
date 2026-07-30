import { describe, expect, test, vi } from "vitest";
import type { FleetTelemetryEnvelopeV1 } from "@observability-schema";
import {
  collectFleetTelemetryLocally,
  decideFleetTelemetrySampling,
  drainFleetTelemetryToTransport,
  enqueueFleetTelemetry,
  FLEET_TELEMETRY_CONSENT_STORAGE_KEY,
  FLEET_TELEMETRY_QUEUE_STORAGE_KEY,
  getFleetTelemetryInspectorSnapshot,
  loadFleetTelemetryConsent,
  loadFleetTelemetryQueue,
  saveFleetTelemetryConsent,
  setFleetTelemetryConsent,
} from "../../src/background/telemetry";
import { createFakeStorageArea } from "../fakes/persistence";

const BASE_ENVELOPE: FleetTelemetryEnvelopeV1 = {
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000000",
  extension: { version: "0.6.0", channel: "dev" },
  environment: { browserMajor: 140, osFamily: "linux" },
  runtime: {
    provider: "fireworks",
    executorModel: "other",
    plannerModel: "other",
    judgeModel: "other",
    taskShape: "single_interaction",
  },
  execution: {
    plannerStepCount: 1,
    turnCount: 2,
    durationBucket: "5s_to_15s",
    toolCounts: { click: { attempted: 1, failed: 0 } },
  },
  completion: {
    doneCallCount: 1,
    acceptedSource: "model_done",
    rejectedDoneCount: 0,
    rejectionReasons: [],
    evidenceTypes: ["target_state_observed"],
  },
  result: {
    outcome: "completed",
    terminalReason: "completion_accepted",
    errorCodes: [],
  },
};

function envelope(sequence: number): FleetTelemetryEnvelopeV1 {
  return {
    ...BASE_ENVELOPE,
    eventId: `00000000-0000-4000-8000-${sequence
      .toString()
      .padStart(12, "0")}`,
  };
}

describe("fleet telemetry local consent and collection", () => {
  test("defaults off and does not sample or project without consent", async () => {
    const storage = createFakeStorageArea();
    const random = vi.fn(() => 0);
    const project = vi.fn(() => BASE_ENVELOPE);

    const result = await collectFleetTelemetryLocally({
      storage,
      random,
      project,
    });

    expect(result).toEqual({
      collect: false,
      reason: "consent_unset",
    });
    expect(random).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(storage.store.has(FLEET_TELEMETRY_QUEUE_STORAGE_KEY)).toBe(false);
  });

  test("treats a prior disclosure version as stale until renewed", async () => {
    const storage = createFakeStorageArea();
    await storage.set({
      [FLEET_TELEMETRY_CONSENT_STORAGE_KEY]: {
        disclosureVersion: 0,
        enabled: true,
        decidedAt: 100,
      },
    });

    expect(await loadFleetTelemetryConsent(storage)).toMatchObject({
      status: "stale",
    });
    expect(
      decideFleetTelemetrySampling(
        await loadFleetTelemetryConsent(storage),
        () => 0,
      ),
    ).toEqual({ collect: false, reason: "consent_stale" });
  });

  test("samples independently and queues only a passing session", async () => {
    const storage = createFakeStorageArea();
    await saveFleetTelemetryConsent(storage, true, 100);
    const skippedProjection = vi.fn(() => envelope(1));

    expect(
      await collectFleetTelemetryLocally({
        storage,
        project: skippedProjection,
        random: () => 0.05,
        now: 200,
      }),
    ).toEqual({ collect: false, reason: "not_sampled" });
    expect(skippedProjection).not.toHaveBeenCalled();

    const acceptedProjection = vi.fn(() => envelope(2));
    expect(
      await collectFleetTelemetryLocally({
        storage,
        project: acceptedProjection,
        random: () => 0.049,
        now: 201,
      }),
    ).toEqual({ collect: true, reason: "queued" });
    expect(acceptedProjection).toHaveBeenCalledOnce();
    expect(await loadFleetTelemetryQueue(storage, 201)).toHaveLength(1);
  });

  test("bounds the queue by record count, bytes, and age", async () => {
    const storage = createFakeStorageArea();
    const limits = {
      maxRecords: 2,
      maxBytes: 512 * 1_024,
      maxAgeMs: 1_000,
    };

    await enqueueFleetTelemetry(storage, envelope(1), 100, limits);
    await enqueueFleetTelemetry(storage, envelope(2), 200, limits);
    const result = await enqueueFleetTelemetry(
      storage,
      envelope(3),
      300,
      limits,
    );
    expect(result.queue.map((item) => item.envelope.eventId)).toEqual([
      envelope(2).eventId,
      envelope(3).eventId,
    ]);

    expect(
      (
        await enqueueFleetTelemetry(storage, envelope(4), 400, {
          ...limits,
          maxBytes: 1,
        })
      ).stored,
    ).toBe(false);

    await storage.set({
      [FLEET_TELEMETRY_QUEUE_STORAGE_KEY]: [
        { envelope: envelope(5), queuedAt: 100, attemptCount: 0 },
      ],
    });
    expect(await loadFleetTelemetryQueue(storage, 1_101, limits)).toEqual([]);
  });

  test("opt-out immediately clears queued and inspector payload data", async () => {
    const storage = createFakeStorageArea();
    await setFleetTelemetryConsent(storage, true, 100);
    await enqueueFleetTelemetry(storage, envelope(1), 200);
    expect(
      await getFleetTelemetryInspectorSnapshot(storage, 200),
    ).toMatchObject({
      queuedCount: 1,
      lastPayload: { eventId: envelope(1).eventId },
    });

    await setFleetTelemetryConsent(storage, false, 300);

    expect(
      await getFleetTelemetryInspectorSnapshot(storage, 300),
    ).toMatchObject({
      consent: { status: "disabled" },
      queuedCount: 0,
      lastPayload: null,
    });
  });

  test("the test-double transport cannot receive data before valid consent", async () => {
    const storage = createFakeStorageArea();
    await enqueueFleetTelemetry(storage, envelope(1), 100);
    const transport = { send: vi.fn(async () => {}) };

    expect(
      await drainFleetTelemetryToTransport(storage, transport, 100),
    ).toBe(0);
    expect(transport.send).not.toHaveBeenCalled();
    expect(await loadFleetTelemetryQueue(storage, 100)).toEqual([]);

    await saveFleetTelemetryConsent(storage, true, 101);
    await enqueueFleetTelemetry(storage, envelope(1), 101);
    expect(
      await drainFleetTelemetryToTransport(storage, transport, 101),
    ).toBe(1);
    expect(transport.send).toHaveBeenCalledWith([envelope(1)]);
  });
});
