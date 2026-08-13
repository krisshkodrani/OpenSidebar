import { createHash } from "node:crypto";
import type {
  RemoteMissionApprovalDecisionV1,
  RemoteMissionTargetDecisionV1,
  RemoteMissionV1,
} from "@opensidebar/shared-types";
import type { ControlRepository } from "./control-repository.js";
import { tokenHash } from "./crypto.js";
import type {
  HostedBrowserMcpOperations,
  HostedBrowserMcpPrincipal,
} from "./hosted-browser-mcp.js";
import type { RemoteMissionRepository } from "./remote-mission-repository.js";
import type { RemoteMissionVault } from "./remote-mission-vault.js";
import { parseRemoteMissionSupervisorDecision } from "./remote-mission-policy.js";

type Dependencies = {
  accounts: ControlRepository;
  missions: RemoteMissionRepository;
  vault: RemoteMissionVault;
};

type Args = Record<string, unknown>;

const text = (input: Args, key: string) => String(input[key] ?? "").trim();
const identity = (accountId: string, mission: RemoteMissionV1) => ({
  accountId,
  deviceId: mission.deviceId,
  missionId: mission.missionId,
});
const terminal = (state: RemoteMissionV1["state"]) =>
  state === "succeeded" ||
  state === "failed" ||
  state === "cancelled" ||
  state === "outcome_unknown";

async function ownedMission(
  deps: Dependencies,
  principal: HostedBrowserMcpPrincipal,
  input: Args,
) {
  const mission = await deps.missions.mission(principal.accountId, text(input, "missionId"));
  if (!mission) throw new Error("mission_not_found");
  return mission;
}

async function statusFor(
  deps: Dependencies,
  principal: HostedBrowserMcpPrincipal,
  mission: RemoteMissionV1,
) {
  const location = identity(principal.accountId, mission);
  const progress = terminal(mission.state)
    ? null
    : await deps.vault.getProgressAndDecrypt(location, (
        mission.state === "accepted" ||
        mission.state === "running" ||
        mission.state === "target_selection_required" ||
        mission.state === "supervision_required" ||
        mission.state === "approval_required"
      ) ? mission.state : undefined).catch(() => null);
  const result = terminal(mission.state)
    ? await deps.vault.getResultAndDecrypt(location, mission.resultCode).catch(() => null)
    : null;
  return {
    ...mission,
    ...(progress?.state === mission.state ? { progress } : {}),
    ...(result ? { result } : {}),
  };
}

