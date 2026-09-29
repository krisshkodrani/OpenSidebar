import { afterEach, describe, expect, test, vi } from "vitest";
import { emptySessionMetrics } from "../../src/background/agent/agent-telemetry";
import { RunAnalyticsReporter } from "../../src/background/run-analytics-reporter";
import { costLabel } from "../../src/sidepanel/task-status-format";

describe("run analytics reporter", () => {
  afterEach(() => vi.useRealTimers());
  test("local spend labels distinguish unknown and measured zero", () => {
    const unknown = emptySessionMetrics();
    unknown.llmCallCount = 1;
    unknown.unknownCostCallCount = 1;
    expect(costLabel(unknown)).toBe("Unknown");
    const measured = emptySessionMetrics();
    measured.llmCallCount = 1;
    measured.costMode = "actual";
    expect(costLabel(measured)).toBe("$0");
  });
  test("does not upload without account consent", async () => {
    const paths: string[] = [];
    const reporter = new RunAnalyticsReporter(async (path) => {
      paths.push(path);
      return Response.json({ enabled: false });
    });
    const run = { runId: crypto.randomUUID(), startedAt: Date.now(), metrics: emptySessionMetrics() };
    reporter.start(run, "local");
    await reporter.publish(run, "succeeded");
    expect(paths).toEqual(["/analytics/consent"]);
  });

  test("uploads only allowed metadata and preserves known zero", async () => {
    const payloads: Record<string, unknown>[] = [];
    const reporter = new RunAnalyticsReporter(async (path, init) => {
      if (path === "/analytics/consent") return Response.json({ enabled: true });
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ result: "saved" });
    });
    const metrics = emptySessionMetrics();
    metrics.llmCallCount = 1;
    metrics.costMode = "actual";
    const run = { runId: crypto.randomUUID(), startedAt: Date.now(), metrics };
    reporter.start(run, "local", "openrouter");
    await reporter.publish(run, "succeeded");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.spendUsd).toBe(0);
    expect(payloads[0]?.spendProvenance).toBe("provider_reported");
    expect(Object.keys(payloads[0]!).sort()).toEqual([
      "completionTokens", "finishedAt", "observedAt", "promptTokens", "provider",
      "runId", "schemaVersion", "sequence", "source", "spendProvenance",
      "spendUsd", "startedAt", "state",
    ].sort());
  });

  test("an opt-in after a run starts does not backfill that run", async () => {
    let enabled = false;
    const paths: string[] = [];
    const reporter = new RunAnalyticsReporter(async (path) => {
      paths.push(path);
      return Response.json({ enabled });
    });
    const run = { runId: crypto.randomUUID(), startedAt: Date.now(), metrics: emptySessionMetrics() };
    reporter.start(run, "local");
    enabled = true;
    await reporter.publish(run, "succeeded");
    expect(paths).toEqual(["/analytics/consent"]);
  });

  test("remote snapshots are provisional and terminal state supersedes them", async () => {
    vi.useFakeTimers();
    const payloads: Array<{ sequence: number; state: string; finishedAt?: string; spendUsd: number | null }> = [];
    const reporter = new RunAnalyticsReporter(async (path, init) => {
      if (path === "/analytics/consent") return Response.json({ enabled: true });
      payloads.push(JSON.parse(String(init?.body)) as typeof payloads[number]);
      return Response.json({ result: "saved" });
    });
    const metrics = emptySessionMetrics();
    const run = { runId: crypto.randomUUID(), startedAt: Date.now(), metrics };
    reporter.start(run, "remote");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);
    metrics.llmCallCount = 1;
    metrics.costMode = "actual";
    metrics.totalCost = 0.02;
    await reporter.publish(run, "succeeded");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({ sequence: 1, state: "running", spendUsd: null });
    expect(payloads[0]).not.toHaveProperty("finishedAt");
    expect(payloads[1]).toMatchObject({ sequence: 2, state: "succeeded", spendUsd: 0.02 });
    expect(payloads[1]).toHaveProperty("finishedAt");
  });
});
