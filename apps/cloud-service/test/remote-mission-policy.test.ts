import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRemoteMissionTransition,
  parseCreateRemoteMission,
  parseMissionEvidence,
  parseRemoteMissionProgress,
  parseRemoteMissionTargetDecision,
  parseRemoteMissionSupervisorDecision,
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

test("binds Codex supervisor decisions to a mission step revision", () => {
  const missionId = crypto.randomUUID();
  const parsed = parseRemoteMissionSupervisorDecision({
    schemaVersion: 1,
    decisionId: "decision-1",
    missionId,
    stepId: "step-1",
    expectedPlanRevision: 2,
    kind: "retry",
    guidance: "Inspect the main content region.",
    decidedAt: new Date().toISOString(),
  }, missionId);
  assert.equal(parsed.expectedPlanRevision, 2);
  assert.equal(parsed.kind, "retry");
  assert.throws(() => parseRemoteMissionSupervisorDecision({
    ...parsed,
    kind: "complete",
  }, missionId), RemoteMissionPolicyError);
  assert.doesNotThrow(() => parseRemoteMissionSupervisorDecision({
    ...parsed,
    kind: "complete",
    outcome: "completed",
  }, missionId));
  assert.throws(() => parseRemoteMissionSupervisorDecision({
    ...parsed,
    expectedPlanRevision: 1,
    kind: "replace_remaining_plan",
  }, missionId), RemoteMissionPolicyError);
});

test("preserves bounded page and approval evidence for Codex", () => {
  const missionId = crypto.randomUUID();
  const approval = {
    approvalId: "approval-1",
    question: "Submit this form?",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    actionDigest: "sha256:test",
  };
  const parsed = parseMissionEvidence({
    schemaVersion: 1,
    missionId,
    stepId: "step-1",
    attemptId: "attempt-1",
    planRevision: 1,
    outcome: "approval_required",
    page: { origin: "https://example.test", title: "Example" },
    target: {
      context: "isolated_tab",
      pageOrigin: "https://example.test",
      pageTitle: "Example",
      expectedUrlMatched: true,
      windowLabel: "Window 1",
      workspaceTitle: "OpenSidebar 1",
      inWorkspace: true,
      sidePanelEnabled: true,
      createdForMission: true,
    },
    claims: [{ claim: "The form is ready.", source: "page_observation" }],
    effects: [{ type: "form_submit", consequential: true }],
    uncertainties: [],
    approval,
  }, missionId);
  assert.deepEqual(parsed.page, { origin: "https://example.test", title: "Example" });
  assert.equal(parsed.target?.workspaceTitle, "OpenSidebar 1");
  assert.equal(parsed.target?.sidePanelEnabled, true);
  assert.deepEqual(parsed.approval, approval);
  assert.throws(() => parseMissionEvidence({
    ...parsed,
    page: { origin: "https://example.test/path" },
  }, missionId), RemoteMissionPolicyError);
  assert.throws(() => parseMissionEvidence({
    ...parsed,
    outcome: "achieved",
  }, missionId), RemoteMissionPolicyError);
  assert.throws(() => parseMissionEvidence({
    ...parsed,
    target: { ...parsed.target, pageOrigin: "https://example.test/path" },
  }, missionId), RemoteMissionPolicyError);
});
