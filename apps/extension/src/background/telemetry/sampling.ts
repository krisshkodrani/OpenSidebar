import type { FleetTelemetryConsentState } from "../../utils/fleet-telemetry";

export const DEFAULT_FLEET_TELEMETRY_SAMPLE_RATE = 0.05;

export type FleetTelemetrySamplingDecision =
  | { collect: true; reason: "sampled" }
  | {
      collect: false;
      reason:
        | "consent_unset"
        | "consent_disabled"
        | "consent_stale"
        | "not_sampled";
    };

/**
 * Decide independently for one session. The random value is supplied by the
 * caller so tests are deterministic and no persistent sampling seed is needed.
 */
export function decideFleetTelemetrySampling(
  consent: FleetTelemetryConsentState,
  randomValue: () => number,
  sampleRate = DEFAULT_FLEET_TELEMETRY_SAMPLE_RATE,
): FleetTelemetrySamplingDecision {
  if (consent.status !== "enabled") {
    return {
      collect: false,
      reason:
        consent.status === "unset"
          ? "consent_unset"
          : consent.status === "stale"
            ? "consent_stale"
            : "consent_disabled",
    };
  }

  const normalizedRate = Number.isFinite(sampleRate)
    ? Math.min(1, Math.max(0, sampleRate))
    : 0;
  const value = randomValue();
  return value >= 0 && value < normalizedRate
    ? { collect: true, reason: "sampled" }
    : { collect: false, reason: "not_sampled" };
}
