/**
 * Vitest reporter that surfaces pass-on-retry ("flaky-pass") outcomes.
 *
 * The e2e config runs with `retry: 1`, which silently rescues flaky tests:
 * a test that fails once and passes on the in-place retry reports as a plain
 * pass, so the suite accumulates zero flakiness telemetry. This reporter
 * makes those rescues loud (console) and durable (JSONL under .artifacts/,
 * which is git-ignored), so flake rates become measurable over time.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../../../..");
const FLAKY_LOG_DIR = path.resolve(PROJECT_ROOT, ".artifacts", "e2e");
const FLAKY_LOG_FILE = path.resolve(FLAKY_LOG_DIR, "flaky-log.jsonl");

interface FlakyRecord {
  at: string;
  kind: "pass-on-retry";
  file: string;
  test: string;
  retryCount: number;
}

interface TaskLike {
  type?: string;
  name?: string;
  tasks?: TaskLike[];
  file?: { filepath?: string };
  result?: { state?: string; retryCount?: number };
}

function collectTests(task: TaskLike | undefined, out: TaskLike[]): void {
  if (!task) return;
  if (task.type === "test") out.push(task);
  for (const child of task.tasks ?? []) collectTests(child, out);
}

export default class FlakyRetryReporter {
  onFinished(files: TaskLike[] = []): void {
    const tests: TaskLike[] = [];
    for (const file of files) collectTests(file, tests);

    const records: FlakyRecord[] = [];
    for (const test of tests) {
      const retryCount = test.result?.retryCount ?? 0;
      if (test.result?.state === "pass" && retryCount > 0) {
        records.push({
          at: new Date().toISOString(),
          kind: "pass-on-retry",
          file: path.basename(test.file?.filepath ?? "unknown"),
          test: test.name ?? "unknown",
          retryCount,
        });
      }
    }

    if (records.length === 0) return;

    for (const record of records) {
      console.warn(
        `[flaky] PASS-ON-RETRY ${record.file} > ${record.test} (retries: ${record.retryCount})`,
      );
    }
    console.warn(
      `[flaky] ${records.length} test(s) passed only after in-place retry; logged to ${FLAKY_LOG_FILE}`,
    );

    try {
      fs.mkdirSync(FLAKY_LOG_DIR, { recursive: true });
      fs.appendFileSync(
        FLAKY_LOG_FILE,
        records.map((record) => JSON.stringify(record)).join("\n") + "\n",
        "utf8",
      );
    } catch (error) {
      console.warn(`[flaky] Could not write flaky log: ${String(error)}`);
    }
  }
}
