import { describe, expect, test, vi } from "vitest";
import type {
  MissionSpecV1,
  SupervisorDecisionV1,
} from "@shared-types/remote-missions";
import type { RemoteMissionRunner } from "../../src/background/remote-mission-runner";
import {
  MemoryMissionAttemptJournal,
  MemoryRemoteMissionTransport,
  ScriptedMissionSupervisor,
} from "../../src/background/remote-missions/in-memory-ports";
import { MissionWorker } from "../../src/background/remote-missions/mission-worker";
import { LocalMissionAttemptJournal } from "../../src/background/remote-missions/local-attempt-journal";
import { createFakePersistencePort } from "../fakes/persistence";

const mission = (): MissionSpecV1 => ({
  schemaVersion: 1,
  missionId: "mission-1",
  deviceId: "device-1",
  objective: "Read the visible heading",
  successCriteria: ["The heading is reported"],
  planRevision: 1,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  steps: [
    {
      schemaVersion: 1,
      missionId: "mission-1",
      stepId: "step-1",
      planRevision: 1,
      risk: "read_only",
      objective: "Read the visible heading",
      successCriteria: ["The heading is reported"],
    },
  ],
});

const decision = (
  kind: SupervisorDecisionV1["kind"],
  extra: Partial<SupervisorDecisionV1> = {},
): SupervisorDecisionV1 => ({
  schemaVersion: 1,
  decisionId: crypto.randomUUID(),
  missionId: "mission-1",
  stepId: "step-1",
  expectedPlanRevision: 1,
  kind,
  ...extra,
});

