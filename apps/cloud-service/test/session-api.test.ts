import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { createApp } from "../src/app.js";
import type { CloudConfig } from "../src/config.js";
import { ControlAuthService } from "../src/control-auth.js";
import { tokenHash } from "../src/crypto.js";
import type { PlaygroundRepository } from "../src/repository.js";
import { MemoryControlRepository } from "./memory-control-repository.js";
import { MemoryDeviceCoordinationRepository } from "./memory-device-coordination-repository.js";
import { MemorySessionRepository } from "./memory-session-repository.js";
import {
  CheckpointVault,
  type CheckpointObjectPort,
} from "../src/checkpoint-vault.js";
import type { KmsPort } from "../src/credential-vault.js";
import { CommandVault } from "../src/command-vault.js";
import { MemoryDeviceCommandRepository } from "./memory-device-command-repository.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const origin = `chrome-extension://${extensionId}`;
const config: CloudConfig = {
  port: 8787,
  databaseUrl: "postgresql://unused/db",
  controlDatabaseUrl: "postgresql://unused/db",
  controlOrigin: "https://opensidebar.com",
  targetOrigin: "https://play.opensidebar.com",
  cookieSecure: true,
  awsRegion: "eu-central-1",
  authQuotaHmacKey: "session-api-test-key",
  cloudControlEnabled: true,
  extensionAuthEnabled: true,
  credentialWritesEnabled: false,
  relayEnabled: false,
  preferenceWritesEnabled: false,
  cloudSessionsEnabled: true,
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
  cloudTesterSubjects: new Set(["account-1", "account-2"]),
  cloudSessionTesterSubjects: new Set(["account-1", "account-2"]),
  cloudOperatorSubjects: new Set(["account-1"]),
  relayModelAllowlist: new Set(),
};
const playground = {
  session: async () => null,
  health: async () => undefined,
  consumeAuthQuota: async () => undefined,
  createAuthFlow: async () => undefined,
} as unknown as PlaygroundRepository;

async function fixture(
  activeConfig: CloudConfig = config,
  coordinationRepository?: MemoryDeviceCoordinationRepository,
  checkpointVault?: CheckpointVault,
  commandVault?: CommandVault,
  commandRepository?: MemoryDeviceCommandRepository,
) {
  const repository = new MemoryControlRepository();
  const sessionRepository = new MemorySessionRepository();
  const auth = new ControlAuthService(repository, activeConfig);
  const app = createApp(playground, activeConfig, undefined, {
    repository,
    sessionRepository,
    coordinationRepository,
    checkpointVault,
    commandVault,
    commandRepository,
    auth,
  });
  const link = async (
    accountId: string,
    code: string,
    installationId: string,
  ) => {
    await repository.upsertAccount(accountId, `${accountId}@example.com`, true);
    await repository.createDeviceLink(
      tokenHash(code),
      accountId,
      new Date(Date.now() + 60_000),
    );
    const response = await app.request("/api/v1/extension/auth/link", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        code,
        installationId,
        displayName: "Test Chrome",
        extensionVersion: "0.7.2",
      }),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as { accessToken: string };
  };
  return { app, repository, sessionRepository, link };
}

