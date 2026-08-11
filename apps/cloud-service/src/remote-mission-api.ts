import { Hono, type Context } from "hono";
import type { RemoteMissionTransitionV1 } from "@opensidebar/shared-types";
import type { CloudConfig } from "./config.js";
import type {
  ControlPrincipal,
  ControlRepository,
} from "./control-repository.js";
import { tokenHash } from "./crypto.js";
import {
  assertRemoteMissionTransition,
  parseCreateRemoteMission,
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

export function createRemoteMissionApi(deps: Dependencies) {
  const api = new Hono<{ Variables: Variables }>();
  api.use("*", async (c, next) => {
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
  });

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
      const input = parseCreateRemoteMission(await c.req.json().catch(() => null));
      const devices = await deps.accounts.listDevices(principal.accountId);
      const device = devices.find(
        (candidate) => candidate.id === input.deviceId && !candidate.revokedAt,
      );
      if (!device)
        return problem(c, 404, "device_not_found", "Selected device is unavailable.");
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
        instruction: input.instruction,
        ...(input.initialUrl ? { initialUrl: input.initialUrl } : {}),
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
      const mission = await deps.missions.mission(c.get("principal").accountId, missionId);
      return mission
        ? c.json(mission)
        : problem(c, 404, "mission_not_found", "Mission was not found.");
    }),
  );

  api.get("/devices/:deviceId/remote-missions", (c) =>
    attempt(c, async () => {
      const principal = c.get("principal");
      const deviceId = c.req.param("deviceId");
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

  return api;
}
