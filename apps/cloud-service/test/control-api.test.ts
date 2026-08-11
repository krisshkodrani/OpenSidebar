import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import type { CloudConfig } from "../src/config.js";
import { ControlAuthService } from "../src/control-auth.js";
import { tokenHash } from "../src/crypto.js";
import type { PlaygroundRepository } from "../src/repository.js";
import { MemoryControlRepository } from "./memory-control-repository.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop",
  origin = `chrome-extension://${extensionId}`;
const baseConfig: CloudConfig = {
  port: 8787,
  databaseUrl: "postgresql://unused/db",
  controlDatabaseUrl: "postgresql://unused/db",
  controlOrigin: "https://opensidebar.com",
  targetOrigin: "https://play.opensidebar.com",
  cookieSecure: true,
  awsRegion: "eu-central-1",
  authQuotaHmacKey: "test",
  cloudControlEnabled: true,
  extensionAuthEnabled: true,
  credentialWritesEnabled: false,
  relayEnabled: false,
  preferenceWritesEnabled: true,
  cloudSessionsEnabled: false,
  checkpointWritesEnabled: false,
  checkpointRestoreEnabled: false,
  deviceCommandsEnabled: false,
  deviceTakeoverEnabled: false,
  temporalShadowEnabled: false,
  temporalCoordinationEnabled: false,
  extensionId,
  extensionClientId: "client",
  cognitoDomain: "https://auth.example.com",
  cognitoClientId: "web-client",
  cloudTesterSubjects: new Set(["account-1"]),
  cloudSessionTesterSubjects: new Set(["account-1"]),
  cloudOperatorSubjects: new Set(["account-1"]),
  relayModelAllowlist: new Set(["allowed/model"]),
};
const playground = {
  session: async () => null,
  health: async () => undefined,
  consumeAuthQuota: async () => undefined,
  createAuthFlow: async () => undefined,
} as unknown as PlaygroundRepository;
const body = (value: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { origin, "content-type": "application/json", ...headers },
  body: JSON.stringify(value),
});

