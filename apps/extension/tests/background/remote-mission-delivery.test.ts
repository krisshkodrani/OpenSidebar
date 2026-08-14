import { describe, expect, test, vi } from "vitest";
import type {
  DeliveredRemoteMissionV1,
  RemoteMissionState,
  RemoteMissionV1,
} from "@shared-types/remote-missions";
import { createFakePersistencePort } from "../fakes/persistence";
import { LocalRemoteMissionDeliveryJournal } from "../../src/background/remote-missions/delivery-journal";
import { RemoteMissionDeliveryController } from "../../src/background/remote-missions/delivery-controller";
import type { RemoteMissionDeliveryPort } from "../../src/background/remote-missions/ports";
import type { MissionWorker } from "../../src/background/remote-missions/mission-worker";

const deviceId = "123e4567-e89b-42d3-a456-426614174000";
const missionId = "123e4567-e89b-42d3-a456-426614174001";

const delivery = (overrides: Partial<RemoteMissionV1> = {}): DeliveredRemoteMissionV1 => {
  const mission: RemoteMissionV1 = {
    schemaVersion: 1,
    missionId,
    deviceId,
    createdAt: "2026-08-12T12:00:00.000Z",
    expiresAt: "2099-08-12T13:00:00.000Z",
    sequence: 1,
    state: "queued",
    ...overrides,
  };
  return {
    schemaVersion: 1,
    mission,
    payload: {
      schemaVersion: 1,
      missionId: mission.missionId,
      executionClass: "read_only",
      instruction: "Read the visible page heading",
      initialUrl: "https://example.com/",
    },
  };
};

function setup(items = [delivery()]) {
  const { port } = createFakePersistencePort();
  const records = new Map(items.map((item) => [item.mission.missionId, item.mission]));
  const transitions: RemoteMissionState[] = [];
  const results: unknown[] = [];
  const progress: unknown[] = [];
  let approvalDecision: Awaited<ReturnType<RemoteMissionDeliveryPort["getApprovalDecision"]>> = null;
  let targetDecision: Awaited<ReturnType<RemoteMissionDeliveryPort["getTargetDecision"]>> = null;
  let supervisorDecision: Awaited<ReturnType<RemoteMissionDeliveryPort["getSupervisorDecision"]>> = null;
  const poll = vi.fn(async (_device: string, after: number) =>
    items.filter((item) => item.mission.sequence > after));
  const transport: RemoteMissionDeliveryPort = {
    enabled: true,
    poll,
    async get(id) { return records.get(id) ?? null; },
    async getApprovalDecision() { return approvalDecision; },
    async putApprovalDecision() {},
    async getTargetDecision() { return targetDecision; },
    async putTargetDecision() {},
    async getSupervisorDecision() { return supervisorDecision; },
    async putSupervisorDecision() {},
    async cancel(id) {
      const current = records.get(id)!;
      const next = { ...current, state: "cancelled" as const, resultCode: "cancelled" as const };
      records.set(id, next);
      return next;
    },
    async transition(mission, to, resultCode) {
      transitions.push(to);
      const current = records.get(mission.missionId) ?? mission;
      const next = { ...current, state: to, ...(resultCode ? { resultCode } : {}) };
      records.set(mission.missionId, next);
      return next;
    },
    async putResult(_mission, result) {
      results.push(result);
    },
    async putProgress(_mission, value) {
      progress.push(value);
    },
  };
  const run = vi.fn().mockResolvedValue({ state: "succeeded", summary: "Example Domain" });
  const resumeApproval = vi.fn().mockResolvedValue({
    state: "succeeded",
    summary: "Approved action verified.",
  });
  const resumeTargetSelection = vi.fn().mockResolvedValue({
    state: "succeeded",
    summary: "Selected target verified.",
  });
  const resumeSupervision = vi.fn().mockResolvedValue({
    state: "succeeded",
    summary: "Codex accepted the evidence.",
  });
  const worker = { run, resumeApproval, resumeTargetSelection, resumeSupervision } as unknown as MissionWorker;
  const journal = new LocalRemoteMissionDeliveryJournal(port.local);
  const statuses: RemoteMissionState[] = [];
  const statusRecords: Array<Parameters<NonNullable<ConstructorParameters<typeof RemoteMissionDeliveryController>[4]>>[0]> = [];
  const controller = new RemoteMissionDeliveryController(
    transport,
    journal,
    worker,
    async () => deviceId,
    async (status) => {
      statuses.push(status.state);
      statusRecords.push(status);
    },
  );
  return {
    controller,
    journal,
    run,
    resumeApproval,
    resumeTargetSelection,
    resumeSupervision,
    transitions,
    statuses,
    statusRecords,
    records,
    results,
    progress,
    poll,
    setApprovalDecision(value: typeof approvalDecision) { approvalDecision = value; },
    setTargetDecision(value: typeof targetDecision) { targetDecision = value; },
    setSupervisorDecision(value: typeof supervisorDecision) { supervisorDecision = value; },
  };
}

