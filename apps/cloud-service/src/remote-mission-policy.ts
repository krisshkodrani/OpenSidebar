import type {
  CreateRemoteMissionV1,
  RemoteMissionApprovalDecisionV1,
  RemoteMissionResultV1,
  RemoteMissionProgressV1,
  RemoteMissionState,
  RemoteMissionTargetDecisionV1,
  RemoteMissionTargetSelectionV1,
  RemoteMissionSupervisorDecisionV1,
  MissionEvidenceV1,
  MissionStepV1,
  RemoteMissionTransitionV1,
} from "@shared-types";

export class RemoteMissionPolicyError extends Error {
  constructor(readonly code: "invalid_request" | "invalid_transition") {
    super(code);
  }
}

const deviceId = (value: unknown): value is string =>
  typeof value === "string" && /^dev_[A-Za-z0-9_-]{1,96}$/.test(value);

const initialUrl = (value: unknown) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 2_048)
    throw new RemoteMissionPolicyError("invalid_request");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RemoteMissionPolicyError("invalid_request");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new RemoteMissionPolicyError("invalid_request");
  return parsed.toString();
};

export function parseCreateRemoteMission(
  value: unknown,
): CreateRemoteMissionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteMissionPolicyError("invalid_request");
  const input = value as Record<string, unknown>;
  const instruction =
    typeof input.instruction === "string" ? input.instruction.trim() : "";
  const expiresInSeconds = input.expiresInSeconds ?? 15 * 60;
  const targetContext = input.targetContext ?? "isolated_tab";
  if (
    input.schemaVersion !== 1 ||
    !deviceId(input.deviceId) ||
    instruction.length < 1 ||
    instruction.length > 16_000 ||
    !Number.isSafeInteger(expiresInSeconds) ||
    Number(expiresInSeconds) < 30 ||
    Number(expiresInSeconds) > 60 * 60 ||
    (targetContext !== "active_tab" &&
      targetContext !== "existing_tab" &&
      targetContext !== "isolated_tab") ||
    (targetContext === "existing_tab" && input.initialUrl === undefined)
  )
    throw new RemoteMissionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    deviceId: input.deviceId,
    instruction,
    ...(input.initialUrl === undefined
      ? {}
      : { initialUrl: initialUrl(input.initialUrl) }),
    targetContext,
    expiresInSeconds: Number(expiresInSeconds),
  };
}

const boundedOptional = (value: unknown, max: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max)
    throw new RemoteMissionPolicyError("invalid_request");
  const normalized = value.trim();
  return normalized || undefined;
};

export function parseRemoteMissionResult(
  value: unknown,
  missionId: string,
): RemoteMissionResultV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteMissionPolicyError("invalid_request");
  const input = value as Record<string, unknown>;
  const outcomes = new Set(["completed", "not_achieved", "cancelled", "unknown"]);
  const createdAt = typeof input.createdAt === "string" ? new Date(input.createdAt) : null;
  if (
    input.schemaVersion !== 1 ||
    input.missionId !== missionId ||
    !outcomes.has(input.outcome as string) ||
    !createdAt ||
    !Number.isFinite(createdAt.getTime())
  )
    throw new RemoteMissionPolicyError("invalid_request");
  const summary = boundedOptional(input.summary, 4_000);
  const diagnostic = boundedOptional(input.diagnostic, 1_000);
  return {
    schemaVersion: 1,
    missionId,
    outcome: input.outcome as RemoteMissionResultV1["outcome"],
    createdAt: createdAt.toISOString(),
    ...(summary ? { summary } : {}),
    ...(diagnostic ? { diagnostic } : {}),
  };
}

