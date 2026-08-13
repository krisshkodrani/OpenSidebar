import assert from "node:assert/strict";
import test from "node:test";
import {
  BENCHMARK_CASE_SCHEMA_VERSION,
  SCENARIO_SCHEMA_VERSION,
} from "../src/index.js";

test("publishes explicit scenario and case schema versions", () => {
  assert.equal(SCENARIO_SCHEMA_VERSION, 2);
  assert.equal(BENCHMARK_CASE_SCHEMA_VERSION, 1);
});
