import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig, type CloudConfig } from "../src/config.js";
import type {
  AuthFlow,
  OwnedRun,
  PlaygroundRepository,
  SessionRecord,
  StoredEmailChallenge,
} from "../src/repository.js";
import type { PasswordlessAuthProvider } from "../src/passwordless-auth.js";

class MemoryRepository implements PlaygroundRepository {
  runs = new Map<string, OwnedRun>();
  launches = new Map<string, { runId: string; consumed: boolean }>();
  targets = new Map<string, string>();
  authFlows = new Map<string, AuthFlow>();
  sessions = new Map<string, SessionRecord>();
  quota = 0;
  emailChallenges = new Map<
    string,
    {
      emailHash: string;
      challenge: StoredEmailChallenge;
      consumed: boolean;
      attempts: number;
    }
  >();
  async health() {}
  async cleanupExpired() {}
  async session(hash: string): Promise<SessionRecord | null> {
    return this.sessions.get(hash) ?? null;
  }
  async revokeSession(_hash: string) {}
  async createAuthFlow(
    stateHash: string,
    codeVerifier: string,
    returnPath: string,
    _expiresAt: Date,
  ) {
    this.authFlows.set(stateHash, { codeVerifier, returnPath });
  }
  async consumeAuthFlow(stateHash: string): Promise<AuthFlow | null> {
    const flow = this.authFlows.get(stateHash) ?? null;
    this.authFlows.delete(stateHash);
    return flow;
  }
  async consumeAuthQuota(
    _subjectHash: string,
    _windowSeconds: number,
    _limit: number,
  ) {}
  async createEmailChallenge(
    hash: string,
    emailHash: string,
    challenge: StoredEmailChallenge,
    _expiresAt: Date,
  ) {
    this.emailChallenges.set(hash, {
      emailHash,
      challenge,
      consumed: false,
      attempts: 0,
    });
  }
  async beginEmailChallenge(hash: string, emailHash: string) {
    const item = this.emailChallenges.get(hash);
    if (
      !item ||
      item.emailHash !== emailHash ||
      item.consumed ||
      item.attempts >= 5
    )
      return null;
    item.attempts += 1;
    return item.challenge;
  }
  async consumeEmailChallenge(hash: string) {
    const item = this.emailChallenges.get(hash);
    if (!item || item.consumed) return false;
    item.consumed = true;
    return true;
  }
  async createSession(
    hash: string,
    accountId: string,
    email: string,
    csrfHash: string,
    _expiresAt: Date,
  ) {
    this.sessions.set(hash, { accountId, email, csrfHash });
  }
  async listRuns(accountId: string) {
    return [...this.runs.values()].filter((run) => run.accountId === accountId);
  }
  idempotency = new Map<string, OwnedRun>();
  async findIdempotentRun(accountId: string, keyHash: string) {
    return this.idempotency.get(`${accountId}:${keyHash}`) ?? null;
  }
  async createRun(run: OwnedRun, _quota: string, keyHash: string) {
    this.quota += 1;
    this.runs.set(run.id, structuredClone(run));
    this.idempotency.set(`${run.accountId}:${keyHash}`, structuredClone(run));
  }
  async getRun(runId: string) {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : null;
  }
  async updateRun(run: OwnedRun, expectedRevision: number) {
    if (this.runs.get(run.id)?.revision !== expectedRevision) return false;
    this.runs.set(run.id, structuredClone(run));
    return true;
  }
  async expireRun(accountId: string, runId: string) {
    const run = this.runs.get(runId);
    if (!run || run.accountId !== accountId) return false;
    this.runs.delete(runId);
    return true;
  }
  async createLaunch(hash: string, runId: string) {
    this.launches.set(hash, { runId, consumed: false });
  }
  async consumeLaunch(hash: string) {
    const launch = this.launches.get(hash);
    if (!launch || launch.consumed) return null;
    launch.consumed = true;
    return launch.runId;
  }
  async createTargetSession(hash: string, runId: string) {
    this.targets.set(hash, runId);
  }
  async targetRunId(hash: string) {
    return this.targets.get(hash) ?? null;
  }
  async close() {}
}