export function parseRemoteMissionProgress(
  value: unknown,
  missionId: string,
): RemoteMissionProgressV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteMissionPolicyError("invalid_request");
  const input = value as Record<string, unknown>;
  const states = new Set(["accepted", "running", "target_selection_required", "supervision_required", "approval_required"]);
  const updatedAt = typeof input.updatedAt === "string" ? new Date(input.updatedAt) : null;
  const approval = input.approval as Record<string, unknown> | undefined;
  const targetSelection = input.targetSelection as Record<string, unknown> | undefined;
  const evidence = input.evidence as Record<string, unknown> | undefined;
  const pendingStep = input.pendingStep;
  if (
    input.schemaVersion !== 1 ||
    input.missionId !== missionId ||
    !states.has(input.state as string) ||
    !updatedAt ||
    !Number.isFinite(updatedAt.getTime()) ||
    ((input.state === "approval_required") !== Boolean(approval)) ||
    ((input.state === "target_selection_required") !== Boolean(targetSelection))
    || ((input.state === "supervision_required") !== Boolean(evidence && pendingStep))
  )
    throw new RemoteMissionPolicyError("invalid_request");
  let boundedApproval: RemoteMissionProgressV1["approval"];
  if (approval) {
    const approvalId = boundedOptional(approval.approvalId, 200);
    const question = boundedOptional(approval.question, 1_000);
    const expiresAt = typeof approval.expiresAt === "string" ? new Date(approval.expiresAt) : null;
    const actionDigest = boundedOptional(approval.actionDigest, 256);
    if (!approvalId || !question || !expiresAt || !Number.isFinite(expiresAt.getTime()))
      throw new RemoteMissionPolicyError("invalid_request");
    boundedApproval = {
      approvalId,
      question,
      expiresAt: expiresAt.toISOString(),
      ...(actionDigest ? { actionDigest } : {}),
    };
  }
  let boundedTargetSelection: RemoteMissionTargetSelectionV1 | undefined;
  if (targetSelection) {
    const expiresAt = typeof targetSelection.expiresAt === "string"
      ? new Date(targetSelection.expiresAt)
      : null;
    const candidates = Array.isArray(targetSelection.candidates)
      ? targetSelection.candidates
      : [];
    if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || candidates.length < 2 || candidates.length > 10)
      throw new RemoteMissionPolicyError("invalid_request");
    boundedTargetSelection = {
      expiresAt: expiresAt.toISOString(),
      candidates: candidates.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new RemoteMissionPolicyError("invalid_request");
        const candidate = value as Record<string, unknown>;
        const targetHandle = boundedOptional(candidate.targetHandle, 200);
        const pageTitle = boundedOptional(candidate.pageTitle, 160);
        if (!targetHandle || !/^target_[A-Za-z0-9-]+$/.test(targetHandle) || !pageTitle)
          throw new RemoteMissionPolicyError("invalid_request");
        const groupTitle = boundedOptional(candidate.groupTitle, 80);
        const windowLabel = boundedOptional(candidate.windowLabel, 80);
        return {
          targetHandle,
          pageTitle,
          ...(groupTitle ? { groupTitle } : {}),
          ...(windowLabel ? { windowLabel } : {}),
        };
      }),
    };
    if (new Set(boundedTargetSelection.candidates.map((candidate) => candidate.targetHandle)).size !== boundedTargetSelection.candidates.length)
      throw new RemoteMissionPolicyError("invalid_request");
  }
  const summary = boundedOptional(input.summary, 1_000);
  const boundedEvidence = evidence ? parseMissionEvidence(evidence, missionId) : undefined;
  const boundedPendingStep = pendingStep
    ? parseReplacementSteps([pendingStep], missionId)[0]
    : undefined;
  const boundedRemainingSteps = input.remainingSteps
    ? parseReplacementSteps(input.remainingSteps, missionId)
    : undefined;
  if (
    boundedEvidence && boundedPendingStep &&
    (boundedEvidence.stepId !== boundedPendingStep.stepId ||
      boundedEvidence.planRevision !== boundedPendingStep.planRevision)
  ) throw new RemoteMissionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    missionId,
    state: input.state as RemoteMissionProgressV1["state"],
    updatedAt: updatedAt.toISOString(),
    ...(summary ? { summary } : {}),
    ...(boundedApproval ? { approval: boundedApproval } : {}),
    ...(boundedTargetSelection ? { targetSelection: boundedTargetSelection } : {}),
    ...(boundedEvidence ? { evidence: boundedEvidence } : {}),
    ...(boundedPendingStep ? { pendingStep: boundedPendingStep } : {}),
    ...(boundedRemainingSteps ? { remainingSteps: boundedRemainingSteps } : {}),
  };
}

const boundedStringList = (value: unknown, maxItems: number, maxLength: number) => {
  if (!Array.isArray(value) || value.length > maxItems)
    throw new RemoteMissionPolicyError("invalid_request");
  return value.map((item) => {
    const text = boundedOptional(item, maxLength);
    if (!text) throw new RemoteMissionPolicyError("invalid_request");
    return text;
  });
};

