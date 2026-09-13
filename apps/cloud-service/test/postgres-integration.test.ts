import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { PostgresPlaygroundRepository } from "../src/postgres-repository.js";

const databaseUrl = process.env.PLAYGROUND_TEST_DATABASE_URL;
test(
  "PostgreSQL migration and Restock transaction slice",
  { skip: !databaseUrl },
  async () => {
    const repository = new PostgresPlaygroundRepository(databaseUrl!);
    try {
      await repository.pool.query("DROP SCHEMA IF EXISTS playground CASCADE");
      await repository.migrate();
      const app = createApp(repository, {
        port: 8787,
        databaseUrl: databaseUrl!,
        controlOrigin: "https://opensidebar.com",
        targetOrigin: "https://play.opensidebar.com",
        cookieSecure: true,
        developmentAccountId: "postgres-test@example.com",
        awsRegion: "eu-central-1",
        authQuotaHmacKey: "test-auth-quota-key",
        controlDatabaseUrl: databaseUrl!,
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
      });
      const quotaSubject = `integration-${crypto.randomUUID()}`;
      await repository.consumeAuthQuota(quotaSubject, 60, 2);
      await repository.consumeAuthQuota(quotaSubject, 60, 2);
      await assert.rejects(
        repository.consumeAuthQuota(quotaSubject, 60, 2),
        (cause: unknown) =>
          (cause as { code?: string }).code === "auth_rate_limit",
      );
      const request = (url: string, body: unknown) =>
        app.request(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
      const created = await request("/api/v1/playground/runs", {
        scenarioId: "restock-alert",
      });
      assert.equal(created.status, 201);
      const run = (
        (await created.json()) as { run: { id: string; revision: number } }
      ).run;
      assert.equal(run.revision, 1);
      assert.equal(
        (
          await request(`/api/v1/playground/runs/${run.id}/commands`, {
            type: "restock.setAvailability",
            availability: "in_stock",
          })
        ).status,
        200,
      );
      const rows = await repository.pool.query<{
        revision: string;
        availability: string;
      }>(
        "SELECT revision,state->>'availability' AS availability FROM playground.runs WHERE id=$1",
        [run.id],
      );
      assert.equal(Number(rows.rows[0]?.revision), 2);
      assert.equal(rows.rows[0]?.availability, "in_stock");
      assert.equal(
        (
          await app.request(`/api/v1/playground/runs/${run.id}`, {
            method: "DELETE",
          })
        ).status,
        204,
      );
      assert.equal(await repository.getRun(run.id), null);
    } finally {
      await repository.close();
    }
  },
);