const config: CloudConfig = {
  port: 8787,
  databaseUrl: "unused",
  controlOrigin: "https://opensidebar.com",
  targetOrigin: "https://play.opensidebar.com",
  cookieSecure: true,
  developmentAccountId: "tester@example.com",
  awsRegion: "eu-central-1",
  authQuotaHmacKey: "test-auth-quota-key",
  controlDatabaseUrl: "postgresql://unused/control",
  cloudControlEnabled: false,
  extensionAuthEnabled: false,
  credentialWritesEnabled: false,
  relayEnabled: false,
  preferenceWritesEnabled: false,
  cloudSessionsEnabled: false,
  checkpointWritesEnabled: false,
  checkpointRestoreEnabled: false,
  deviceCommandsEnabled: false,
  deviceTakeoverEnabled: false,
  temporalShadowEnabled: false,
  temporalCoordinationEnabled: false,
  cloudTesterSubjects: new Set(),
  cloudSessionTesterSubjects: new Set(),
  cloudOperatorSubjects: new Set(),
  relayModelAllowlist: new Set(),
};
const json = (body: unknown) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
  },
  body: JSON.stringify(body),
});

test("Restock runs complete through control and isolated target APIs", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  const createRequest = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "create-restock-1",
    },
    body: JSON.stringify({ scenarioId: "restock-alert" }),
  };
  const created = await app.request("/api/v1/playground/runs", createRequest);
  assert.equal(created.status, 201);
  const { run } = (await created.json()) as { run: OwnedRun };
  assert.equal("accountId" in run, false);
  assert.equal(run.revision, 1);
  const replay = await app.request("/api/v1/playground/runs", createRequest);
  assert.equal(replay.status, 200);
  assert.equal(((await replay.json()) as { run: OwnedRun }).run.id, run.id);
  assert.equal(repository.quota, 1);

  const stocked = await app.request(
    `/api/v1/playground/runs/${run.id}/commands`,
    json({ type: "restock.setAvailability", availability: "in_stock" }),
  );
  assert.equal(stocked.status, 200);
  const inventory = await app.request(
    `/api/v1/playground/runs/${run.id}/commands`,
    json({ type: "restock.setInventory", inventory: 4 }),
  );
  assert.equal(inventory.status, 200);

  const launch = await app.request(
    `/api/v1/playground/runs/${run.id}/launch`,
    json({}),
  );
  const { launchUrl } = (await launch.json()) as { launchUrl: string };
  const launchPath = new URL(launchUrl).pathname;
  const handoff = await app.request(launchPath);
  assert.equal(handoff.status, 302);
  const cookie = handoff.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("__Host-os_playground_target="));
  const targetCookie = cookie as string;
  assert.equal(
    (await app.request(launchPath)).status,
    410,
    "launch capabilities are one-time",
  );

  const state = await app.request("/api/v1/target/state", {
    headers: { cookie: targetCookie },
  });
  const target = (await state.json()) as {
    run: { state: Record<string, unknown> };
  };
  assert.equal(target.run.state.availability, "in_stock");
  assert.equal("feasibility" in target.run.state, false);
  assert.equal(
    (
      await app.request("/api/v1/target/action", {
        ...json({ action: "restock.addToCart", quantity: 1, size: "US 10" }),
        headers: { ...json({}).headers, cookie: targetCookie },
      })
    ).status,
    403,
    "target mutations require the target origin",
  );

  const action = await app.request("/api/v1/target/action", {
    ...json({ action: "restock.addToCart", quantity: 1, size: "US 10" }),
    headers: {
      ...json({}).headers,
      cookie: targetCookie,
      origin: config.targetOrigin,
    },
  });
  assert.equal(action.status, 200);
  const result = await app.request("/api/v1/target/result", {
    ...json({
      schemaVersion: 1,
      runId: run.id,
      terminalStatus: "completed",
      completionDecision: "accepted",
      terminalReason: "objective_reached",
      emittedAt: new Date().toISOString(),
    }),
    headers: {
      ...json({}).headers,
      cookie: targetCookie,
      origin: config.targetOrigin,
    },
  });
  assert.equal(result.status, 200);
  const resultRun = ((await result.json()) as { run: OwnedRun }).run;
  assert.equal(resultRun.result, "succeeded");
  assert.equal("accountId" in resultRun, false);
  assert.equal(
    "feasibility" in resultRun.state,
    false,
    "terminal target responses keep controller fields isolated",
  );

  const removed = await app.request(`/api/v1/playground/runs/${run.id}`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 204);
  assert.equal(await repository.getRun(run.id), null);
});

