import assert from "node:assert/strict";
import test from "node:test";
import {
  publicPlaygroundCase,
  publicPlaygroundCatalog,
} from "@opensidebar/scenario-engine";
import type { PlaygroundRunV2 } from "@opensidebar/scenario-contracts";
import { createApp } from "../src/app.js";
import type { CloudConfig } from "../src/config.js";
import { tokenHash } from "../src/crypto.js";
import type { PlaygroundRepository } from "../src/repository.js";
import type {
  PlaygroundRunRecordV2,
  PlaygroundV2Repository,
} from "../src/playground-v2-repository.js";
import { PostgresPlaygroundRepository } from "../src/postgres-repository.js";
import { PostgresPlaygroundV2Repository } from "../src/postgres-playground-v2-repository.js";

class MemoryPublicRepository implements PlaygroundV2Repository {
  runs = new Map<string, PlaygroundRunRecordV2>();
  launches = new Map<string, string>();
  sessions = new Map<string, string>();
  async list(owner: string) {
    return [...this.runs.values()].filter((run) => run.ownerId === owner);
  }
  async get(id: string) {
    return structuredClone(this.runs.get(id) ?? null);
  }
  async create(run: PlaygroundRunRecordV2) {
    this.runs.set(run.id, structuredClone(run));
    return run;
  }
  async update(run: PlaygroundRunRecordV2, revision: number) {
    if (this.runs.get(run.id)?.revision !== revision) return false;
    this.runs.set(run.id, structuredClone(run));
    return true;
  }
  async remove(id: string, owner: string) {
    return this.runs.get(id)?.ownerId === owner && this.runs.delete(id);
  }
  async createLaunch(hash: string, id: string) {
    this.launches.set(hash, id);
  }
  async consumeLaunch(hash: string) {
    const id = this.launches.get(hash) ?? null;
    this.launches.delete(hash);
    return id;
  }
  async createTargetSession(hash: string, id: string) {
    this.sessions.set(hash, id);
  }
  async targetRunId(hash: string) {
    return this.sessions.get(hash) ?? null;
  }
}
const config = {
  controlOrigin: "https://opensidebar.com",
  targetOrigin: "https://play.opensidebar.com",
  cookieSecure: true,
  playgroundV2Enabled: true,
} as CloudConfig;
const auth = {
  async session(hash: string) {
    const owner =
      hash === tokenHash("alice")
        ? "alice"
        : hash === tokenHash("bob")
          ? "bob"
          : null;
    return owner
      ? {
          accountId: owner,
          email: `${owner}@example.test`,
          csrfHash: tokenHash("csrf"),
        }
      : null;
  },
} as PlaygroundRepository;
const headers = (owner = "alice") => ({
  cookie: `__Host-os_session=${owner}; os_csrf=csrf`,
  "x-os-csrf": "csrf",
  origin: config.controlOrigin,
  "content-type": "application/json",
  "idempotency-key": crypto.randomUUID(),
});
const post = (body: unknown, owner = "alice") => ({
  method: "POST",
  headers: headers(owner),
  body: JSON.stringify(body),
});
const setup = () => {
  const repository = new MemoryPublicRepository();
  return {
    repository,
    app: createApp(auth, config, undefined, undefined, undefined, repository),
  };
};