class TestObjects implements CheckpointObjectPort {
  values = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array) {
    if (this.values.has(key)) throw new Error("checkpoint_object_exists");
    this.values.set(key, Uint8Array.from(body));
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error("missing");
    return Uint8Array.from(value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}
class TestKms implements KmsPort {
  values = new Map<string, Uint8Array>();
  async send(command: DecryptCommand | GenerateDataKeyCommand) {
    if (command instanceof GenerateDataKeyCommand) {
      const Plaintext = randomBytes(32),
        CiphertextBlob = randomBytes(32);
      this.values.set(
        Buffer.from(CiphertextBlob).toString("base64"),
        Uint8Array.from(Plaintext),
      );
      return { Plaintext, CiphertextBlob };
    }
    return {
      Plaintext: this.values.get(
        Buffer.from(command.input.CiphertextBlob ?? []).toString("base64"),
      ),
    };
  }
}

const requestHeaders = (accessToken: string, extra = {}) => ({
  origin,
  authorization: `Bearer ${accessToken}`,
  "content-type": "application/json",
  ...extra,
});

test("session routes require the dedicated named-tester allowlist", async () => {
  const activeConfig = {
    ...config,
    cloudSessionTesterSubjects: new Set(["account-1"]),
  };
  const { app, link } = await fixture(activeConfig);
  const { accessToken } = await link(
    "account-2",
    "ABCDEFGH",
    "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
  );
  const sessions = await app.request("/api/v1/sessions", {
    headers: requestHeaders(accessToken),
  });
  assert.equal(sessions.status, 403);
  assert.equal(
    ((await sessions.json()) as { error: { code: string } }).error.code,
    "cloud_session_access_not_enabled",
  );
  assert.equal(
    (
      await app.request("/api/v1/account", {
        headers: requestHeaders(accessToken),
      })
    ).status,
    200,
  );
});

test("session create is idempotent and exposes no account partition key", async () => {
  const { app, link } = await fixture();
  const { accessToken } = await link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const payload = {
    schemaVersion: 1,
    title: "Quarterly report",
    mode: "cloud_checkpointed",
    runtimeVersion: "0.7.2",
  };
  const missingKey = await app.request("/api/v1/sessions", {
    method: "POST",
    headers: requestHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  assert.equal(missingKey.status, 400);

  const headers = requestHeaders(accessToken, {
    "idempotency-key": "session-create-0001",
  });
  const created = await app.request("/api/v1/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(created.status, 201);
  const first = (await created.json()) as Record<string, unknown>;
  assert.equal(first.accountId, undefined);
  assert.equal(first.revision, 1);

  const replayed = await app.request("/api/v1/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(replayed.status, 200);
  assert.equal(
    ((await replayed.json()) as { sessionId: string }).sessionId,
    first.sessionId,
  );
  assert.match(
    replayed.headers.get("access-control-allow-headers") ?? "",
    /idempotency-key/,
  );
});

test("session timeline contains metadata only and never checkpoint bodies", async () => {
  const { app, link } = await fixture();
  const { accessToken } = await link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const created = await app.request("/api/v1/sessions", {
    method: "POST",
    headers: requestHeaders(accessToken, {
      "idempotency-key": "timeline-session-create-0001",
    }),
    body: JSON.stringify({
      schemaVersion: 1,
      title: "Metadata timeline",
      mode: "cloud_checkpointed",
      runtimeVersion: "0.7.2",
    }),
  });
  assert.equal(created.status, 201);
  const session = (await created.json()) as { sessionId: string };
  const response = await app.request(
    `/api/v1/sessions/${session.sessionId}/timeline`,
    { headers: requestHeaders(accessToken) },
  );
  assert.equal(response.status, 200);
  const timeline = await response.json();
  assert.equal(timeline.detailedTrace, "local_only");
  assert.deepEqual(
    timeline.events.map((event: { kind: string }) => event.kind),
    ["session_created", "session_updated"],
  );
  const serialized = JSON.stringify(timeline).toLowerCase();
  for (const forbidden of ["prompt", "screenshot", "cookie", "body"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("session ownership and revision checks fail closed", async () => {
  const { app, link } = await fixture();
  const accountOne = await link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const accountTwo = await link(
    "account-2",
    "JKLMNPQR",
    "ee1d61ab-b013-4681-b8d4-131e89da3063",
  );
  const created = await app.request("/api/v1/sessions", {
    method: "POST",
    headers: requestHeaders(accountOne.accessToken, {
      "idempotency-key": "session-create-0002",
    }),
    body: JSON.stringify({
      schemaVersion: 1,
      title: "Private session",
      mode: "cloud_archived",
      runtimeVersion: "0.7.2",
    }),
  });
  const session = (await created.json()) as {
    sessionId: string;
    revision: number;
  };

  assert.equal(
    (
      await app.request(`/api/v1/sessions/${session.sessionId}`, {
        headers: requestHeaders(accountTwo.accessToken),
      })
    ).status,
    404,
  );

  const stale = await app.request(`/api/v1/sessions/${session.sessionId}`, {
    method: "PATCH",
    headers: requestHeaders(accountOne.accessToken, {
      "idempotency-key": "session-update-0001",
      "if-match": "99",
    }),
    body: JSON.stringify({ schemaVersion: 1, pinned: true }),
  });
  assert.equal(stale.status, 409);

  const updated = await app.request(`/api/v1/sessions/${session.sessionId}`, {
    method: "PATCH",
    headers: requestHeaders(accountOne.accessToken, {
      "idempotency-key": "session-update-0002",
      "if-match": String(session.revision),
    }),
    body: JSON.stringify({ schemaVersion: 1, pinned: true }),
  });
  assert.equal(updated.status, 200);
  assert.equal(((await updated.json()) as { pinned: boolean }).pinned, true);
});

test("session exports are independently disabled and idempotently queued", async () => {
  const disabled = await fixture();
  const disabledAuth = await disabled.link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const create = async (app: Awaited<ReturnType<typeof fixture>>["app"], token: string, key: string) => {
    const response = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: requestHeaders(token, { "idempotency-key": key }),
      body: JSON.stringify({
        schemaVersion: 1,
        title: "Export test",
        mode: "cloud_checkpointed",
        runtimeVersion: "0.7.2",
      }),
    });
    return (await response.json()) as { sessionId: string; revision: number };
  };
  const disabledSession = await create(disabled.app, disabledAuth.accessToken, "export-create-disabled-0001");
  assert.equal(
    (
      await disabled.app.request(`/api/v1/sessions/${disabledSession.sessionId}/export`, {
        method: "POST",
        headers: requestHeaders(disabledAuth.accessToken, {
          "idempotency-key": "export-disabled-request-0001",
          "if-match": String(disabledSession.revision),
        }),
      })
    ).status,
    503,
  );

  const enabled = await fixture({ ...config, sessionExportsEnabled: true });
  const auth = await enabled.link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const session = await create(enabled.app, auth.accessToken, "export-create-enabled-0001");
  const headers = requestHeaders(auth.accessToken, {
    "idempotency-key": "export-request-enabled-0001",
    "if-match": String(session.revision),
  });
  const queued = await enabled.app.request(`/api/v1/sessions/${session.sessionId}/export`, {
    method: "POST",
    headers,
  });
  assert.equal(queued.status, 202);
  const job = (await queued.json()) as { jobId: string; state: string };
  assert.equal(job.state, "pending");
  assert.equal(
    (
      await enabled.app.request(`/api/v1/sessions/${session.sessionId}/export`, {
        method: "POST",
        headers,
      })
    ).status,
    200,
  );
  const status = await enabled.app.request(
    `/api/v1/sessions/${session.sessionId}/exports/${job.jobId}`,
    { headers: requestHeaders(auth.accessToken) },
  );
  assert.equal(status.status, 200);
});

test("checkpoint reads remain independently disabled", async () => {
  const { app, link } = await fixture();
  const { accessToken } = await link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const response = await app.request(
    "/api/v1/sessions/1bd0c891-8ddb-468f-8f02-e47a0e430176/checkpoints/latest",
    { headers: requestHeaders(accessToken) },
  );
  assert.equal(response.status, 503);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "checkpoint_restore_disabled",
  );
});

test("checkpoint upload, commit, and restore are encrypted and ownership scoped", async () => {
  const objects = new TestObjects();
  const vault = new CheckpointVault(objects, "session-key", new TestKms());
  const enabledConfig: CloudConfig = {
    ...config,
    checkpointWritesEnabled: true,
    checkpointRestoreEnabled: true,
    sessionKmsKeyId: "session-key",
    sessionBucketName: "session-bucket",
  };
  const { app, link } = await fixture(enabledConfig, undefined, vault);
  const owner = await link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const stranger = await link(
    "account-2",
    "JKLMNPQR",
    "ee1d61ab-b013-4681-b8d4-131e89da3063",
  );
  const created = await app.request("/api/v1/sessions", {
    method: "POST",
    headers: requestHeaders(owner.accessToken, {
      "idempotency-key": "checkpoint-session-create-0001",
    }),
    body: JSON.stringify({
      schemaVersion: 1,
      title: "Cloud restore",
      mode: "cloud_checkpointed",
      runtimeVersion: "0.7.2",
    }),
  });
  const session = (await created.json()) as {
    sessionId: string;
    revision: number;
  };
  const checkpointId = crypto.randomUUID();
  const checkpoint = {
    schemaVersion: 1,
    sessionId: session.sessionId,
    checkpointId,
    revision: 1,
    createdAt: new Date().toISOString(),
    runtimeVersion: "0.7.2",
    reason: "pause",
    objective: {
      originalRequest: "Prepare the report",
      currentInterpretation: "Prepare the report",
      successCriteria: ["Report prepared"],
      userConstraints: [],
    },
    conversation: { messages: [] },
    execution: { plan: [], completedActions: [], unresolvedFacts: [] },
    grounding: {
      expectedOrigins: ["https://example.com"],
      userVisibleStateSummary: "Report page",
      requiredCapabilities: ["navigation"],
    },
    pending: { kind: "none" },
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      cachedTokens: 0,
      imageTokenEstimate: 0,
      turns: 1,
    },
  };
  const intent = await app.request(
    `/api/v1/sessions/${session.sessionId}/checkpoints/intents`,
    {
      method: "POST",
      headers: requestHeaders(owner.accessToken, {
        "idempotency-key": "checkpoint-intent-api-0001",
      }),
      body: JSON.stringify({
        schemaVersion: 1,
        sessionRevision: session.revision,
        checkpoint,
      }),
    },
  );
  assert.equal(intent.status, 201);
  const index = (await intent.json()) as {
    ciphertextSizeBytes: number;
    ciphertextSha256: string;
  };
  assert.equal(
    [...objects.values.values()].some((body) =>
      Buffer.from(body).includes(Buffer.from("Prepare the report")),
    ),
    false,
  );
  const committed = await app.request(
    `/api/v1/sessions/${session.sessionId}/checkpoints/${checkpointId}/commit`,
    {
      method: "POST",
      headers: requestHeaders(owner.accessToken, {
        "idempotency-key": "checkpoint-commit-api-0001",
        "if-match": String(session.revision),
      }),
      body: JSON.stringify({
        schemaVersion: 1,
        checkpointId,
        ciphertextSizeBytes: index.ciphertextSizeBytes,
        ciphertextSha256: index.ciphertextSha256,
      }),
    },
  );
  assert.equal(committed.status, 200);
  const restored = await app.request(
    `/api/v1/sessions/${session.sessionId}/checkpoints/${checkpointId}`,
    { headers: requestHeaders(owner.accessToken) },
  );
  assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), checkpoint);
  assert.equal(
    (
      await app.request(
        `/api/v1/sessions/${session.sessionId}/checkpoints/${checkpointId}`,
        { headers: requestHeaders(stranger.accessToken) },
      )
    ).status,
    404,
  );
});

test("device connections and leases require the authenticated device and remain takeover-gated", async () => {
  const coordination = new MemoryDeviceCoordinationRepository();
  const enabledConfig: CloudConfig = {
    ...config,
    deviceCommandsEnabled: true,
  };
  const { app, repository, link } = await fixture(enabledConfig, coordination);
  const { accessToken } = await link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const device = [...repository.devices.values()][0]!;
  const wrongDevice = await app.request(
    "/api/v1/devices/not-this-device/connections",
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "connection-create-api-0001",
      }),
      body: JSON.stringify({ schemaVersion: 1, transport: "long_poll" }),
    },
  );
  assert.equal(wrongDevice.status, 403);

  const connected = await app.request(
    `/api/v1/devices/${device.id}/connections`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "connection-create-api-0002",
      }),
      body: JSON.stringify({ schemaVersion: 1, transport: "long_poll" }),
    },
  );
  assert.equal(connected.status, 201);
  const connection = (await connected.json()) as { connectionId: string };

  const created = await app.request("/api/v1/sessions", {
    method: "POST",
    headers: requestHeaders(accessToken, {
      "idempotency-key": "session-create-api-lease-0001",
    }),
    body: JSON.stringify({
      schemaVersion: 1,
      title: "Lease test",
      mode: "cloud_checkpointed",
      runtimeVersion: "0.7.2",
    }),
  });
  const session = (await created.json()) as {
    sessionId: string;
    revision: number;
  };
  const leased = await app.request(
    `/api/v1/sessions/${session.sessionId}/lease`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "lease-acquire-api-0001",
      }),
      body: JSON.stringify({
        schemaVersion: 1,
        connectionId: connection.connectionId,
        expectedSessionRevision: session.revision,
      }),
    },
  );
  assert.equal(leased.status, 201);
  const lease = (await leased.json()) as {
    leaseId: string;
    generation: number;
  };
  assert.equal(lease.generation, 1);

  const reconnected = await app.request(
    `/api/v1/devices/${device.id}/connections`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "connection-reconnect-api-0001",
      }),
      body: JSON.stringify({ schemaVersion: 1, transport: "long_poll" }),
    },
  );
  assert.equal(reconnected.status, 201);
  const reconnectConnection = (await reconnected.json()) as {
    connectionId: string;
  };
  assert.notEqual(reconnectConnection.connectionId, connection.connectionId);
  const renewed = await app.request(
    `/api/v1/sessions/${session.sessionId}/lease/reconnect`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "lease-reconnect-api-0001",
      }),
      body: JSON.stringify({
        schemaVersion: 1,
        connectionId: reconnectConnection.connectionId,
        leaseId: lease.leaseId,
        generation: lease.generation,
      }),
    },
  );
  assert.equal(renewed.status, 200);
  assert.equal(
    ((await renewed.json()) as { generation: number }).generation,
    lease.generation,
  );

  const takeover = await app.request(
    `/api/v1/sessions/${session.sessionId}/lease/takeover`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "lease-takeover-api-0001",
      }),
      body: JSON.stringify({
        schemaVersion: 1,
        connectionId: connection.connectionId,
        leaseId: lease.leaseId,
        generation: lease.generation,
        expectedSessionRevision: session.revision,
      }),
    },
  );
  assert.equal(takeover.status, 503);
});