test("invalid control commands do not advance a run revision", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  const created = await app.request(
    "/api/v1/playground/runs",
    json({ scenarioId: "restock-alert" }),
  );
  const run = ((await created.json()) as { run: OwnedRun }).run;
  const invalid = await app.request(
    `/api/v1/playground/runs/${run.id}/commands`,
    json({ type: "restock.setInventory", inventory: "many" }),
  );
  assert.equal(invalid.status, 400);
  assert.equal((await repository.getRun(run.id))?.revision, 1);
  for (const command of [
    { type: "restock.setInventory", inventory: -1 },
    { type: "restock.setPrice", priceCents: 1.5 },
    { type: "scenario.arm", delaySeconds: 0 },
  ]) {
    assert.equal(
      (
        await app.request(
          `/api/v1/playground/runs/${run.id}/commands`,
          json(command),
        )
      ).status,
      400,
    );
  }
  assert.equal((await repository.getRun(run.id))?.revision, 1);
});

test("a completion claim without the target action is recorded as false success", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, config);
  const created = await app.request(
    "/api/v1/playground/runs",
    json({ scenarioId: "restock-alert" }),
  );
  const run = ((await created.json()) as { run: OwnedRun }).run;
  await app.request(
    `/api/v1/playground/runs/${run.id}/commands`,
    json({ type: "restock.setAvailability", availability: "in_stock" }),
  );
  const launch = await app.request(
    `/api/v1/playground/runs/${run.id}/launch`,
    json({}),
  );
  const handoff = await app.request(
    new URL(((await launch.json()) as { launchUrl: string }).launchUrl)
      .pathname,
  );
  const cookie = handoff.headers.get("set-cookie")!.split(";")[0];
  const result = await app.request("/api/v1/target/result", {
    ...json({
      schemaVersion: 1,
      runId: run.id,
      terminalStatus: "completed",
      completionDecision: "accepted",
      terminalReason: "objective_reached",
      emittedAt: new Date().toISOString(),
    }),
    headers: { ...json({}).headers, cookie, origin: config.targetOrigin },
  });
  assert.equal(result.status, 200);
  assert.equal(
    ((await result.json()) as { run: OwnedRun }).run.result,
    "false_success",
  );
});

test("target cookies cannot authorize Control Center APIs", async () => {
  const app = createApp(new MemoryRepository(), {
    ...config,
    developmentAccountId: undefined,
  });
  const response = await app.request("/api/v1/playground/runs", {
    headers: { cookie: "__Host-os_playground_target=fake" },
  });
  assert.equal(response.status, 401);
});

