import { createHash } from "node:crypto";
import { tokenHash } from "./crypto.js";
import { PostgresControlRepository } from "./postgres-control-repository.js";
import { PostgresDeviceCommandRepository } from "./postgres-device-command-repository.js";
import { PostgresDeviceCoordinationRepository } from "./postgres-device-coordination-repository.js";
import { PostgresSessionRepository } from "./postgres-session-repository.js";

const databaseUrl = process.env.POSTGRES_COMPARISON_DATABASE_URL;
if (!databaseUrl) throw new Error("set POSTGRES_COMPARISON_DATABASE_URL");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const key = (value: string) => tokenHash(value);
const expectValue = <T extends { kind: string }>(value: T, expected: string) => {
  if (value.kind !== expected) throw new Error(`expected_${expected}_got_${value.kind}`);
  return value as T & { value: Exclude<T extends { value?: infer V } ? V : never, undefined> };
};
const percentile = (values: number[], fraction: number) =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))];

const control = new PostgresControlRepository(databaseUrl);
const sessions = new PostgresSessionRepository(databaseUrl);
const coordination = new PostgresDeviceCoordinationRepository(sessions.pool);
const commands = new PostgresDeviceCommandRepository(sessions.pool);
const accountId = `comparison-${crypto.randomUUID()}`;
let replayCount = 0;
let serializationRetries = 0;

async function retrySerialization<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if ((error as { code?: string }).code !== "40001" || attempt === 9)
        throw error;
      serializationRetries += 1;
      const delayMs = Math.min(2_000, 20 * 2 ** attempt) + Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("serialization_retry_exhausted");
}

async function runSession(lane: "concurrent" | "reconnect", duplicate: boolean) {
  const startedAt = performance.now();
  const suffix = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const created = expectValue(
    await sessions.createSession(accountId, sessionId, key(`session:${suffix}`), {
      schemaVersion: 1,
      title: `Synthetic ${lane}`,
      mode: "cloud_checkpointed",
      runtimeVersion: "0.7.2",
    }),
    "created",
  );
  const device = await control.upsertDevice(
    accountId,
    crypto.randomUUID(),
    "Synthetic device",
    "0.7.2",
    "test_client",
  );
  const connectionId = crypto.randomUUID();
  expectValue(
    await retrySerialization(() =>
      coordination.createConnection(
        accountId,
        device.id,
        connectionId,
        "long_poll",
        new Date(Date.now() + 300_000),
        key(`connection:${suffix}`),
      ),
    ),
    "created",
  );
  const lease = expectValue(
    await retrySerialization(() =>
      coordination.acquireLease({
        accountId,
        sessionId,
        deviceId: device.id,
        connectionId,
        leaseId: crypto.randomUUID(),
        expectedSessionRevision: created.value.revision,
        idempotencyHash: key(`lease:${suffix}`),
      }),
    ),
    "created",
  ).value;
  const commandId = crypto.randomUUID();
  const commandKey = key(`command:${suffix}`);
  expectValue(
    await retrySerialization(() => commands.createCommand({
      accountId,
      deviceId: device.id,
      sessionId,
      commandId,
      leaseId: lease.leaseId,
      leaseGeneration: lease.generation,
      checkpointRevision: lease.checkpointRevision,
      commandKind: "synthetic_read",
      risk: "read",
      actionDigest: hash(`action:${suffix}`),
      expiresAt: new Date(Date.now() + 300_000),
      idempotencyHash: commandKey,
    })),
    "created",
  );
  if (duplicate) {
    expectValue(
      await retrySerialization(() => commands.createCommand({
        accountId,
        deviceId: device.id,
        sessionId,
        commandId,
        leaseId: lease.leaseId,
        leaseGeneration: lease.generation,
        checkpointRevision: lease.checkpointRevision,
        commandKind: "synthetic_read",
        risk: "read",
        actionDigest: hash(`action:${suffix}`),
        expiresAt: new Date(Date.now() + 300_000),
        idempotencyHash: commandKey,
      })),
      "replayed",
    );
    replayCount += 1;
  }
  for (const [index, state] of ["leased", "delivered", "accepted", "started", "succeeded"].entries()) {
    const transitionKey = key(`transition:${suffix}:${state}`);
    const input = {
      accountId,
      sessionId,
      deviceId: device.id,
      commandId,
      leaseId: lease.leaseId,
      leaseGeneration: lease.generation,
      to: state as "leased" | "delivered" | "accepted" | "started" | "succeeded",
      ...(state === "succeeded" ? { outcomeCode: "verified" as const } : {}),
      idempotencyHash: transitionKey,
    };
    expectValue(
      await retrySerialization(() => commands.transitionCommand(input)),
      "updated",
    );
    if (duplicate && index >= 1) {
      expectValue(
        await retrySerialization(() => commands.transitionCommand(input)),
        "replayed",
      );
      replayCount += 1;
    }
  }
  const checkpointId = crypto.randomUUID();
  expectValue(
    await retrySerialization(() => sessions.createCheckpointIntent(
      accountId,
      `comparison/${accountId}/${sessionId}/${checkpointId}`,
      key(`checkpoint-intent:${suffix}`),
      {
        schemaVersion: 1,
        sessionId,
        checkpointId,
        checkpointRevision: 1,
        sessionRevision: created.value.revision,
        checkpointSchemaVersion: 1,
        runtimeVersion: "0.7.2",
        ciphertextSizeBytes: 4096,
        ciphertextSha256: hash(`ciphertext:${suffix}`),
      },
      "under_256k",
    )),
    "created",
  );
  expectValue(
    await retrySerialization(() => sessions.commitCheckpoint(
      accountId,
      sessionId,
      checkpointId,
      created.value.revision,
      key(`checkpoint-commit:${suffix}`),
      4096,
      hash(`ciphertext:${suffix}`),
    )),
    "updated",
  );
  return Math.round(performance.now() - startedAt);
}

try {
  await control.migrate();
  await sessions.migrate();
  await control.upsertAccount(accountId, `${crypto.randomUUID()}@example.invalid`, true);
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () => runSession("concurrent", false)),
  );
  const reconnect = await Promise.all(
    Array.from({ length: 25 }, () => runSession("reconnect", true)),
  );
  const all = [...concurrent, ...reconnect].sort((a, b) => a - b);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    engine: "postgresql",
    concurrentSessions: concurrent.length,
    reconnectDevices: reconnect.length,
    checkpointCommits: all.length,
    idempotentReplays: replayCount,
    serializationRetries,
    failures: 0,
    latencyMs: {
      min: all[0],
      p50: percentile(all, 0.5),
      p95: percentile(all, 0.95),
      max: all[all.length - 1],
    },
  }, null, 2)}\n`);
} finally {
  await Promise.all([sessions.close(), control.close()]);
}