test("public v2 routes enforce account, CSRF, origin, ownership and closed scenario inputs", async () => {
  const { app } = setup();
  assert.equal((await app.request("/api/v2/playground/scenarios")).status, 401);
  const noCsrf = post({ scenarioId: "price-watch" });
  delete (noCsrf.headers as Record<string, string>)["x-os-csrf"];
  assert.equal(
    (await app.request("/api/v2/playground/runs", noCsrf)).status,
    403,
  );
  const wrongOrigin = post({ scenarioId: "price-watch" });
  wrongOrigin.headers.origin = config.targetOrigin;
  assert.equal(
    (await app.request("/api/v2/playground/runs", wrongOrigin)).status,
    403,
  );
  for (const body of [
    { scenarioId: "retail.checkout-multi-item" },
    { scenarioId: "price-watch", prompt: "private" },
    { scenarioId: "price-watch", model: "private" },
  ])
    assert.equal(
      (await app.request("/api/v2/playground/runs", post(body))).status,
      400,
    );
  const response = await app.request(
    "/api/v2/playground/runs",
    post({ scenarioId: "price-watch" }),
  );
  assert.equal(response.status, 201);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const { run } = (await response.json()) as { run: PlaygroundRunV2 };
  assert.deepEqual(Object.keys(run).sort(), [
    "createdAt",
    "expiresAt",
    "id",
    "lifecycle",
    "result",
    "revision",
    "scenarioId",
    "scenarioVersion",
    "updatedAt",
  ]);
  assert.deepEqual(
    await (
      await app.request("/api/v2/playground/runs", { headers: headers("bob") })
    ).json(),
    { runs: [] },
  );
  assert.equal(
    (
      await app.request(
        `/api/v2/playground/runs/${run.id}/launch`,
        post({}, "bob"),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await app.request(`/api/v2/playground/runs/${run.id}`, {
        method: "DELETE",
        headers: headers("bob"),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await app.request(
        "/api/v1/playground/runs",
        post({ scenarioId: "restock-alert" }),
      )
    ).status,
    503,
  );
});

test("all public fixtures run through isolated target sessions without collecting answers", async () => {
  const { app, repository } = setup();
  for (const scenario of publicPlaygroundCatalog()) {
    const created = await app.request(
      "/api/v2/playground/runs",
      post({ scenarioId: scenario.id }),
    );
    const { run } = (await created.json()) as { run: PlaygroundRunV2 };
    const launch = await app.request(
      `/api/v2/playground/runs/${run.id}/launch`,
      post({}),
    );
    const { launchUrl } = (await launch.json()) as { launchUrl: string };
    const handoff = await app.request(launchUrl);
    assert.equal(handoff.status, 302);
    assert.equal(
      handoff.headers.get("location"),
      `/scenario/index.html?run=${run.id}`,
    );
    const cookie = handoff.headers.get("set-cookie")!.split(";")[0];
    assert.match(cookie, /^__Host-os_scenario_target=/);
    assert.equal((await app.request(launchUrl)).status, 410);
    const targetHeaders = {
      cookie,
      origin: config.targetOrigin,
      "content-type": "application/json",
    };
    const act = (body: unknown) =>
      app.request(`/api/v2/playground-target/runs/${run.id}/action`, {
        method: "POST",
        headers: targetHeaders,
        body: JSON.stringify(body),
      });
    const target = await app.request(
      `/api/v2/playground-target/runs/${run.id}/state`,
      { headers: targetHeaders },
    );
    assert.equal(target.status, 200);
    assert.equal(
      (
        await app.request("/api/v2/playground-target/runs/another-run/state", {
          headers: targetHeaders,
        })
      ).status,
      401,
    );
    const projected = (await target.json()) as {
      run: { data: Record<string, unknown> };
    };
    assert.equal(projected.run.data.control, undefined);
    assert.doesNotMatch(
      JSON.stringify(projected),
      /"(?:validator|ownerId|expected|prompt|seed)"/,
    );
    assert.equal(
      (await app.request("/api/v2/playground/runs", { headers: targetHeaders }))
        .status,
      401,
    );
    assert.equal(
      (
        await app.request(`/api/v2/playground-target/runs/${run.id}/state`, {
          headers: headers(),
        })
      ).status,
      401,
    );
    const revision = repository.runs.get(run.id)!.revision;
    assert.equal(
      (await act({ type: "case.submit", payload: { answer: "private" } }))
        .status,
      400,
    );
    assert.equal(repository.runs.get(run.id)!.revision, revision);
    const definition = publicPlaygroundCase(scenario.id);
    for (const action of definition.oracle.actions.filter((action) =>
      action.type.startsWith("workflow."),
    ))
      assert.equal((await act(action)).status, 200, scenario.id);
    if (!scenario.observationOnly) {
      const result = await act({
        type: "case.submit",
        payload:
          scenario.id === "price-watch"
            ? { value: "90" }
            : { decision: "apply" },
      });
      assert.equal(result.status, 200, scenario.id);
      assert.equal(
        repository.runs.get(run.id)!.result,
        "succeeded",
        scenario.id,
      );
    } else assert.equal(repository.runs.get(run.id)!.result, "page_state_only");
    repository.runs.get(run.id)!.expiresAt = new Date(0).toISOString();
    assert.equal(
      (
        await app.request(`/api/v2/playground-target/runs/${run.id}/state`, {
          headers: targetHeaders,
        })
      ).status,
      401,
    );
  }
});

test("maintenance blocks creation while existing v2 runs can drain", async () => {
  const { repository } = setup();
  const app = createApp(
    auth,
    { ...config, playgroundMaintenance: true },
    undefined,
    undefined,
    undefined,
    repository,
  );
  assert.deepEqual(
    await (
      await app.request("/api/v2/playground/scenarios", { headers: headers() })
    ).json(),
    { schemaVersion: 2, enabled: false, scenarios: [] },
  );
  for (const version of [1, 2])
    assert.equal(
      (
        await app.request(
          `/api/v${version}/playground/runs`,
          post({ scenarioId: "price-watch" }),
        )
      ).status,
      503,
    );
});

test(
  "PostgreSQL public runs: idempotency, shared quotas, CAS, expiry and deletion",
  { skip: !process.env.PLAYGROUND_V2_TEST_DATABASE_URL },
  async () => {
    const legacy = new PostgresPlaygroundRepository(
      process.env.PLAYGROUND_V2_TEST_DATABASE_URL!,
    );
    const repository = new PostgresPlaygroundV2Repository(legacy.pool);
    const owner = `public-test-${crypto.randomUUID()}`;
    const app = createApp(
      legacy,
      { ...config, developmentAccountId: owner },
      undefined,
      undefined,
      undefined,
      repository,
    );
    try {
      await legacy.migrate();
      await repository.migrate();
      const request = post({ scenarioId: "price-watch" });
      const replies = await Promise.all(
        Array.from({ length: 4 }, () =>
          app.request("/api/v2/playground/runs", request),
        ),
      );
      assert.ok(replies.every((response) => response.status === 201));
      const runs = await Promise.all(
        replies.map(
          async (response) =>
            ((await response.json()) as { run: PlaygroundRunV2 }).run,
        ),
      );
      assert.equal(new Set(runs.map((run) => run.id)).size, 1);
      const conflict = {
        ...request,
        body: JSON.stringify({ scenarioId: "registration" }),
      };
      assert.equal(
        (await app.request("/api/v2/playground/runs", conflict)).status,
        409,
      );
      assert.equal(
        (
          await app.request(
            "/api/v2/playground/runs",
            post({ scenarioId: "registration" }),
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await app.request(
            "/api/v2/playground/runs",
            post({ scenarioId: "data-table" }),
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await app.request(
            "/api/v2/playground/runs",
            post({ scenarioId: "email-compose" }),
          )
        ).status,
        429,
      );
      const record = (await repository.get(runs[0].id))!;
      assert.equal(
        await repository.update(
          { ...record, revision: record.revision + 1 },
          record.revision,
        ),
        true,
      );
      assert.equal(await repository.update(record, record.revision), false);
      await repository.createLaunch("test-launch", record.id, record.expiresAt);
      assert.equal(await repository.consumeLaunch("test-launch"), record.id);
      assert.equal(await repository.consumeLaunch("test-launch"), null);
      await repository.createTargetSession(
        "test-session",
        record.id,
        record.expiresAt,
      );
      assert.equal(await repository.remove(record.id, "someone-else"), false);
      assert.equal(await repository.remove(record.id, owner), true);
      assert.equal(await repository.targetRunId("test-session"), null);
      await legacy.pool.query(
        "UPDATE playground.daily_quotas SET used=25 WHERE subject_hash=$1",
        [tokenHash(owner)],
      );
      assert.equal(
        (
          await app.request(
            "/api/v2/playground/runs",
            post({ scenarioId: "price-watch" }),
          )
        ).status,
        429,
      );
    } finally {
      for (const run of await repository.list(owner))
        await repository.remove(run.id, owner);
      await legacy.pool.query(
        "DELETE FROM playground.daily_quotas WHERE subject_hash=$1",
        [tokenHash(owner)],
      );
      await legacy.pool.end();
    }
  },
);
