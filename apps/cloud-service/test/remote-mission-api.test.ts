import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type {
  RemoteMissionState,
  RemoteMissionV1,
} from "@opensidebar/shared-types";
import { createRemoteMissionApi } from "../src/remote-mission-api.js";
import { tokenHash } from "../src/crypto.js";

const deviceId = "dev_123e4567e89b42d3a4564266";
const otherDeviceId = "dev_123e4567e89b42d3a4564299";

function world(options: {
  createThrows?: boolean;
  enabled?: boolean;
  principalDeviceId?: string;
  connectionKind?: "browser_extension" | "test_client";
  remoteMissionCapable?: boolean;
  remoteWorkEnabled?: boolean;
} = {}) {
  const records = new Map<string, RemoteMissionV1>();
  const payloads = new Map<string, unknown>();
  const results = new Map<string, unknown>();
  const progress = new Map<string, unknown>();
  const decisions = new Map<string, unknown>();
  const targetDecisions = new Map<string, unknown>();
  const supervisorDecisions = new Map<string, unknown>();
  const principal = {
    accountId: "account-1",
    email: "owner@example.test",
    sessionEpoch: 1,
    cloudAccess: true,
    deviceId: options.principalDeviceId ?? deviceId,
    installationId: "install-1",
  };
  const accounts = {
    async remoteWorkSettings() {
      return { schemaVersion: 1, enabled: options.remoteWorkEnabled ?? true, revision: 1, updatedAt: new Date().toISOString() };
    },
    async accessPrincipal(hash: string) {
      return hash === tokenHash("token") ? principal : null;
    },
    async listDevices() {
      return [
        {
          schemaVersion: 1 as const,
          id: deviceId,
          installationId: "install-1",
          displayName: "Laptop",
          displayNameRevision: 1,
          extensionVersion: "0.7.3",
          connectionKind: options.connectionKind ?? "browser_extension",
          capabilities:
            options.remoteMissionCapable === false
              ? []
              : ["remote_browser_tasks_v1" as const],
          availability: "online" as const,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        },
      ];
    },
    async markRemoteMissionReady(accountId: string, candidateDeviceId: string) {
      return (
        accountId === principal.accountId &&
        candidateDeviceId === principal.deviceId &&
        (options.connectionKind ?? "browser_extension") === "browser_extension"
      );
    },
  };
  const missions = {
    async activeMissions() {
      return [...records.values()].filter((mission) =>
        ["queued", "accepted", "running", "target_selection_required", "supervision_required", "approval_required"].includes(mission.state),
      );
    },
    async missionByIdempotency() {
      return null;
    },
    async createMission(input: {
      missionId: string;
      deviceId: string;
      createdAt: Date;
      expiresAt: Date;
    }) {
      if (options.createThrows) throw new Error("database unavailable");
      const mission: RemoteMissionV1 = {
        schemaVersion: 1,
        missionId: input.missionId,
        deviceId: input.deviceId,
        sequence: records.size + 1,
        state: "queued",
        createdAt: input.createdAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      };
      records.set(mission.missionId, mission);
      return { kind: "created" as const, value: mission };
    },
    async mission(_accountId: string, missionId: string) {
      return records.get(missionId) ?? null;
    },
    async missions(input: { deviceId: string; afterSequence: number }) {
      return [...records.values()].filter(
        (value) =>
          value.deviceId === input.deviceId &&
          value.sequence > input.afterSequence,
      );
    },
    async transition(input: {
      missionId: string;
      from: RemoteMissionState;
      to: RemoteMissionState;
      resultCode?: RemoteMissionV1["resultCode"];
    }) {
      const current = records.get(input.missionId);
      if (!current || current.state !== input.from)
        return { kind: "state_conflict" as const };
      const value = {
        ...current,
        state: input.to,
        ...(input.resultCode ? { resultCode: input.resultCode } : {}),
      };
      records.set(input.missionId, value);
      return { kind: "updated" as const, value };
    },
    async payloadObjectKey() {
      return "unused";
    },
    async expired() {
      return [];
    },
    async remove(_accountId: string, missionId: string) {
      return records.delete(missionId);
    },
  };
  const vault = {
    objectKey: (identity: { missionId: string }) => identity.missionId,
    async encryptAndPut(
      identity: { missionId: string },
      payload: unknown,
    ) {
      payloads.set(identity.missionId, payload);
      return { ciphertextSizeBytes: 100, ciphertextSha256: "a".repeat(64) };
    },
    async getAndDecrypt(identity: { missionId: string }) {
      return payloads.get(identity.missionId)!;
    },
    async encryptResultAndPut(identity: { missionId: string }, result: unknown) {
      results.set(identity.missionId, result);
      return { ciphertextSizeBytes: 100, ciphertextSha256: "b".repeat(64) };
    },
    async getResultAndDecrypt(identity: { missionId: string }) {
      const result = results.get(identity.missionId);
      if (!result) throw new Error("missing");
      return result;
    },
    async encryptProgressAndPut(identity: { missionId: string }, value: unknown) {
      progress.set(identity.missionId, value);
      return { ciphertextSizeBytes: 100, ciphertextSha256: "c".repeat(64) };
    },
    async replaceSupervisionProgressAndPut(identity: { missionId: string }, value: unknown) {
      progress.set(identity.missionId, value);
      supervisorDecisions.delete(identity.missionId);
      return { ciphertextSizeBytes: 100, ciphertextSha256: "f".repeat(64) };
    },
    async getProgressAndDecrypt(identity: { missionId: string }) {
      const value = progress.get(identity.missionId);
      if (!value) throw new Error("missing");
      return value;
    },
    async encryptApprovalDecisionAndPut(
      identity: { missionId: string },
      value: unknown,
    ) {
      decisions.set(identity.missionId, value);
      return { ciphertextSizeBytes: 100, ciphertextSha256: "d".repeat(64) };
    },
    async getApprovalDecisionAndDecrypt(identity: { missionId: string }) {
      const value = decisions.get(identity.missionId);
      if (!value) throw new Error("missing");
      return value;
    },
    async encryptTargetDecisionAndPut(identity: { missionId: string }, value: unknown) {
      targetDecisions.set(identity.missionId, value);
      return { ciphertextSizeBytes: 100, ciphertextSha256: "e".repeat(64) };
    },
    async getTargetDecisionAndDecrypt(identity: { missionId: string }) {
      const value = targetDecisions.get(identity.missionId);
      if (!value) throw new Error("missing");
      return value;
    },
    async encryptSupervisorDecisionAndPut(identity: { missionId: string }, value: unknown) {
      supervisorDecisions.set(identity.missionId, value);
      return { ciphertextSizeBytes: 100, ciphertextSha256: "f".repeat(64) };
    },
    async getSupervisorDecisionAndDecrypt(identity: { missionId: string }) {
      const value = supervisorDecisions.get(identity.missionId);
      if (!value) throw new Error("missing");
      return value;
    },
    async delete(identity: { missionId: string }) {
      payloads.delete(identity.missionId);
      results.delete(identity.missionId);
      progress.delete(identity.missionId);
      decisions.delete(identity.missionId);
      targetDecisions.delete(identity.missionId);
      supervisorDecisions.delete(identity.missionId);
    },
  };
  const app = new Hono();
  app.route(
    "/api/v1",
    createRemoteMissionApi({
      config: {
        remoteMissionsEnabled: options.enabled ?? true,
        cloudSessionTesterSubjects: new Set(["account-1"]),
      } as never,
      accounts: accounts as never,
      missions,
      vault: vault as never,
    }),
  );
  return { app, records, payloads, results, progress, targetDecisions, supervisorDecisions, principal };
}

