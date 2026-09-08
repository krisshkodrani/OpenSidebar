import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCheckpointCommit,
  parseCheckpointUploadIntent,
  parseCreateCloudSession,
  parseExpectedRevision,
  parseIdempotencyKey,
  parsePortableCheckpoint,
  parseUpdateCloudSession,
  plaintextSizeBucket,
  SessionPolicyError,
} from "../src/session-policy.js";

const rejects = (action: () => unknown, code = "invalid_request") =>
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof SessionPolicyError && error.code === code,
  );

test("session metadata schemas are closed and byte bounded", () => {
  assert.deepEqual(
    parseCreateCloudSession({
      schemaVersion: 1,
      title: "  Resume report  ",
      mode: "cloud_checkpointed",
      runtimeVersion: "0.7.2",
    }),
    {
      schemaVersion: 1,
      title: "Resume report",
      mode: "cloud_checkpointed",
      runtimeVersion: "0.7.2",
    },
  );
  rejects(() =>
    parseCreateCloudSession({
      schemaVersion: 1,
      title: "x".repeat(161),
      mode: "cloud_checkpointed",
      runtimeVersion: "0.7.2",
    }),
  );
  rejects(() =>
    parseCreateCloudSession({
      schemaVersion: 1,
      title: "valid",
      mode: "cloud_archived",
      runtimeVersion: "0.7.2",
      accountId: "confused-deputy",
    }),
  );
  rejects(() => parseUpdateCloudSession({ schemaVersion: 1 }));
});

test("mutation guards require bounded idempotency and positive If-Match", () => {
  assert.equal(parseIdempotencyKey("session-create-123"), "session-create-123");
  rejects(() => parseIdempotencyKey(undefined), "idempotency_key_required");
  rejects(() => parseIdempotencyKey("short"), "idempotency_key_required");
  assert.equal(parseExpectedRevision('"12"'), 12);
  rejects(() => parseExpectedRevision("0"), "if_match_required");
});

test("checkpoint metadata validates IDs, digest, and size buckets", () => {
  const input = {
    schemaVersion: 1,
    sessionId: "1bd0c891-8ddb-468f-8f02-e47a0e430176",
    checkpointId: "f0341e58-3989-41ac-bd85-99aca119dd86",
    checkpointRevision: 1,
    sessionRevision: 1,
    checkpointSchemaVersion: 1,
    runtimeVersion: "0.7.2",
    ciphertextSizeBytes: 1024,
    ciphertextSha256: "a".repeat(64),
  };
  assert.deepEqual(parseCheckpointUploadIntent(input), input);
  assert.deepEqual(
    parseCheckpointCommit({
      schemaVersion: 1,
      checkpointId: input.checkpointId,
      ciphertextSizeBytes: input.ciphertextSizeBytes,
      ciphertextSha256: input.ciphertextSha256,
    }),
    {
      schemaVersion: 1,
      checkpointId: input.checkpointId,
      ciphertextSizeBytes: input.ciphertextSizeBytes,
      ciphertextSha256: input.ciphertextSha256,
    },
  );
  rejects(() =>
    parseCheckpointUploadIntent({ ...input, ciphertextSha256: "invalid" }),
  );
  rejects(() =>
    parseCheckpointUploadIntent({
      ...input,
      ciphertextSizeBytes: 10 * 1024 * 1024 + 1,
    }),
  );
  assert.equal(plaintextSizeBucket(200_000), "under_256k");
  assert.equal(plaintextSizeBucket(9 * 1024 * 1024), "under_10m");
});

test("portable checkpoints reject unknown nested fields and replayable approval grants", () => {
  const value = {
    schemaVersion: 1,
    sessionId: "1bd0c891-8ddb-468f-8f02-e47a0e430176",
    checkpointId: "f0341e58-3989-41ac-bd85-99aca119dd86",
    revision: 1,
    createdAt: "2026-08-09T12:00:00.000Z",
    runtimeVersion: "0.7.2",
    reason: "pause",
    objective: {
      originalRequest: "Prepare report",
      currentInterpretation: "Prepare report",
      successCriteria: ["Report is ready"],
      userConstraints: [],
    },
    conversation: { messages: [] },
    execution: { plan: [], completedActions: [], unresolvedFacts: [] },
    grounding: {
      expectedOrigins: ["https://example.com"],
      userVisibleStateSummary: "Report page",
      requiredCapabilities: ["navigation"],
    },
    pending: { kind: "none" },
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      imageTokenEstimate: 0,
      turns: 0,
    },
  };
  assert.equal(parsePortableCheckpoint(value).checkpointId, value.checkpointId);
  rejects(() =>
    parsePortableCheckpoint({
      ...value,
      objective: { ...value.objective, hiddenPlannerState: "unsafe" },
    }),
  );
  rejects(() =>
    parsePortableCheckpoint({
      ...value,
      pending: { kind: "approval_required", approvalId: "old-grant" },
    }),
  );
});