export function parseMissionEvidence(
  value: unknown,
  missionId: string,
): MissionEvidenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteMissionPolicyError("invalid_request");
  const input = value as Record<string, unknown>;
  const stepId = boundedOptional(input.stepId, 200);
  const attemptId = boundedOptional(input.attemptId, 200);
  const outcomes = new Set(["achieved", "not_achieved", "approval_required", "unknown"]);
  if (
    input.schemaVersion !== 1 || input.missionId !== missionId || !stepId || !attemptId ||
    !Number.isSafeInteger(input.planRevision) || Number(input.planRevision) < 1 ||
    !outcomes.has(input.outcome as string) || !Array.isArray(input.claims) ||
    input.claims.length > 20 || !Array.isArray(input.effects) || input.effects.length > 20
  ) throw new RemoteMissionPolicyError("invalid_request");
  const claims = input.claims.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new RemoteMissionPolicyError("invalid_request");
    const claim = value as Record<string, unknown>;
    const content = boundedOptional(claim.claim, 4_000);
    const sources = new Set(["page_observation", "form_field_readback", "navigation", "download", "agent_summary"]);
    if (!content || !sources.has(claim.source as string))
      throw new RemoteMissionPolicyError("invalid_request");
    return { claim: content, source: claim.source as MissionEvidenceV1["claims"][number]["source"] };
  });
  const effects = input.effects.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new RemoteMissionPolicyError("invalid_request");
    const effect = value as Record<string, unknown>;
    const type = boundedOptional(effect.type, 200);
    if (!type || typeof effect.consequential !== "boolean")
      throw new RemoteMissionPolicyError("invalid_request");
    return { type, consequential: effect.consequential };
  });
  let page: MissionEvidenceV1["page"];
  if (input.page !== undefined) {
    if (!input.page || typeof input.page !== "object" || Array.isArray(input.page))
      throw new RemoteMissionPolicyError("invalid_request");
    const candidate = input.page as Record<string, unknown>;
    const originValue = boundedOptional(candidate.origin, 2_048);
    if (!originValue) throw new RemoteMissionPolicyError("invalid_request");
    let origin: string;
    try {
      const parsed = new URL(originValue);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.origin !== originValue
      ) throw new Error("invalid origin");
      origin = parsed.origin;
    } catch {
      throw new RemoteMissionPolicyError("invalid_request");
    }
    const title = boundedOptional(candidate.title, 160);
    page = { origin, ...(title ? { title } : {}) };
  }
  let approval: MissionEvidenceV1["approval"];
  if (input.approval !== undefined) {
    if (!input.approval || typeof input.approval !== "object" || Array.isArray(input.approval))
      throw new RemoteMissionPolicyError("invalid_request");
    const candidate = input.approval as Record<string, unknown>;
    const approvalId = boundedOptional(candidate.approvalId, 200);
    const question = boundedOptional(candidate.question, 1_000);
    const expiresAt = typeof candidate.expiresAt === "string"
      ? new Date(candidate.expiresAt)
      : null;
    const actionDigest = boundedOptional(candidate.actionDigest, 256);
    if (!approvalId || !question || !expiresAt || !Number.isFinite(expiresAt.getTime()))
      throw new RemoteMissionPolicyError("invalid_request");
    approval = {
      approvalId,
      question,
      expiresAt: expiresAt.toISOString(),
      ...(actionDigest ? { actionDigest } : {}),
    };
  }
  if ((input.outcome === "approval_required") !== Boolean(approval))
    throw new RemoteMissionPolicyError("invalid_request");
  let target: MissionEvidenceV1["target"];
  if (input.target !== undefined) {
    if (!input.target || typeof input.target !== "object" || Array.isArray(input.target))
      throw new RemoteMissionPolicyError("invalid_request");
    const candidate = input.target as Record<string, unknown>;
    if (
      !["active_tab", "existing_tab", "isolated_tab"].includes(String(candidate.context)) ||
      typeof candidate.inWorkspace !== "boolean" ||
      typeof candidate.sidePanelEnabled !== "boolean" ||
      typeof candidate.createdForMission !== "boolean" ||
      (candidate.expectedUrlMatched !== undefined && typeof candidate.expectedUrlMatched !== "boolean")
    ) throw new RemoteMissionPolicyError("invalid_request");
    const pageOrigin = boundedOptional(candidate.pageOrigin, 2_048);
    if (pageOrigin) {
      try {
        const parsed = new URL(pageOrigin);
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username || parsed.password || parsed.origin !== pageOrigin
        ) throw new Error("invalid origin");
      } catch {
        throw new RemoteMissionPolicyError("invalid_request");
      }
    }
    const pageTitle = boundedOptional(candidate.pageTitle, 160);
    const windowLabel = boundedOptional(candidate.windowLabel, 80);
    const workspaceTitle = boundedOptional(candidate.workspaceTitle, 80);
    target = {
      context: candidate.context as NonNullable<MissionEvidenceV1["target"]>["context"],
      ...(pageOrigin ? { pageOrigin } : {}),
      ...(pageTitle ? { pageTitle } : {}),
      ...(candidate.expectedUrlMatched === undefined
        ? {}
        : { expectedUrlMatched: candidate.expectedUrlMatched }),
      ...(windowLabel ? { windowLabel } : {}),
      ...(workspaceTitle ? { workspaceTitle } : {}),
      inWorkspace: candidate.inWorkspace,
      sidePanelEnabled: candidate.sidePanelEnabled,
      createdForMission: candidate.createdForMission,
    };
  }
  return {
    schemaVersion: 1,
    missionId,
    stepId,
    attemptId,
    planRevision: Number(input.planRevision),
    outcome: input.outcome as MissionEvidenceV1["outcome"],
    ...(page ? { page } : {}),
    ...(target ? { target } : {}),
    claims,
    effects,
    uncertainties: boundedStringList(input.uncertainties, 20, 1_000),
    ...(approval ? { approval } : {}),
  };
}