const auth = { authorization: "Bearer token" };

test("mission guards do not intercept unrelated API routes", async () => {
  const { app } = world({ enabled: false });
  assert.equal((await app.request("/api/v1/playground/auth/login")).status, 404);
  const disabled = await app.request("/api/v1/remote-missions", {
    method: "POST",
  });
  assert.equal(disabled.status, 503);
});

test("creates metadata-only mission and selected device receives payload", async () => {
  const { app } = world();
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "create-1",
    },
    body: JSON.stringify({
      schemaVersion: 1,
      deviceId,
      instruction: "Summarize this dashboard",
    }),
  });
  assert.equal(created.status, 201);
  const metadata = (await created.json()) as Record<string, unknown>;
  assert.equal(metadata.instruction, undefined);

  const delivery = await app.request(
    `/api/v1/devices/${deviceId}/remote-missions`,
    { headers: auth },
  );
  assert.equal(delivery.status, 200);
  assert.equal(
    (await delivery.text()).includes("Summarize this dashboard"),
    true,
  );
  assert.equal((await (async () => {
    const response = await app.request(`/api/v1/devices/${deviceId}/remote-missions`, { headers: auth });
    return response.json() as Promise<{ missions: Array<{ payload: { executionClass: string } }> }>;
  })()).missions[0]?.payload.executionClass, "read_only");
});