test("website account session requires matching double-submit CSRF for mutations", async () => {
  const repository = new MemoryControlRepository();
  const websitePlayground = {
    health: async () => undefined,
    session: async (hash: string) =>
      hash === tokenHash("web-token")
        ? {
            accountId: "account-1",
            email: "owner@example.com",
            csrfHash: tokenHash("csrf-token"),
          }
        : null,
    consumeAuthQuota: async () => undefined,
  } as unknown as PlaygroundRepository;
  const auth = new ControlAuthService(repository, baseConfig);
  const app = createApp(websitePlayground, baseConfig, undefined, {
    repository,
    auth,
  });
  const cookie = "__Host-os_session=web-token; os_csrf=csrf-token";
  assert.equal(
    (
      await app.request("/api/v1/account", {
        headers: { origin: "https://opensidebar.com", cookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await app.request("/api/v1/account/device-links", {
        method: "POST",
        headers: { origin: "https://opensidebar.com", cookie },
      })
    ).status,
    403,
  );
  const accepted = await app.request("/api/v1/account/device-links", {
    method: "POST",
    headers: {
      origin: "https://opensidebar.com",
      cookie,
      "x-os-csrf": "csrf-token",
    },
  });
  assert.equal(accepted.status, 201);
  assert.match(
    ((await accepted.json()) as { code: string }).code,
    /^[A-Z2-9]{8}$/,
  );
});

test("control API stays unavailable when the master flag is disabled", async () => {
  const repository = new MemoryControlRepository();
  const config = {
    ...baseConfig,
    cloudControlEnabled: false,
    extensionAuthEnabled: false,
    preferenceWritesEnabled: false,
  };
  const app = createApp(playground, config, undefined, {
    repository,
    auth: new ControlAuthService(repository, config),
  });
  const response = await app.request("/api/v1/account", {
    headers: { origin },
  });
  assert.equal(response.status, 503);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "cloud_control_disabled",
  );
});

test("removing a named tester blocks an already-issued bearer token", async () => {
  const cloudTesterSubjects = new Set(["account-1"]);
  const activeConfig = { ...baseConfig, cloudTesterSubjects };
  const repository = new MemoryControlRepository();
  await repository.upsertAccount("account-1", "owner@example.com", true);
  await repository.createDeviceLink(
    tokenHash("ABCDEFGH"),
    "account-1",
    new Date(Date.now() + 60_000),
  );
  const app = createApp(playground, activeConfig, undefined, {
    repository,
    auth: new ControlAuthService(repository, activeConfig),
  });
  const linked = await app.request(
    "/api/v1/extension/auth/link",
    body({
      code: "ABCDEFGH",
      installationId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
      displayName: "Chrome",
      extensionVersion: "0.7.2",
    }),
  );
  assert.equal(linked.status, 201);
  const { accessToken } = (await linked.json()) as { accessToken: string };
  assert.equal(
    (
      await app.request("/api/v1/account", {
        headers: { origin, authorization: `Bearer ${accessToken}` },
      })
    ).status,
    200,
  );
  cloudTesterSubjects.clear();
  const blocked = await app.request("/api/v1/account", {
    headers: { origin, authorization: `Bearer ${accessToken}` },
  });
  assert.equal(blocked.status, 403);
  assert.equal(
    ((await blocked.json()) as { error: { code: string } }).error.code,
    "cloud_access_not_enabled",
  );
});

test("read-only dashboard returns closed metadata and hides activation from non-operators", async () => {
  const activeConfig = {
    ...baseConfig,
    cloudOperatorSubjects: new Set<string>(),
  };
  const repository = new MemoryControlRepository();
  await repository.upsertAccount("account-1", "owner@example.com", true);
  await repository.createDeviceLink(
    tokenHash("ABCDEFGH"),
    "account-1",
    new Date(Date.now() + 60_000),
  );
  const app = createApp(playground, activeConfig, undefined, {
    repository,
    auth: new ControlAuthService(repository, activeConfig),
  });
  const linked = await app.request(
    "/api/v1/extension/auth/link",
    body({
      code: "ABCDEFGH",
      installationId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
      displayName: "Chrome",
      extensionVersion: "0.7.2",
    }),
  );
  const { accessToken } = (await linked.json()) as { accessToken: string };
  const headers = { origin, authorization: `Bearer ${accessToken}` };
  const summary = await app.request("/api/v1/dashboard/summary", { headers });
  assert.equal(summary.status, 200);
  const value = await summary.json();
  assert.equal(value.detailedTraces, "local_only");
  assert.equal(value.sessions.enabled, false);
  assert.deepEqual(value.sessions.recent, []);
  for (const forbidden of [
    "prompt",
    "screenshot",
    "checkpointBody",
    "accessToken",
  ]) {
    assert.equal(
      JSON.stringify(value).toLowerCase().includes(forbidden.toLowerCase()),
      false,
    );
  }
  assert.equal(
    (await app.request("/api/v1/dashboard/activation", { headers })).status,
    404,
  );
});

test("operator activation status is read-only and reports all capabilities disabled", async () => {
  const repository = new MemoryControlRepository();
  await repository.upsertAccount("account-1", "owner@example.com", true);
  await repository.createDeviceLink(
    tokenHash("ABCDEFGH"),
    "account-1",
    new Date(Date.now() + 60_000),
  );
  const app = createApp(playground, baseConfig, undefined, {
    repository,
    auth: new ControlAuthService(repository, baseConfig),
  });
  const linked = await app.request(
    "/api/v1/extension/auth/link",
    body({
      code: "ABCDEFGH",
      installationId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
      displayName: "Chrome",
      extensionVersion: "0.7.2",
    }),
  );
  const { accessToken } = (await linked.json()) as { accessToken: string };
  const response = await app.request("/api/v1/dashboard/activation", {
    headers: { origin, authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.stage, "disabled");
  assert.equal(status.operatorMode, "read_only");
  assert.equal(Object.values(status.flags).some(Boolean), false);
});

test("disabled control middleware cannot intercept Playground routes", async () => {
  const repository = new MemoryControlRepository();
  const config = {
    ...baseConfig,
    cloudControlEnabled: false,
    extensionAuthEnabled: false,
    preferenceWritesEnabled: false,
  };
  const app = createApp(playground, config, undefined, {
    repository,
    auth: new ControlAuthService(repository, config),
  });

  assert.equal((await app.request("/api/v1/account")).status, 503);
  const login = await app.request(
    "/api/v1/playground/auth/login?return=/account",
  );
  assert.equal(login.status, 302, await login.clone().text());
  assert.match(
    login.headers.get("location") ?? "",
    /^https:\/\/auth\.example\.com/,
  );
});

test("relay request bodies use the dedicated 8 MiB boundary", async () => {
  const repository = new MemoryControlRepository();
  const config = { ...baseConfig, relayEnabled: true };
  const app = createApp(playground, config, undefined, {
    repository,
    auth: new ControlAuthService(repository, config),
  });
  const mediumBody = JSON.stringify({ padding: "x".repeat(128 * 1024) });

  const relayMedium = await app.request(
    "/api/v1/relay/chat/completions",
    body(JSON.parse(mediumBody)),
  );
  assert.equal(relayMedium.status, 401);
  assert.equal((await relayMedium.json()).error.code, "unauthenticated");

  const regularMedium = await app.request("/api/v1/preferences", {
    method: "PUT",
    headers: { origin, "content-type": "application/json" },
    body: mediumBody,
  });
  assert.equal(regularMedium.status, 400);
  assert.equal((await regularMedium.json()).error.code, "body_too_large");

  const relayOversized = await app.request(
    "/api/v1/relay/chat/completions",
    body({ padding: "x".repeat(8 * 1024 * 1024) }),
  );
  assert.equal(relayOversized.status, 400);
  assert.equal((await relayOversized.json()).error.code, "body_too_large");
});

test("linked extension session reaches account and revisioned preferences with exact CORS", async () => {
  const repository = new MemoryControlRepository();
  await repository.upsertAccount("account-1", "owner@example.com", true);
  await repository.createDeviceLink(
    tokenHash("ABCDEFGH"),
    "account-1",
    new Date(Date.now() + 60_000),
  );
  const auth = new ControlAuthService(repository, baseConfig);
  const app = createApp(playground, baseConfig, undefined, {
    repository,
    auth,
  });
  const linked = await app.request(
    "/api/v1/extension/auth/link",
    body({
      code: "ABCDEFGH",
      installationId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
      displayName: "Chrome",
      extensionVersion: "0.7.0",
    }),
  );
  assert.equal(linked.status, 201);
  assert.equal(linked.headers.get("access-control-allow-origin"), origin);
  assert.match(
    linked.headers.get("access-control-allow-headers") ?? "",
    /if-match/,
  );
  const session = (await linked.json()) as { accessToken: string };
  const headers = {
    origin,
    authorization: `Bearer ${session.accessToken}`,
    "content-type": "application/json",
  };
  const account = await app.request("/api/v1/account", { headers });
  assert.equal(account.status, 200);
  assert.equal(
    ((await account.json()) as { email: string }).email,
    "owner@example.com",
  );
  const preferences = {
    schemaVersion: 1,
    revision: 1,
    inferenceMode: "cloud",
    providerMode: "openrouter",
    maxTurns: 100,
    theme: "system",
    showSessionMetrics: true,
  };
  const saved = await app.request("/api/v1/preferences", {
    method: "PUT",
    headers: { ...headers, "if-match": "0" },
    body: JSON.stringify(preferences),
  });
  assert.equal(saved.status, 200);
  const unsafe = await app.request("/api/v1/preferences", {
    method: "PUT",
    headers: { ...headers, "if-match": "1" },
    body: JSON.stringify({
      ...preferences,
      revision: 2,
      requireApprovals: false,
    }),
  });
  assert.equal(unsafe.status, 400);
  const devices = await app.request("/api/v1/account/devices", { headers });
  const deviceId = (
    (await devices.json()) as { devices: Array<{ id: string }> }
  ).devices[0]!.id;
  const revoked = await app.request(`/api/v1/account/devices/${deviceId}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(revoked.status, 204);
  assert.equal((await app.request("/api/v1/account", { headers })).status, 401);
  const hostile = await app.request("/api/v1/account", {
    headers: { ...headers, origin: "https://attacker.invalid" },
  });
  assert.equal(hostile.status, 403);
});
