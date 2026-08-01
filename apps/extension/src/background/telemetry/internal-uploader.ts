import type { FleetTelemetryEnvelopeV1 } from "@observability-schema";
import {
  loadFleetTelemetryQueue,
  type FleetTelemetryStorageArea,
} from "../../utils/fleet-telemetry";
import {
  drainFleetTelemetryToTransport,
  type FleetTelemetryDrainResult,
  type FleetTelemetryRetryPolicy,
  type FleetTelemetryTransport,
} from "./local-controller";

const REQUEST_TIMEOUT_MS = 5_000;

export type FleetFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The endpoint is injected only by `vite build --mode internal`. Published and
 * ordinary development builds receive an empty string, so they have no upload
 * destination and cannot issue telemetry network requests.
 */
export function getInternalFleetTelemetryEndpoint(): string {
  return typeof __FLEET_TELEMETRY_INTERNAL_ENDPOINT__ === "string"
    ? __FLEET_TELEMETRY_INTERNAL_ENDPOINT__.trim()
    : "";
}

export function createInternalFleetTelemetryTransport(
  endpoint = getInternalFleetTelemetryEndpoint(),
  fetchImpl: FleetFetch = fetch,
): FleetTelemetryTransport | null {
  if (!endpoint) return null;
  return {
    async send(envelope: FleetTelemetryEnvelopeV1): Promise<void> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope),
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status !== 202) {
          throw new Error(
            `Fleet telemetry ingest rejected (${response.status})`,
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

const EMPTY_DRAIN_RESULT: FleetTelemetryDrainResult = {
  attempted: 0,
  delivered: 0,
  dropped: 0,
  remaining: 0,
};

/** Best-effort MV3 recovery drain. Delivery failures never escape to callers. */
export async function drainInternalFleetTelemetry(
  storage: FleetTelemetryStorageArea,
  options: {
    endpoint?: string;
    fetchImpl?: FleetFetch;
    now?: number;
    random?: () => number;
    retryPolicy?: FleetTelemetryRetryPolicy;
  } = {},
): Promise<FleetTelemetryDrainResult> {
  const transport = createInternalFleetTelemetryTransport(
    options.endpoint,
    options.fetchImpl,
  );
  if (!transport) {
    try {
      const queue = await loadFleetTelemetryQueue(storage, options.now);
      return { ...EMPTY_DRAIN_RESULT, remaining: queue.length };
    } catch {
      return { ...EMPTY_DRAIN_RESULT };
    }
  }
  return drainFleetTelemetryToTransport(storage, transport, {
    now: options.now,
    random: options.random,
    retryPolicy: options.retryPolicy,
  });
}