test("test clients are never selectable as browser mission executors", async () => {
  const { app } = world({ connectionKind: "test_client" });
  const response = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "reject-test-client",
    },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  assert.equal(response.status, 409);
});

test("online devices without a recent remote poll cannot receive missions", async () => {
  const { app } = world({ remoteMissionCapable: false });
  const response = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "reject-incapable-device",
    },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "device_remote_work_unavailable");
});

test("disabled remote work blocks creation and browser delivery", async () => {
  const { app } = world({ remoteWorkEnabled: false });
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "remote-disabled",
    },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  assert.equal(created.status, 403);
  const delivery = await app.request(`/api/v1/devices/${deviceId}/remote-missions`, { headers: auth });
  assert.equal(delivery.status, 403);
});

test("rejects delivery to a different authenticated device", async () => {
  const { app } = world();
  const response = await app.request(
    `/api/v1/devices/${otherDeviceId}/remote-missions`,
    { headers: auth },
  );
  assert.equal(response.status, 403);
});

test("removes an encrypted orphan when metadata creation throws", async () => {
  const { app, payloads } = world({ createThrows: true });
  const response = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "create-orphan",
    },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  assert.equal(response.status, 503);
  assert.equal(payloads.size, 0);
});

test("selected device advances the monotonic lifecycle", async () => {
  const { app } = world();
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "create-2",
    },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  const mission = (await created.json()) as RemoteMissionV1;
  const accepted = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/transition`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, to: "accepted" }),
    },
  );
  assert.equal(accepted.status, 200);
  assert.equal(((await accepted.json()) as RemoteMissionV1).state, "accepted");

  const invalid = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/transition`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, to: "succeeded", resultCode: "completed" }),
    },
  );
  assert.equal(invalid.status, 400);
});

test("stores a bounded encrypted terminal result for coordinator retrieval", async () => {
  const { app } = world();
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "result-1" },
    body: JSON.stringify({
      schemaVersion: 1,
      deviceId,
      instruction: "Read",
      targetContext: "active_tab",
    }),
  });
  const mission = (await created.json()) as RemoteMissionV1;
  for (const to of ["accepted", "running"] as const) {
    const transitioned = await app.request(
      `/api/v1/remote-missions/${mission.missionId}/transition`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, to }),
      },
    );
    assert.equal(transitioned.status, 200);
  }
  const stored = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/result`,
    {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        missionId: mission.missionId,
        outcome: "completed",
        createdAt: "2026-08-12T20:00:00.000Z",
        summary: "Example Domain",
      }),
    },
  );
  assert.equal(stored.status, 201);
  const terminal = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/transition`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, to: "succeeded", resultCode: "completed" }),
    },
  );
  assert.equal(terminal.status, 200);
  const fetched = await app.request(`/api/v1/remote-missions/${mission.missionId}`, {
    headers: auth,
  });
  assert.equal(fetched.status, 200);
  assert.equal(((await fetched.json()) as { result?: { summary?: string } }).result?.summary, "Example Domain");
});

