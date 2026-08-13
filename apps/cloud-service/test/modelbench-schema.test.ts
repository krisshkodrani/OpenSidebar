import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../migrations/018_modelbench.sql", import.meta.url);

test("ModelBench migration isolates runs and attempts in a private schema", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS modelbench/);
  assert.match(sql, /REVOKE ALL ON SCHEMA modelbench FROM PUBLIC/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS modelbench\.scenario_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS modelbench\.attempts/);
  assert.match(sql, /retry_of_attempt_id text REFERENCES modelbench\.attempts/);
  assert.match(sql, /expires_at timestamptz NOT NULL/);
  assert.doesNotMatch(sql, /prompt|screenshot|provider_key|credential/i);
});