const parseReplacementSteps = (value: unknown, missionId: string): MissionStepV1[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20)
    throw new RemoteMissionPolicyError("invalid_request");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new RemoteMissionPolicyError("invalid_request");
    const step = item as Record<string, unknown>;
    const stepId = boundedOptional(step.stepId, 200);
    const objective = boundedOptional(step.objective, 4_000);
    if (
      step.schemaVersion !== 1 || step.missionId !== missionId || !stepId || !objective ||
      !Number.isSafeInteger(step.planRevision) || Number(step.planRevision) < 1 ||
      !["read_only", "reversible", "consequential"].includes(String(step.risk))
    ) throw new RemoteMissionPolicyError("invalid_request");
    return {
      schemaVersion: 1,
      missionId,
      stepId,
      planRevision: Number(step.planRevision),
      risk: step.risk as MissionStepV1["risk"],
      objective,
      successCriteria: boundedStringList(step.successCriteria, 20, 500),
      ...(step.constraints ? { constraints: boundedStringList(step.constraints, 20, 500) } : {}),
      ...(step.prohibitedEffects ? { prohibitedEffects: boundedStringList(step.prohibitedEffects, 20, 500) } : {}),
    };
  });
};

export function parseRemoteMissionSupervisorDecision(
  value: unknown,
  missionId: string,
): RemoteMissionSupervisorDecisionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteMissionPolicyError("invalid_request");
  const input = value as Record<string, unknown>;
  const decisionId = boundedOptional(input.decisionId, 200);
  const stepId = boundedOptional(input.stepId, 200);
  const kinds = new Set(["continue", "retry", "replace_remaining_plan", "request_evidence", "request_user_input", "request_approval", "complete", "stop"]);
  const decidedAt = typeof input.decidedAt === "string" ? new Date(input.decidedAt) : null;
  if (
    input.schemaVersion !== 1 || input.missionId !== missionId || !decisionId || !stepId ||
    !Number.isSafeInteger(input.expectedPlanRevision) || Number(input.expectedPlanRevision) < 1 ||
    !kinds.has(input.kind as string) || !decidedAt || !Number.isFinite(decidedAt.getTime())
  ) throw new RemoteMissionPolicyError("invalid_request");
  const guidance = boundedOptional(input.guidance, 4_000);
  const outcome = input.outcome;
  if (outcome !== undefined && !["completed", "not_achieved", "cancelled", "unknown"].includes(String(outcome)))
    throw new RemoteMissionPolicyError("invalid_request");
  if (
    (input.kind === "complete" && outcome !== "completed") ||
    (input.kind === "stop" && !["not_achieved", "cancelled", "unknown"].includes(String(outcome))) ||
    (!["complete", "stop"].includes(String(input.kind)) && outcome !== undefined) ||
    (input.kind !== "replace_remaining_plan" && input.replacementSteps !== undefined)
  ) throw new RemoteMissionPolicyError("invalid_request");
  const replacementSteps = input.kind === "replace_remaining_plan"
    ? parseReplacementSteps(input.replacementSteps, missionId)
    : undefined;
  if (
    replacementSteps &&
    new Set(replacementSteps.map((step) => step.stepId)).size !== replacementSteps.length
  ) throw new RemoteMissionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    decisionId,
    missionId,
    stepId,
    expectedPlanRevision: Number(input.expectedPlanRevision),
    kind: input.kind as RemoteMissionSupervisorDecisionV1["kind"],
    decidedAt: decidedAt.toISOString(),
    ...(guidance ? { guidance } : {}),
    ...(outcome ? { outcome: outcome as RemoteMissionSupervisorDecisionV1["outcome"] } : {}),
    ...(replacementSteps ? { replacementSteps } : {}),
  };
}

