import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TemporalShadowOutbox,
  temporalAccountHash,
} from "../src/temporal-shadow-outbox.js";

test("shadow account hashes are keyed and stable", () => {
  const first = temporalAccountHash("account", "a".repeat(32));
  assert.equal(first.length, 64);
  assert.equal(first, temporalAccountHash("account", "a".repeat(32)));
  assert.notEqual(first, temporalAccountHash("account", "b".repeat(32)));
  assert.doesNotMatch(first, /account/);
});

test("claimed rows map to the closed Temporal shadow contract", async () => {
  const eventId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const outbox = new TemporalShadowOutbox({
    query: async () => ({
      rows: [
        {
          event_id: eventId,
          account_hash: "a".repeat(64),
          session_id: sessionId,
          event_type: "session_created",
          revision: "1",
          deadline_at: null,
          occurred_at: new Date("2026-08-09T00:00:00Z"),
          claim_token: crypto.randomUUID(),
        },
      ],
    }),
  } as never);
  const [claimed] = await outbox.claim();
  assert.equal(claimed?.schemaVersion, 1);
  assert.deepEqual(Object.keys(claimed!).sort(), [
    "accountHash",
    "claimToken",
    "deadlineAt",
    "eventId",
    "eventType",
    "occurredAt",
    "revision",
    "schemaVersion",
    "sessionId",
  ]);
});

test("shadow outbox schema has no user-content payload column", async () => {
  const sql = await readFile(
    new URL("../migrations/005_temporal_shadow_outbox.sql", import.meta.url),
    "utf8",
  );
  const table = sql.slice(
    sql.indexOf("CREATE TABLE"),
    sql.indexOf(");", sql.indexOf("CREATE TABLE")) + 2,
  );
  for (const forbidden of [
    "prompt",
    "url",
    "email",
    "cookie",
    "authorization",
    "screenshot",
    "payload",
    "checkpoint_plaintext",
  ])
    assert.doesNotMatch(table, new RegExp(`\\b${forbidden}\\b`, "i"));
});
