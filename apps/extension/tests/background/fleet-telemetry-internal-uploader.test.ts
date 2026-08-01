import { describe, expect, test, vi } from "vitest";
import type { FleetTelemetryEnvelopeV1 } from "@observability-schema";
import {
  createInternalFleetTelemetryTransport,
  drainInternalFleetTelemetry,
  enqueueFleetTelemetry,
  FLEET_TELEMETRY_QUEUE_STORAGE_KEY,
  getFleetTelemetryRetryDelayMs,
  loadFleetTelemetryQueue,
  saveFleetTelemetryConsent,
} from "../../src/background/telemetry";
import { createFakeStorageArea } from "../fakes/persistence";

const BASE_ENVELOPE: FleetTelemetryEnvelopeV1 = {
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000010",
  extension: { version: "0.6.0", channel: "dev" },
  environment: { browserMajor: 140, osFamily: "windows" },
  runtime: {
    provider: "fireworks",
    executorModel: "other",
    plannerModel: "other",
    judgeModel: "other",
    taskShape: "unknown",
  },
  execution: {
    plannerStepCount: 0,
    turnCount: 0,
    durationBucket: "under_1s",
    toolCounts: {},
  },
  completion: {
    doneCallCount: 0,
    acceptedSource: "none",
    rejectedDoneCount: 0,
    rejectionReasons: [],
    evidenceTypes: ["none"],
  },
  result: {
    outcome: "stopped",
    terminalReason: "user_stopped",
    errorCodes: ["user_abort"],
  },
};

