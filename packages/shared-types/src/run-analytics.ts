/** Account-owned, content-free run analytics. Separate from relay quota and traces. */
export interface RunAnalyticsSnapshotV1 {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  startedAt: string;
  observedAt: string;
  finishedAt?: string;
  state: "running" | "succeeded" | "failed" | "stopped" | "unknown";
  source: "local" | "remote";
  /** Provider name stored by the account service; older runs may name other providers. */
  provider?: string;
  /** Present only when a run used one known model. */
  model?: string;
  promptTokens: number;
  completionTokens: number;
  /** Null is unknown; measured zero is 0. */
  spendUsd: number | null;
  spendProvenance: "provider_reported" | "estimated" | "mixed" | "unknown";
}

export interface AccountRunAnalyticsV1 {
  schemaVersion: 1;
  enabled: boolean;
  enabledAt: string | null;
  retentionDays: 90;
  runs: Array<RunAnalyticsSnapshotV1 & { deviceId: string }>;
}