describe("remote mission delivery", () => {
  test("journals before dispatch and completes an ordered read-only mission", async () => {
    const world = setup();
    await world.controller.pollOnce();
    expect(world.transitions).toEqual(["accepted", "running", "succeeded"]);
    expect(world.run).toHaveBeenCalledWith(
      expect.objectContaining({ missionId, steps: [expect.objectContaining({ risk: "read_only" })] }),
      expect.objectContaining({ initialUrl: "https://example.com/" }),
    );
    expect(await world.journal.read()).toEqual({ schemaVersion: 1, lastSequence: 1 });
    expect(world.statuses).toEqual(["accepted", "running", "succeeded"]);
    expect(world.statusRecords[0]).toMatchObject({
      requesterLabel: "OpenSidebar account",
      instructionSummary: "Read the visible page heading",
      targetContext: "isolated_tab",
    });
    expect(world.results).toEqual([
      expect.objectContaining({ outcome: "completed", summary: "Example Domain" }),
    ]);
    expect(world.progress).toEqual([
      expect.objectContaining({ state: "accepted" }),
      expect.objectContaining({ state: "running" }),
    ]);
  });

  test("refreshes readiness during a run without dispatching concurrently", async () => {
    let release!: () => void;
    const world = setup();
    world.run.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ state: "succeeded", summary: "done" });
    }));
    const first = world.controller.pollOnce();
    const second = world.controller.pollOnce();
    await vi.waitFor(() => expect(world.run).toHaveBeenCalledTimes(1));
    await expect(second).resolves.toBeUndefined();
    expect(world.poll).toHaveBeenCalledTimes(2);
    release();
    await first;
    await world.controller.pollOnce();
    expect(world.run).toHaveBeenCalledTimes(1);
  });

  test("fails closed on a cross-device or payload identity mismatch", async () => {
    const wrong = delivery({ deviceId: crypto.randomUUID() });
    const world = setup([wrong]);
    await expect(world.controller.pollOnce()).rejects.toThrow("remote_mission_delivery_mismatch");
    expect(world.run).not.toHaveBeenCalled();
    expect(world.transitions).toEqual([]);
  });

  test("cancels an expired queued delivery without dispatch", async () => {
    const world = setup([delivery({ expiresAt: "2020-01-01T00:00:00.000Z" })]);
    await world.controller.pollOnce();
    expect(world.transitions).toEqual(["cancelled"]);
    expect(world.run).not.toHaveBeenCalled();
    expect((await world.journal.read()).lastSequence).toBe(1);
  });

  test("recovers a journaled read-only run after restart and never treats it as consequential", async () => {
    const item = delivery({ state: "running" });
    const world = setup([item]);
    await world.journal.write({
      schemaVersion: 1,
      lastSequence: 0,
      active: { missionId, sequence: 1, state: "running", updatedAt: new Date().toISOString() },
    });
    await world.controller.pollOnce();
    expect(world.transitions).toEqual(["succeeded"]);
    expect(world.run).toHaveBeenCalledTimes(1);
    expect(world.progress).toEqual([
      expect.objectContaining({ state: "running" }),
    ]);
    expect((await world.journal.read()).active).toBeUndefined();
  });

  test("keeps a redelivered approval hold without replaying earlier progress", async () => {
    const world = setup([delivery({ state: "approval_required" })]);
    await world.controller.pollOnce();
    expect(world.run).not.toHaveBeenCalled();
    expect(world.transitions).toEqual([]);
    expect(world.progress).toEqual([]);
    expect(world.statuses).toEqual(["approval_required"]);
  });

  test("consumes a digest-bound decision and resumes the held mission", async () => {
    const item = delivery({ state: "approval_required" });
    const world = setup([item]);
    const approval = {
      approvalId: "approval-1",
      question: "Continue?",
      actionDigest: "digest-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    world.records.set(missionId, {
      ...item.mission,
      progress: {
        schemaVersion: 1,
        missionId,
        state: "approval_required",
        updatedAt: new Date().toISOString(),
        approval,
      },
    } as never);
    world.setApprovalDecision({
      schemaVersion: 1,
      missionId,
      approvalId: approval.approvalId,
      actionDigest: approval.actionDigest,
      approved: true,
      decidedAt: new Date().toISOString(),
    });
    await world.controller.pollOnce();
    expect(world.transitions).toEqual(["running", "succeeded"]);
    expect(world.resumeApproval).toHaveBeenCalledWith(
      expect.objectContaining({ missionId }),
      expect.objectContaining({ approvalId: "approval-1", approved: true }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(world.results).toEqual([
      expect.objectContaining({ outcome: "completed" }),
    ]);
  });

  test("expires a held approval without dispatching it", async () => {
    const item = delivery({ state: "approval_required" });
    const world = setup([item]);
    world.records.set(missionId, {
      ...item.mission,
      progress: {
        schemaVersion: 1,
        missionId,
        state: "approval_required",
        updatedAt: new Date(Date.now() - 120_000).toISOString(),
        approval: {
          approvalId: "approval-expired",
          question: "Continue?",
          actionDigest: "digest-expired",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    } as never);
    await world.controller.pollOnce();
    expect(world.resumeApproval).not.toHaveBeenCalled();
    expect(world.transitions).toEqual(["failed"]);
    expect(world.results).toEqual([
      expect.objectContaining({ outcome: "not_achieved" }),
    ]);
  });

  test("resumes an ambiguous existing-tab mission using only an opaque target handle", async () => {
    const item = delivery({ state: "target_selection_required" });
    const world = setup([item]);
    const updatedAt = new Date().toISOString();
    const targetSelection = {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      candidates: [
        { targetHandle: "target_one", pageTitle: "Example Domain", groupTitle: "Work", windowLabel: "Window 1" },
        { targetHandle: "target_two", pageTitle: "Example Domain", groupTitle: "Personal", windowLabel: "Window 2" },
      ],
    };
    world.records.set(missionId, {
      ...item.mission,
      progress: { schemaVersion: 1, missionId, state: "target_selection_required", updatedAt, targetSelection },
    } as never);
    world.setTargetDecision({
      schemaVersion: 1,
      missionId,
      targetHandle: "target_two",
      decidedAt: new Date(Date.now() + 1).toISOString(),
    });
    await world.controller.pollOnce();
    expect(world.transitions).toEqual(["running", "succeeded"]);
    expect(world.resumeTargetSelection).toHaveBeenCalledWith(
      expect.objectContaining({ missionId }),
      expect.objectContaining({ initialUrl: "https://example.com/" }),
      expect.objectContaining({ targetHandle: "target_two" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(world.statusRecords[0]).toMatchObject({
      state: "target_selection_required",
      targetSelection: expect.objectContaining({ candidates: expect.any(Array) }),
    });
  });

  test("resumes the same mission after a revision-bound Codex evidence decision", async () => {
    const item = delivery({ state: "supervision_required" });
    const world = setup([item]);
    const updatedAt = new Date(Date.now() - 1_000).toISOString();
    const evidence = {
      schemaVersion: 1 as const,
      missionId,
      stepId: `${missionId}:read`,
      attemptId: "attempt-1",
      planRevision: 1,
      outcome: "achieved" as const,
      claims: [{ claim: "Example Domain", source: "agent_summary" as const }],
      effects: [],
      uncertainties: [],
    };
    const pendingStep = {
      schemaVersion: 1 as const,
      missionId,
      stepId: evidence.stepId,
      planRevision: 1,
      risk: "read_only" as const,
      objective: "Read the visible page heading",
      successCriteria: ["Return the exact heading"],
    };
    world.records.set(missionId, {
      ...item.mission,
      progress: { schemaVersion: 1, missionId, state: "supervision_required", updatedAt, evidence, pendingStep },
    } as never);
    world.setSupervisorDecision({
      schemaVersion: 1,
      decisionId: "decision-1",
      missionId,
      stepId: evidence.stepId,
      expectedPlanRevision: 1,
      kind: "complete",
      outcome: "completed",
      decidedAt: new Date().toISOString(),
    });
    await world.controller.pollOnce();
    expect(world.transitions).toEqual(["running", "succeeded"]);
    expect(world.resumeSupervision).toHaveBeenCalledWith(
      expect.objectContaining({ missionId }),
      evidence,
      expect.objectContaining({ kind: "complete" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("reports cancellation when a running read-only worker is aborted", async () => {
    const controller = new AbortController();
    const world = setup();
    world.run.mockImplementation(async (_mission, options) => {
      controller.abort();
      expect(options.signal?.aborted).toBe(true);
      return { state: "cancelled" };
    });
    await world.controller.pollOnce({ signal: controller.signal });
    expect(world.transitions).toEqual(["accepted", "running", "cancelled"]);
    expect(world.results).toEqual([
      expect.objectContaining({ outcome: "cancelled" }),
    ]);
  });

  test("aborts a running worker when the coordinator cancels in cloud", async () => {
    const world = setup();
    const controller = new RemoteMissionDeliveryController(
      {
        enabled: true,
        poll: async () => [delivery()],
        get: async () => ({ ...delivery().mission, state: "cancelled", resultCode: "cancelled" }),
        getApprovalDecision: async () => null,
        putApprovalDecision: async () => {},
        getTargetDecision: async () => null,
        putTargetDecision: async () => {},
        getSupervisorDecision: async () => null,
        putSupervisorDecision: async () => {},
        cancel: async () => ({
          ...delivery().mission,
          state: "cancelled",
          resultCode: "cancelled",
        }),
        transition: async (mission, to, resultCode) => {
          world.transitions.push(to);
          return { ...mission, state: to, ...(resultCode ? { resultCode } : {}) };
        },
        putResult: async (_mission, result) => { world.results.push(result); },
        putProgress: async (_mission, value) => { world.progress.push(value); },
      },
      world.journal,
      {
        run: vi.fn().mockImplementation((_mission, options) =>
          new Promise((resolve) => {
            options.signal?.addEventListener("abort", () =>
              resolve({ state: "cancelled", reason: "Mission cancelled." }),
            );
          }),
        ),
      } as unknown as MissionWorker,
      async () => deviceId,
      undefined,
      1,
    );
    await controller.pollOnce();
    expect(world.transitions).toEqual(["accepted", "running"]);
    expect((await world.journal.read()).lastSequence).toBe(1);
  });
});
