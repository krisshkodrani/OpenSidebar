import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { BenchmarkAttemptV1 } from "@opensidebar/scenario-contracts";
import { MemoryScenarioStore, MODEL_BENCH_CASES } from "@opensidebar/scenario-engine";
import { createModelBenchApi } from "../src/modelbench-api.js";
import type { ModelBenchRepository } from "../src/modelbench-repository.js";

class MemoryRepository extends MemoryScenarioStore implements ModelBenchRepository {
  readonly attempts = new Map<string, BenchmarkAttemptV1>();
  async saveAttempt(value: BenchmarkAttemptV1) { this.attempts.set(value.attemptId, value); }
  async attempt(id: string) { return this.attempts.get(id) ?? null; }
  async listAttempts(caseId?: string) {
    return [...this.attempts.values()].filter((value) => !caseId || value.caseId === caseId);
  }
  async cleanupExpired() { return { runs: 0, attempts: 0 }; }
}

function app(repository: ModelBenchRepository) {
  const root = new Hono<{ Variables: { principal: { accountId: string } } }>();
  root.use("*", async (c, next) => {
    c.set("principal", { accountId: "tester-1" });
    await next();
  });
  root.route("/", createModelBenchApi(repository));
  return root;
}

test("internal API creates owner-scoped versioned runs", async () => {
  const repository = new MemoryRepository();
  const definition = MODEL_BENCH_CASES[0]!;
  const response = await app(repository).request("/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId: definition.contract.id }),
  });
  assert.equal(response.status, 201);
  const created = await response.json() as { run: { id: string; caseId: string } };
  assert.equal(created.run.caseId, definition.contract.id);
  assert.equal((await app(repository).request(`/runs/${created.run.id}`)).status, 200);
});

test("internal API rejects attempts from another case version or hash", async () => {
  const definition = MODEL_BENCH_CASES[0]!;
  const response = await app(new MemoryRepository()).request("/attempts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      attemptId: "attempt-1",
      caseId: definition.contract.id,
      caseVersion: definition.contract.version,
      caseContentHash: "wrong",
      buildRevision: "abc",
      startedAt: new Date().toISOString(),
      durationMs: 1,
      classification: "valid_pass",
      scoreEligible: true,
      requestedSeats: {},
      resolvedSeats: {},
      usageByRole: {},
      validation: null,
      artifactRefs: [],
    }),
  });
  assert.equal(response.status, 409);
});