test("returns encrypted live progress and coordinator cancellation is idempotent", async () => {
  const { app } = world();
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "cancel-1" },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  const mission = (await created.json()) as RemoteMissionV1;
  const progress = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/progress`,
    {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        missionId: mission.missionId,
        state: "accepted",
        updatedAt: "2026-08-13T08:00:00.000Z",
      }),
    },
  );
  assert.equal(progress.status, 201);
  const accepted = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/transition`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, to: "accepted" }),
    },
  );
  assert.equal(accepted.status, 200);
  const status = await app.request(`/api/v1/remote-missions/${mission.missionId}`, {
    headers: auth,
  });
  assert.equal(
    ((await status.json()) as { progress?: { state?: string } }).progress?.state,
    "accepted",
  );
  const cancelled = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/cancel`,
    {
      method: "POST",
      headers: { ...auth, "idempotency-key": "cancel-request-1" },
    },
  );
  assert.equal(cancelled.status, 200);
  assert.equal(((await cancelled.json()) as RemoteMissionV1).state, "cancelled");
  const replay = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/cancel`,
    {
      method: "POST",
      headers: { ...auth, "idempotency-key": "cancel-request-1" },
    },
  );
  assert.equal(replay.status, 200);
  const terminal = await app.request(`/api/v1/remote-missions/${mission.missionId}`, {
    headers: auth,
  });
  const terminalBody = (await terminal.json()) as {
    progress?: unknown;
    result?: { outcome?: string };
  };
  assert.equal(terminalBody.progress, undefined);
  assert.equal(terminalBody.result?.outcome, "cancelled");
});

test("binds one encrypted approval decision to the pending digest", async () => {
  const { app, principal } = world();
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "approval-1" },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  const mission = (await created.json()) as RemoteMissionV1;
  for (const to of ["accepted", "running"] as const) {
    assert.equal((await app.request(
      `/api/v1/remote-missions/${mission.missionId}/transition`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, to }),
      },
    )).status, 200);
  }
  assert.equal((await app.request(
    `/api/v1/remote-missions/${mission.missionId}/progress`,
    {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        missionId: mission.missionId,
        state: "approval_required",
        updatedAt: new Date().toISOString(),
        approval: {
          approvalId: "approval-1",
          question: "Continue?",
          actionDigest: "digest-1",
          expiresAt: "2099-08-13T08:00:00.000Z",
        },
      }),
    },
  )).status, 201);
  assert.equal((await app.request(
    `/api/v1/remote-missions/${mission.missionId}/transition`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, to: "approval_required" }),
    },
  )).status, 200);
  const stale = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/approval-decision`,
    {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json", "idempotency-key": "decision-stale" },
      body: JSON.stringify({
        schemaVersion: 1,
        missionId: mission.missionId,
        approvalId: "approval-1",
        actionDigest: "wrong",
        approved: true,
        decidedAt: new Date().toISOString(),
      }),
    },
  );
  assert.equal(stale.status, 409);
  const decisionBody = {
    schemaVersion: 1,
    missionId: mission.missionId,
    approvalId: "approval-1",
    actionDigest: "digest-1",
    approved: true,
    decidedAt: new Date().toISOString(),
  };
  const decided = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/approval-decision`,
    {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json", "idempotency-key": "decision-1" },
      body: JSON.stringify(decisionBody),
    },
  );
  assert.equal(decided.status, 201);
  const replay = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/approval-decision`,
    {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json", "idempotency-key": "decision-1" },
      body: JSON.stringify(decisionBody),
    },
  );
  assert.equal(replay.status, 200);
  principal.deviceId = otherDeviceId;
  assert.equal((await app.request(
    `/api/v1/remote-missions/${mission.missionId}/approval-decision`,
    { headers: auth },
  )).status, 403);
  principal.deviceId = deviceId;
  const consumed = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/approval-decision`,
    { headers: auth },
  );
  assert.equal(consumed.status, 200);
  assert.equal(
    ((await consumed.json()) as { actionDigest?: string }).actionDigest,
    "digest-1",
  );
});