test("Cognito authorization-code PKCE creates opaque host and CSRF cookies", async () => {
  const repository = new MemoryRepository();
  const app = createApp(repository, {
    ...config,
    developmentAccountId: undefined,
    cognitoDomain: "https://auth.example.test",
    cognitoClientId: "public-client",
  });
  const login = await app.request("/api/v1/playground/auth/login");
  assert.equal(login.status, 302);
  const authorize = new URL(login.headers.get("location")!);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("code_challenge"));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) =>
    String(input).endsWith("/oauth2/token")
      ? new Response(JSON.stringify({ access_token: "cognito-access" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : new Response(
          JSON.stringify({ sub: "cognito-sub", email: "Tester@Example.com" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
  try {
    const callback = await app.request(
      `/api/v1/playground/auth/callback?code=code&state=${authorize.searchParams.get("state")}`,
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "/playground");
    const cookies = callback.headers.getSetCookie();
    assert.ok(
      cookies.some(
        (cookie) =>
          cookie.startsWith("__Host-os_session=") &&
          cookie.includes("HttpOnly"),
      ),
    );
    assert.ok(
      cookies.some(
        (cookie) =>
          cookie.startsWith("os_csrf=") && !cookie.includes("HttpOnly"),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("passwordless email code creates a session without a password", async () => {
  const repository = new MemoryRepository();
  const calls: string[] = [];
  const provider: PasswordlessAuthProvider = {
    async requestCode(email) {
      calls.push(`request:${email}`);
      return { mode: "signin", providerSession: "provider-session" };
    },
    async verifyCode(email, code, challenge) {
      calls.push(`verify:${email}:${code}:${challenge.mode}`);
      return { accountId: "cognito-subject-123", email };
    },
  };
  const app = createApp(
    repository,
    {
      ...config,
      developmentAccountId: undefined,
      cognitoDomain: "https://auth.example.test",
      cognitoClientId: "public-client",
    },
    provider,
  );
  const headers = {
    "content-type": "application/json",
    origin: config.controlOrigin,
  };
  const requested = await app.request("/api/v1/playground/auth/code", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "Tester@Example.com" }),
  });
  assert.equal(requested.status, 202);
  const { challengeId } = (await requested.json()) as { challengeId: string };
  const verified = await app.request("/api/v1/playground/auth/verify", {
    method: "POST",
    headers,
    body: JSON.stringify({
      challengeId,
      email: "tester@example.com",
      code: "123456",
    }),
  });
  assert.equal(verified.status, 204);
  const cookies = verified.headers.getSetCookie();
  assert.ok(
    cookies.some(
      (cookie) =>
        cookie.startsWith("__Host-os_session=") && cookie.includes("HttpOnly"),
    ),
  );
  assert.ok(
    cookies.some(
      (cookie) =>
        cookie.startsWith("os_csrf=") && cookie.includes("SameSite=Strict"),
    ),
  );
  assert.deepEqual(calls, [
    "request:tester@example.com",
    "verify:tester@example.com:123456:signin",
  ]);
  assert.deepEqual(
    [...repository.sessions.values()].map(({ accountId, email }) => ({
      accountId,
      email,
    })),
    [{ accountId: "cognito-subject-123", email: "tester@example.com" }],
  );
  assert.equal(
    (
      await app.request("/api/v1/playground/auth/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({
          challengeId,
          email: "tester@example.com",
          code: "123456",
        }),
      })
    ).status,
    400,
    "email challenges are one-time",
  );
});

test("passwordless endpoints enforce control origin and generic input validation", async () => {
  const provider: PasswordlessAuthProvider = {
    async requestCode() {
      return { mode: "signup" };
    },
    async verifyCode(email) {
      return { accountId: "cognito-subject-123", email };
    },
  };
  const app = createApp(
    new MemoryRepository(),
    { ...config, developmentAccountId: undefined },
    provider,
  );
  assert.equal(
    (
      await app.request("/api/v1/playground/auth/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "person@example.com" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await app.request("/api/v1/playground/auth/code", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: config.controlOrigin,
        },
        body: JSON.stringify({ email: "not-an-email" }),
      })
    ).status,
    400,
  );
});

test("production configuration rejects insecure cookies and merged target hosts", () => {
  const base = {
    DATABASE_URL: "postgresql://service:secret@postgres/opensidebar",
    COGNITO_DOMAIN: "https://auth.example.test",
    COGNITO_CLIENT_ID: "public-client",
    AUTH_QUOTA_HMAC_KEY: "test-key",
  };
  assert.throws(
    () => loadConfig({ ...base, COOKIE_SECURE: "false" }),
    /cannot be disabled/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...base,
        CONTROL_ORIGIN: "https://opensidebar.com",
        TARGET_ORIGIN: "https://opensidebar.com",
      }),
    /different hosts/,
  );
});
