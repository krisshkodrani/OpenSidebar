import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("remote mission delivery sequence cannot be reused after deletion", async () => {
  const repository = await readFile(
    new URL("../src/postgres-remote-mission-repository.ts", import.meta.url),
    "utf8",
  );
  const migration = await readFile(
    new URL("../migrations/012_remote_mission_delivery_sequence.sql", import.meta.url),
    "utf8",
  );
  const epochFloor = await readFile(
    new URL("../migrations/013_remote_mission_sequence_epoch_floor.sql", import.meta.url),
    "utf8",
  );
  assert.match(repository, /nextval\('sessions\.remote_mission_delivery_sequence'\)/);
  assert.doesNotMatch(repository, /MAX\(sequence\).*\+1/s);
  assert.match(migration, /CREATE SEQUENCE IF NOT EXISTS/);
  assert.match(epochFloor, /extract\(epoch FROM clock_timestamp\(\)\) \* 1000/);
  assert.match(epochFloor, /MAX\(sequence\)/);
});