test("binds target selection to a pending opaque candidate", async () => {
  const { app, principal } = world();
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "target-1" },
    body: JSON.stringify({
      schemaVersion: 1,
      deviceId,
      instruction: "Read",
      initialUrl: "https://example.com/",
      targetContext: "existing_tab",
    }),
  });
  const mission = (await created.json()) as RemoteMissionV1;
  for (const to of ["accepted", "running"] as const) {
    assert.equal((await app.request(`/api/v1/remote-missions/${mission.missionId}/transition`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, to }),
    })).status, 200);
  }
  const updatedAt = new Date(Date.now() - 1_000).toISOString();
  assert.equal((await app.request(`/api/v1/remote-missions/${mission.missionId}/progress`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      missionId: mission.missionId,
      state: "target_selection_required",
      updatedAt,
      targetSelection: {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        candidates: [
          { targetHandle: "target_work", pageTitle: "Example", groupTitle: "Work" },
          { targetHandle: "target_personal", pageTitle: "Example", groupTitle: "Personal" },
        ],
      },
    }),
  })).status, 201);
  assert.equal((await app.request(`/api/v1/remote-missions/${mission.missionId}/transition`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, to: "target_selection_required" }),
  })).status, 200);
  const rejected = await app.request(`/api/v1/remote-missions/${mission.missionId}/target-decision`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "target-bad" },
    body: JSON.stringify({
      schemaVersion: 1,
      missionId: mission.missionId,
      targetHandle: "target_unknown",
      decidedAt: new Date().toISOString(),
    }),
  });
  assert.equal(rejected.status, 409);
  const selected = await app.request(`/api/v1/remote-missions/${mission.missionId}/target-decision`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "target-good" },
    body: JSON.stringify({
      schemaVersion: 1,
      missionId: mission.missionId,
      targetHandle: "target_personal",
      decidedAt: new Date().toISOString(),
    }),
  });
  assert.equal(selected.status, 201);
  principal.deviceId = otherDeviceId;
  assert.equal((await app.request(
    `/api/v1/remote-missions/${mission.missionId}/target-decision`,
    { headers: auth },
  )).status, 403);
});

test("binds an encrypted Codex decision to the current browser evidence revision", async () => {
  const state = world();
  const created = await state.app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "supervisor-1" },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  const mission = (await created.json()) as RemoteMissionV1;
  state.records.set(mission.missionId, { ...mission, state: "running" });
  const updatedAt = new Date(Date.now() - 1_000).toISOString();
  const evidence = {
    schemaVersion: 1,
    missionId: mission.missionId,
    stepId: `${mission.missionId}:read`,
    attemptId: "attempt-1",
    planRevision: 1,
    outcome: "achieved",
    claims: [{ claim: "Example Domain", source: "agent_summary" }],
    effects: [],
    uncertainties: [],
  };
  const pendingStep = {
    schemaVersion: 1,
    missionId: mission.missionId,
    stepId: evidence.stepId,
    planRevision: 1,
    risk: "read_only",
    objective: "Read the visible heading",
    successCriteria: ["Return the exact heading"],
  };
  assert.equal((await state.app.request(`/api/v1/remote-missions/${mission.missionId}/progress`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      missionId: mission.missionId,
      state: "supervision_required",
      updatedAt,
      evidence,
      pendingStep,
    }),
  })).status, 201);
  assert.equal((await state.app.request(`/api/v1/remote-missions/${mission.missionId}/transition`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, to: "supervision_required" }),
  })).status, 200);
  const stale = await state.app.request(`/api/v1/remote-missions/${mission.missionId}/supervisor-decision`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "supervisor-stale" },
    body: JSON.stringify({
      schemaVersion: 1,
      decisionId: "decision-stale",
      missionId: mission.missionId,
      stepId: evidence.stepId,
      expectedPlanRevision: 2,
      kind: "complete",
      outcome: "completed",
      decidedAt: new Date().toISOString(),
    }),
  });
  assert.equal(stale.status, 409);
  const accepted = await state.app.request(`/api/v1/remote-missions/${mission.missionId}/supervisor-decision`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "supervisor-current" },
    body: JSON.stringify({
      schemaVersion: 1,
      decisionId: "decision-current",
      missionId: mission.missionId,
      stepId: evidence.stepId,
      expectedPlanRevision: 1,
      kind: "complete",
      outcome: "completed",
      decidedAt: new Date().toISOString(),
    }),
  });
  assert.equal(accepted.status, 201);
});

test("account deletion removes mission metadata and encrypted payload", async () => {
  const worldState = world();
  const created = await worldState.app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", "idempotency-key": "delete-1" },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  const mission = (await created.json()) as RemoteMissionV1;
  const deleted = await worldState.app.request(`/api/v1/remote-missions/${mission.missionId}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(deleted.status, 204);
  assert.equal(worldState.payloads.size, 0);
  assert.equal(worldState.records.size, 0);
});
