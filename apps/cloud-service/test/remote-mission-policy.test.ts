import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRemoteMissionTransition,
  parseCreateRemoteMission,
  RemoteMissionPolicyError,
} from "../src/remote-mission-policy.js";

const deviceId = "123e4567-e89b-42d3-a456-426614174000";

test("parses and normalizes a bounded remote mission", () => {
  assert.deepEqual(
    parseCreateRemoteMission({
      schemaVersion: 1,
      deviceId,
      instruction: "  Summarize this page  ",
      initialUrl: "https://example.test/path",
    }),
    {
      schemaVersion: 1,
      deviceId,
      instruction: "Summarize this page",
      initialUrl: "https://example.test/path",
      expiresInSeconds: 900,
    },
  );
});

test("rejects unsafe URLs, invalid devices, and unbounded instructions", () => {
  for (const value of [
    { schemaVersion: 1, deviceId: "device", instruction: "read" },
    { schemaVersion: 1, deviceId, instruction: "" },
    { schemaVersion: 1, deviceId, instruction: "read", initialUrl: "file:///x" },
    { schemaVersion: 1, deviceId, instruction: "x".repeat(16_001) },
  ])
    assert.throws(
      () => parseCreateRemoteMission(value),
      RemoteMissionPolicyError,
    );
});

test("allows only monotonic lifecycle transitions with matching outcomes", () => {
  assert.doesNotThrow(() =>
    assertRemoteMissionTransition("queued", {
      schemaVersion: 1,
      to: "accepted",
    }),
  );
  assert.doesNotThrow(() =>
    assertRemoteMissionTransition("running", {
      schemaVersion: 1,
      to: "outcome_unknown",
      resultCode: "unknown",
    }),
  );
  assert.throws(
    () =>
      assertRemoteMissionTransition("succeeded", {
        schemaVersion: 1,
        to: "running",
      }),
    /invalid_transition/,
  );
  assert.throws(
    () =>
      assertRemoteMissionTransition("running", {
        schemaVersion: 1,
        to: "succeeded",
        resultCode: "unknown",
      }),
    /invalid_request/,
  );
});
