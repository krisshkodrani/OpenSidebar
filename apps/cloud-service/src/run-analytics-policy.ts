import type { RunAnalyticsSnapshotV1 } from "@opensidebar/shared-types";

const keys = new Set([
  "schemaVersion", "runId", "sequence", "startedAt", "observedAt",
  "finishedAt", "state", "source", "provider", "model", "promptTokens",
  "completionTokens", "spendUsd", "spendProvenance",
]);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 32 && !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000_000;

export function parseRunAnalyticsSnapshot(value: unknown): RunAnalyticsSnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_run_analytics");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !keys.has(key)) ||
    row.schemaVersion !== 1 || !uuid(row.runId) || !count(row.sequence) ||
    !date(row.startedAt) || !date(row.observedAt) ||
    (row.finishedAt !== undefined && !date(row.finishedAt)) ||
    !["running", "succeeded", "failed", "stopped", "unknown"].includes(String(row.state)) ||
    !["local", "remote"].includes(String(row.source)) ||
    (row.provider !== undefined && !["openrouter", "fireworks"].includes(String(row.provider))) ||
    (row.model !== undefined && (typeof row.model !== "string" || row.model.length > 128 || row.model.includes("://") || !/^[\w./:-]+$/.test(row.model))) ||
    !count(row.promptTokens) || !count(row.completionTokens) ||
    (row.spendUsd !== null && (typeof row.spendUsd !== "number" || !Number.isFinite(row.spendUsd) || row.spendUsd < 0 || row.spendUsd > 1_000_000)) ||
    !["provider_reported", "estimated", "mixed", "unknown"].includes(String(row.spendProvenance)) ||
    (row.spendUsd === null) !== (row.spendProvenance === "unknown") ||
    Date.parse(row.observedAt as string) < Date.parse(row.startedAt as string) ||
    Date.parse(row.startedAt as string) > Date.now() + 5 * 60_000 ||
    Date.parse(row.observedAt as string) > Date.now() + 5 * 60_000 ||
    (row.finishedAt !== undefined && Date.parse(row.finishedAt as string) < Date.parse(row.startedAt as string)) ||
    (row.finishedAt !== undefined && Date.parse(row.finishedAt as string) > Date.parse(row.observedAt as string)) ||
    (row.state === "running") !== (row.finishedAt === undefined))
    throw new Error("invalid_run_analytics");
  return structuredClone(row) as unknown as RunAnalyticsSnapshotV1;
}