export function createHostedBrowserMcpOperations(
  deps: Dependencies,
): HostedBrowserMcpOperations {
  return {
    async listDevices(principal) {
      const devices = (await deps.accounts.listDevices(principal.accountId))
        .filter((device) => device.connectionKind === "browser_extension" && !device.revokedAt)
        .map((device) => ({
          deviceId: device.id,
          name: device.displayName,
          availability: device.availability,
          extensionVersion: device.extensionVersion,
          remoteWork:
            device.capabilities.includes("remote_browser_tasks_v1") &&
            device.availability === "online"
              ? "ready"
              : device.availability === "online"
                ? "unsupported"
                : "offline",
        }));
      return { devices };
    },

    async startTask(principal, input) {
      if (!(await deps.accounts.remoteWorkSettings(principal.accountId)).enabled)
        throw new Error("remote_work_disabled");
      const devices = await deps.accounts.listDevices(principal.accountId);
      const idempotencyHash = tokenHash(
        `mcp:${principal.clientId}:${text(input, "requestId")}`,
      );
      const replay = await deps.missions.missionByIdempotency(
        principal.accountId,
        idempotencyHash,
      );
      if (replay) {
        const selected = devices.find((device) => device.id === replay.deviceId);
        return {
          mission: replay,
          selectedDevice: {
            deviceId: replay.deviceId,
            name: selected?.displayName ?? "Linked browser",
          },
          replayed: true,
        };
      }
      const eligible = devices.filter(
        (device) =>
          device.connectionKind === "browser_extension" &&
          !device.revokedAt &&
          device.availability === "online" &&
          device.capabilities.includes("remote_browser_tasks_v1"),
      );
      const requested = text(input, "deviceId");
      const device = requested
        ? eligible.find((candidate) => candidate.id === requested)
        : eligible.length === 1
          ? eligible[0]
          : undefined;
      if (!device)
        throw new Error(
          requested ? "device_remote_work_unavailable" : "device_selection_required",
        );
      const missionId = crypto.randomUUID();
      const now = new Date();
      const location = { accountId: principal.accountId, deviceId: device.id, missionId };
      const criteria = (input.successCriteria as string[]).map((value) => `- ${value.trim()}`).join("\n");
      const constraints = Array.isArray(input.constraints) && input.constraints.length
        ? `\n\nConstraints:\n${input.constraints.map((value) => `- ${String(value).trim()}`).join("\n")}`
        : "";
      const prohibited = Array.isArray(input.prohibitedEffects) && input.prohibitedEffects.length
        ? `\n\nDo not:\n${input.prohibitedEffects.map((value) => `- ${String(value).trim()}`).join("\n")}`
        : "";
      const instruction = `${text(input, "objective")}\n\nSuccess criteria:\n${criteria}${constraints}${prohibited}`;
      if (instruction.length > 16_000) throw new Error("mission_instruction_too_large");
      const stored = await deps.vault.encryptAndPut(location, {
        schemaVersion: 1,
        missionId,
        executionClass: "read_only",
        instruction,
        ...(typeof input.initialUrl === "string" ? { initialUrl: input.initialUrl } : {}),
        ...(input.targetContext === "active_tab" ||
        input.targetContext === "existing_tab" ||
        input.targetContext === "isolated_tab"
          ? { targetContext: input.targetContext }
          : { targetContext: "isolated_tab" as const }),
      });
      const created = await deps.missions.createMission({
        ...location,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 15 * 60_000),
        idempotencyHash,
        payloadObjectKey: deps.vault.objectKey(location),
        payloadCiphertextSizeBytes: stored.ciphertextSizeBytes,
        payloadCiphertextSha256: stored.ciphertextSha256,
      });
      if (!("value" in created)) {
        await deps.vault.delete(location).catch(() => undefined);
        throw new Error(created.kind);
      }
      if (created.kind === "replayed")
        await deps.vault.delete(location).catch(() => undefined);
      const selected = devices.find((candidate) => candidate.id === created.value.deviceId);
      return {
        mission: created.value,
        selectedDevice: {
          deviceId: created.value.deviceId,
          name: selected?.displayName ?? "Linked browser",
        },
        ...(created.kind === "replayed" ? { replayed: true } : {}),
      };
    },

    async getTask(principal, input) {
      return statusFor(deps, principal, await ownedMission(deps, principal, input));
    },

    async continueTask(principal, input) {
      const mission = await ownedMission(deps, principal, input);
      const location = identity(principal.accountId, mission);
      if (input.decision === "select_target") {
        if (mission.state !== "target_selection_required") throw new Error("state_conflict");
        const progress = await deps.vault.getProgressAndDecrypt(location, "target_selection_required");
        const targetHandle = text(input, "targetHandle");
        if (
          !progress.targetSelection?.candidates.some((candidate) => candidate.targetHandle === targetHandle) ||
          new Date(progress.targetSelection.expiresAt).getTime() <= Date.now()
        ) throw new Error("target_selection_stale");
        const decision: RemoteMissionTargetDecisionV1 = {
          schemaVersion: 1,
          missionId: mission.missionId,
          targetHandle,
          decidedAt: new Date().toISOString(),
        };
        await deps.vault.encryptTargetDecisionAndPut(location, decision);
        return { missionId: mission.missionId, state: mission.state, decision: "select_target" };
      }
      if (mission.state !== "supervision_required") throw new Error("state_conflict");
      const progress = await deps.vault.getProgressAndDecrypt(location, "supervision_required");
      if (!progress.evidence) throw new Error("supervision_evidence_missing");
      const decisionId = `decision_${createHash("sha256").update(JSON.stringify({
        missionId: mission.missionId,
        stepId: input.stepId,
        expectedPlanRevision: input.expectedPlanRevision,
        kind: input.decision,
        guidance: input.guidance,
        outcome: input.outcome,
        replacementSteps: input.replacementSteps,
      })).digest("hex")}`;
      const decision = parseRemoteMissionSupervisorDecision({
        schemaVersion: 1,
        decisionId,
        missionId: mission.missionId,
        stepId: input.stepId,
        expectedPlanRevision: input.expectedPlanRevision,
        kind: input.decision,
        decidedAt: new Date().toISOString(),
        ...(input.guidance ? { guidance: input.guidance } : {}),
        ...(input.outcome ? { outcome: input.outcome } : {}),
        ...(input.replacementSteps ? { replacementSteps: input.replacementSteps } : {}),
      }, mission.missionId);
      if (
        decision.stepId !== progress.evidence.stepId ||
        decision.expectedPlanRevision !== progress.evidence.planRevision
      ) throw new Error("supervisor_decision_stale");
      if (decision.kind === "request_user_input")
        return {
          missionId: mission.missionId,
          state: mission.state,
          decision: decision.kind,
          requiresUserInput: true,
          question: decision.guidance ?? "Ask the user for the missing information, then continue with their answer as guidance.",
        };
      if (decision.kind === "request_approval")
        throw new Error("approval_must_originate_from_browser_evidence");
      if (decision.kind === "continue" && !progress.remainingSteps?.length)
        throw new Error("no_remaining_step_to_continue");
      if (
        decision.replacementSteps?.some(
          (step) => step.planRevision <= progress.evidence!.planRevision,
        )
      ) throw new Error("replacement_plan_revision_stale");
      await deps.vault.encryptSupervisorDecisionAndPut(location, decision);
      return { missionId: mission.missionId, state: mission.state, decision: decision.kind };
    },

    async respondApproval(principal, input) {
      const mission = await ownedMission(deps, principal, input);
      if (mission.state !== "approval_required") throw new Error("state_conflict");
      const location = identity(principal.accountId, mission);
      const progress = await deps.vault.getProgressAndDecrypt(location, "approval_required");
      const approval = progress.approval;
      if (
        !approval?.actionDigest ||
        approval.approvalId !== text(input, "approvalId") ||
        new Date(approval.expiresAt).getTime() <= Date.now()
      ) throw new Error("approval_stale");
      const decision: RemoteMissionApprovalDecisionV1 = {
        schemaVersion: 1,
        missionId: mission.missionId,
        approvalId: approval.approvalId,
        actionDigest: approval.actionDigest,
        approved: input.approved === true,
        decidedAt: new Date().toISOString(),
      };
      await deps.vault.encryptApprovalDecisionAndPut(location, decision);
      return { missionId: mission.missionId, state: mission.state, approved: decision.approved };
    },

    async cancelTask(principal, input) {
      const mission = await ownedMission(deps, principal, input);
      if (terminal(mission.state)) return mission;
      await deps.vault.encryptResultAndPut(identity(principal.accountId, mission), {
        schemaVersion: 1,
        missionId: mission.missionId,
        outcome: "cancelled",
        createdAt: new Date().toISOString(),
        diagnostic: "Cancellation requested by an authorized MCP client.",
      });
      const transitioned = await deps.missions.transition({
        accountId: principal.accountId,
        missionId: mission.missionId,
        deviceId: mission.deviceId,
        from: mission.state,
        to: "cancelled",
        resultCode: "cancelled",
      });
      if (!("value" in transitioned)) throw new Error(transitioned.kind);
      return transitioned.value;
    },
  };
}
