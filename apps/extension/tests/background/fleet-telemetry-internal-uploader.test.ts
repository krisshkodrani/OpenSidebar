import { describe, expect, test, vi } from "vitest";
import {
  createInternalFleetTelemetryTransport,
  drainInternalFleetTelemetry,
  enqueueFleetTelemetry,
  loadFleetTelemetryQueue,
  saveFleetTelemetryConsent,
} from "../../src/background/telemetry";
import { createFakeStorageArea } from "../fakes/persistence";

const envelope = {
  schemaVersion: 1 as const,
  eventId: "00000000-0000-4000-8000-000000000010",
  extension: { version: "0.6.0", channel: "dev" as const },
  environment: { browserMajor: 140, osFamily: "windows" as const },
  runtime: {
    provider: "fireworks" as const,
    executorModel: "other" as const,
    plannerModel: "other" as const,
    judgeModel: "other" as const,
    taskShape: "unknown" as const,
  },
  execution: { plannerStepCount: 0, turnCount: 0, durationBucket: "under_1s" as const, toolCounts: {} },
  completion: { doneCallCount: 0, acceptedSource: "none" as const, rejectedDoneCount: 0, rejectionReasons: [], evidenceTypes: ["none" as const] },
  result: { outcome: "stopped" as const, terminalReason: "user_stopped" as const, errorCodes: ["user_abort" as const] },
};

describe("internal fleet telemetry uploader", () => {
  test("has no transport without an explicitly injected internal endpoint", () => {
    expect(createInternalFleetTelemetryTransport("")).toBeNull();
  });

  test("sends each accepted record anonymously and clears only after 202", async () => {
    const storage = createFakeStorageArea();
    await saveFleetTelemetryConsent(storage, true, 100);
    await enqueueFleetTelemetry(storage, envelope, 101);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));

    await expect(
      drainInternalFleetTelemetry(storage, {
        endpoint: "https://telemetry.example.test/v1/telemetry",
        fetchImpl,
        now: 102,
      }),
    ).resolves.toBe(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://telemetry.example.test/v1/telemetry",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(await loadFleetTelemetryQueue(storage, 102)).toEqual([]);
  });

  test("keeps queued records when the backend is unavailable", async () => {
    const storage = createFakeStorageArea();
    await saveFleetTelemetryConsent(storage, true, 100);
    await enqueueFleetTelemetry(storage, envelope, 101);

    await expect(
      drainInternalFleetTelemetry(storage, {
        endpoint: "https://telemetry.example.test/v1/telemetry",
        fetchImpl: async () => new Response(null, { status: 503 }),
        now: 102,
      }),
    ).rejects.toThrow("rejected (503)");
    expect(await loadFleetTelemetryQueue(storage, 102)).toHaveLength(1);
  });
});
