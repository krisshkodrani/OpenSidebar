import assert from "node:assert/strict";
import test from "node:test";
import type { RemoteMissionV1 } from "@opensidebar/shared-types";
import { createHostedBrowserMcpOperations } from "../src/hosted-browser-mcp-operations.js";

const principal = {
  accountId: "account-1",
  clientId: "codex",
  scopes: new Set<string>(),
};

function world(deviceCount = 1) {
  const missions = new Map<string, RemoteMissionV1>();
  const idempotentMissions = new Map<string, RemoteMissionV1>();
  const payloads = new Map<string, unknown>();
  const progress = new Map<string, unknown>();
  const targetDecisions = new Map<string, unknown>();
  const supervisorDecisions = new Map<string, unknown>();
  const supervisorWrites: unknown[] = [];
  const requestedProgressStates: Array<string | undefined> = [];
  const devices = Array.from({ length: deviceCount }, (_, index) => ({
    schemaVersion: 1 as const,
    id: `dev_browser_${index + 1}`,
    installationId: `install-${index + 1}`,
    displayName: index ? "Personal laptop" : "Work laptop",
    displayNameRevision: 1,
    extensionVersion: "0.7.4",
    connectionKind: "browser_extension" as const,
    capabilities: ["remote_browser_tasks_v1" as const],
    availability: "online" as const,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }));
  const accounts = {
    async listDevices() { return devices; },
    async remoteWorkSettings() {
      return { schemaVersion: 1, enabled: true, revision: 1, updatedAt: new Date().toISOString() };
    },
  };
  const repository = {
    async missionByIdempotency(accountId: string, idempotencyHash: string) {
      return accountId === principal.accountId
        ? idempotentMissions.get(idempotencyHash) ?? null
        : null;
    },
    async mission(accountId: string, missionId: string) {
      return accountId === principal.accountId ? missions.get(missionId) ?? null : null;
    },
    async createMission(input: { missionId: string; deviceId: string; createdAt: Date; expiresAt: Date; idempotencyHash: string }) {
      const mission: RemoteMissionV1 = {
        schemaVersion: 1,
        missionId: input.missionId,
        deviceId: input.deviceId,
        sequence: missions.size + 1,
        state: "queued",
        createdAt: input.createdAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      };
      missions.set(mission.missionId, mission);
      idempotentMissions.set(input.idempotencyHash, mission);
      return { kind: "created" as const, value: mission };
    },
    async transition(input: { missionId: string; to: RemoteMissionV1["state"] }) {
      const current = missions.get(input.missionId)!;
      const value = { ...current, state: input.to };
      missions.set(input.missionId, value);
      return { kind: "updated" as const, value };
    },
  };
  const vault = {
    objectKey: ({ missionId }: { missionId: string }) => `missions/${missionId}`,
    async encryptAndPut(identity: { missionId: string }, value: unknown) {
      payloads.set(identity.missionId, value);
      return { ciphertextSizeBytes: 10, ciphertextSha256: "a".repeat(64) };
    },
    async getProgressAndDecrypt(identity: { missionId: string }, state?: string) {
      requestedProgressStates.push(state);
      const value = progress.get(identity.missionId);
      if (!value) throw new Error("missing");
      return value;
    },
    async getResultAndDecrypt() { throw new Error("missing"); },
    async encryptTargetDecisionAndPut(identity: { missionId: string }, value: unknown) {
      targetDecisions.set(identity.missionId, value);
    },
    async encryptSupervisorDecisionAndPut(identity: { missionId: string }, value: unknown) {
      supervisorDecisions.set(identity.missionId, value);
      supervisorWrites.push(value);
    },
    async encryptApprovalDecisionAndPut() {},
    async encryptResultAndPut() {},
    async delete() {},
  };
  return {
    operations: createHostedBrowserMcpOperations({
      accounts: accounts as never,
      missions: repository as never,
      vault: vault as never,
    }),
    missions,
    payloads,
    progress,
    targetDecisions,
    supervisorDecisions,
    supervisorWrites,
    requestedProgressStates,
    devices,
  };
}

test("selects the only online browser and returns its name with the job", async () => {
  const state = world();
  const result = await state.operations.startTask(principal, {
    requestId: "request-1",
    objective: "Read the heading",
    successCriteria: ["Return the exact heading"],
  }) as { mission: RemoteMissionV1; selectedDevice: { deviceId: string; name: string } };
  assert.equal(result.selectedDevice.name, "Work laptop");
  assert.equal(result.selectedDevice.deviceId, state.devices[0]!.id);
  assert.equal(result.mission.state, "queued");
  assert.equal(JSON.stringify(state.payloads.get(result.mission.missionId)).includes("Read the heading"), true);
  const replay = await state.operations.startTask(principal, {
    requestId: "request-1",
    objective: "Read the heading",
    successCriteria: ["Return the exact heading"],
  }) as { mission: RemoteMissionV1; replayed?: boolean };
  assert.equal(replay.mission.missionId, result.mission.missionId);
  assert.equal(replay.replayed, true);
  assert.equal(state.payloads.size, 1);
});

test("requires a device choice when two browsers are online", async () => {
  const state = world(2);
  await assert.rejects(
    () => state.operations.startTask(principal, {
      requestId: "request-2",
      objective: "Read the heading",
      successCriteria: ["Return the exact heading"],
    }),
    /device_selection_required/,
  );
});