describe("MissionWorker", () => {
  test("persists a bounded attempt journal across worker instances", async () => {
    const { port, sync, session } = createFakePersistencePort();
    const first = new LocalMissionAttemptJournal(port);
    const attempt = {
      schemaVersion: 1 as const,
      missionId: "mission-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      planRevision: 1,
      state: "running" as const,
      mayHaveConsequentialEffect: false,
      updatedAt: new Date().toISOString(),
    };
    await first.write(attempt);
    expect(await new LocalMissionAttemptJournal(port).read("mission-1")).toEqual(attempt);
    expect(sync.store.size).toBe(0);
    expect(session.store.size).toBe(0);
  });

  test("journals, publishes evidence, and acknowledges only after supervisor completion", async () => {
    const run = vi.fn().mockResolvedValue({ state: "succeeded", summary: "Heading: Example Domain" });
    const journal = new MemoryMissionAttemptJournal();
    const transport = new MemoryRemoteMissionTransport();
    const worker = new MissionWorker(
      { run } as RemoteMissionRunner,
      new ScriptedMissionSupervisor([decision("complete")]),
      journal,
      transport,
    );

    await expect(worker.run(mission(), { sequence: 7 })).resolves.toEqual({
      state: "succeeded",
      summary: "Heading: Example Domain",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(transport.evidence[0]?.claims[0]?.claim).toBe("Heading: Example Domain");
    expect(transport.acknowledgements).toEqual([7]);
    expect(await journal.read("mission-1")).toBeNull();
  });

  test("retries the semantic step with supervisor guidance", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ state: "failed", summary: "Heading not visible" })
      .mockResolvedValueOnce({ state: "succeeded", summary: "Heading: Example Domain" });
    const worker = new MissionWorker(
      { run } as RemoteMissionRunner,
      new ScriptedMissionSupervisor([
        decision("retry", { guidance: "Inspect the main content region." }),
        decision("complete"),
      ]),
      new MemoryMissionAttemptJournal(),
    );

    await expect(worker.run(mission())).resolves.toMatchObject({ state: "succeeded" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].instruction).toContain("Inspect the main content region.");
  });

  test("does not repeat an interrupted attempt that may have had a consequential effect", async () => {
    const journal = new MemoryMissionAttemptJournal();
    await journal.write({
      schemaVersion: 1,
      missionId: "mission-1",
      stepId: "step-1",
      attemptId: "attempt-old",
      planRevision: 1,
      state: "running",
      mayHaveConsequentialEffect: true,
      updatedAt: new Date().toISOString(),
    });
    const run = vi.fn();
    const worker = new MissionWorker(
      { run } as RemoteMissionRunner,
      new ScriptedMissionSupervisor([]),
      journal,
    );

    await expect(worker.run(mission())).resolves.toMatchObject({ state: "outcome_unknown" });
    expect(run).not.toHaveBeenCalled();
  });

  test("rejects stale supervisor decisions", async () => {
    const worker = new MissionWorker(
      { run: vi.fn().mockResolvedValue({ state: "succeeded" }) } as RemoteMissionRunner,
      new ScriptedMissionSupervisor([
        decision("complete", { expectedPlanRevision: 0 }),
      ]),
      new MemoryMissionAttemptJournal(),
    );
    await expect(worker.run(mission())).rejects.toThrow(
      "remote_mission_stale_supervisor_decision",
    );
  });

  test("resumes a journaled approval in the same runner session", async () => {
    const journal = new MemoryMissionAttemptJournal();
    await journal.write({
      schemaVersion: 1,
      missionId: "mission-1",
      stepId: "step-1",
      attemptId: "attempt-approval",
      planRevision: 1,
      state: "approval_required",
      mayHaveConsequentialEffect: true,
      updatedAt: new Date().toISOString(),
    });
    const respondApproval = vi.fn().mockResolvedValue({
      state: "succeeded",
      summary: "Submission verified.",
    });
    const worker = new MissionWorker(
      { run: vi.fn(), respondApproval } as RemoteMissionRunner,
      new ScriptedMissionSupervisor([decision("complete")]),
      journal,
    );
    await expect(worker.resumeApproval(mission(), {
      schemaVersion: 1,
      missionId: "mission-1",
      approvalId: "approval-1",
      actionDigest: "digest-1",
      approved: true,
      decidedAt: new Date().toISOString(),
    })).resolves.toEqual({
      state: "succeeded",
      summary: "Submission verified.",
    });
    expect(respondApproval).toHaveBeenCalledWith(
      "mission-1",
      "approval-1",
      true,
      { signal: undefined },
    );
    expect(await journal.read("mission-1")).toBeNull();
  });

  test("fails safely when a restarted worker lost the pending approval", async () => {
    const respondApproval = vi.fn();
    const worker = new MissionWorker(
      { run: vi.fn(), respondApproval } as RemoteMissionRunner,
      new ScriptedMissionSupervisor([]),
      new MemoryMissionAttemptJournal(),
    );
    await expect(worker.resumeApproval(mission(), {
      schemaVersion: 1,
      missionId: "mission-1",
      approvalId: "approval-1",
      actionDigest: "digest-1",
      approved: true,
      decidedAt: new Date().toISOString(),
    })).resolves.toMatchObject({
      state: "failed",
      reason: expect.stringContaining("no longer available"),
    });
    expect(respondApproval).not.toHaveBeenCalled();
  });

  test("denial resumes only to stop the pending action and never claims completion", async () => {
    const journal = new MemoryMissionAttemptJournal();
    await journal.write({
      schemaVersion: 1,
      missionId: "mission-1",
      stepId: "step-1",
      attemptId: "attempt-denied",
      planRevision: 1,
      state: "approval_required",
      mayHaveConsequentialEffect: true,
      updatedAt: new Date().toISOString(),
    });
    const respondApproval = vi.fn().mockResolvedValue({ state: "failed" });
    const supervisor = new ScriptedMissionSupervisor([]);
    const worker = new MissionWorker(
      { run: vi.fn(), respondApproval } as RemoteMissionRunner,
      supervisor,
      journal,
    );
    await expect(worker.resumeApproval(mission(), {
      schemaVersion: 1,
      missionId: "mission-1",
      approvalId: "approval-1",
      actionDigest: "digest-1",
      approved: false,
      decidedAt: new Date().toISOString(),
    })).resolves.toEqual({ state: "failed", reason: "Approval was denied." });
    expect(respondApproval).toHaveBeenCalledWith(
      "mission-1",
      "approval-1",
      false,
      { signal: undefined },
    );
    expect(await journal.read("mission-1")).toBeNull();
  });
});
