import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("remote mission readiness is durable, indexed, and migrated by the control repository", async () => {
  const migration = await readFile(
    new URL("../migrations/020_remote_mission_capabilities.sql", import.meta.url),
    "utf8",
  );
  const repository = await readFile(
    new URL("../src/postgres-control-repository.ts", import.meta.url),
    "utf8",
  );

  assert.match(migration, /remote_mission_ready_at timestamptz/);
  assert.match(migration, /control_devices_remote_mission_ready/);
  assert.match(repository, /020_remote_mission_capabilities\.sql/);
  assert.match(repository, /remote_mission_ready_at=now\(\)/);
});
