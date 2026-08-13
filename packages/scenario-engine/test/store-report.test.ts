import assert from "node:assert/strict";
import test from "node:test";
import type { BenchmarkAttemptV1 } from "@opensidebar/scenario-contracts";
import {
  buildBenchmarkReport,
  checkRoleProbes,
  MemoryScenarioStore,
  MODEL_BENCH_CASES,
  ROLE_PROBES,
  ScenarioRevisionConflict,
} from "../src/index.js";

test("publishes exactly ten frozen probes for each diagnostic role", () => {
  assert.deepEqual(checkRoleProbes(), []);
  assert.equal(ROLE_PROBES.length, 50);
});

test("memory store enforces optimistic revisions and returns copies", async () => {
  const store = new MemoryScenarioStore();
  const created = await store.create({
    id: "run-1",
    ownerId: "owner-1",
    caseId: MODEL_BENCH_CASES[0]!.contract.id,
    createdAt: "2026-08-13T12:00:00.000Z",
    expiresAt: "2026-08-13T14:00:00.000Z",
  });
  const updated = await store.apply(
    created.id,
    created.revision,
    { type: "set", payload: { path: "public.case.status", value: "complete" } },
    "2026-08-13T12:01:00.000Z",
  );
  assert.equal(updated.revision, created.revision + 1);
  updated.state.data.public = {};
  assert.notDeepEqual((await store.get(created.id))?.state.data.public, {});
  await assert.rejects(
    () =>
      store.apply(
        created.id,
        created.revision,
        { type: "finish" },
        "2026-08-13T12:02:00.000Z",
      ),
    ScenarioRevisionConflict,
  );
});

function attempt(index: number): BenchmarkAttemptV1 {
  const definition = MODEL_BENCH_CASES[index]!;
  return {
    schemaVersion: 1,
    attemptId: `attempt-${index}`,
    caseId: definition.contract.id,
    caseVersion: definition.contract.version,
    caseContentHash: definition.contentHash,
    buildRevision: "abc123",
    startedAt: "2026-08-13T12:00:00.000Z",
    durationMs: 1000 + index,
    classification: "valid_pass",
    scoreEligible: true,
    requestedSeats: {},
    resolvedSeats: {},
    usageByRole: {
      executor: {
        calls: 1,
        promptTokens: 10,
        completionTokens: 5,
        cachedTokens: 0,
        costUsd: 0.01,
        llmTimeMs: 500,
      },
    },
    validation: null,
    artifactRefs: [],
  };
}

test("full valid 100-case report is rankable and preserves metric vectors", () => {
  const report = buildBenchmarkReport(
    MODEL_BENCH_CASES.map((_, index) => attempt(index)),
    "2026-08-13T13:00:00.000Z",
  );
  assert.equal(report.rankable, true);
  assert.equal(report.coverage, 1);
  assert.equal(report.overall.passAt1, 1);
  assert.equal(report.byRole.executor.requested, 30);
  assert.equal(report.byFamily.retail.requested, 10);
  assert.equal(report.byDifficulty.hard.requested, 35);
  assert.equal(report.totalCostUsd.toFixed(2), "1.00");
});