test("device commands are encrypted, polled in sequence, and transition monotonically", async () => {
  const coordination = new MemoryDeviceCoordinationRepository();
  const objects = new TestObjects();
  const kms = new TestKms();
  const commands = new MemoryDeviceCommandRepository();
  const commandVault = new CommandVault(objects, "session-key", kms);
  const enabledConfig: CloudConfig = {
    ...config,
    deviceCommandsEnabled: true,
    sessionKmsKeyId: "session-key",
    sessionBucketName: "session-bucket",
  };
  const { app, repository, link } = await fixture(
    enabledConfig,
    coordination,
    undefined,
    commandVault,
    commands,
  );
  const { accessToken } = await link(
    "account-1",
    "ABCDEFGH",
    "84c86e91-2f7b-4470-a6de-038269d9bb4b",
  );
  const device = [...repository.devices.values()][0]!;
  const connectionResponse = await app.request(
    `/api/v1/devices/${device.id}/connections`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "command-connection-api-0001",
      }),
      body: JSON.stringify({ schemaVersion: 1, transport: "long_poll" }),
    },
  );
  const connection = (await connectionResponse.json()) as {
    connectionId: string;
  };
  const sessionResponse = await app.request("/api/v1/sessions", {
    method: "POST",
    headers: requestHeaders(accessToken, {
      "idempotency-key": "command-session-api-0001",
    }),
    body: JSON.stringify({
      schemaVersion: 1,
      title: "Command session",
      mode: "cloud_checkpointed",
      runtimeVersion: "0.7.2",
    }),
  });
  const session = (await sessionResponse.json()) as {
    sessionId: string;
    revision: number;
  };
  const leaseResponse = await app.request(
    `/api/v1/sessions/${session.sessionId}/lease`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "command-lease-api-0001",
      }),
      body: JSON.stringify({
        schemaVersion: 1,
        connectionId: connection.connectionId,
        expectedSessionRevision: session.revision,
      }),
    },
  );
  const lease = (await leaseResponse.json()) as {
    leaseId: string;
    generation: number;
    checkpointRevision: number;
  };
  const issued = await app.request(
    `/api/v1/sessions/${session.sessionId}/commands`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "command-issue-api-0001",
      }),
      body: JSON.stringify({
        schemaVersion: 1,
        leaseId: lease.leaseId,
        leaseGeneration: lease.generation,
        checkpointRevision: lease.checkpointRevision,
        action: { kind: "read_page", arguments: {} },
        preconditions: [{ kind: "origin", value: "https://example.com" }],
        risk: "read",
        expiresInSeconds: 60,
      }),
    },
  );
  assert.equal(issued.status, 201);
  const record = (await issued.json()) as { commandId: string };
  const replayedIssue = await app.request(
    `/api/v1/sessions/${session.sessionId}/commands`,
    {
      method: "POST",
      headers: requestHeaders(accessToken, {
        "idempotency-key": "command-issue-api-0001",
      }),
      body: JSON.stringify({
        schemaVersion: 1,
        leaseId: lease.leaseId,
        leaseGeneration: lease.generation,
        checkpointRevision: lease.checkpointRevision,
        action: { kind: "read_page", arguments: {} },
        preconditions: [{ kind: "origin", value: "https://example.com" }],
        risk: "read",
        expiresInSeconds: 60,
      }),
    },
  );
  assert.equal(replayedIssue.status, 200);
  assert.equal(
    ((await replayedIssue.json()) as { commandId: string }).commandId,
    record.commandId,
  );
  assert.equal(objects.values.size, 1);
  assert.equal(
    [...objects.values.values()].some((body) =>
      Buffer.from(body).includes(Buffer.from("read_page")),
    ),
    false,
  );
  const poll = await app.request(
    `/api/v1/sessions/${session.sessionId}/commands?leaseId=${lease.leaseId}&generation=${lease.generation}&after=0`,
    { headers: requestHeaders(accessToken) },
  );
  assert.equal(poll.status, 200);
  const delivered = (await poll.json()) as {
    commands: Array<{
      record: { state: string };
      command: { action: { kind: string } };
    }>;
  };
  assert.equal(delivered.commands[0]?.record.state, "delivered");
  assert.equal(delivered.commands[0]?.command.action.kind, "read_page");

  for (const [path, outcomeCode] of [
    ["accept", undefined],
    ["start", undefined],
    ["result", "verified"],
  ] as const) {
    const response = await app.request(
      `/api/v1/sessions/${session.sessionId}/commands/${record.commandId}/${path}`,
      {
        method: "POST",
        headers: requestHeaders(accessToken, {
          "idempotency-key": `command-${path}-api-0001`,
        }),
        body: JSON.stringify({
          schemaVersion: 1,
          leaseId: lease.leaseId,
          leaseGeneration: lease.generation,
          ...(outcomeCode ? { outcomeCode } : {}),
        }),
      },
    );
    assert.equal(response.status, 200);
  }
  assert.equal(commands.values.get(record.commandId)?.state, "succeeded");
});
