import type { FleetTelemetryEnvelopeV1 } from "@observability-schema";
import type { FleetTelemetryStorageArea } from "../../utils/fleet-telemetry";
import {
  drainFleetTelemetryToTransport,
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
    async send(envelopes: readonly FleetTelemetryEnvelopeV1[]): Promise<void> {
      for (const envelope of envelopes) {
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
            throw new Error(`Fleet telemetry ingest rejected (${response.status})`);
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    },
  };
}

/** Best-effort MV3 recovery drain. Rejections leave the bounded queue intact. */
export async function drainInternalFleetTelemetry(
  storage: FleetTelemetryStorageArea,
  options: {
    endpoint?: string;
    fetchImpl?: FleetFetch;
    now?: number;
  } = {},
): Promise<number> {
  const transport = createInternalFleetTelemetryTransport(
    options.endpoint,
    options.fetchImpl,
  );
  if (!transport) return 0;
  return drainFleetTelemetryToTransport(storage, transport, options.now);
}