export function parseRemoteMissionTargetDecision(
  value: unknown,
  missionId: string,
): RemoteMissionTargetDecisionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteMissionPolicyError("invalid_request");
  const input = value as Record<string, unknown>;
  const targetHandle = boundedOptional(input.targetHandle, 200);
  const decidedAt = typeof input.decidedAt === "string" ? new Date(input.decidedAt) : null;
  if (
    input.schemaVersion !== 1 ||
    input.missionId !== missionId ||
    !targetHandle ||
    !/^target_[A-Za-z0-9-]+$/.test(targetHandle) ||
    !decidedAt ||
    !Number.isFinite(decidedAt.getTime())
  ) throw new RemoteMissionPolicyError("invalid_request");
  return { schemaVersion: 1, missionId, targetHandle, decidedAt: decidedAt.toISOString() };
}

export function parseRemoteMissionApprovalDecision(
  value: unknown,
  missionId: string,
): RemoteMissionApprovalDecisionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteMissionPolicyError("invalid_request");
  const input = value as Record<string, unknown>;
  const approvalId = boundedOptional(input.approvalId, 200);
  const actionDigest = boundedOptional(input.actionDigest, 256);
  const decidedAt =
    typeof input.decidedAt === "string" ? new Date(input.decidedAt) : null;
  if (
    input.schemaVersion !== 1 ||
    input.missionId !== missionId ||
    !approvalId ||
    !actionDigest ||
    typeof input.approved !== "boolean" ||
    !decidedAt ||
    !Number.isFinite(decidedAt.getTime())
  ) throw new RemoteMissionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    missionId,
    approvalId,
    actionDigest,
    approved: input.approved,
    decidedAt: decidedAt.toISOString(),
  };
}

const transitions: Readonly<Record<RemoteMissionState, readonly RemoteMissionState[]>> = {
  queued: ["accepted", "cancelled"],
  accepted: ["running", "cancelled"],
  running: ["target_selection_required", "supervision_required", "approval_required", "succeeded", "failed", "cancelled", "outcome_unknown"],
  supervision_required: ["running", "failed", "cancelled"],
  target_selection_required: ["running", "failed", "cancelled"],
  approval_required: ["running", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  outcome_unknown: [],
};

export function assertRemoteMissionTransition(
  from: RemoteMissionState,
  transition: RemoteMissionTransitionV1,
) {
  if (!transitions[from].includes(transition.to))
    throw new RemoteMissionPolicyError("invalid_transition");
  const resultExpected =
    transition.to === "succeeded" ||
    transition.to === "failed" ||
    transition.to === "cancelled" ||
    transition.to === "outcome_unknown";
  if (resultExpected !== Boolean(transition.resultCode))
    throw new RemoteMissionPolicyError("invalid_request");
  if (
    (transition.to === "succeeded" && transition.resultCode !== "completed") ||
    (transition.to === "failed" && transition.resultCode !== "not_achieved") ||
    (transition.to === "cancelled" && transition.resultCode !== "cancelled") ||
    (transition.to === "outcome_unknown" && transition.resultCode !== "unknown")
  )
    throw new RemoteMissionPolicyError("invalid_request");
}
