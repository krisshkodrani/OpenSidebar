import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRemoteMissionTransition,
  parseCreateRemoteMission,
  parseRemoteMissionProgress,
  parseRemoteMissionTargetDecision,
  RemoteMissionPolicyError,
} from "../src/remote-mission-policy.js";

const deviceId = "dev_123e4567e89b42d3a4564266";

test("parses and normalizes a bounded remote mission", () => {
  assert.deepEqual(
    parseCreateRemoteMission({
      schemaVersion: 1,
      deviceId,
      instruction: "  Summarize this page  ",
      initialUrl: "https://example.test/path",
      targetContext: "active_tab",
    }),
    {
      schemaVersion: 1,
      deviceId,
      instruction: "Summarize this page",
      initialUrl: "https://example.test/path",
      targetContext: "active_tab",
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
    { schemaVersion: 1, deviceId, instruction: "read", targetContext: "some_tab" },
    { schemaVersion: 1, deviceId, instruction: "read", targetContext: "existing_tab" },
  ])
    assert.throws(
      () => parseCreateRemoteMission(value),
      RemoteMissionPolicyError,
    );
});

test("allows only monotonic lifecycle transitions with matching outcomes", () => {
  assert.doesNotThrow(() =>
    assertRemoteMissionTransition("running", {
      schemaVersion: 1,
      to: "target_selection_required",
    }),
  );
  assert.doesNotThrow(() =>
    assertRemoteMissionTransition("target_selection_required", {
      schemaVersion: 1,
      to: "running",
    }),
  );
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
  assert.doesNotThrow(() =>
    assertRemoteMissionTransition("running", {
      schemaVersion: 1,
      to: "cancelled",
      resultCode: "cancelled",
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

test("bounds opaque target choices and decisions", () => {
  const missionId = crypto.randomUUID();
  const progress = parseRemoteMissionProgress({
    schemaVersion: 1,
    missionId,
    state: "target_selection_required",
    updatedAt: new Date().toISOString(),
    targetSelection: {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      candidates: [
        { targetHandle: "target_work", pageTitle: "Example", groupTitle: "Work" },
        { targetHandle: "target_personal", pageTitle: "Example", windowLabel: "Window 2" },
      ],
    },
  }, missionId);
  assert.equal(progress.targetSelection?.candidates.length, 2);
  assert.equal(parseRemoteMissionTargetDecision({
    schemaVersion: 1,
    missionId,
    targetHandle: "target_personal",
    decidedAt: new Date().toISOString(),
  }, missionId).targetHandle, "target_personal");
  assert.throws(() => parseRemoteMissionProgress({
    ...progress,
    targetSelection: {
      ...progress.targetSelection,
      candidates: [{ targetHandle: "target_only", pageTitle: "Only" }],
    },
  }, missionId), RemoteMissionPolicyError);
});
