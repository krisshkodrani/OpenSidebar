import assert from "node:assert/strict";
import test from "node:test";
import {
  SPIKE_FIXTURES,
  SPIKE_OPERATIONAL_FIXTURES,
  validateSyntheticWorkflowInput,
  type SpikeFixture,
  type SyntheticWorkflowInputV1,
  validateShadowEvent,
} from "../src/contracts.js";

const input = (fixture: SpikeFixture): SyntheticWorkflowInputV1 => ({
  schemaVersion: 1,
  fixture,
  sessionId: crypto.randomUUID(),
  commandId: crypto.randomUUID(),
  revision: 1,
  leaseGeneration: 1,
  iteration: 0,
  deadlineEpochMs: Date.now() + 60_000,
});

test("shadow events accept only opaque coordination fields", () => {
  const event = {
    schemaVersion: 1 as const,
    eventId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    accountHash: "a".repeat(64),
    eventType: "session_created" as const,
    revision: 1,
    occurredAt: new Date().toISOString(),
  };
  assert.doesNotThrow(() => validateShadowEvent(event));
  assert.throws(() =>
    validateShadowEvent({ ...event, prompt: "CANARY" } as never),
  );
});

test("the immutable seven fixtures use the closed content-free input", () => {
  assert.equal(SPIKE_FIXTURES.length, 7);
  for (const fixture of SPIKE_FIXTURES)
    assert.doesNotThrow(() => validateSyntheticWorkflowInput(input(fixture)));
});

test("operator-only fixtures stay outside the immutable matrix", () => {
  assert.deepEqual(SPIKE_OPERATIONAL_FIXTURES, ["stuck_operation"]);
  assert.doesNotThrow(() =>
    validateSyntheticWorkflowInput(input("stuck_operation")),
  );
});

test("workflow input rejects content and identity fields", () => {
  for (const forbidden of [
    "email",
    "url",
    "authorization",
    "providerKey",
    "cookie",
    "prompt",
    "screenshot",
    "checkpointPlaintext",
    "accountId",
  ]) {
    const candidate = { ...input("normal"), [forbidden]: "CANARY" };
    assert.throws(() =>
      validateSyntheticWorkflowInput(candidate as SyntheticWorkflowInputV1),
    );
  }
});
