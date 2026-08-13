import assert from "node:assert/strict";
import test from "node:test";
import { tokenHash } from "../src/crypto.js";
import { PostgresControlRepository } from "../src/postgres-control-repository.js";
import { PostgresDeviceCoordinationRepository } from "../src/postgres-device-coordination-repository.js";
import { PostgresDeviceCommandRepository } from "../src/postgres-device-command-repository.js";
import { PostgresSessionRepository } from "../src/postgres-session-repository.js";

const databaseUrl = process.env.PLAYGROUND_TEST_DATABASE_URL;

test(
  "PostgreSQL session ownership, revision, idempotency, and checkpoint transactions",
  { skip: !databaseUrl },
  async () => {
    const control = new PostgresControlRepository(databaseUrl!);
    const sessions = new PostgresSessionRepository(databaseUrl!);
    const coordination = new PostgresDeviceCoordinationRepository(
      sessions.pool,
    );
    const commands = new PostgresDeviceCommandRepository(sessions.pool);
    try {
      await control.pool.query("DROP SCHEMA IF EXISTS sessions CASCADE");
      await control.pool.query("DROP SCHEMA IF EXISTS control CASCADE");
      await control.migrate();
      await sessions.migrate();
      await control.upsertAccount("account-1", "one@example.com", true);
      await control.upsertAccount("account-2", "two@example.com", true);

      const initialPreferences = {
        schemaVersion: 1 as const,
        revision: 1,
        inferenceMode: "local" as const,
        providerMode: "openrouter" as const,
        maxTurns: 50,
        theme: "system" as const,
        showSessionMetrics: true,
      };
      assert.equal(
        await control.putPreferences("account-1", 0, initialPreferences),
        true,
      );
      assert.equal((await control.preferences("account-1"))?.revision, 1);
      assert.equal(
        await control.putPreferences("account-1", 1, {
          ...initialPreferences,
          revision: 2,
          inferenceMode: "cloud",
        }),
        true,
      );
      assert.deepEqual(await control.preferences("account-1"), {
        ...initialPreferences,
        revision: 2,
        inferenceMode: "cloud",
      });
      assert.equal(
        await control.putPreferences("account-1", 1, {
          ...initialPreferences,
          revision: 2,
        }),
        false,
      );

      await control.pool.query(
        `INSERT INTO control.relay_request_records
         (account_id,request_id,provider,model_id,status,expires_at)
         VALUES($1,$2,'openrouter','allowed/model','active',now()+interval '24 hours')`,
        ["account-1", "interrupted-relay-integration"],
      );
      await control.pool.query(
        `UPDATE control.relay_request_records
         SET updated_at=now()-interval '20 minutes'
         WHERE account_id=$1 AND request_id=$2`,
        ["account-1", "interrupted-relay-integration"],
      );
      assert.equal(
        await control.recoverInterruptedRelayRequests(
          new Date(Date.now() - 16 * 60_000),
        ),
        1,
      );
      assert.deepEqual(
        (
          await control.pool.query<{ status: string; latency_bucket: string }>(
            `SELECT status,latency_bucket
             FROM control.relay_request_records
             WHERE account_id=$1 AND request_id=$2`,
            ["account-1", "interrupted-relay-integration"],
          )
        ).rows[0],
        { status: "failed", latency_bucket: "interrupted" },
      );

      const sessionId = crypto.randomUUID();
      const createKey = tokenHash("session-create-integration-0001");
      const created = await sessions.createSession(
        "account-1",
        sessionId,
        createKey,
        {
          schemaVersion: 1,
          title: "Integration session",
          mode: "cloud_checkpointed",
          runtimeVersion: "0.7.2",
        },
      );
      assert.equal(created.kind, "created");
      assert.equal(
        (
          await sessions.createSession(
            "account-1",
            crypto.randomUUID(),
            createKey,
            {
              schemaVersion: 1,
              title: "Ignored replay body",
              mode: "cloud_archived",
              runtimeVersion: "0.7.2",
            },
          )
        ).kind,
        "replayed",
      );
      assert.equal(await sessions.session("account-2", sessionId), null);

      const updates = await Promise.all([
        sessions.updateSession(
          "account-1",
          sessionId,
          1,
          tokenHash("session-update-integration-0001"),
          { schemaVersion: 1, pinned: true },
        ),
        sessions.updateSession(
          "account-1",
          sessionId,
          1,
          tokenHash("session-update-integration-0002"),
          { schemaVersion: 1, title: "Concurrent loser" },
        ),
      ]);
      assert.deepEqual(updates.map((value) => value.kind).sort(), [
        "revision_conflict",
        "updated",
      ]);
      const current = await sessions.session("account-1", sessionId);
      assert.equal(current?.revision, 2);

      const checkpointId = crypto.randomUUID();
      const checkpoint = await sessions.createCheckpointIntent(
        "account-1",
        `checkpoints/${crypto.randomUUID()}`,
        tokenHash("checkpoint-intent-integration-0001"),
        {
          schemaVersion: 1,
          sessionId,
          checkpointId,
          checkpointRevision: 1,
          sessionRevision: 2,
          checkpointSchemaVersion: 1,
          runtimeVersion: "0.7.2",
          ciphertextSizeBytes: 4096,
          ciphertextSha256: "a".repeat(64),
        },
        "under_256k",
      );
      assert.equal(checkpoint.kind, "created");
      const committed = await sessions.commitCheckpoint(
        "account-1",
        sessionId,
        checkpointId,
        2,
        tokenHash("checkpoint-commit-integration-0001"),
        4096,
        "a".repeat(64),
      );
      assert.equal(committed.kind, "updated");
      assert.equal(
        (
          await sessions.commitCheckpoint(
            "account-1",
            sessionId,
            checkpointId,
            2,
            tokenHash("checkpoint-commit-integration-0001"),
            4096,
            "a".repeat(64),
          )
        ).kind,
        "replayed",
      );
      assert.equal(
        (await sessions.latestCheckpoint("account-1", sessionId))?.state,
        "committed",
      );
      assert.equal(
        await sessions.latestCheckpoint("account-2", sessionId),
        null,
      );

      const deviceOne = await control.upsertDevice(
        "account-1",
        crypto.randomUUID(),
        "Device one",
        "0.7.2",
        "test_client",
      );
      const deviceTwo = await control.upsertDevice(
        "account-1",
        crypto.randomUUID(),
        "Device two",
        "0.7.2",
        "test_client",
      );
      const connectionOne = crypto.randomUUID();
      const connectionTwo = crypto.randomUUID();
      assert.equal(
        (
          await coordination.createConnection(
            "account-1",
            deviceOne.id,
            connectionOne,
            "long_poll",
            new Date(Date.now() + 60_000),
            tokenHash("connection-create-integration-0001"),
          )
        ).kind,
        "created",
      );
      assert.equal(
        (
          await coordination.createConnection(
            "account-2",
            deviceOne.id,
            crypto.randomUUID(),
            "long_poll",
            new Date(Date.now() + 60_000),
            tokenHash("connection-create-integration-0002"),
          )
        ).kind,
        "device_mismatch",
      );
      await coordination.createConnection(
        "account-1",
        deviceTwo.id,
        connectionTwo,
        "long_poll",
        new Date(Date.now() + 60_000),
        tokenHash("connection-create-integration-0003"),
      );
      const leaseOneId = crypto.randomUUID();
      const leaseTwoId = crypto.randomUUID();
      const leaseAttempts = await Promise.all([
        coordination.acquireLease({
          accountId: "account-1",
          sessionId,
          deviceId: deviceOne.id,
          connectionId: connectionOne,
          leaseId: leaseOneId,
          expectedSessionRevision: 3,
          idempotencyHash: tokenHash("lease-acquire-integration-0001"),
        }),
        coordination.acquireLease({
          accountId: "account-1",
          sessionId,
          deviceId: deviceTwo.id,
          connectionId: connectionTwo,
          leaseId: leaseTwoId,
          expectedSessionRevision: 3,
          idempotencyHash: tokenHash("lease-acquire-integration-0002"),
        }),
      ]);
      assert.deepEqual(leaseAttempts.map((value) => value.kind).sort(), [
        "created",
        "lease_conflict",
      ]);
      const winner = leaseAttempts.find(
        (value): value is Extract<typeof value, { kind: "created" }> =>
          value.kind === "created",
      )!;
      const winningConnection =
        winner.value.deviceId === deviceOne.id ? connectionOne : connectionTwo;
      const commandId = crypto.randomUUID();
      const command = await commands.createCommand({
        accountId: "account-1",
        deviceId: winner.value.deviceId,
        sessionId,
        commandId,
        leaseId: winner.value.leaseId,
        leaseGeneration: winner.value.generation,
        checkpointRevision: winner.value.checkpointRevision,
        commandKind: "read_page",
        risk: "read",
        actionDigest: "b".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyHash: tokenHash("command-create-integration-0001"),
      });
      assert.equal(command.kind, "created");
      const expiredCommandId = crypto.randomUUID();
      assert.equal(
        (
          await commands.createCommand({
            accountId: "account-1",
            deviceId: winner.value.deviceId,
            sessionId,
            commandId: expiredCommandId,
            leaseId: winner.value.leaseId,
            leaseGeneration: winner.value.generation,
            checkpointRevision: winner.value.checkpointRevision,
            commandKind: "read_page",
            risk: "read",
            actionDigest: "c".repeat(64),
            expiresAt: new Date(Date.now() - 1_000),
            idempotencyHash: tokenHash(
              "command-create-integration-expired-0001",
            ),
          })
        ).kind,
        "created",
      );
      await sessions.pool.query(
        "UPDATE sessions.device_connections SET expires_at=now()-interval '1 second' WHERE account_id=$1 AND connection_id=$2",
        ["account-1", winningConnection],
      );
      await sessions.cleanupExpired();
      const maintenanceRows = await sessions.pool.query<{
        command_state: string;
        revoked_at: Date | null;
      }>(
        `SELECT command.state AS command_state, connection.revoked_at
         FROM sessions.device_commands command
         JOIN sessions.device_connections connection
           ON connection.account_id=command.account_id AND connection.connection_id=$3
         WHERE command.account_id=$1 AND command.command_id=$2`,
        ["account-1", expiredCommandId, winningConnection],
      );
      assert.equal(maintenanceRows.rows[0]?.command_state, "expired");
      assert.ok(maintenanceRows.rows[0]?.revoked_at);
      assert.equal(
        (
          await commands.commands({
            accountId: "account-1",
            sessionId,
            deviceId: winner.value.deviceId,
            leaseId: winner.value.leaseId,
            leaseGeneration: winner.value.generation,
            afterSequence: 0,
            limit: 25,
          })
        ).length,
        2,
      );
      const transitions = [
        "leased",
        "delivered",
        "accepted",
        "started",
        "succeeded",
      ] as const;
      for (const [index, state] of transitions.entries()) {
        const transitioned = await commands.transitionCommand({
          accountId: "account-1",
          sessionId,
          deviceId: winner.value.deviceId,
          commandId,
          leaseId: winner.value.leaseId,
          leaseGeneration: winner.value.generation,
          to: state,
          ...(state === "succeeded"
            ? { outcomeCode: "verified" as const }
            : {}),
          idempotencyHash: tokenHash(
            `command-transition-integration-000${index + 1}`,
          ),
        });
        assert.equal(transitioned.kind, "updated", state);
      }
      assert.equal(
        (
          await commands.transitionCommand({
            accountId: "account-1",
            sessionId,
            deviceId: winner.value.deviceId,
            commandId,
            leaseId: winner.value.leaseId,
            leaseGeneration: winner.value.generation,
            to: "succeeded",
            outcomeCode: "verified",
            idempotencyHash: tokenHash("command-transition-integration-0005"),
          })
        ).kind,
        "replayed",
      );
      assert.equal(
        (
          await commands.transitionCommand({
            accountId: "account-1",
            sessionId,
            deviceId: winner.value.deviceId,
            commandId,
            leaseId: winner.value.leaseId,
            leaseGeneration: winner.value.generation,
            to: "started",
            idempotencyHash: tokenHash("command-transition-integration-0006"),
          })
        ).kind,
        "invalid_transition",
      );
      assert.equal(
        (
          await coordination.heartbeatLease({
            accountId: "account-1",
            sessionId,
            deviceId: winner.value.deviceId,
            connectionId: winningConnection,
            leaseId: winner.value.leaseId,
            generation: winner.value.generation + 1,
            idempotencyHash: tokenHash("lease-heartbeat-integration-0001"),
          })
        ).kind,
        "generation_conflict",
      );
      const reconnectConnection = crypto.randomUUID();
      const reconnectRegistration = await coordination.createConnection(
        "account-1",
        winner.value.deviceId,
        reconnectConnection,
        "long_poll",
        new Date(Date.now() + 60_000),
        tokenHash("connection-reconnect-integration-0001"),
      );
      assert.equal(reconnectRegistration.kind, "created");
      const reconnected = await coordination.reconnectLease({
        accountId: "account-1",
        sessionId,
        deviceId: winner.value.deviceId,
        connectionId: reconnectConnection,
        leaseId: winner.value.leaseId,
        generation: winner.value.generation,
        idempotencyHash: tokenHash("lease-reconnect-integration-0001"),
      });
      assert.equal(reconnected.kind, "updated");
      assert.equal(
        (
          await coordination.heartbeatLease({
            accountId: "account-1",
            sessionId,
            deviceId: winner.value.deviceId,
            connectionId: winningConnection,
            leaseId: winner.value.leaseId,
            generation: winner.value.generation,
            idempotencyHash: tokenHash("lease-old-connection-integration-0001"),
          })
        ).kind,
        "generation_conflict",
      );
      assert.equal(
        (
          await coordination.heartbeatLease({
            accountId: "account-1",
            sessionId,
            deviceId: winner.value.deviceId,
            connectionId: reconnectConnection,
            leaseId: winner.value.leaseId,
            generation: winner.value.generation,
            idempotencyHash: tokenHash("lease-new-connection-integration-0001"),
          })
        ).kind,
        "updated",
      );
      const takeoverDevice =
        winner.value.deviceId === deviceOne.id ? deviceTwo : deviceOne;
      const takeoverConnection =
        takeoverDevice.id === deviceOne.id ? connectionOne : connectionTwo;
      const takeover = await coordination.takeoverLease({
        accountId: "account-1",
        sessionId,
        deviceId: takeoverDevice.id,
        connectionId: takeoverConnection,
        leaseId: crypto.randomUUID(),
        expectedSessionRevision: 3,
        expectedGeneration: winner.value.generation,
        idempotencyHash: tokenHash("lease-takeover-integration-0001"),
      });
      assert.equal(takeover.kind, "updated");
      if (!("value" in takeover)) throw new Error("takeover failed");
      assert.equal(takeover.value.generation, winner.value.generation + 1);
      assert.equal(
        (
          await coordination.heartbeatLease({
            accountId: "account-1",
            sessionId,
            deviceId: winner.value.deviceId,
            connectionId: winningConnection,
            leaseId: winner.value.leaseId,
            generation: winner.value.generation,
            idempotencyHash: tokenHash("lease-heartbeat-integration-0002"),
          })
        ).kind,
        "generation_conflict",
      );
      assert.equal(
        (
          await coordination.releaseLease({
            accountId: "account-1",
            sessionId,
            deviceId: takeover.value.deviceId,
            leaseId: takeover.value.leaseId,
            generation: takeover.value.generation,
            idempotencyHash: tokenHash("lease-release-integration-0001"),
          })
        ).kind,
        "updated",
      );
    } finally {
      await Promise.all([sessions.close(), control.close()]);
    }
  },
);
