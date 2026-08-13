import type {
  CreateRemoteMissionV1,
  RemoteMissionApprovalDecisionV1,
  RemoteMissionResultV1,
  RemoteMissionProgressV1,
  RemoteMissionState,
  RemoteMissionTargetDecisionV1,
  RemoteMissionTargetSelectionV1,
  RemoteMissionTransitionV1,
} from "@opensidebar/shared-types";

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
  const states = new Set(["accepted", "running", "target_selection_required", "approval_required"]);
  const updatedAt = typeof input.updatedAt === "string" ? new Date(input.updatedAt) : null;
  const approval = input.approval as Record<string, unknown> | undefined;
  const targetSelection = input.targetSelection as Record<string, unknown> | undefined;
  if (
    input.schemaVersion !== 1 ||
    input.missionId !== missionId ||
    !states.has(input.state as string) ||
    !updatedAt ||
    !Number.isFinite(updatedAt.getTime()) ||
    ((input.state === "approval_required") !== Boolean(approval)) ||
    ((input.state === "target_selection_required") !== Boolean(targetSelection))
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
  return {
    schemaVersion: 1,
    missionId,
    state: input.state as RemoteMissionProgressV1["state"],
    updatedAt: updatedAt.toISOString(),
    ...(summary ? { summary } : {}),
    ...(boundedApproval ? { approval: boundedApproval } : {}),
    ...(boundedTargetSelection ? { targetSelection: boundedTargetSelection } : {}),
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
  running: ["target_selection_required", "approval_required", "succeeded", "failed", "cancelled", "outcome_unknown"],
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