test("reports but never selects an online build that has not polled remote work", async () => {
  const state = world();
  state.devices[0]!.capabilities = [];
  const listed = await state.operations.listDevices(principal) as {
    devices: Array<{ remoteWork: string }>;
  };
  assert.equal(listed.devices[0]?.remoteWork, "unsupported");
  await assert.rejects(
    () => state.operations.startTask(principal, {
      requestId: "request-incapable",
      deviceId: state.devices[0]!.id,
      objective: "Read the heading",
      successCriteria: ["Return the exact heading"],
    }),
    /device_remote_work_unavailable/,
  );
});

test("stores only a candidate-bound target decision for the held mission", async () => {
  const state = world();
  const started = await state.operations.startTask(principal, {
    requestId: "request-3",
    objective: "Read the heading",
    successCriteria: ["Return the exact heading"],
    initialUrl: "https://example.com/",
    targetContext: "existing_tab",
  }) as { mission: RemoteMissionV1 };
  state.missions.set(started.mission.missionId, {
    ...started.mission,
    state: "target_selection_required",
  });
  state.progress.set(started.mission.missionId, {
    schemaVersion: 1,
    missionId: started.mission.missionId,
    state: "target_selection_required",
    updatedAt: new Date().toISOString(),
    targetSelection: {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      candidates: [
        { targetHandle: "target_work", pageTitle: "Example", groupTitle: "Work" },
        { targetHandle: "target_personal", pageTitle: "Example", groupTitle: "Personal" },
      ],
    },
  });
  await assert.rejects(
    () => state.operations.continueTask(principal, {
      missionId: started.mission.missionId,
      decision: "select_target",
      targetHandle: "target_unknown",
    }),
    /target_selection_stale/,
  );
  await state.operations.continueTask(principal, {
    missionId: started.mission.missionId,
    decision: "select_target",
    targetHandle: "target_personal",
  });
  const decision = state.targetDecisions.get(started.mission.missionId) as {
    missionId: string;
    targetHandle: string;
  };
  assert.equal(decision.missionId, started.mission.missionId);
  assert.equal(decision.targetHandle, "target_personal");
});

test("stores a revision-bound Codex completion decision without changing browser evidence", async () => {
  const state = world();
  const started = await state.operations.startTask(principal, {
    requestId: "request-4",
    objective: "Read the heading",
    successCriteria: ["Return the exact heading"],
  }) as { mission: RemoteMissionV1 };
  state.missions.set(started.mission.missionId, {
    ...started.mission,
    state: "supervision_required",
  });
  state.progress.set(started.mission.missionId, {
    schemaVersion: 1,
    missionId: started.mission.missionId,
    state: "supervision_required",
    updatedAt: new Date().toISOString(),
    evidence: {
      schemaVersion: 1,
      missionId: started.mission.missionId,
      stepId: `${started.mission.missionId}:read`,
      attemptId: "attempt-1",
      planRevision: 1,
      outcome: "achieved",
      claims: [{ claim: "Example Domain", source: "agent_summary" }],
      effects: [],
      uncertainties: [],
    },
  });
  await state.operations.continueTask(principal, {
    missionId: started.mission.missionId,
    stepId: `${started.mission.missionId}:read`,
    expectedPlanRevision: 1,
    decision: "complete",
    outcome: "completed",
  });
  const decision = state.supervisorDecisions.get(started.mission.missionId) as {
    kind: string;
    expectedPlanRevision: number;
  };
  assert.equal(decision.kind, "complete");
  assert.equal(decision.expectedPlanRevision, 1);
  const status = await state.operations.getTask(principal, {
    missionId: started.mission.missionId,
  }) as { progress?: { evidence?: { attemptId?: string } } };
  assert.equal(status.progress?.evidence?.attemptId, "attempt-1");
  assert.equal(state.requestedProgressStates.at(-1), "supervision_required");
});

test("keeps user-input requests conversational and supervisor retries idempotent", async () => {
  const state = world();
  const started = await state.operations.startTask(principal, {
    requestId: "request-5",
    objective: "Read the heading",
    successCriteria: ["Return the exact heading"],
  }) as { mission: RemoteMissionV1 };
  const missionId = started.mission.missionId;
  state.missions.set(missionId, { ...started.mission, state: "supervision_required" });
  state.progress.set(missionId, {
    schemaVersion: 1,
    missionId,
    state: "supervision_required",
    updatedAt: new Date().toISOString(),
    evidence: {
      schemaVersion: 1,
      missionId,
      stepId: `${missionId}:read`,
      attemptId: "attempt-1",
      planRevision: 1,
      outcome: "unknown",
      claims: [],
      effects: [],
      uncertainties: ["The requested section was ambiguous."],
    },
  });
  const base = {
    missionId,
    stepId: `${missionId}:read`,
    expectedPlanRevision: 1,
  };
  const input = await state.operations.continueTask(principal, {
    ...base,
    decision: "request_user_input",
    guidance: "Which section should I summarize?",
  }) as { requiresUserInput?: boolean };
  assert.equal(input.requiresUserInput, true);
  assert.equal(state.supervisorWrites.length, 0);
  await state.operations.continueTask(principal, {
    ...base,
    decision: "retry",
    guidance: "Summarize the Overview section.",
  });
  await state.operations.continueTask(principal, {
    ...base,
    decision: "retry",
    guidance: "Summarize the Overview section.",
  });
  assert.equal(
    (state.supervisorWrites[0] as { decisionId: string }).decisionId,
    (state.supervisorWrites[1] as { decisionId: string }).decisionId,
  );
});
