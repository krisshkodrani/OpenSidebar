import type {
  MissionAttemptV1,
  MissionEvidenceV1,
  MissionSpecV1,
  MissionStepV1,
  RemoteMissionApprovalDecisionV1,
  RemoteMissionPayloadV1,
  RemoteMissionRunResultV1,
  RemoteMissionTargetDecisionV1,
  RemoteMissionTargetSelectionV1,
  RemoteMissionSupervisorDecisionV1,
  SupervisorDecisionV1,
} from "@shared-types/remote-missions";
import type { RemoteMissionRunner } from "../remote-mission-runner";
import type {
  MissionAttemptJournalPort,
  MissionSupervisorPort,
  RemoteMissionTransportPort,
} from "./ports";

export type MissionWorkerOutcome =
  | { state: "succeeded"; summary?: string }
  | { state: "failed" | "cancelled" | "outcome_unknown"; reason?: string }
  | { state: "target_selection_required"; targetSelection: RemoteMissionTargetSelectionV1 }
  | { state: "approval_required"; evidence: MissionEvidenceV1 }
  | {
      state: "supervision_required";
      evidence: MissionEvidenceV1;
      pendingStep: MissionStepV1;
      remainingSteps?: MissionStepV1[];
    };

const bounded = (values: string[] | undefined, limit = 20) =>
  (values ?? []).slice(0, limit).map((value) => value.trim()).filter(Boolean);