function envelope(sequence: number): FleetTelemetryEnvelopeV1 {
  return {
    ...BASE_ENVELOPE,
    eventId: `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
  };
}

describe("internal fleet telemetry uploader", () => {
  test("has no transport without an explicitly injected internal endpoint", async () => {
    expect(createInternalFleetTelemetryTransport("")).toBeNull();

    const storage = createFakeStorageArea();
    await saveFleetTelemetryConsent(storage, true, 100);
    await enqueueFleetTelemetry(storage, envelope(1), 101);
    await expect(
      drainInternalFleetTelemetry(storage, { now: 102 }),
    ).resolves.toEqual({
      attempted: 0,
      delivered: 0,
      dropped: 0,
      remaining: 1,
    });
  });

  test("sends each accepted record anonymously and removes it after 202", async () => {
    const storage = createFakeStorageArea();
    await saveFleetTelemetryConsent(storage, true, 100);
    await enqueueFleetTelemetry(storage, envelope(1), 101);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));

    await expect(
      drainInternalFleetTelemetry(storage, {
        endpoint: "https://telemetry.example.test/v1/telemetry",
        fetchImpl,
        now: 102,
      }),
    ).resolves.toEqual({
      attempted: 1,
      delivered: 1,
      dropped: 0,
      remaining: 0,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://telemetry.example.test/v1/telemetry",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(envelope(1)),
      }),
    );
    expect(await loadFleetTelemetryQueue(storage, 102)).toEqual([]);
  });

  test("keeps partial progress and persists backoff across worker restarts", async () => {
    const storage = createFakeStorageArea();
    await saveFleetTelemetryConsent(storage, true, 100);
    await enqueueFleetTelemetry(storage, envelope(1), 101);
    await enqueueFleetTelemetry(storage, envelope(2), 102);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(
      drainInternalFleetTelemetry(storage, {
        endpoint: "https://telemetry.example.test/v1/telemetry",
        fetchImpl,
        now: 200,
        random: () => 0,
      }),
    ).resolves.toEqual({
      attempted: 2,
      delivered: 1,
      dropped: 0,
      remaining: 1,
    });
    expect(await loadFleetTelemetryQueue(storage, 200)).toEqual([
      expect.objectContaining({
        envelope: envelope(2),
        attemptCount: 1,
        nextAttemptAt: 30_200,
      }),
    ]);

    await expect(
      drainInternalFleetTelemetry(storage, {
        endpoint: "https://telemetry.example.test/v1/telemetry",
        fetchImpl,
        now: 30_199,
      }),
    ).resolves.toEqual({
      attempted: 0,
      delivered: 0,
      dropped: 0,
      remaining: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await expect(
      drainInternalFleetTelemetry(storage, {
        endpoint: "https://telemetry.example.test/v1/telemetry",
        fetchImpl,
        now: 30_200,
      }),
    ).resolves.toEqual({
      attempted: 1,
      delivered: 1,
      dropped: 0,
      remaining: 0,
    });
    expect(await loadFleetTelemetryQueue(storage, 30_200)).toEqual([]);
  });

  test("preserves a record enqueued while an earlier upload is in flight", async () => {
    const storage = createFakeStorageArea();
    await saveFleetTelemetryConsent(storage, true, 100);
    await enqueueFleetTelemetry(storage, envelope(1), 101);
    let acceptFirst: ((response: Response) => void) | undefined;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            acceptFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    const drain = drainInternalFleetTelemetry(storage, {
      endpoint: "https://telemetry.example.test/v1/telemetry",
      fetchImpl,
      now: 200,
      random: () => 0,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await enqueueFleetTelemetry(storage, envelope(2), 150);
    acceptFirst?.(new Response(null, { status: 202 }));

    await expect(drain).resolves.toEqual({
      attempted: 2,
      delivered: 1,
      dropped: 0,
      remaining: 1,
    });
    expect(await loadFleetTelemetryQueue(storage, 200)).toEqual([
      expect.objectContaining({ envelope: envelope(2), attemptCount: 1 }),
    ]);
  });

  test("drops a record after its sixth failed delivery without rejecting", async () => {
    const storage = createFakeStorageArea();
    await saveFleetTelemetryConsent(storage, true, 100);
    await enqueueFleetTelemetry(storage, envelope(1), 101);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    let now = 102;

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const result = await drainInternalFleetTelemetry(storage, {
        endpoint: "https://telemetry.example.test/v1/telemetry",
        fetchImpl,
        now,
        random: () => 0,
      });
      expect(result.attempted).toBe(1);
      if (attempt < 6) {
        expect(result).toMatchObject({
          delivered: 0,
          dropped: 0,
          remaining: 1,
        });
        now = (await loadFleetTelemetryQueue(storage, now))[0].nextAttemptAt;
      } else {
        expect(result).toEqual({
          attempted: 1,
          delivered: 0,
          dropped: 1,
          remaining: 0,
        });
      }
    }

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(await loadFleetTelemetryQueue(storage, now)).toEqual([]);
  });

  test("normalizes legacy queue records as immediately eligible", async () => {
    const storage = createFakeStorageArea();
    await storage.set({
      [FLEET_TELEMETRY_QUEUE_STORAGE_KEY]: [
        { envelope: envelope(1), queuedAt: 100, attemptCount: 2 },
      ],
    });

    expect(await loadFleetTelemetryQueue(storage, 200)).toEqual([
      {
        envelope: envelope(1),
        queuedAt: 100,
        attemptCount: 2,
        nextAttemptAt: 100,
      },
    ]);
  });

  test("uses equal jitter and caps exponential retry delays at one hour", () => {
    expect(getFleetTelemetryRetryDelayMs(1, () => 0)).toBe(30_000);
    expect(getFleetTelemetryRetryDelayMs(1, () => 1)).toBe(60_000);
    expect(getFleetTelemetryRetryDelayMs(8, () => 1)).toBe(3_600_000);
  });

  test("turns a timed-out request into a deferred retry", async () => {
    vi.useFakeTimers();
    try {
      const storage = createFakeStorageArea();
      await saveFleetTelemetryConsent(storage, true, 100);
      await enqueueFleetTelemetry(storage, envelope(1), 101);
      const fetchImpl = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );

      const drain = drainInternalFleetTelemetry(storage, {
        endpoint: "https://telemetry.example.test/v1/telemetry",
        fetchImpl,
        now: 200,
        random: () => 0,
      });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(drain).resolves.toEqual({
        attempted: 1,
        delivered: 0,
        dropped: 0,
        remaining: 1,
      });
      expect(await loadFleetTelemetryQueue(storage, 200)).toEqual([
        expect.objectContaining({ attemptCount: 1, nextAttemptAt: 30_200 }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
