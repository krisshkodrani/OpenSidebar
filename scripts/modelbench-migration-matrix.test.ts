import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyMigrationMatrix, checkLegacyMigrationMatrix } from "./modelbench-migration-matrix.js";

test("every lexical legacy E2E and Arena case has a checked disposition", () => {
  const entries = buildLegacyMigrationMatrix();
  assert.equal(checkLegacyMigrationMatrix(entries).length, 0);
  assert.ok(entries.length >= 118, `expected at least 99 lexical tests plus 19 Arena tasks, got ${entries.length}`);
  assert.equal(new Set(entries.map((entry) => entry.legacyId)).size, entries.length);
});
