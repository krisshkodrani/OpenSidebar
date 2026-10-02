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
  /** Configured provider; a routed call may use another backend. */
  provider?: "openrouter" | "fireworks";
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
