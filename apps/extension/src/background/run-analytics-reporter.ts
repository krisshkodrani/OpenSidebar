import type { RunAnalyticsSnapshotV1, SessionMetrics } from "@shared-types";
import { CloudAuthenticatedFetch } from "../cloud/authenticated-fetch";
import { chromePersistencePort } from "./environment/chrome";

type Run = {
  runId: string;
  startedAt: number;
  metrics: SessionMetrics;
};
type Active = { allowed: Promise<boolean>; timer?: ReturnType<typeof setInterval>; sequence: number; source: RunAnalyticsSnapshotV1["source"]; provider?: RunAnalyticsSnapshotV1["provider"] };

/** Sends only an explicit metadata allowlist. Server consent is authoritative. */
export class RunAnalyticsReporter {
  private readonly active = new Map<string, Active>();
  constructor(private readonly request: (path: string, init?: RequestInit) => Promise<Response>) {}

  start(run: Run, source: Active["source"], provider?: Active["provider"]) {
    if (this.active.has(run.runId)) return;
    const entry: Active = {
      source, provider, sequence: 0,
      allowed: this.request("/analytics/consent")
        .then(async (response) => response.ok && ((await response.json()) as { enabled?: boolean; enabledAt?: string }).enabled === true)
        .catch(() => false),
    };
    this.active.set(run.runId, entry);
    if (source === "remote") void entry.allowed.then((allowed) => {
      if (allowed && this.active.get(run.runId) === entry) entry.timer = setInterval(() => {
        void this.publish(run, "running");
      }, 15_000);
    });
  }

  private snapshot(run: Run, entry: Active, state: RunAnalyticsSnapshotV1["state"]): RunAnalyticsSnapshotV1 {
    const metrics = run.metrics;
    const costKnown = metrics.llmCallCount > 0 && metrics.costMode !== "none" && metrics.costMode !== undefined && (metrics.unknownCostCallCount ?? 0) === 0;
    const models = Object.keys(metrics.modelBreakdown ?? {});
    const model = models.length === 1 && models[0] && models[0].length <= 128 && /^[\w./:-]+$/.test(models[0])
      ? models[0] : undefined;
    const observedAt = new Date().toISOString();
    return {
      schemaVersion: 1,
      runId: run.runId,
      sequence: ++entry.sequence,
      startedAt: new Date(run.startedAt).toISOString(),
      observedAt,
      ...(state === "running" ? {} : { finishedAt: observedAt }),
      state,
      source: entry.source,
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(model ? { model } : {}),
      promptTokens: metrics.totalPromptTokens,
      completionTokens: metrics.totalCompletionTokens,
      spendUsd: costKnown ? metrics.totalCost : null,
      spendProvenance: costKnown
        ? metrics.costMode === "actual" ? "provider_reported" : metrics.costMode === "estimated" ? "estimated" : "mixed"
        : "unknown",
    };
  }

  async publish(run: Run, state: RunAnalyticsSnapshotV1["state"]) {
    const entry = this.active.get(run.runId);
    if (!entry) return;
    if (state !== "running") {
      if (entry.timer) clearInterval(entry.timer);
      this.active.delete(run.runId);
    }
    if (!(await entry.allowed)) return;
    const snapshot = this.snapshot(run, entry, state);
    try {
      const response = await this.request(`/analytics/runs/${snapshot.runId}`, { method: "PUT", body: JSON.stringify(snapshot) });
      if (response.status === 403) {
        entry.allowed = Promise.resolve(false);
        if (entry.timer) clearInterval(entry.timer);
      }
    } catch {
      // Analytics is best effort and must never delay browser work.
    }
  }
}

const cloud = new CloudAuthenticatedFetch(chromePersistencePort.local);
export const runAnalyticsReporter = new RunAnalyticsReporter((path, init) => cloud.request(path, init));
