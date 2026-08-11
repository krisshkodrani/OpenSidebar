import {
  PORTABLE_CHECKPOINT_SCHEMA_VERSION,
  type CheckpointCompatibility,
  type PortableCheckpointV1,
  type RestoreGroundingResult,
} from "./cloud-sessions";

export type PortableCheckpointValidation =
  | { valid: true; value: PortableCheckpointV1 }
  | { valid: false; code: "invalid_schema" | "forbidden_field" | "size_exceeded"; path: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN = new Set([
  "approvalid", "authorization", "authorizationheader", "cookie", "cookies",
  "credential", "credentials", "dom", "domnode", "domsnapshot", "frameid",
  "headers", "password", "providerkey", "rawtrace", "selector", "storagekey",
  "tabid", "token", "windowid",
]);
const normalized = (key: string) => key.replace(/[_\-\s]/g, "").toLowerCase();
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const bounded = (value: unknown, max: number, allowEmpty = false) =>
  typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= max;
const integer = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min;
const iso = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const stringArray = (value: unknown, maxItems: number, maxLength: number) =>
  Array.isArray(value) && value.length <= maxItems && value.every((item) => bounded(item, maxLength));

function forbiddenPath(value: unknown, path = "checkpoint"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = forbiddenPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!record(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN.has(normalized(key))) return `${path}.${key}`;
    const found = forbiddenPath(nested, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function validObjective(value: unknown) {
  return record(value) &&
    exact(value, ["originalRequest", "currentInterpretation", "successCriteria", "userConstraints"]) &&
    bounded(value.originalRequest, 16_000) && bounded(value.currentInterpretation, 16_000) &&
    stringArray(value.successCriteria, 100, 4_000) && stringArray(value.userConstraints, 100, 4_000);
}

function validConversation(value: unknown) {
  if (!record(value) || !exact(value, ["messages"]) || !Array.isArray(value.messages) || value.messages.length > 500) return false;
  return value.messages.every((item) => record(item) &&
    exact(item, ["id", "role", "content", "createdAt", "provenance", "uncertainty"]) &&
    bounded(item.id, 160) && ["user", "assistant", "tool", "summary"].includes(String(item.role)) &&
    bounded(item.content, 64_000) && iso(item.createdAt) &&
    (item.provenance === undefined || ["user", "model", "tool", "compacted"].includes(String(item.provenance))) &&
    (item.uncertainty === undefined || ["none", "low", "medium", "high"].includes(String(item.uncertainty))));
}

function validExecution(value: unknown) {
  if (!record(value) || !exact(value, ["plan", "completedActions", "unresolvedFacts", "partialHandoff"]) ||
      !Array.isArray(value.plan) || value.plan.length > 250 ||
      !Array.isArray(value.completedActions) || value.completedActions.length > 500 ||
      !Array.isArray(value.unresolvedFacts) || value.unresolvedFacts.length > 250) return false;
  const plan = value.plan.every((item) => record(item) && exact(item, ["stepId", "description", "status", "evidenceRefs"]) &&
    bounded(item.stepId, 160) && bounded(item.description, 8_000) &&
    ["pending", "in_progress", "completed", "blocked"].includes(String(item.status)) &&
    stringArray(item.evidenceRefs, 100, 160));
  const actions = value.completedActions.every((item) => record(item) &&
    exact(item, ["actionId", "kind", "summary", "observedOutcome", "evidenceType"]) &&
    bounded(item.actionId, 160) && bounded(item.kind, 160) && bounded(item.summary, 8_000) &&
    bounded(item.observedOutcome, 16_000) && bounded(item.evidenceType, 160));
  const facts = value.unresolvedFacts.every((item) => record(item) && exact(item, ["statement", "confidence"]) &&
    bounded(item.statement, 8_000) && ["low", "medium", "high"].includes(String(item.confidence)));
  const partial = value.partialHandoff === undefined || (record(value.partialHandoff) &&
    exact(value.partialHandoff, ["completed", "remaining", "uncertain"]) &&
    stringArray(value.partialHandoff.completed, 100, 4_000) &&
    stringArray(value.partialHandoff.remaining, 100, 4_000) &&
    stringArray(value.partialHandoff.uncertain, 100, 4_000));
  return plan && actions && facts && partial;
}

function validGrounding(value: unknown) {
  if (!record(value) || !exact(value, ["lastKnownUrl", "expectedOrigins", "pageTitle", "pageFingerprint", "userVisibleStateSummary", "requiredCapabilities"])) return false;
  if (value.lastKnownUrl !== undefined) {
    if (!bounded(value.lastKnownUrl, 8_000)) return false;
    try { new URL(String(value.lastKnownUrl)); } catch { return false; }
  }
  if (!Array.isArray(value.expectedOrigins) || value.expectedOrigins.length > 20 || !value.expectedOrigins.every((origin) => {
    if (!bounded(origin, 500)) return false;
    try { return new URL(String(origin)).origin === origin; } catch { return false; }
  })) return false;
  return (value.pageTitle === undefined || bounded(value.pageTitle, 2_000)) &&
    (value.pageFingerprint === undefined || bounded(value.pageFingerprint, 256)) &&
    bounded(value.userVisibleStateSummary, 16_000) &&
    Array.isArray(value.requiredCapabilities) && value.requiredCapabilities.length <= 4 &&
    value.requiredCapabilities.every((item) => ["navigation", "forms", "downloads", "tabs"].includes(String(item)));
}

function validPending(value: unknown) {
  if (!record(value) || typeof value.kind !== "string") return false;
  if (value.kind === "none") return exact(value, ["kind"]);
  if (value.kind === "clarification") return exact(value, ["kind", "question", "askedAt"]) && bounded(value.question, 8_000) && iso(value.askedAt);
  if (value.kind === "approval_required") return exact(value, ["kind", "actionSummary", "risk", "requestedAt", "expiresAt"]) &&
    bounded(value.actionSummary, 8_000) && ["low", "medium", "high"].includes(String(value.risk)) && iso(value.requestedAt) && iso(value.expiresAt);
  if (value.kind === "browser_result_unknown") return exact(value, ["kind", "actionSummary", "startedAt"]) && bounded(value.actionSummary, 8_000) && iso(value.startedAt);
  return false;
}

export function validatePortableCheckpoint(input: unknown): PortableCheckpointValidation {
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { return { valid: false, code: "invalid_schema", path: "checkpoint" }; }
  if (new TextEncoder().encode(serialized).byteLength > 7_800_000)
    return { valid: false, code: "size_exceeded", path: "checkpoint" };
  const forbidden = forbiddenPath(input);
  if (forbidden) return { valid: false, code: "forbidden_field", path: forbidden };
  if (!record(input) || !exact(input, ["schemaVersion", "sessionId", "checkpointId", "parentCheckpointId", "revision", "createdAt", "runtimeVersion", "reason", "objective", "conversation", "execution", "grounding", "pending", "usage"]) ||
      input.schemaVersion !== PORTABLE_CHECKPOINT_SCHEMA_VERSION || !UUID.test(String(input.sessionId)) || !UUID.test(String(input.checkpointId)) ||
      (input.parentCheckpointId !== undefined && !UUID.test(String(input.parentCheckpointId))) || !integer(input.revision, 1) || !iso(input.createdAt) ||
      !bounded(input.runtimeVersion, 80) || !["periodic", "before_navigation", "after_verified_action", "waiting_for_user", "pause", "terminal"].includes(String(input.reason)) ||
      !validObjective(input.objective) || !validConversation(input.conversation) || !validExecution(input.execution) || !validGrounding(input.grounding) || !validPending(input.pending) ||
      !record(input.usage) || !exact(input.usage, ["promptTokens", "completionTokens", "cachedTokens", "imageTokenEstimate", "turns"]) ||
      !Object.values(input.usage).every((item) => integer(item, 0)))
    return { valid: false, code: "invalid_schema", path: "checkpoint" };
  return { valid: true, value: input as unknown as PortableCheckpointV1 };
}

/** Pure v0→v1 migration. V0 used the final closed shape before its version stamp. */
export function migratePortableCheckpoint(
  input: unknown,
): PortableCheckpointValidation {
  if (record(input) && input.schemaVersion === 0)
    return validatePortableCheckpoint({ ...input, schemaVersion: 1 });
  return validatePortableCheckpoint(input);
}

export function checkpointCompatibility(schemaVersion: number, runtimeVersion: string, currentRuntimeVersion: string): CheckpointCompatibility {
  if (schemaVersion > PORTABLE_CHECKPOINT_SCHEMA_VERSION) return "read_only_newer";
  if (schemaVersion < PORTABLE_CHECKPOINT_SCHEMA_VERSION - 1) return "read_only_older";
  if (schemaVersion === PORTABLE_CHECKPOINT_SCHEMA_VERSION - 1) return "migratable_previous";
  const major = (value: string) => value.split(".")[0];
  return major(runtimeVersion) === major(currentRuntimeVersion) ? "compatible" : "runtime_incompatible";
}

export function classifyRestoreGrounding(checkpoint: PortableCheckpointV1, observed: { url?: string; title?: string; pageFingerprint?: string; available: boolean; authorized: boolean }): RestoreGroundingResult {
  if (!observed.authorized) return "unauthorized";
  if (!observed.available) return "unavailable";
  let origin: string | undefined;
  try { origin = observed.url ? new URL(observed.url).origin : undefined; } catch { return "changed"; }
  if (checkpoint.grounding.expectedOrigins.length && (!origin || !checkpoint.grounding.expectedOrigins.includes(origin))) return "changed";
  if (checkpoint.grounding.pageFingerprint && checkpoint.grounding.pageFingerprint !== observed.pageFingerprint) return "changed";
  if (checkpoint.grounding.pageTitle && checkpoint.grounding.pageTitle !== observed.title) return "changed";
  return "matched";
}
