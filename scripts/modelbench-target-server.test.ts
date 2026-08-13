import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_BENCH_CASES } from "@opensidebar/scenario-engine";
import { startModelBenchTargetServer } from "./modelbench-target-server.js";

test("local target server uses one-time launch sessions and hides controls", async () => {
  const server = await startModelBenchTargetServer();
  try {
    const definition = MODEL_BENCH_CASES.find((entry) => entry.contract.primaryRole === "executor")!;
    const create = await fetch(`${server.origin}/api/v2/modelbench/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: definition.contract.id }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { launchUrl: string };
    const launch = await fetch(created.launchUrl, { redirect: "manual" });
    assert.equal(launch.status, 302);
    const cookie = launch.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    assert.equal((await fetch(created.launchUrl, { redirect: "manual" })).status, 410);
    const stateResponse = await fetch(`${server.origin}/api/v2/target/state`, { headers: { cookie } });
    const state = await stateResponse.json() as { run: { data: Record<string, unknown> } };
    assert.equal(stateResponse.status, 200);
    assert.equal("control" in state.run.data, false);
    assert.equal(JSON.stringify(state).includes("expected"), false);
    const action = await fetch(`${server.origin}/api/v2/target/action`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ type: "case.submit", payload: { value: "visible form input" } }),
    });
    assert.equal(action.status, 200);
    const updated = await action.json() as { run: { lifecycle: string } };
    assert.equal(updated.run.lifecycle, "finished");
  } finally {
    await server.close();
  }
});
