import { describe, expect, it, vi } from "vitest";
import type { PortableCheckpointV1 } from "@shared-types/cloud-sessions";
import { PortableCheckpointCoordinator } from "../../src/background/orchestrator/portable-restore";
import type { PortableCheckpointLocalPort } from "../../src/background/environment/portable-checkpoint-local-port";
import type { CloudCheckpointPort } from "../../src/background/environment/cloud-checkpoint-port";

const checkpoint = (pending: PortableCheckpointV1["pending"] = { kind: "none" }): PortableCheckpointV1 => ({
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
    successCriteria: ["Report ready"],
    userConstraints: [],
  },
  conversation: { messages: [] },
  execution: {
    plan: [
      { stepId: "read", description: "Read totals", status: "completed", evidenceRefs: [] },
      { stepId: "write", description: "Write report", status: "pending", evidenceRefs: [] },
    ],
    completedActions: [],
    unresolvedFacts: [],
  },
  grounding: {
    lastKnownUrl: "https://example.com/report",
    expectedOrigins: ["https://example.com"],
    pageTitle: "Report",
    userVisibleStateSummary: "Monthly report",
    requiredCapabilities: ["navigation"],
  },
  pending,
  usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0, imageTokenEstimate: 0, turns: 1 },
});

const ports = (value: PortableCheckpointV1 | null, cloudEnabled = false) => {
  let localValue = value;
  const local: PortableCheckpointLocalPort = {
    save: vi.fn(async (saved) => { localValue = saved; }),
    load: vi.fn(async () => localValue),
    delete: vi.fn(async () => { localValue = null; }),
  };
  const cloud: CloudCheckpointPort = {
    enabled: cloudEnabled,
    upload: vi.fn(async () => ({ checkpoint: {} as never, sessionRevision: 2 })),
    restore: vi.fn(async () => value),
  };
  return { local, cloud };
};

describe("portable restore coordinator", () => {
  it("saves locally before cloud upload and preserves the local copy on outage", async () => {
    const value = checkpoint();
    const { local, cloud } = ports(null, true);
    vi.mocked(cloud.upload).mockRejectedValue(new Error("offline"));
    const result = await new PortableCheckpointCoordinator(local, cloud, "0.7.3")
      .saveLocalThenUpload(1, value);
    expect(result.state).toBe("sync_failed");
    expect(local.save).toHaveBeenCalledBefore(vi.mocked(cloud.upload));
    expect(await local.load(value.sessionId, value.checkpointId)).toEqual(value);
  });

  it("re-grounds changed pages and remains paused until explicit Continue", async () => {
    const value = checkpoint();
    const { local, cloud } = ports(value);
    const prepared = await new PortableCheckpointCoordinator(local, cloud, "0.7.3").prepareRestore({
      sessionId: value.sessionId,
      checkpointId: value.checkpointId,
      observation: { available: true, authorized: true, url: "https://example.com/report", title: "Changed report" },
    });
    expect(prepared.state).toBe("restored_paused");
    expect(prepared.preview).toMatchObject({
      grounding: "changed",
      changedStateWarning: true,
      historicalElementReferencesInvalidated: true,
      completed: ["Read totals"],
      remaining: ["Write report"],
    });
    expect(prepared.continueAfterUserConfirmation()).toMatchObject({
      localWorkspaceId: expect.any(String),
      runId: expect.any(String),
    });
    expect(prepared.state).toBe("running");
    expect(() => prepared.continueAfterUserConfirmation()).toThrow("restore_already_continued");
  });

  it("requires fresh approval and clarification for uncertain browser outcomes", async () => {
    const approval = checkpoint({
      kind: "approval_required",
      actionSummary: "Submit report",
      risk: "high",
      requestedAt: "2026-08-09T12:00:00.000Z",
      expiresAt: "2026-08-09T12:05:00.000Z",
    });
    const approvalPorts = ports(approval);
    const prepared = await new PortableCheckpointCoordinator(approvalPorts.local, approvalPorts.cloud, "0.7.3")
      .prepareRestore({
        sessionId: approval.sessionId,
        checkpointId: approval.checkpointId,
        observation: { available: true, authorized: true, url: "https://example.com/report", title: "Report" },
      });
    expect(prepared.preview.requiresFreshApproval).toBe(true);

    const unknown = checkpoint({
      kind: "browser_result_unknown",
      actionSummary: "Submit report",
      startedAt: "2026-08-09T12:00:00.000Z",
    });
    const unknownPorts = ports(unknown);
    const uncertain = await new PortableCheckpointCoordinator(unknownPorts.local, unknownPorts.cloud, "0.7.3")
      .prepareRestore({
        sessionId: unknown.sessionId,
        checkpointId: unknown.checkpointId,
        observation: { available: false, authorized: false },
      });
    expect(uncertain.preview).toMatchObject({
      grounding: "unauthorized",
      requiresOutcomeClarification: true,
      state: "restored_paused",
    });
    expect(() => uncertain.continueAfterUserConfirmation()).toThrow(
      "restore_outcome_clarification_required",
    );
    expect(
      uncertain.continueAfterUserConfirmation("The page showed a success banner."),
    ).toMatchObject({
      outcomeResolution: "The page showed a success banner.",
    });
  });

  it("migrates the previous schema and rejects incompatible restores", async () => {
    const previous = {
      ...checkpoint(),
      schemaVersion: 0,
    } as unknown as PortableCheckpointV1;
    const previousPorts = ports(previous);
    const migrated = await new PortableCheckpointCoordinator(
      previousPorts.local,
      previousPorts.cloud,
      "0.7.3",
    ).prepareRestore({
      sessionId: previous.sessionId,
      checkpointId: previous.checkpointId,
      observation: { available: true, authorized: true },
    });
    expect(migrated.preview).toMatchObject({
      compatibility: "migratable_previous",
      checkpoint: { schemaVersion: 1 },
    });

    for (const [value, error] of [
      [{ ...checkpoint(), schemaVersion: 2 }, "portable_checkpoint_read_only_newer"],
      [{ ...checkpoint(), runtimeVersion: "1.0.0" }, "portable_checkpoint_runtime_incompatible"],
    ] as const) {
      const candidate = value as unknown as PortableCheckpointV1;
      const candidatePorts = ports(candidate);
      await expect(
        new PortableCheckpointCoordinator(
          candidatePorts.local,
          candidatePorts.cloud,
          "0.7.3",
        ).prepareRestore({
          sessionId: candidate.sessionId,
          checkpointId: candidate.checkpointId,
          observation: { available: true, authorized: true },
        }),
      ).rejects.toThrow(error);
    }
  });
});
