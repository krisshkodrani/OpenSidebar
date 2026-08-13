import type {
  DeliveredRemoteMissionV1,
  MissionSpecV1,
  RemoteMissionV1,
  RemoteMissionResultV1,
  RemoteMissionProgressV1,
  SupervisorDecisionV1,
} from "@shared-types/remote-missions";
import type { MissionSupervisorPort, RemoteMissionDeliveryPort } from "./ports";
import type { MissionWorker, MissionWorkerOutcome } from "./mission-worker";
import type { RemoteMissionLocalStatus } from "../../remote-mission-local-status";
import {
  LocalRemoteMissionDeliveryJournal,
  type RemoteMissionDeliveryJournalV1,
} from "./delivery-journal";

export class EvidenceOutcomeSupervisor implements MissionSupervisorPort {
  async decide(mission: MissionSpecV1, evidence: Parameters<MissionSupervisorPort["decide"]>[1]) {
    const base = {
      schemaVersion: 1 as const,
      decisionId: crypto.randomUUID(),
      missionId: mission.missionId,
      stepId: evidence.stepId,
      expectedPlanRevision: evidence.planRevision,
    };
    if (evidence.outcome === "achieved")
      return { ...base, kind: "complete", outcome: "completed" } satisfies SupervisorDecisionV1;
    return {
      ...base,
      kind: "stop",
      outcome: evidence.outcome === "not_achieved" ? "not_achieved" : "unknown",
      guidance: evidence.uncertainties[0] ?? evidence.claims[0]?.claim,
    } satisfies SupervisorDecisionV1;
  }
}

const specFor = (delivery: DeliveredRemoteMissionV1): MissionSpecV1 => ({
  schemaVersion: 1,
  missionId: delivery.mission.missionId,
  deviceId: delivery.mission.deviceId,
  objective: delivery.payload.instruction,
  successCriteria: ["Return a grounded answer using read-only browser observations."],
  constraints: ["Do not change website, browser, or account state."],
  prohibitedEffects: ["Do not click, type, submit, download, or modify data."],
  planRevision: 1,
  expiresAt: delivery.mission.expiresAt,
  targetContext: delivery.payload.targetContext ?? "isolated_tab",
  steps: [{
    schemaVersion: 1,
    missionId: delivery.mission.missionId,
    stepId: `${delivery.mission.missionId}:read`,
    planRevision: 1,
    risk: "read_only",
    objective: delivery.payload.instruction,
    successCriteria: ["Return a grounded answer using read-only browser observations."],
    constraints: ["Do not change website, browser, or account state."],
    prohibitedEffects: ["Do not click, type, submit, download, or modify data."],
  }],
});

const terminal = (outcome: MissionWorkerOutcome, aborted: boolean) => {
  if (aborted || outcome.state === "cancelled")
    return { state: "cancelled" as const, resultCode: "cancelled" as const };
  if (outcome.state === "succeeded")
    return { state: "succeeded" as const, resultCode: "completed" as const };
  if (outcome.state === "failed")
    return { state: "failed" as const, resultCode: "not_achieved" as const };
  return { state: "outcome_unknown" as const, resultCode: "unknown" as const };
};

const localDiagnostic = (outcome: MissionWorkerOutcome) => {
  if (import.meta.env.VITE_REMOTE_MISSION_DIAGNOSTICS_ENABLED !== "true")
    return undefined;
  const value = "reason" in outcome ? outcome.reason?.trim() : undefined;
  return value ? value.slice(0, 500) : undefined;
};

const encryptedResult = (
  missionId: string,
  outcome: MissionWorkerOutcome,
  forcedOutcome?: RemoteMissionResultV1["outcome"],
): RemoteMissionResultV1 => {
  const reason = "reason" in outcome ? outcome.reason?.trim().slice(0, 1_000) : undefined;
  const summary = "summary" in outcome ? outcome.summary?.trim().slice(0, 4_000) : undefined;
  return {
    schemaVersion: 1,
    missionId,
    outcome:
      forcedOutcome ?? (outcome.state === "succeeded"
        ? "completed"
        : outcome.state === "failed"
          ? "not_achieved"
          : outcome.state === "cancelled"
            ? "cancelled"
            : "unknown"),
    createdAt: new Date().toISOString(),
    ...(summary ? { summary } : {}),
    ...(reason ? { diagnostic: reason } : {}),
  };
};

