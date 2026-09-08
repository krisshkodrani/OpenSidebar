import { Hono, type Context } from "hono";
import {
  isRemoteMissionTerminal,
  type RemoteMissionTransitionV1,
} from "@opensidebar/shared-types";
import type { CloudConfig } from "./config.js";
import type {
  ControlPrincipal,
  ControlRepository,
} from "./control-repository.js";
import { tokenHash } from "./crypto.js";
import {
  assertRemoteMissionTransition,
  parseCreateRemoteMission,
  parseRemoteMissionApprovalDecision,
  parseRemoteMissionProgress,
  parseRemoteMissionResult,
  parseRemoteMissionTargetDecision,
  parseRemoteMissionSupervisorDecision,
  RemoteMissionPolicyError,
} from "./remote-mission-policy.js";
import type { RemoteMissionRepository } from "./remote-mission-repository.js";
import type { RemoteMissionVault } from "./remote-mission-vault.js";

type Variables = { principal: ControlPrincipal };
type Dependencies = {
  config: CloudConfig;
  accounts: ControlRepository;
  missions: RemoteMissionRepository;
  vault: RemoteMissionVault;
};

const problem = (
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  message: string,
) => {
  c.header("Cache-Control", "no-store");
  return c.json({ error: { code, message } }, status);
};
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const idempotencyHash = (c: Context) => {
  const value = c.req.header("idempotency-key")?.trim();
  if (!value || value.length > 200)
    throw new RemoteMissionPolicyError("invalid_request");
  return tokenHash(value);
};
const terminalOutcome = (state: RemoteMissionTransitionV1["to"]) =>
  state === "succeeded"
    ? "completed"
    : state === "failed"
      ? "not_achieved"
      : state === "cancelled"
        ? "cancelled"
        : state === "outcome_unknown"
          ? "unknown"
          : null;
const missionOutcome = (mission: { resultCode?: string }) =>
  mission.resultCode === "completed"
    ? "completed"
    : mission.resultCode === "not_achieved"
      ? "not_achieved"
      : mission.resultCode === "cancelled"
        ? "cancelled"
        : mission.resultCode === "unknown"
          ? "unknown"
          : undefined;
const missionProgressState = (state: string) =>
  state === "accepted" || state === "running" || state === "target_selection_required" || state === "supervision_required" || state === "approval_required"
    ? state
    : undefined;

