/**
 * Vitest reporter that exports e2e results to Bluebox as OpenTelemetry
 * (traces + logs + metrics). Sibling of flaky-reporter.ts, same TaskLike
 * walking; this one makes runs analyzable ACROSS time — flake patterns,
 * duration regressions, failure clustering — by shipping:
 *
 *   - one span per test (status, duration, retryCount, file), parented into
 *     the staged runner's suite span via TRACEPARENT when present;
 *   - one ERROR log record per failed test carrying the exact failure text
 *     (what Bluebox quotes back when you ask "why did run X fail?");
 *   - counters/histogram: tests by status (incl. pass-on-retry as its own
 *     status), test duration.
 *
 * Default-off: without OTEL_EXPORTER_OTLP_ENDPOINT (or a repo-root .env.otel)
 * `startOtel` declines and onFinished returns immediately — a normal e2e run
 * is byte-identical to before. Console/report output is untouched either way;
 * everything here is additive export.
 */

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";
import { metrics } from "@opentelemetry/api";

import {
  contextFromTraceparentEnv,
  shutdownOtel,
  startOtel,
} from "../../../../../scripts/otel/sdk";

interface TaskLike {
  type?: string;
  name?: string;
  tasks?: TaskLike[];
  file?: { filepath?: string };
  result?: {
    state?: string;
    retryCount?: number;
    startTime?: number;
    duration?: number;
    errors?: Array<{ message?: string; stack?: string }>;
  };
}

function collectTests(task: TaskLike | undefined, out: TaskLike[]): void {
  if (!task) return;
  if (task.type === "test") out.push(task);
  for (const child of task.tasks ?? []) collectTests(child, out);
}

function baseName(filepath: string | undefined): string {
  if (!filepath) return "unknown";
  const idx = Math.max(filepath.lastIndexOf("/"), filepath.lastIndexOf("\\"));
  return idx >= 0 ? filepath.slice(idx + 1) : filepath;
}

export default class OtelReporter {
  async onFinished(files: TaskLike[] = []): Promise<void> {
    if (!(await startOtel("opensidebar-e2e-harness"))) return;

    const tracer = trace.getTracer("opensidebar-e2e-harness");
    const logger = logs.getLogger("opensidebar-e2e-harness");
    const meter = metrics.getMeter("opensidebar-e2e-harness");
    const testCounter = meter.createCounter("opensidebar.e2e.tests", {
      description: "E2E test results by status (flaky-pass = pass-on-retry)",
    });
    const durationHistogram = meter.createHistogram(
      "opensidebar.e2e.test.duration",
      { description: "E2E test duration", unit: "ms" },
    );

    const parentCtx = contextFromTraceparentEnv();
    const tests: TaskLike[] = [];
    for (const file of files) collectTests(file, tests);

    for (const test of tests) {
      const result = test.result ?? {};
      const state = result.state ?? "unknown";
      const retryCount = result.retryCount ?? 0;
      const status =
        state === "pass" && retryCount > 0 ? "flaky-pass" : state;
      const file = baseName(test.file?.filepath);
      const start = result.startTime ?? Date.now();
      const duration = result.duration ?? 0;

      const span = tracer.startSpan(
        `e2e_test ${test.name ?? "unknown"}`,
        {
          startTime: start,
          attributes: {
            "opensidebar.e2e.file": file,
            "opensidebar.e2e.status": status,
            "opensidebar.e2e.retry_count": retryCount,
          },
        },
        parentCtx,
      );
      if (state === "fail") {
        const message =
          result.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
          "test failed";
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: `${file} > ${test.name ?? "unknown"}: ${message}`,
          attributes: {
            "opensidebar.e2e.file": file,
            "opensidebar.e2e.test": test.name ?? "unknown",
          },
        });
      }
      span.end(start + duration);

      testCounter.add(1, { file, status });
      if (duration > 0) durationHistogram.record(duration, { file, status });
    }

    // Flush before the vitest process exits, or the batch never leaves.
    await shutdownOtel();
  }
}
