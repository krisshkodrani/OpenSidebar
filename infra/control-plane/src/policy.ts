import { createHash } from "node:crypto";
import type {
  CloudProviderId,
  CredentialCipher,
  CredentialRepository,
  ProviderVerifier,
  SafePreferences,
} from "./contracts.ts";

export const MAX_CREDENTIAL_BYTES = 8 * 1024;
export const MAX_RELAY_BYTES = 8 * 1024 * 1024;
export const ALLOWED_PROVIDERS = new Set<CloudProviderId>([
  "openrouter",
  "fireworks",
]);

export class PolicyError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "invalid_provider"
      | "verification_failed"
      | "revision_conflict",
    message: string,
  ) {
    super(message);
  }
}

export function requireAccountId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(value)) {
    throw new PolicyError("invalid_request", "A valid authenticated subject is required");
  }
  return value;
}

export function requireProvider(value: unknown): CloudProviderId {
  if (value !== "openrouter" && value !== "fireworks") {
    throw new PolicyError("invalid_provider", "Provider is not enabled");
  }
  return value;
}

export function normalizeCredential(value: unknown): string {
  if (typeof value !== "string") {
    throw new PolicyError("invalid_request", "Credential must be a string");
  }
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized) > MAX_CREDENTIAL_BYTES) {
    throw new PolicyError("invalid_request", "Credential is empty or too large");
  }
  return normalized;
}

function encryptionContext(accountId: string, provider: CloudProviderId) {
  return { accountId, provider, purpose: "opensidebar-provider-credential-v1" };
}

export async function verifyAndStoreCredential(input: {
  accountId: string;
  provider: CloudProviderId;
  credential: string;
  cipher: CredentialCipher;
  repository: CredentialRepository;
  verifier: ProviderVerifier;
  now?: Date;
}): Promise<{ fingerprintSuffix: string; verifiedAt: string }> {
  const accountId = requireAccountId(input.accountId);
  const provider = requireProvider(input.provider);
  const credential = normalizeCredential(input.credential);
  try {
    await input.verifier.verify(provider, credential);
  } catch {
    throw new PolicyError("verification_failed", "Provider rejected the credential");
  }
  const encrypted = await input.cipher.encrypt(
    credential,
    encryptionContext(accountId, provider),
  );
  const verifiedAt = (input.now ?? new Date()).toISOString();
  const fingerprintSuffix = createHash("sha256")
    .update(credential)
    .digest("hex")
    .slice(-8);
  await input.repository.put({
    accountId,
    provider,
    ...encrypted,
    fingerprintSuffix,
    updatedAt: verifiedAt,
    lastVerifiedAt: verifiedAt,
    verification: "valid",
  });
  return { fingerprintSuffix, verifiedAt };
}

const FORBIDDEN_PREFERENCE_KEYS = new Set([
  "requireApprovals",
  "requirePlanConfirmation",
  "allowNavigation",
  "allowedNavigationOrigins",
  "siteAccessMode",
  "siteAccessBlocklist",
  "fleetTelemetryConsent",
]);

export function parseSafePreferences(value: unknown): SafePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PolicyError("invalid_request", "Preferences must be an object");
  }
  const raw = value as Record<string, unknown>;
  for (const key of FORBIDDEN_PREFERENCE_KEYS) {
    if (key in raw) {
      throw new PolicyError("invalid_request", `${key} is device-local`);
    }
  }
  if (
    raw.schemaVersion !== 1 ||
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) < 0 ||
    (raw.providerMode !== "openrouter" && raw.providerMode !== "fireworks") ||
    !["light", "dark", "system"].includes(String(raw.theme)) ||
    typeof raw.showSessionMetrics !== "boolean"
  ) {
    throw new PolicyError("invalid_request", "Preferences do not match schema v1");
  }
  return structuredClone(raw) as unknown as SafePreferences;
}

export function validateRelayEnvelope(value: unknown, rawBytes: number): void {
  if (rawBytes <= 0 || rawBytes > MAX_RELAY_BYTES) {
    throw new PolicyError("invalid_request", "Relay payload is empty or too large");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PolicyError("invalid_request", "Relay request must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.requestId !== "string" ||
    raw.requestId.length > 128 ||
    !ALLOWED_PROVIDERS.has(raw.provider as CloudProviderId) ||
    typeof raw.model !== "string" ||
    raw.model.length === 0 ||
    raw.model.length > 256 ||
    !Array.isArray(raw.messages)
  ) {
    throw new PolicyError("invalid_request", "Relay request does not match schema v1");
  }
  for (const forbidden of ["url", "baseUrl", "headers", "apiKey", "credential"]) {
    if (forbidden in raw) {
      throw new PolicyError("invalid_request", `${forbidden} is not client-controlled`);
    }
  }
}