export function createRemoteMissionApi(deps: Dependencies) {
  const api = new Hono<{ Variables: Variables }>();
  const authenticate = async (c: Context, next: () => Promise<void>) => {
    c.header("Cache-Control", "no-store");
    if (!deps.config.remoteMissionsEnabled)
      return problem(c, 503, "remote_missions_disabled", "Remote missions are not enabled.");
    const token = c.req.header("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
    const principal = token
      ? await deps.accounts.accessPrincipal(tokenHash(token))
      : null;
    if (!principal)
      return problem(c, 401, "unauthenticated", "Sign in again.");
    if (!deps.config.cloudSessionTesterSubjects.has(principal.accountId))
      return problem(c, 403, "remote_mission_access_not_enabled", "Remote mission access is not enabled.");
    c.set("principal", principal);
    return next();
  };
  api.use("/remote-missions", authenticate);
  api.use("/remote-missions/*", authenticate);
  api.use("/devices/:deviceId/remote-missions", authenticate);

  const attempt = async (c: Context, action: () => Promise<Response>) => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof RemoteMissionPolicyError)
        return problem(c, 400, error.code, error.code.replaceAll("_", " "));
      console.error("remote mission API request failed", error);
      return problem(c, 503, "remote_mission_unavailable", "Remote mission request could not be completed.");
    }
  };

  api.post("/remote-missions", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      if (!(await deps.accounts.remoteWorkSettings(principal.accountId)).enabled)
        return problem(c, 403, "remote_work_disabled", "Enable remote work from your OpenSidebar account.");
      const input = parseCreateRemoteMission(await c.req.json().catch(() => null));
      const devices = await deps.accounts.listDevices(principal.accountId);
      const device = devices.find(
        (candidate) =>
          candidate.id === input.deviceId &&
          candidate.connectionKind === "browser_extension" &&
          candidate.availability === "online" &&
          candidate.capabilities.includes("remote_browser_tasks_v1"),
      );
      if (!device)
        return problem(
          c,
          409,
          "device_remote_work_unavailable",
          "Selected device is not currently ready for remote browser work.",
        );
      const hash = idempotencyHash(c);
      const replay = await deps.missions.missionByIdempotency(principal.accountId, hash);
      if (replay) return c.json(replay);
      const missionId = crypto.randomUUID();
      const identity = {
        accountId: principal.accountId,
        deviceId: input.deviceId,
        missionId,
      };
      const stored = await deps.vault.encryptAndPut(identity, {
        schemaVersion: 1,
        missionId,
        executionClass: "read_only",
        instruction: input.instruction,
        ...(input.initialUrl ? { initialUrl: input.initialUrl } : {}),
        ...(input.targetContext ? { targetContext: input.targetContext } : {}),
      });
      const createdAt = new Date();
      const result = await deps.missions.createMission({
        ...identity,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + input.expiresInSeconds! * 1_000),
        idempotencyHash: hash,
        payloadObjectKey: deps.vault.objectKey(identity),
        payloadCiphertextSizeBytes: stored.ciphertextSizeBytes,
        payloadCiphertextSha256: stored.ciphertextSha256,
      }).catch(async (error) => {
        await deps.vault.delete(identity).catch(() => undefined);
        throw error;
      });
      if (!("value" in result)) {
        await deps.vault.delete(identity).catch(() => undefined);
        return problem(c, 409, result.kind, "Mission could not be created.");
      }
      if (result.kind === "replayed" && result.value.missionId !== missionId)
        await deps.vault.delete(identity).catch(() => undefined);
      return c.json(result.value, result.kind === "created" ? 201 : 200);
    }),
  );

  api.get("/remote-missions/:missionId", (c) =>
    attempt(c, async () => {
      const missionId = c.req.param("missionId");
      if (!uuid(missionId))
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      const principal = c.get("principal");
      const mission = await deps.missions.mission(principal.accountId, missionId);
      if (mission && principal.deviceId === mission.deviceId)
        await deps.accounts.markRemoteMissionReady(
          principal.accountId,
          principal.deviceId,
        );
      const result = mission && isRemoteMissionTerminal(mission.state)
          ? await deps.vault.getResultAndDecrypt({
            accountId: c.get("principal").accountId,
            deviceId: mission.deviceId,
            missionId,
          }, missionOutcome(mission)).catch(() => null)
        : null;
      const progress = mission && !isRemoteMissionTerminal(mission.state)
          ? await deps.vault.getProgressAndDecrypt({
            accountId: c.get("principal").accountId,
            deviceId: mission.deviceId,
            missionId,
          }, missionProgressState(mission.state)).catch(() => null)
        : null;
      const expectedOutcome = mission ? missionOutcome(mission) : undefined;
      const expectedProgressState = mission
        ? missionProgressState(mission.state)
        : undefined;
      const matchingResult =
        result && expectedOutcome && result.outcome === expectedOutcome
          ? result
          : null;
      const matchingProgress =
        progress && expectedProgressState && progress.state === expectedProgressState
          ? progress
          : null;
      return mission
        ? c.json({
            ...mission,
            ...(matchingProgress ? { progress: matchingProgress } : {}),
            ...(matchingResult ? { result: matchingResult } : {}),
          })
        : problem(c, 404, "mission_not_found", "Mission was not found.");
    }),
  );

  api.delete("/remote-missions/:missionId", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      await deps.vault.delete({
        accountId: principal.accountId,
        deviceId: mission.deviceId,
        missionId,
      });
      await deps.missions.remove(principal.accountId, missionId);
      return c.body(null, 204);
    }),
  );

  api.get("/devices/:deviceId/remote-missions", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const deviceId = c.req.param("deviceId");
      if (!(await deps.accounts.remoteWorkSettings(principal.accountId)).enabled)
        return problem(c, 403, "remote_work_disabled", "Remote work is disabled.");
      const after = Number(c.req.query("after") ?? 0);
      const limit = Number(c.req.query("limit") ?? 25);
      if (
        principal.deviceId !== deviceId ||
        !Number.isSafeInteger(after) ||
        after < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        return problem(c, 403, "device_mismatch", "Mission belongs to another device.");
      if (!(await deps.accounts.markRemoteMissionReady(principal.accountId, deviceId)))
        return problem(c, 403, "device_mismatch", "Device is not available for remote work.");
      const missions = await deps.missions.missions({
        accountId: principal.accountId,
        deviceId,
        afterSequence: after,
        limit,
      });
      const delivered = [];
      for (const mission of missions)
        delivered.push({
          schemaVersion: 1,
          mission,
          payload: await deps.vault.getAndDecrypt({
            accountId: principal.accountId,
            deviceId,
            missionId: mission.missionId,
          }),
        });
      return c.json({ schemaVersion: 1, missions: delivered });
    }),
  );

  api.post("/remote-missions/:missionId/transition", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const transition = (await c.req.json().catch(() => null)) as RemoteMissionTransitionV1 | null;
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      if (principal.deviceId !== mission.deviceId)
        return problem(c, 403, "device_mismatch", "Mission belongs to another device.");
      if (!transition || transition.schemaVersion !== 1)
        throw new RemoteMissionPolicyError("invalid_request");
      assertRemoteMissionTransition(mission.state, transition);
      const expectedOutcome = terminalOutcome(transition.to);
      if (expectedOutcome) {
        const result = await deps.vault.getResultAndDecrypt({
          accountId: principal.accountId,
          deviceId: principal.deviceId,
          missionId,
        }, expectedOutcome).catch(() => null);
        if (!result || result.outcome !== expectedOutcome)
          throw new RemoteMissionPolicyError("invalid_request");
      }
      const result = await deps.missions.transition({
        accountId: principal.accountId,
        missionId,
        deviceId: principal.deviceId,
        from: mission.state,
        to: transition.to,
        ...(transition.resultCode ? { resultCode: transition.resultCode } : {}),
      });
      return "value" in result
        ? c.json(result.value)
        : problem(c, 409, result.kind, "Mission state changed.");
    }),
  );

  api.put("/remote-missions/:missionId/result", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      if (principal.deviceId !== mission.deviceId)
        return problem(c, 403, "device_mismatch", "Mission belongs to another device.");
      if (isRemoteMissionTerminal(mission.state))
        return problem(c, 409, "state_conflict", "Mission is already terminal.");
      const result = parseRemoteMissionResult(await c.req.json().catch(() => null), missionId);
      await deps.vault.encryptResultAndPut(
        { accountId: principal.accountId, deviceId: principal.deviceId, missionId },
        result,
      );
      return c.json(result, 201);
    }),
  );

  api.put("/remote-missions/:missionId/progress", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      if (principal.deviceId !== mission.deviceId)
        return problem(c, 403, "device_mismatch", "Mission belongs to another device.");
      if (isRemoteMissionTerminal(mission.state))
        return problem(c, 409, "state_conflict", "Mission is already terminal.");
      const progress = parseRemoteMissionProgress(
        await c.req.json().catch(() => null),
        missionId,
      );
      const progressMatchesMission =
        (progress.state === "accepted" &&
          (mission.state === "queued" || mission.state === "accepted")) ||
        (progress.state === "running" && mission.state === "running") ||
        (progress.state === "target_selection_required" &&
          (mission.state === "running" || mission.state === "target_selection_required")) ||
        (progress.state === "supervision_required" &&
          (mission.state === "running" || mission.state === "supervision_required")) ||
        (progress.state === "approval_required" &&
          (mission.state === "running" || mission.state === "approval_required"));
      if (!progressMatchesMission)
        return problem(c, 409, "state_conflict", "Progress does not match mission state.");
      const identity = { accountId: principal.accountId, deviceId: principal.deviceId, missionId };
      if (progress.state === "supervision_required")
        await deps.vault.replaceSupervisionProgressAndPut(identity, progress);
      else
        await deps.vault.encryptProgressAndPut(identity, progress);
      return c.json(progress, 201);
    }),
  );

  api.put("/remote-missions/:missionId/approval-decision", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      idempotencyHash(c);
      const decision = parseRemoteMissionApprovalDecision(
        await c.req.json().catch(() => null),
        missionId,
      );
      const identity = {
        accountId: principal.accountId,
        deviceId: mission.deviceId,
        missionId,
      };
      const existing = await deps.vault
        .getApprovalDecisionAndDecrypt(identity)
        .catch(() => null);
      if (existing) {
        const matches =
          existing.approvalId === decision.approvalId &&
          existing.actionDigest === decision.actionDigest &&
          existing.approved === decision.approved;
        return matches
          ? c.json(existing)
          : problem(c, 409, "approval_decision_conflict", "Approval was already answered.");
      }
      if (mission.state !== "approval_required")
        return problem(c, 409, "state_conflict", "Mission is not awaiting approval.");
      const progress = await deps.vault
        .getProgressAndDecrypt(identity, "approval_required")
        .catch(() => null);
      if (
        !progress?.approval?.actionDigest ||
        progress.approval.approvalId !== decision.approvalId ||
        progress.approval.actionDigest !== decision.actionDigest ||
        new Date(mission.expiresAt).getTime() <= Date.now() ||
        new Date(progress.approval.expiresAt).getTime() <= Date.now() ||
        new Date(decision.decidedAt).getTime() <
          new Date(progress.updatedAt).getTime() ||
        new Date(decision.decidedAt).getTime() >
          Math.min(
            new Date(progress.approval.expiresAt).getTime(),
            new Date(mission.expiresAt).getTime(),
          )
      ) return problem(c, 409, "approval_stale", "Approval is stale or no longer valid.");
      await deps.vault.encryptApprovalDecisionAndPut(identity, decision);
      return c.json(decision, 201);
    }),
  );

  api.put("/remote-missions/:missionId/target-decision", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      idempotencyHash(c);
      const decision = parseRemoteMissionTargetDecision(
        await c.req.json().catch(() => null),
        missionId,
      );
      const identity = { accountId: principal.accountId, deviceId: mission.deviceId, missionId };
      const existing = await deps.vault.getTargetDecisionAndDecrypt(identity).catch(() => null);
      if (existing)
        return existing.targetHandle === decision.targetHandle
          ? c.json(existing)
          : problem(c, 409, "target_decision_conflict", "A browser target was already chosen.");
      if (mission.state !== "target_selection_required")
        return problem(c, 409, "state_conflict", "Mission is not awaiting a browser target.");
      const progress = await deps.vault
        .getProgressAndDecrypt(identity, "target_selection_required")
        .catch(() => null);
      if (
        !progress?.targetSelection ||
        !progress.targetSelection.candidates.some(
          (candidate) => candidate.targetHandle === decision.targetHandle,
        ) ||
        new Date(decision.decidedAt).getTime() < new Date(progress.updatedAt).getTime() ||
        new Date(decision.decidedAt).getTime() >
          Math.min(
            new Date(progress.targetSelection.expiresAt).getTime(),
            new Date(mission.expiresAt).getTime(),
          )
      ) return problem(c, 409, "target_selection_stale", "Browser target selection is stale.");
      await deps.vault.encryptTargetDecisionAndPut(identity, decision);
      return c.json(decision, 201);
    }),
  );

  api.get("/remote-missions/:missionId/target-decision", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      if (principal.deviceId !== mission.deviceId)
        return problem(c, 403, "device_mismatch", "Mission belongs to another device.");
      const decision = await deps.vault.getTargetDecisionAndDecrypt({
        accountId: principal.accountId,
        deviceId: mission.deviceId,
        missionId,
      }).catch(() => null);
      return decision
        ? c.json(decision)
        : problem(c, 404, "target_decision_not_found", "Browser target has not been chosen.");
    }),
  );

  api.put("/remote-missions/:missionId/supervisor-decision", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission) return problem(c, 404, "mission_not_found", "Mission was not found.");
      idempotencyHash(c);
      const decision = parseRemoteMissionSupervisorDecision(
        await c.req.json().catch(() => null),
        missionId,
      );
      if (decision.kind === "request_user_input" || decision.kind === "request_approval")
        return problem(
          c,
          409,
          "non_persistent_supervisor_decision",
          "This decision must be handled in the supervising conversation.",
        );
      const identity = { accountId: principal.accountId, deviceId: mission.deviceId, missionId };
      const existing = await deps.vault.getSupervisorDecisionAndDecrypt(identity).catch(() => null);
      if (existing)
        return existing.decisionId === decision.decisionId
          ? c.json(existing)
          : problem(c, 409, "supervisor_decision_conflict", "A supervisor decision already exists.");
      if (mission.state !== "supervision_required")
        return problem(c, 409, "state_conflict", "Mission is not awaiting supervision.");
      const progress = await deps.vault
        .getProgressAndDecrypt(identity, "supervision_required")
        .catch(() => null);
      if (
        !progress?.evidence ||
        progress.evidence.stepId !== decision.stepId ||
        progress.evidence.planRevision !== decision.expectedPlanRevision ||
        new Date(decision.decidedAt).getTime() < new Date(progress.updatedAt).getTime() ||
        new Date(decision.decidedAt).getTime() > new Date(mission.expiresAt).getTime()
      ) return problem(c, 409, "supervisor_decision_stale", "Supervisor decision is stale.");
      await deps.vault.encryptSupervisorDecisionAndPut(identity, decision);
      return c.json(decision, 201);
    }),
  );

  api.get("/remote-missions/:missionId/supervisor-decision", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission) return problem(c, 404, "mission_not_found", "Mission was not found.");
      if (principal.deviceId !== mission.deviceId)
        return problem(c, 403, "device_mismatch", "Mission belongs to another device.");
      const decision = await deps.vault.getSupervisorDecisionAndDecrypt({
        accountId: principal.accountId,
        deviceId: mission.deviceId,
        missionId,
      }).catch(() => null);
      return decision
        ? c.json(decision)
        : problem(c, 404, "supervisor_decision_not_found", "Supervisor has not decided.");
    }),
  );

  api.get("/remote-missions/:missionId/approval-decision", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      if (principal.deviceId !== mission.deviceId)
        return problem(c, 403, "device_mismatch", "Mission belongs to another device.");
      const decision = await deps.vault
        .getApprovalDecisionAndDecrypt({
          accountId: principal.accountId,
          deviceId: mission.deviceId,
          missionId,
        })
        .catch(() => null);
      return decision
        ? c.json(decision)
        : problem(c, 404, "approval_decision_not_found", "Approval has not been answered.");
    }),
  );

  api.post("/remote-missions/:missionId/cancel", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const missionId = c.req.param("missionId");
      const mission = uuid(missionId)
        ? await deps.missions.mission(principal.accountId, missionId)
        : null;
      if (!mission)
        return problem(c, 404, "mission_not_found", "Mission was not found.");
      idempotencyHash(c);
      if (mission.state === "cancelled") return c.json(mission);
      if (isRemoteMissionTerminal(mission.state))
        return problem(c, 409, "state_conflict", "Mission is already terminal.");
      const identity = {
        accountId: principal.accountId,
        deviceId: mission.deviceId,
        missionId,
      };
      await deps.vault.encryptResultAndPut(identity, {
        schemaVersion: 1,
        missionId,
        outcome: "cancelled",
        createdAt: new Date().toISOString(),
        diagnostic: "Cancellation requested by the mission coordinator.",
      });
      const cancelled = await deps.missions.transition({
        accountId: principal.accountId,
        missionId,
        deviceId: mission.deviceId,
        from: mission.state,
        to: "cancelled",
        resultCode: "cancelled",
      });
      if ("value" in cancelled) return c.json(cancelled.value);
      const latest = await deps.missions.mission(principal.accountId, missionId);
      return latest?.state === "cancelled"
        ? c.json(latest)
        : problem(c, 409, cancelled.kind, "Mission state changed.");
    }),
  );

  return api;
}