export class RemoteMissionDeliveryController {
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly transport: RemoteMissionDeliveryPort,
    private readonly journal: LocalRemoteMissionDeliveryJournal,
    private readonly worker: MissionWorker,
    private readonly deviceId: () => Promise<string | null>,
    private readonly onStatus?: (status: RemoteMissionLocalStatus) => Promise<void> | void,
    private readonly cancellationPollMilliseconds = 1_000,
  ) {}

  private progress(
    missionId: string,
    state: RemoteMissionProgressV1["state"],
    values: Pick<RemoteMissionProgressV1, "summary" | "approval" | "targetSelection"> = {},
  ): RemoteMissionProgressV1 {
    return {
      schemaVersion: 1,
      missionId,
      state,
      updatedAt: new Date().toISOString(),
      ...(values.summary ? { summary: values.summary.slice(0, 1_000) } : {}),
      ...(values.approval ? { approval: values.approval } : {}),
      ...(values.targetSelection ? { targetSelection: values.targetSelection } : {}),
    };
  }

  private async report(
    delivery: DeliveredRemoteMissionV1,
    state: RemoteMissionLocalStatus["state"],
    values: Pick<RemoteMissionLocalStatus, "approval" | "targetSelection" | "diagnostic"> = {},
  ) {
    const instructionSummary = delivery.payload.instruction
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    await this.onStatus?.({
      missionId: delivery.mission.missionId,
      state,
      updatedAt: new Date().toISOString(),
      requesterLabel: "OpenSidebar account",
      ...(instructionSummary ? { instructionSummary } : {}),
      expiresAt: delivery.mission.expiresAt,
      targetContext: delivery.payload.targetContext ?? "isolated_tab",
      ...(values.approval ? { approval: values.approval } : {}),
      ...(values.targetSelection ? { targetSelection: values.targetSelection } : {}),
      ...(values.diagnostic ? { diagnostic: values.diagnostic } : {}),
    });
  }

  private cancellationSignal(missionId: string, parent?: AbortSignal) {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    parent?.addEventListener("abort", onParentAbort, { once: true });
    let checking = false;
    const timer = setInterval(() => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      void this.transport.get(missionId)
        .then((mission) => {
          if (mission?.state === "cancelled") controller.abort();
        })
        .catch(() => undefined)
        .finally(() => { checking = false; });
    }, this.cancellationPollMilliseconds);
    return {
      signal: controller.signal,
      stop: () => {
        clearInterval(timer);
        parent?.removeEventListener("abort", onParentAbort);
      },
    };
  }

  pollOnce(options?: { signal?: AbortSignal }): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runPoll(options).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async runPoll(options?: { signal?: AbortSignal }) {
    if (!this.transport.enabled || options?.signal?.aborted) return;
    const deviceId = await this.deviceId();
    if (!deviceId) return;
    let journal = await this.journal.read();
    const deliveries = await this.transport.poll(deviceId, journal.lastSequence);
    for (const delivery of deliveries.sort((a, b) => a.mission.sequence - b.mission.sequence)) {
      if (options?.signal?.aborted) break;
      journal = await this.process(deviceId, journal, delivery, options?.signal);
    }
  }

  private async process(
    deviceId: string,
    journal: RemoteMissionDeliveryJournalV1,
    delivery: DeliveredRemoteMissionV1,
    signal?: AbortSignal,
  ) {
    const { mission, payload } = delivery;
    if (
      mission.deviceId !== deviceId ||
      payload.missionId !== mission.missionId ||
      payload.executionClass !== "read_only"
    ) throw new Error("remote_mission_delivery_mismatch");
    if (mission.sequence <= journal.lastSequence) return journal;
    if (new Date(mission.expiresAt).getTime() <= Date.now()) {
      if (
        mission.state === "queued" ||
        mission.state === "accepted" ||
        mission.state === "running" ||
        mission.state === "target_selection_required" ||
        mission.state === "approval_required"
      ) {
        await this.transport.putResult(
          mission,
          encryptedResult(mission.missionId, {
            state: "cancelled",
            reason: "Mission expired before execution.",
          }),
        );
        await this.transport.transition(mission, "cancelled", "cancelled");
      }
      return this.completeJournal(journal, mission);
    }

    let current = mission;
    let outcome: MissionWorkerOutcome | undefined;
    if (current.state === "target_selection_required") {
      const status = await this.transport.get(mission.missionId);
      const targetSelection = status?.progress?.targetSelection;
      await this.report(delivery, "target_selection_required", {
        ...(targetSelection ? { targetSelection } : {}),
      });
      if (!targetSelection) return journal;
      if (new Date(targetSelection.expiresAt).getTime() <= Date.now()) {
        outcome = { state: "failed", reason: "Browser target selection expired." };
        await this.transport.putResult(current, encryptedResult(mission.missionId, outcome));
        const expired = await this.transport.transition(current, "failed", "not_achieved");
        await this.report(delivery, expired.state);
        return this.completeJournal(journal, mission);
      }
      const decision = await this.transport.getTargetDecision(mission.missionId);
      if (!decision) return journal;
      if (
        !targetSelection.candidates.some((candidate) => candidate.targetHandle === decision.targetHandle) ||
        new Date(decision.decidedAt).getTime() < new Date(status!.progress!.updatedAt).getTime() ||
        new Date(decision.decidedAt).getTime() > new Date(targetSelection.expiresAt).getTime()
      ) throw new Error("remote_mission_target_decision_mismatch");
      current = await this.transport.transition(current, "running");
      const cancellation = this.cancellationSignal(mission.missionId, signal);
      try {
        outcome = await this.worker.resumeTargetSelection(
          specFor(delivery),
          payload,
          decision,
          { signal: cancellation.signal },
        );
      } catch (error) {
        outcome = {
          state: "failed",
          reason: error instanceof Error ? error.message : "Target continuation failed.",
        };
      } finally {
        cancellation.stop();
      }
    }
    if (current.state === "approval_required") {
      const status = await this.transport.get(mission.missionId);
      const approval = status?.progress?.approval;
      await this.report(delivery, "approval_required", {
        ...(approval ? { approval } : {}),
      });
      if (!approval?.actionDigest) return journal;
      if (new Date(approval.expiresAt).getTime() <= Date.now()) {
        outcome = { state: "failed", reason: "Approval expired before continuation." };
        await this.transport.putResult(
          current,
          encryptedResult(mission.missionId, outcome, "not_achieved"),
        );
        const expired = await this.transport.transition(
          current,
          "failed",
          "not_achieved",
        );
        await this.report(delivery, expired.state);
        return this.completeJournal(journal, mission);
      }
      const decision = await this.transport.getApprovalDecision(mission.missionId);
      if (!decision) return journal;
      if (
        decision.approvalId !== approval.approvalId ||
        decision.actionDigest !== approval.actionDigest ||
        new Date(decision.decidedAt).getTime() >
          new Date(approval.expiresAt).getTime()
      ) throw new Error("remote_mission_approval_decision_mismatch");
      current = await this.transport.transition(current, "running");
      const cancellation = this.cancellationSignal(mission.missionId, signal);
      try {
        outcome = await this.worker.resumeApproval(specFor(delivery), decision, {
          signal: cancellation.signal,
        });
      } catch (error) {
        outcome = {
          state: "failed",
          reason: error instanceof Error ? error.message : "Approval continuation failed.",
        };
      } finally {
        cancellation.stop();
      }
    }
    if (!outcome && (current.state === "queued" || current.state === "accepted")) {
      await this.writeActive(journal, mission, "accepted");
      await this.transport.putProgress(
        mission,
        this.progress(mission.missionId, "accepted"),
      );
      await this.report(delivery, "accepted");
    }
    if (!outcome && current.state === "queued")
      current = await this.transport.transition(current, "accepted");
    if (!outcome && current.state === "accepted") {
      current = await this.transport.transition(current, "running");
    }
    if (current.state !== "running") return journal;
    if (!outcome) {
      await this.writeActive(journal, mission, "running");
      await this.transport.putProgress(
        current,
        this.progress(mission.missionId, "running"),
      );
      await this.report(delivery, "running");
    }

    if (!outcome) {
      const cancellation = this.cancellationSignal(mission.missionId, signal);
      try {
        outcome = await this.worker.run(specFor(delivery), {
          signal: cancellation.signal,
          initialUrl: payload.initialUrl,
        });
      } catch (error) {
        outcome = { state: "failed", reason: error instanceof Error ? error.message : "Remote mission failed." };
      } finally {
        cancellation.stop();
      }
    }
    const latest = await this.transport.get(mission.missionId);
    if (latest?.state === "cancelled") {
      await this.report(delivery, "cancelled");
      return this.completeJournal(journal, mission);
    }
    if (outcome.state === "approval_required") {
      const approval = outcome.evidence.approval;
      if (!approval) throw new Error("remote_mission_approval_missing");
      await this.transport.putProgress(
        current,
        this.progress(mission.missionId, "approval_required", { approval }),
      );
      const waiting = await this.transport.transition(current, "approval_required");
      await this.report(delivery, waiting.state, { approval });
      return journal;
    }
    if (outcome.state === "target_selection_required") {
      await this.transport.putProgress(
        current,
        this.progress(mission.missionId, "target_selection_required", {
          targetSelection: outcome.targetSelection,
        }),
      );
      const waiting = await this.transport.transition(current, "target_selection_required");
      await this.report(delivery, waiting.state, {
        targetSelection: outcome.targetSelection,
      });
      return journal;
    }
    const result = terminal(outcome, signal?.aborted === true);
    await this.transport.putResult(
      current,
      encryptedResult(mission.missionId, outcome, result.resultCode),
    );
    const finished = await this.transport.transition(current, result.state, result.resultCode);
    const diagnostic = localDiagnostic(outcome);
    await this.report(delivery, finished.state, {
      ...(diagnostic ? { diagnostic } : {}),
    });
    return this.completeJournal(journal, mission);
  }

  private async writeActive(
    journal: RemoteMissionDeliveryJournalV1,
    mission: RemoteMissionV1,
    state: "accepted" | "running",
  ) {
    await this.journal.write({
      ...journal,
      active: { missionId: mission.missionId, sequence: mission.sequence, state, updatedAt: new Date().toISOString() },
    });
  }

  private async completeJournal(journal: RemoteMissionDeliveryJournalV1, mission: RemoteMissionV1) {
    const completed: RemoteMissionDeliveryJournalV1 = {
      schemaVersion: 1,
      lastSequence: Math.max(journal.lastSequence, mission.sequence),
    };
    await this.journal.write(completed);
    return completed;
  }
}
