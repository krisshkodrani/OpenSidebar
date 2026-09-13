import assert from "node:assert/strict";
import test from "node:test";
import type { BenchmarkAttemptV1 } from "@opensidebar/scenario-contracts";
import { MemoryScenarioStore } from "@opensidebar/scenario-engine";
import type { CloudConfig } from "../src/config.js";
import type { ModelBenchRepository } from "../src/modelbench-repository.js";
import { createModelBenchTargetApi } from "../src/modelbench-target-api.js";

class MemoryRepository extends MemoryScenarioStore implements ModelBenchRepository {
  launches = new Map<string, string>();
  sessions = new Map<string, string>();
  async createLaunch(hash: string, runId: string, _ownerId: string, _expiresAt: string) {
    this.launches.set(hash, runId);
  }
  async consumeLaunch(hash: string) { const runId = this.launches.get(hash) ?? null; this.launches.delete(hash); return runId; }
  async createTargetSession(hash: string, runId: string, _expiresAt: string) {
    this.sessions.set(hash, runId);
  }
  async targetRunId(hash: string) { return this.sessions.get(hash) ?? null; }
  async saveAttempt(_attempt: BenchmarkAttemptV1) {}
  async attempt(_id: string) { return null; }
  async listAttempts() { return []; }
  async cleanupExpired() { return { runs: 0, attempts: 0 }; }
}

const config = {
  targetOrigin: "https://play.opensidebar.com",
  cookieSecure: true,
} as CloudConfig;

test("ModelBench target handoff is one-time and runs recovery workflow", async () => {
  const repository = new MemoryRepository();
  const run = await repository.create({
    id: "run-cloud-workflow",
    ownerId: "tester-1",
    caseId: "retail.recover-price-refresh",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
  });
  await repository.createLaunch("launch-hash", run.id, run.ownerId, new Date(Date.now() + 300_000).toISOString());
  // This test repository stores the opaque token directly to isolate route behavior from hashing.
  repository.launches.clear();
  const { tokenHash } = await import("../src/crypto.js");
  repository.launches.set(tokenHash("one-time-token"), run.id);
  const app = createModelBenchTargetApi(repository, config);
  const handoff = await app.request("/modelbench/launch/one-time-token");
  assert.equal(handoff.status, 302);
  assert.equal(handoff.headers.get("location"), "/modelbench/index.html");
  const cookie = handoff.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("__Host-os_modelbench_target="));
  assert.equal((await app.request("/modelbench/launch/one-time-token")).status, 410);

  const state = await app.request("/api/v2/target/state", { headers: { cookie: cookie! } });
  assert.equal(state.status, 200);
  const act = (type: string, payload: Record<string, unknown> = {}) => app.request("/api/v2/target/action", {
    method: "POST",
    headers: { cookie: cookie!, origin: config.targetOrigin, "content-type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  assert.equal((await act("workflow.advance", { stageId: "stage-1" })).status, 200);
  assert.equal((await act("workflow.advance", { stageId: "stage-2" })).status, 400);
  assert.equal((await act("workflow.recover")).status, 200);
  assert.equal((await act("workflow.advance", { stageId: "stage-2" })).status, 200);
  assert.equal((await act("workflow.advance", { stageId: "stage-3" })).status, 200);
  const completed = await act("case.submit", { decision: "apply" });
  assert.equal(completed.status, 200);
  assert.equal((await completed.json() as { run: { lifecycle: string } }).run.lifecycle, "finished");
});

test("ModelBench target mutation requires the isolated target origin", async () => {
  const repository = new MemoryRepository();
  const run = await repository.create({
    id: "run-origin-check",
    ownerId: "tester-1",
    caseId: "crm.raise-priority",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
  });
  repository.sessions.set("session-hash", run.id);
  const { tokenHash } = await import("../src/crypto.js");
  repository.sessions.clear();
  repository.sessions.set(tokenHash("session-token"), run.id);
  const response = await createModelBenchTargetApi(repository, config).request("/api/v2/target/action", {
    method: "POST",
    headers: { cookie: "__Host-os_modelbench_target=session-token", "content-type": "application/json" },
    body: JSON.stringify({ type: "case.submit", payload: { value: "urgent" } }),
  });
  assert.equal(response.status, 403);
  assert.equal((await repository.get(run.id))?.revision, 1);
});
