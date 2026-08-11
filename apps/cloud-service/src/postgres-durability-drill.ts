import { tokenHash } from "./crypto.js";
import { PostgresControlRepository } from "./postgres-control-repository.js";
import { PostgresDeviceCoordinationRepository } from "./postgres-device-coordination-repository.js";
import { PostgresSessionRepository } from "./postgres-session-repository.js";

const databaseUrl = process.env.DRILL_DATABASE_URL;
if (!databaseUrl) throw new Error("DRILL_DATABASE_URL is required");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.endsWith("_drill"))
  throw new Error("refusing_non_drill_database");

const control = new PostgresControlRepository(databaseUrl);
const sessions = new PostgresSessionRepository(databaseUrl);
try {
  await control.migrate();
  await sessions.migrate();
  const coordination = new PostgresDeviceCoordinationRepository(sessions.pool);
  const accountId = `drill-${crypto.randomUUID()}`;
  await control.upsertAccount(accountId, `${accountId}@invalid.example`, true);
  const devices = await Promise.all([
    control.upsertDevice(accountId, crypto.randomUUID(), "Browser profile A", "drill"),
    control.upsertDevice(accountId, crypto.randomUUID(), "Browser profile B", "drill"),
  ]);
  const connections = [crypto.randomUUID(), crypto.randomUUID()];
  for (let index = 0; index < devices.length; index += 1) {
    const connected = await coordination.createConnection(
      accountId,
      devices[index]!.id,
      connections[index]!,
      "long_poll",
      new Date(Date.now() + 300_000),
      tokenHash(`drill-connection-${index}-${crypto.randomUUID()}`),
    );
    if (connected.kind !== "created") throw new Error(`connection_${connected.kind}`);
  }
  const sessionId = crypto.randomUUID();
  const created = await sessions.createSession(
    accountId,
    sessionId,
    tokenHash(`drill-session-${crypto.randomUUID()}`),
    {
      schemaVersion: 1,
      title: "Isolated durability drill",
      mode: "cloud_checkpointed",
      runtimeVersion: "drill",
    },
  );
  if (created.kind !== "created") throw new Error(`session_${created.kind}`);
  const firstLeaseId = crypto.randomUUID();
  const first = await coordination.acquireLease({
    accountId,
    sessionId,
    deviceId: devices[0]!.id,
    connectionId: connections[0]!,
    leaseId: firstLeaseId,
    expectedSessionRevision: created.value.revision,
    idempotencyHash: tokenHash(`drill-lease-a-${crypto.randomUUID()}`),
  });
  if (first.kind !== "created") throw new Error(`lease_a_${first.kind}`);
  const reconnectConnection = crypto.randomUUID();
  const reconnectRegistered = await coordination.createConnection(
    accountId,
    devices[0]!.id,
    reconnectConnection,
    "long_poll",
    new Date(Date.now() + 300_000),
    tokenHash(`drill-reconnect-connection-${crypto.randomUUID()}`),
  );
  if (reconnectRegistered.kind !== "created")
    throw new Error(`reconnect_connection_${reconnectRegistered.kind}`);
  const reconnected = await coordination.reconnectLease({
    accountId,
    sessionId,
    deviceId: devices[0]!.id,
    connectionId: reconnectConnection,
    leaseId: firstLeaseId,
    generation: first.value.generation,
    idempotencyHash: tokenHash(`drill-reconnect-${crypto.randomUUID()}`),
  });
  if (reconnected.kind !== "updated")
    throw new Error(`reconnect_${reconnected.kind}`);
  const replacedConnectionHeartbeat = await coordination.heartbeatLease({
    accountId,
    sessionId,
    deviceId: devices[0]!.id,
    connectionId: connections[0]!,
    leaseId: firstLeaseId,
    generation: first.value.generation,
    idempotencyHash: tokenHash(
      `drill-replaced-connection-${crypto.randomUUID()}`,
    ),
  });
  if (replacedConnectionHeartbeat.kind !== "generation_conflict")
    throw new Error(
      `replaced_connection_not_fenced_${replacedConnectionHeartbeat.kind}`,
    );
  const reconnectHeartbeat = await coordination.heartbeatLease({
    accountId,
    sessionId,
    deviceId: devices[0]!.id,
    connectionId: reconnectConnection,
    leaseId: firstLeaseId,
    generation: first.value.generation,
    idempotencyHash: tokenHash(`drill-reconnect-heartbeat-${crypto.randomUUID()}`),
  });
  if (reconnectHeartbeat.kind !== "updated")
    throw new Error(`reconnect_heartbeat_${reconnectHeartbeat.kind}`);
  const conflict = await coordination.acquireLease({
    accountId,
    sessionId,
    deviceId: devices[1]!.id,
    connectionId: connections[1]!,
    leaseId: crypto.randomUUID(),
    expectedSessionRevision: created.value.revision,
    idempotencyHash: tokenHash(`drill-lease-b-conflict-${crypto.randomUUID()}`),
  });
  if (conflict.kind !== "lease_conflict") throw new Error(`expected_conflict_${conflict.kind}`);
  const takeover = await coordination.takeoverLease({
    accountId,
    sessionId,
    deviceId: devices[1]!.id,
    connectionId: connections[1]!,
    leaseId: crypto.randomUUID(),
    expectedSessionRevision: created.value.revision,
    expectedGeneration: first.value.generation,
    idempotencyHash: tokenHash(`drill-takeover-${crypto.randomUUID()}`),
  });
  if (takeover.kind !== "updated") throw new Error(`takeover_${takeover.kind}`);
  const oldHeartbeat = await coordination.heartbeatLease({
    accountId,
    sessionId,
    deviceId: devices[0]!.id,
    connectionId: connections[0]!,
    leaseId: firstLeaseId,
    generation: first.value.generation,
    idempotencyHash: tokenHash(`drill-old-heartbeat-${crypto.randomUUID()}`),
  });
  if (oldHeartbeat.kind !== "generation_conflict")
    throw new Error(`old_device_not_fenced_${oldHeartbeat.kind}`);
  const live = await coordination.lease(accountId, sessionId);
  if (live?.deviceId !== devices[1]!.id || live.generation !== first.value.generation + 1)
    throw new Error("takeover_not_authoritative");
  console.log(JSON.stringify({
    schemaVersion: 1,
    isolatedDatabase: databaseName,
    simulatedBrowserProfiles: 2,
    initialGeneration: first.value.generation,
    takeoverGeneration: live.generation,
    sameDeviceReconnectPassed: true,
    replacedConnectionFenced: true,
    concurrentAcquireRejected: true,
    oldDeviceFenced: true,
    authoritativeDevice: "profile-b",
  }));
} finally {
  await Promise.all([control.close(), sessions.close()]);
}