const instructionFor = (step: MissionStepV1, guidance?: string) =>
  [
    step.objective,
    step.successCriteria.length
      ? `Success criteria:\n${bounded(step.successCriteria).map((v) => `- ${v}`).join("\n")}`
      : "",
    step.constraints?.length
      ? `Constraints:\n${bounded(step.constraints).map((v) => `- ${v}`).join("\n")}`
      : "",
    step.prohibitedEffects?.length
      ? `Do not:\n${bounded(step.prohibitedEffects).map((v) => `- ${v}`).join("\n")}`
      : "",
    guidance ? `Supervisor guidance: ${guidance}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const evidenceFor = (
  mission: MissionSpecV1,
  step: MissionStepV1,
  attemptId: string,
  result: RemoteMissionRunResultV1,
): MissionEvidenceV1 => ({
  schemaVersion: 1,
  missionId: mission.missionId,
  stepId: step.stepId,
  attemptId,
  planRevision: step.planRevision,
  outcome:
    result.state === "succeeded"
      ? "achieved"
      : result.state === "failed"
        ? "not_achieved"
        : result.state === "approval_required"
          ? "approval_required"
          : "unknown",
  claims: "summary" in result && result.summary
    ? [{ claim: result.summary.slice(0, 4_000), source: "agent_summary" }]
    : [],
  effects: [],
  uncertainties:
    result.state === "outcome_unknown"
      ? [("summary" in result ? result.summary?.slice(0, 1_000) : undefined) ?? "The browser outcome could not be verified."]
      : [],
  ...(result.state === "approval_required" ? { approval: result.approval } : {}),
  ...(result.state !== "target_selection_required" && result.target
    ? { target: result.target }
    : {}),
});

const validateDecision = (
  mission: MissionSpecV1,
  step: MissionStepV1,
  decision: SupervisorDecisionV1,
) => {
  if (
    decision.schemaVersion !== 1 ||
    decision.missionId !== mission.missionId ||
    decision.stepId !== step.stepId ||
    decision.expectedPlanRevision !== step.planRevision
  )
    throw new Error("remote_mission_stale_supervisor_decision");
};

export class MissionWorker {
  constructor(
    private readonly runner: RemoteMissionRunner,
    private readonly supervisor: MissionSupervisorPort,
    private readonly journal: MissionAttemptJournalPort,
    private readonly transport?: RemoteMissionTransportPort,
  ) {}

  async resumeSupervision(
    mission: MissionSpecV1,
    evidence: MissionEvidenceV1,
    decision: RemoteMissionSupervisorDecisionV1,
    options?: { signal?: AbortSignal; initialUrl?: string; remainingSteps?: MissionStepV1[] },
  ): Promise<MissionWorkerOutcome> {
    const baseStep = mission.steps.find((candidate) => candidate.stepId === evidence.stepId);
    const attempt = await this.journal.read(mission.missionId);
    if (!baseStep || !attempt || attempt.state !== "supervision_required")
      return { state: "failed", reason: "The pending supervised attempt is no longer available." };
    if (
      decision.schemaVersion !== 1 ||
      decision.missionId !== mission.missionId ||
      decision.stepId !== evidence.stepId ||
      decision.expectedPlanRevision !== evidence.planRevision
    ) throw new Error("remote_mission_stale_supervisor_decision");
    const step = { ...baseStep, planRevision: evidence.planRevision };
    if (decision.kind === "complete") {
      if (evidence.outcome !== "achieved")
        return { state: "outcome_unknown", reason: "Codex cannot mark unachieved browser evidence complete." };
      await this.journal.remove(mission.missionId);
      return { state: "succeeded", summary: evidence.claims[0]?.claim };
    }
    if (decision.kind === "stop") {
      await this.journal.remove(mission.missionId);
      return {
        state: decision.outcome === "cancelled"
          ? "cancelled"
          : decision.outcome === "unknown"
            ? "outcome_unknown"
            : "failed",
        reason: decision.guidance,
      };
    }
    if (decision.kind === "request_user_input")
      return {
        state: "supervision_required",
        evidence,
        pendingStep: step,
        ...(options?.remainingSteps?.length ? { remainingSteps: options.remainingSteps } : {}),
      };
    if (decision.kind === "request_approval")
      return { state: "failed", reason: "An approval must originate from grounded browser evidence." };
    const revision = step.planRevision + 1;
    const steps = decision.kind === "replace_remaining_plan"
      ? (decision.replacementSteps ?? [])
      : decision.kind === "continue" && options?.remainingSteps?.length
        ? options.remainingSteps
        : [{
            ...step,
            planRevision: revision,
            objective: decision.guidance
              ? `${step.objective}\n\nSupervisor guidance: ${decision.guidance}`
              : step.objective,
          }, ...(options?.remainingSteps ?? [])];
    if (!steps.length) return { state: "failed", reason: "The replacement plan was empty." };
    return this.run({
      ...mission,
      planRevision: Math.max(...steps.map((candidate) => candidate.planRevision)),
      steps,
    }, { signal: options?.signal, initialUrl: options?.initialUrl });
  }

  async resumeTargetSelection(
    mission: MissionSpecV1,
    payload: RemoteMissionPayloadV1,
    decision: RemoteMissionTargetDecisionV1,
    options?: { signal?: AbortSignal },
  ): Promise<MissionWorkerOutcome> {
    if (options?.signal?.aborted)
      return { state: "cancelled", reason: "Mission cancelled." };
    if (new Date(mission.expiresAt).getTime() <= Date.now())
      return { state: "failed", reason: "Mission expired before target selection." };
    const attempt = await this.journal.read(mission.missionId);
    const step = mission.steps.find((candidate) => candidate.stepId === attempt?.stepId);
    if (!attempt || attempt.state !== "target_selection_required" || !step)
      return { state: "failed", reason: "The pending browser target is no longer available." };
    if (!this.runner.selectTarget)
      return { state: "failed", reason: "This browser runtime cannot resume target selection." };
    const result = await this.runner.selectTarget(payload, decision, options);
    if (result.state === "target_selection_required") {
      await this.journal.write({ ...attempt, state: "target_selection_required", updatedAt: new Date().toISOString() });
      return result;
    }
    const evidence = evidenceFor(mission, step, attempt.attemptId, result);
    await this.transport?.publishEvidence(evidence);
    await this.journal.write({
      ...attempt,
      state: result.state === "approval_required" ? "approval_required" : "terminal",
      updatedAt: new Date().toISOString(),
    });
    if (result.state === "approval_required") return { state: "approval_required", evidence };
    if (result.state === "failed") return { state: "failed", reason: result.summary };
    if (result.state === "outcome_unknown") return { state: "outcome_unknown", reason: result.summary };
    const supervisor = await this.supervisor.decide(mission, evidence, options);
    validateDecision(mission, step, supervisor);
    if (supervisor.kind !== "complete" || evidence.outcome !== "achieved")
      return { state: "outcome_unknown", reason: supervisor.guidance ?? "Target continuation lacked verified completion." };
    await this.journal.remove(mission.missionId);
    return { state: "succeeded", summary: evidence.claims[0]?.claim };
  }

  async resumeApproval(
    mission: MissionSpecV1,
    decision: RemoteMissionApprovalDecisionV1,
    options?: { signal?: AbortSignal },
  ): Promise<MissionWorkerOutcome> {
    if (options?.signal?.aborted)
      return { state: "cancelled", reason: "Mission cancelled." };
    if (new Date(mission.expiresAt).getTime() <= Date.now())
      return { state: "failed", reason: "Mission expired before approval continuation." };
    const attempt = await this.journal.read(mission.missionId);
    const step = mission.steps.find((candidate) => candidate.stepId === attempt?.stepId);
    if (!attempt || attempt.state !== "approval_required" || !step)
      return {
        state: "failed",
        reason: "The pending local approval session is no longer available.",
      };
    if (!this.runner.respondApproval)
      return { state: "failed", reason: "This browser runtime cannot resume approvals." };
    const result = await this.runner.respondApproval(
      mission.missionId,
      decision.approvalId,
      decision.approved,
      { signal: options?.signal },
    );
    const evidence = evidenceFor(mission, step, attempt.attemptId, result);
    await this.transport?.publishEvidence(evidence);
    await this.journal.write({
      ...attempt,
      state: result.state === "approval_required" ? "approval_required" : "terminal",
      updatedAt: new Date().toISOString(),
    });
    if (!decision.approved) {
      await this.journal.remove(mission.missionId);
      return { state: "failed", reason: "Approval was denied." };
    }
    if (result.state === "approval_required")
      return { state: "approval_required", evidence };
    if (result.state === "failed")
      return { state: "failed", reason: result.summary };
    if (result.state === "outcome_unknown")
      return { state: "outcome_unknown", reason: result.summary };
    const supervisor = await this.supervisor.decide(mission, evidence, options);
    validateDecision(mission, step, supervisor);
    if (supervisor.kind !== "complete" || evidence.outcome !== "achieved")
      return {
        state: "outcome_unknown",
        reason: supervisor.guidance ?? "Approval continuation lacked verified completion.",
      };
    await this.journal.remove(mission.missionId);
    return { state: "succeeded", summary: evidence.claims[0]?.claim };
  }

  async run(
    mission: MissionSpecV1,
    options?: {
      signal?: AbortSignal;
      sequence?: number;
      initialUrl?: string;
      onEvidence?: (evidence: MissionEvidenceV1) => Promise<void> | void;
      onProgress?: (summary: string) => Promise<void> | void;
    },
  ): Promise<MissionWorkerOutcome> {
    if (new Date(mission.expiresAt).getTime() <= Date.now())
      return { state: "cancelled", reason: "Mission expired before execution." };
    let steps = [...mission.steps];
    let index = 0;
    let guidance: string | undefined;

    while (index < steps.length) {
      if (options?.signal?.aborted)
        return { state: "cancelled", reason: "Mission cancelled." };
      const step = steps[index]!;
      const previous = await this.journal.read(mission.missionId);
      if (previous?.state === "running" && previous.mayHaveConsequentialEffect)
        return {
          state: "outcome_unknown",
          reason: "A previous consequential attempt was interrupted and will not be retried automatically.",
        };
      const attemptId = crypto.randomUUID();
      const accepted: MissionAttemptV1 = {
        schemaVersion: 1,
        missionId: mission.missionId,
        stepId: step.stepId,
        attemptId,
        planRevision: step.planRevision,
        state: "accepted",
        mayHaveConsequentialEffect: step.risk === "consequential",
        updatedAt: new Date().toISOString(),
      };
      await this.journal.write(accepted);
      await this.journal.write({ ...accepted, state: "running", updatedAt: new Date().toISOString() });

      const payload: RemoteMissionPayloadV1 = {
        schemaVersion: 1,
        missionId: mission.missionId,
        executionClass: "read_only",
        instruction: instructionFor(step, guidance),
        ...(options?.initialUrl ? { initialUrl: options.initialUrl } : {}),
        targetContext: mission.targetContext,
      };
      const result = await this.runner.run(payload, {
        signal: options?.signal,
        onProgress: options?.onProgress,
        onTargetBound: options?.onEvidence
          ? async (target) => {
              await options.onEvidence!(evidenceFor(
                mission,
                step,
                attemptId,
                {
                  state: "outcome_unknown",
                  summary: "Browser execution is still in progress.",
                  target,
                },
              ));
            }
          : undefined,
      });
      if (result.state === "target_selection_required") {
        await this.journal.write({
          ...accepted,
          state: "target_selection_required",
          updatedAt: new Date().toISOString(),
        });
        return result;
      }
      const evidence = evidenceFor(mission, step, attemptId, result);
      await this.transport?.publishEvidence(evidence);
      await this.journal.write({
        ...accepted,
        state: result.state === "approval_required" ? "approval_required" : "terminal",
        updatedAt: new Date().toISOString(),
      });

      const decision = await this.supervisor.decide(mission, evidence, options);
      validateDecision(mission, step, decision);
      if (decision.kind === "complete") {
        if (evidence.outcome !== "achieved")
          return { state: "outcome_unknown", reason: "Supervisor completion lacked achieved browser evidence." };
        await this.journal.remove(mission.missionId);
        if (options?.sequence !== undefined) await this.transport?.acknowledge(options.sequence);
        return { state: "succeeded", summary: evidence.claims[0]?.claim };
      }
      if (decision.kind === "stop") {
        await this.journal.remove(mission.missionId);
        return {
          state: decision.outcome === "cancelled" ? "cancelled" : decision.outcome === "unknown" ? "outcome_unknown" : "failed",
          reason: decision.guidance,
        };
      }
      if (decision.kind === "request_user_input") {
        await this.journal.write({
          ...accepted,
          state: "supervision_required",
          updatedAt: new Date().toISOString(),
        });
        return {
          state: "supervision_required",
          evidence,
          pendingStep: step,
          ...(steps.length > index + 1 ? { remainingSteps: steps.slice(index + 1) } : {}),
        };
      }
      if (decision.kind === "request_approval" || evidence.outcome === "approval_required")
        return { state: "approval_required", evidence };
      if (decision.kind === "replace_remaining_plan") {
        const replacement = decision.replacementSteps ?? [];
        if (!replacement.length) throw new Error("remote_mission_replacement_plan_empty");
        steps = [...steps.slice(0, index + 1), ...replacement];
        index += 1;
        guidance = decision.guidance;
        continue;
      }
      if (decision.kind === "retry" || decision.kind === "request_evidence") {
        guidance =
          decision.guidance ??
          (decision.kind === "request_evidence"
            ? "Inspect the current page without making changes and return stronger evidence."
            : undefined);
        continue;
      }
      guidance = decision.guidance;
      index += 1;
    }
    return { state: "failed", reason: "The supervised plan ended without a completion decision." };
  }
}
