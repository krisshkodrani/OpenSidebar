import type {
  CreateRemoteMissionV1,
  RemoteMissionState,
  RemoteMissionTransitionV1,
} from "@opensidebar/shared-types";

export class RemoteMissionPolicyError extends Error {
  constructor(readonly code: "invalid_request" | "invalid_transition") {
    super(code);
  }
}

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

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
  if (
    input.schemaVersion !== 1 ||
    !uuid(input.deviceId) ||
    instruction.length < 1 ||
    instruction.length > 16_000 ||
    !Number.isSafeInteger(expiresInSeconds) ||
    Number(expiresInSeconds) < 30 ||
    Number(expiresInSeconds) > 60 * 60
  )
    throw new RemoteMissionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    deviceId: input.deviceId,
    instruction,
    ...(input.initialUrl === undefined
      ? {}
      : { initialUrl: initialUrl(input.initialUrl) }),
    expiresInSeconds: Number(expiresInSeconds),
  };
}

const transitions: Readonly<Record<RemoteMissionState, readonly RemoteMissionState[]>> = {
  queued: ["accepted", "cancelled"],
  accepted: ["running", "cancelled"],
  running: ["approval_required", "succeeded", "failed", "outcome_unknown"],
  approval_required: ["running", "cancelled"],
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
