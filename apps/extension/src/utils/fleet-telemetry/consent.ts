/**
 * Versioned, installation-local consent for fleet telemetry (RFC LP-25).
 *
 * Consent is deliberately separate from UserSettings because those settings
 * are synced. Enabling telemetry on one browser installation must not enable
 * it on another.
 */

export const FLEET_TELEMETRY_DISCLOSURE_VERSION = 1 as const;
export const FLEET_TELEMETRY_CONSENT_STORAGE_KEY =
  "opensidebar:fleet-telemetry-consent";

export interface FleetTelemetryStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface FleetTelemetryConsentRecord {
  disclosureVersion: number;
  enabled: boolean;
  decidedAt: number;
}

export type FleetTelemetryConsentState =
  | { status: "unset" }
  | { status: "stale"; record: FleetTelemetryConsentRecord }
  | { status: "enabled"; record: FleetTelemetryConsentRecord }
  | { status: "disabled"; record: FleetTelemetryConsentRecord };

export function evaluateFleetTelemetryConsent(
  value: unknown,
  disclosureVersion = FLEET_TELEMETRY_DISCLOSURE_VERSION,
): FleetTelemetryConsentState {
  if (!isConsentRecord(value)) return { status: "unset" };
  if (value.disclosureVersion !== disclosureVersion) {
    return { status: "stale", record: value };
  }
  return value.enabled
    ? { status: "enabled", record: value }
    : { status: "disabled", record: value };
}

export async function loadFleetTelemetryConsent(
  storage: FleetTelemetryStorageArea,
): Promise<FleetTelemetryConsentState> {
  const stored = await storage.get(FLEET_TELEMETRY_CONSENT_STORAGE_KEY);
  return evaluateFleetTelemetryConsent(
    stored[FLEET_TELEMETRY_CONSENT_STORAGE_KEY],
  );
}

export async function saveFleetTelemetryConsent(
  storage: FleetTelemetryStorageArea,
  enabled: boolean,
  decidedAt = Date.now(),
): Promise<FleetTelemetryConsentRecord> {
  const record: FleetTelemetryConsentRecord = {
    disclosureVersion: FLEET_TELEMETRY_DISCLOSURE_VERSION,
    enabled,
    decidedAt,
  };
  await storage.set({ [FLEET_TELEMETRY_CONSENT_STORAGE_KEY]: record });
  return record;
}

function isConsentRecord(value: unknown): value is FleetTelemetryConsentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    Number.isInteger(record.disclosureVersion) &&
    typeof record.enabled === "boolean" &&
    typeof record.decidedAt === "number" &&
    Number.isFinite(record.decidedAt) &&
    record.decidedAt >= 0
  );
}
