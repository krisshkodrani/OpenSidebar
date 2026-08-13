import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type {
  CloudProviderId,
  CloudSessionStatus,
} from "@opensidebar/shared-types";
import { canonicalBrowserCommandApprovalPayload } from "@opensidebar/shared-types";
import type { CloudConfig } from "./config.js";
import { ControlAuthError, ControlAuthService } from "./control-auth.js";
import {
  parseCloudPreferences,
  parseRelayRequest,
  providerId,
  ControlPolicyError,
} from "./control-policy.js";
import type {
  ControlPrincipal,
  ControlRepository,
} from "./control-repository.js";
import { keyedHash, opaqueToken, tokenHash } from "./crypto.js";
import type { CredentialVault } from "./credential-vault.js";
import type { CheckpointVault } from "./checkpoint-vault.js";
import type { CommandVault } from "./command-vault.js";
import type { DeviceCommandRepository } from "./device-command-repository.js";
import type { PlaygroundRepository } from "./repository.js";
import type { PasswordlessAuthProvider } from "./passwordless-auth.js";
import type { RelayService } from "./relay-service.js";
import type { SessionRepository } from "./session-repository.js";
import type { DeviceCoordinationRepository } from "./device-coordination-repository.js";
import { createTraceApi } from "./trace-api.js";
import type { TraceRepository } from "./trace-repository.js";
import type { TraceObjectStore } from "./trace-object-store.js";
import type { RemoteMissionRepository } from "./remote-mission-repository.js";
import type { RemoteMissionVault } from "./remote-mission-vault.js";
import { createPersonalDataApi } from "./personal-data-api.js";
import type { PersonalDataRepository } from "./personal-data-repository.js";
import type { PersonalDataObjectPort } from "./personal-data-object-store.js";
import { createModelBenchApi } from "./modelbench-api.js";
import type { ModelBenchRepository } from "./modelbench-repository.js";
import {
  parseConnectionRequest,
  parseCheckpointCommit,
  parseCheckpointWriteRequest,
  parseCreateCloudSession,
  parseExpectedRevision,
  parseIdempotencyKey,
  parseLeaseAcquireRequest,
  parseLeaseMutationRequest,
  parseIssueBrowserCommand,
  parseCommandMutationRequest,
  plaintextSizeBucket,
  parseUpdateCloudSession,
  SessionPolicyError,
} from "./session-policy.js";

type Variables = {
  principal: ControlPrincipal;
  authKind: "bearer" | "cookie";
  csrfHash: string;
};
export type ControlApiDependencies = {
  config: CloudConfig;
  repository: ControlRepository;
  playgroundRepository: PlaygroundRepository;
  auth: ControlAuthService;
  vault?: CredentialVault;
  relay?: RelayService;
  sessionRepository?: SessionRepository;
  coordinationRepository?: DeviceCoordinationRepository;
  checkpointVault?: CheckpointVault;
  commandVault?: CommandVault;
  commandRepository?: DeviceCommandRepository;
  traceRepository?: TraceRepository;
  traceObjectStore?: TraceObjectStore;
  passwordlessAuth?: PasswordlessAuthProvider;
  remoteMissionRepository?: RemoteMissionRepository;
  remoteMissionVault?: RemoteMissionVault;
  personalDataRepository?: PersonalDataRepository;
  personalDataObjectStore?: PersonalDataObjectPort;
  modelBenchRepository?: ModelBenchRepository;
};

const noStore = (c: Context) => c.header("Cache-Control", "no-store");
const problem = (
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 412 | 429 | 500 | 503,
  code: string,
  message: string,
) => {
  noStore(c);
  return c.json({ error: { code, message } }, status);
};
const sameHash = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const jsonBody = async (c: Context) =>
  c.req.json<Record<string, unknown>>().catch(() => null);
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const normalizedEmail = (value: unknown) => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320
    ? email
    : null;
};
const isControlRequest = (c: Context) => {
  const path = c.req.path.replace(/^\/api\/v1/, "");
  return (
    path.startsWith("/extension/") ||
    path === "/account" ||
    path.startsWith("/account/") ||
    path === "/credentials" ||
    path.startsWith("/credentials/") ||
    path === "/preferences" ||
    path === "/dashboard" ||
    path.startsWith("/dashboard/") ||
    path.startsWith("/relay/") ||
    path === "/sessions" ||
    path.startsWith("/sessions/") ||
    path === "/devices" ||
    path.startsWith("/devices/") ||
    path === "/traces" ||
    path.startsWith("/traces/") ||
    path === "/personal-data" ||
    path.startsWith("/personal-data/") ||
    path === "/modelbench" ||
    path.startsWith("/modelbench/")
  );
};
const statusFor = (error: unknown) => {
  const code =
    error instanceof ControlAuthError ||
    error instanceof ControlPolicyError ||
    error instanceof SessionPolicyError
      ? error.code
      : "internal_error";
  if (
    ["invalid_auth_request", "invalid_request", "invalid_provider"].includes(
      code,
    )
  )
    return [400, code] as const;
  if (["signin_failed", "invalid_refresh"].includes(code))
    return [401, code] as const;
  if (code === "cloud_access_not_enabled") return [403, code] as const;
  if (code === "refresh_reused") return [401, code] as const;
  if (code === "revision_conflict" || code === "duplicate_request")
    return [409, code] as const;
  if (
    code === "lease_conflict" ||
    code === "generation_conflict" ||
    code === "state_conflict" ||
    code === "invalid_transition"
  )
    return [409, code] as const;
  if (code === "device_mismatch") return [403, code] as const;
  if (code === "quota_exceeded") return [429, code] as const;
  if (code === "credential_missing") return [404, code] as const;
  if (code === "session_not_found") return [404, code] as const;
  if (code === "verification_failed" || code === "if_match_required")
    return [412, code] as const;
  if (code === "idempotency_key_required") return [400, code] as const;
  return [500, "internal_error"] as const;
};

export function createControlApi(deps: ControlApiDependencies) {
  const {
    config,
    repository,
    playgroundRepository,
    auth,
    vault,
    relay,
    sessionRepository,
    coordinationRepository,
    checkpointVault,
    commandVault,
    commandRepository,
    traceRepository,
    passwordlessAuth,
    traceObjectStore,
    remoteMissionRepository,
    remoteMissionVault,
    personalDataRepository,
    personalDataObjectStore,
    modelBenchRepository,
  } = deps;
  const api = new Hono<{ Variables: Variables }>();
  const encodeSessionCursor = (
    accountId: string,
    cursor: { updatedAt: Date; sessionId: string },
  ) => {
    const payload = `${cursor.updatedAt.toISOString()}|${cursor.sessionId}`;
    return Buffer.from(
      JSON.stringify({
        payload,
        signature: keyedHash(
          config.authQuotaHmacKey,
          `${accountId}:${payload}`,
        ),
      }),
    ).toString("base64url");
  };
  const decodeSessionCursor = (accountId: string, raw: string | undefined) => {
    if (!raw) return undefined;
    try {
      const decoded = JSON.parse(Buffer.from(raw, "base64url").toString()) as {
        payload?: unknown;
        signature?: unknown;
      };
      if (
        typeof decoded.payload !== "string" ||
        typeof decoded.signature !== "string" ||
        !sameHash(
          decoded.signature,
          keyedHash(config.authQuotaHmacKey, `${accountId}:${decoded.payload}`),
        )
      )
        throw new Error("invalid cursor");
      const [timestamp, id, extra] = decoded.payload.split("|");
      const updatedAt = new Date(timestamp ?? "");
      if (extra || !id || !uuid(id) || Number.isNaN(updatedAt.getTime()))
        throw new Error("invalid cursor");
      return { updatedAt, sessionId: id };
    } catch {
      throw new SessionPolicyError("invalid_request");
    }
  };
  api.use("*", async (c, next) => {
    if (!isControlRequest(c)) return next();
    noStore(c);
    if (!config.cloudControlEnabled)
      return problem(
        c,
        503,
        "cloud_control_disabled",
        "Cloud account features are not enabled.",
      );
    const origin = c.req.header("origin");
    const extensionOrigins = new Set(
      [config.extensionId, ...(config.extensionTestIds ?? [])]
        .filter((id): id is string => Boolean(id))
        .map((id) => `chrome-extension://${id}`),
    );
    if (
      origin &&
      origin !== config.controlOrigin &&
      !extensionOrigins.has(origin)
    )
      return problem(c, 403, "origin_failed", "Origin is not allowed.");
    if (origin && extensionOrigins.has(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header(
        "Access-Control-Allow-Headers",
        "authorization,content-type,idempotency-key,if-match,x-os-csrf",
      );
      c.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
      c.header("Vary", "Origin");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  const attempt = async (c: Context, action: () => Promise<Response>) => {
    try {
      return await action();
    } catch (error) {
      const [status, code] = statusFor(error);
      if (status === 500) console.error("control API request failed", error);
      return problem(
        c,
        status,
        code,
        status === 500
          ? "Request could not be completed."
          : code.replaceAll("_", " "),
      );
    }
  };
  const authQuota = async (
    c: Context,
    bucket: string,
    windowSeconds: number,
    limit: number,
  ) => {
    const address =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    try {
      await playgroundRepository.consumeAuthQuota(
        `control:${bucket}:${keyedHash(config.authQuotaHmacKey, address)}`,
        windowSeconds,
        limit,
      );
    } catch (error) {
      if ((error as { code?: string }).code === "auth_rate_limit")
        throw new ControlPolicyError("quota_exceeded");
      throw error;
    }
  };
  api.post("/extension/auth/code", async (c) => {
    if (!config.extensionAuthEnabled || !passwordlessAuth)
      return problem(
        c,
        503,
        "extension_auth_disabled",
        "Extension sign-in is not enabled.",
      );
    return attempt(c, async () => {
      await authQuota(c, "email-code", 3_600, 10);
      const body = (await jsonBody(c)) ?? {};
      const email = normalizedEmail(body.email);
      if (!email) throw new ControlAuthError("invalid_auth_request");
      const emailHash = keyedHash(config.authQuotaHmacKey, `email:${email}`);
      await playgroundRepository.consumeAuthQuota(
        `extension-email:${emailHash}`,
        3_600,
        5,
      );
      const providerChallenge = await passwordlessAuth.requestCode(email);
      const challengeId = opaqueToken(24);
      await playgroundRepository.createEmailChallenge(
        tokenHash(challengeId),
        emailHash,
        providerChallenge,
        new Date(Date.now() + 600_000),
      );
      return c.json({ challengeId, expiresInSeconds: 600 }, 202);
    });
  });
  api.post("/extension/auth/verify", async (c) => {
    if (!config.extensionAuthEnabled || !passwordlessAuth)
      return problem(
        c,
        503,
        "extension_auth_disabled",
        "Extension sign-in is not enabled.",
      );
    return attempt(c, async () => {
      await authQuota(c, "email-verify", 3_600, 30);
      const body = (await jsonBody(c)) ?? {};
      const email = normalizedEmail(body.email);
      const challengeId =
        typeof body.challengeId === "string" ? body.challengeId : "";
      const code =
        typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
      if (!email || !challengeId || !/^\d{6,8}$/.test(code))
        throw new ControlAuthError("invalid_auth_request");
      const challengeHash = tokenHash(challengeId);
      const challenge = await playgroundRepository.beginEmailChallenge(
        challengeHash,
        keyedHash(config.authQuotaHmacKey, `email:${email}`),
      );
      if (!challenge) throw new ControlAuthError("signin_failed");
      const identity = await passwordlessAuth.verifyCode(
        email,
        code,
        challenge,
      );
      if (!(await playgroundRepository.consumeEmailChallenge(challengeHash)))
        throw new ControlAuthError("signin_failed");
      return c.json(await auth.passwordless(identity, body), 201);
    });
  });
  api.post("/extension/auth/exchange", async (c) => {
    if (!config.extensionAuthEnabled)
      return problem(
        c,
        503,
        "extension_auth_disabled",
        "Extension sign-in is not enabled.",
      );
    return attempt(c, async () => {
      await authQuota(c, "exchange", 3_600, 20);
      return c.json(await auth.exchange((await jsonBody(c)) ?? {}), 201);
    });
  });
  api.post("/extension/auth/link", async (c) => {
    if (!config.extensionAuthEnabled)
      return problem(
        c,
        503,
        "extension_auth_disabled",
        "Extension sign-in is not enabled.",
      );
    return attempt(c, async () => {
      await authQuota(c, "link", 60, 10);
      await authQuota(c, "link", 3_600, 50);
      return c.json(await auth.link((await jsonBody(c)) ?? {}), 201);
    });
  });
  api.post("/extension/auth/refresh", async (c) =>
    attempt(c, async () => {
      await authQuota(c, "refresh", 60, 60);
      const body = await jsonBody(c);
      return c.json(await auth.refresh(body?.refreshToken));
    }),
  );

  const authenticate: MiddlewareHandler<{ Variables: Variables }> = async (
    c,
    next,
  ) => {
    if (!isControlRequest(c)) return next();
    const bearer = c.req
      .header("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
    if (bearer) {
      const principal = await repository.accessPrincipal(tokenHash(bearer));
      if (!principal)
        return problem(c, 401, "unauthenticated", "Sign in again.");
      if (!config.cloudTesterSubjects.has(principal.accountId))
        return problem(
          c,
          403,
          "cloud_access_not_enabled",
          "Cloud access is not enabled for this account.",
        );
      c.set("principal", principal);
      c.set("authKind", "bearer");
      c.set("csrfHash", "");
      return next();
    }
    const raw = getCookie(c, "__Host-os_session");
    const session = raw
      ? await playgroundRepository.session(tokenHash(raw))
      : null;
    if (!session)
      return problem(c, 401, "unauthenticated", "Sign in to OpenSidebar.");
    const account = await repository.upsertAccount(
      session.accountId,
      session.email,
      config.cloudTesterSubjects.has(session.accountId),
    );
    if (!account.cloudAccess)
      return problem(
        c,
        403,
        "cloud_access_not_enabled",
        "Cloud access is not enabled for this account.",
      );
    c.set("principal", {
      ...account,
      deviceId: "website",
      installationId: "website",
    });
    c.set("authKind", "cookie");
    c.set("csrfHash", session.csrfHash);
    return next();
  };
  const mutationGuard: MiddlewareHandler<{ Variables: Variables }> = async (
    c,
    next,
  ) => {
    if (!isControlRequest(c)) return next();
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    if (c.get("authKind") === "cookie") {
      const csrf = c.req.header("x-os-csrf"),
        cookie = getCookie(c, "os_csrf");
      if (
        !csrf ||
        csrf !== cookie ||
        !sameHash(tokenHash(csrf), c.get("csrfHash"))
      )
        return problem(
          c,
          403,
          "csrf_failed",
          "Refresh the page and try again.",
        );
    }
    return next();
  };
  api.use("/*", authenticate);
  api.use("/*", mutationGuard);
  const sessionTesterGuard: MiddlewareHandler<{
    Variables: Variables;
  }> = async (c, next) => {
    if (!config.cloudSessionTesterSubjects.has(c.get("principal").accountId))
      return problem(
        c,
        403,
        "cloud_session_access_not_enabled",
        "Cloud Sessions access is not enabled for this account.",
      );
    return next();
  };
  api.use("/sessions", sessionTesterGuard);
  api.use("/sessions/*", sessionTesterGuard);
  api.use("/devices/*", sessionTesterGuard);
  const traceTesterGuard: MiddlewareHandler<{ Variables: Variables }> = async (
    c,
    next,
  ) =>
    config.traceTesterSubjects?.has(c.get("principal").accountId)
      ? next()
      : problem(
          c,
          403,
          "trace_access_not_enabled",
          "Encrypted trace sync is not enabled for this account.",
        );
  api.use("/traces", traceTesterGuard);
  api.use("/traces/*", traceTesterGuard);
  if (modelBenchRepository)
    api.route("/modelbench", createModelBenchApi(modelBenchRepository, config.targetOrigin));
  if (config.traceSyncEnabled && traceRepository && traceObjectStore)
    api.route(
      "/traces",
      createTraceApi(traceRepository, traceObjectStore, {
        uploads: config.traceUploadsEnabled === true,
        downloads: config.traceDownloadsEnabled === true,
      }),
    );

  api.post("/extension/auth/logout", async (c) => {
    const token = c.req.header("authorization")?.slice(7);
    if (token) await repository.revokeAccessSession(tokenHash(token));
    return c.body(null, 204);
  });
  api.get("/account", (c) => {
    const p = c.get("principal");
    return c.json({
      schemaVersion: 1,
      accountId: p.accountId,
      email: p.email,
      cloudAccess: p.cloudAccess,
      sessionEpoch: p.sessionEpoch,
    });
  });
  api.get("/dashboard/summary", async (c) => {
    noStore(c);
    const principal = c.get("principal");
    const accountId = principal.accountId;
    const sessionAuthorized = config.cloudSessionTesterSubjects.has(accountId);
    const usage = await repository.relayUsage(accountId);
    const recent =
      config.cloudSessionsEnabled && sessionAuthorized && sessionRepository
        ? (await sessionRepository.listSessions(accountId, 12)).sessions
        : [];
    return c.json({
      schemaVersion: 1,
      account: {
        schemaVersion: 1,
        accountId,
        email: principal.email,
        cloudAccess: principal.cloudAccess,
        sessionEpoch: principal.sessionEpoch,
      },
      devices: await repository.listDevices(accountId),
      credentials: await repository.credentialStatuses(accountId),
      preferences: await repository.preferences(accountId),
      usage: {
        schemaVersion: 1,
        periodStart: new Date().toISOString().slice(0, 7) + "-01",
        ...usage,
        concurrentStreams: relay?.concurrent(accountId) ?? 0,
        limits: { requests: 2_000, tokens: 10_000_000, concurrentStreams: 2 },
      },
      sessions: {
        enabled: config.cloudSessionsEnabled,
        authorized: sessionAuthorized,
        recent,
      },
      detailedTraces: "local_only",
    });
  });
  api.get("/dashboard/activation", (c) => {
    noStore(c);
    if (!config.cloudOperatorSubjects.has(c.get("principal").accountId))
      return problem(c, 404, "not_found", "Resource was not found.");
    const stage = config.deviceTakeoverEnabled
      ? "takeover"
      : config.deviceCommandsEnabled
        ? "commands"
        : config.checkpointRestoreEnabled
          ? "checkpoint-restore"
          : config.checkpointWritesEnabled
            ? "checkpoint-writes"
            : config.cloudSessionsEnabled
              ? "sessions"
              : "disabled";
    return c.json({
      schemaVersion: 1,
      stage,
      flags: {
        cloudSessions: config.cloudSessionsEnabled,
        checkpointWrites: config.checkpointWritesEnabled,
        checkpointRestore: config.checkpointRestoreEnabled,
        sessionExports: config.sessionExportsEnabled ?? false,
        deviceCommands: config.deviceCommandsEnabled,
        deviceTakeover: config.deviceTakeoverEnabled,
        temporalShadow: config.temporalShadowEnabled,
        temporalCoordination: config.temporalCoordinationEnabled,
      },
      namedTesterCount: config.cloudSessionTesterSubjects.size,
      operatorMode: "read_only",
    });
  });
  api.get("/account/devices", async (c) =>
    c.json({
      schemaVersion: 1,
      devices: await repository.listDevices(c.get("principal").accountId),
    }),
  );
  api.get("/account/remote-work", async (c) =>
    c.json(await repository.remoteWorkSettings(c.get("principal").accountId)),
  );
  api.put("/account/remote-work", async (c) => {
    const body = await jsonBody(c);
    const expectedRevision = Number(c.req.header("if-match"));
    if (
      typeof body?.enabled !== "boolean" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1
    ) return problem(c, 400, "invalid_remote_work_setting", "Refresh and try again.");
    if (body.enabled && c.get("authKind") !== "cookie")
      return problem(c, 403, "website_session_required", "Enable remote work from opensidebar.com.");
    const result = await repository.putRemoteWorkSettings(
      c.get("principal").accountId,
      expectedRevision,
      body.enabled,
    );
    if (result === "revision_conflict")
      return problem(c, 409, "revision_conflict", "Remote-work settings changed elsewhere. Refresh and try again.");
    if (!result.enabled && remoteMissionRepository && remoteMissionVault) {
      for (const mission of await remoteMissionRepository.activeMissions(c.get("principal").accountId)) {
        const identity = {
          accountId: c.get("principal").accountId,
          deviceId: mission.deviceId,
          missionId: mission.missionId,
        };
        await remoteMissionVault.encryptResultAndPut(identity, {
          schemaVersion: 1,
          missionId: mission.missionId,
          outcome: "cancelled",
          summary: "Remote work was disabled for this account.",
          createdAt: new Date().toISOString(),
        });
        await remoteMissionRepository.transition({
          ...identity,
          from: mission.state,
          to: "cancelled",
          resultCode: "cancelled",
        });
      }
    }
    return c.json(result);
  });
  api.put("/account/devices/:id", async (c) => {
    const body = await jsonBody(c);
    const displayName =
      typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const expectedRevision = Number(c.req.header("if-match"));
    if (
      !displayName ||
      displayName.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(displayName) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1
    )
      return problem(c, 400, "invalid_device_name", "Enter a device name between 1 and 80 characters.");
    const result = await repository.renameDevice(
      c.get("principal").accountId,
      c.req.param("id"),
      expectedRevision,
      displayName,
    );
    if (result === "revision_conflict")
      return problem(c, 409, "revision_conflict", "This device was renamed elsewhere. Refresh and try again.");
    return result
      ? c.json(result)
      : problem(c, 404, "device_not_found", "Device was not found.");
  });
  api.delete("/account/devices/:id", async (c) =>
    (await repository.revokeDevice(
      c.get("principal").accountId,
      c.req.param("id"),
    ))
      ? c.body(null, 204)
      : problem(c, 404, "device_not_found", "Device was not found."),
  );
  api.post("/account/logout-all", async (c) => {
    await repository.logoutAll(c.get("principal").accountId);
    return c.body(null, 204);
  });
  api.post("/account/device-links", async (c) => {
    if (c.get("authKind") !== "cookie")
      return problem(
        c,
        403,
        "website_session_required",
        "Create link codes from opensidebar.com.",
      );
    const code = Array.from(
      crypto.getRandomValues(new Uint8Array(8)),
      (byte) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32],
    ).join("");
    await repository.createDeviceLink(
      tokenHash(code),
      c.get("principal").accountId,
      new Date(Date.now() + 10 * 60_000),
    );
    return c.json({ code, expiresInSeconds: 600 }, 201);
  });
  api.post("/devices/:deviceId/connections", async (c) => {
    if (!config.deviceCommandsEnabled || !coordinationRepository)
      return problem(
        c,
        503,
        "device_commands_disabled",
        "Device coordination is not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      if (
        principal.deviceId === "website" ||
        principal.deviceId !== c.req.param("deviceId")
      )
        throw new SessionPolicyError("device_mismatch");
      const input = parseConnectionRequest(await jsonBody(c));
      const result = await coordinationRepository.createConnection(
        principal.accountId,
        principal.deviceId,
        crypto.randomUUID(),
        input.transport,
        new Date(Date.now() + 60 * 60_000),
        tokenHash(parseIdempotencyKey(c.req.header("idempotency-key"))),
      );
      if (!("value" in result)) throw new SessionPolicyError(result.kind);
      return c.json(result.value, result.kind === "created" ? 201 : 200);
    });
  });
  api.get("/sessions/:sessionId/lease", async (c) => {
    if (!config.deviceCommandsEnabled || !coordinationRepository)
      return problem(
        c,
        503,
        "device_commands_disabled",
        "Device coordination is not enabled.",
      );
    const id = c.req.param("sessionId");
    if (!uuid(id))
      return problem(c, 404, "session_not_found", "Session was not found.");
    const value = await coordinationRepository.lease(
      c.get("principal").accountId,
      id,
    );
    return value
      ? c.json(value)
      : problem(c, 404, "lease_not_found", "Lease was not found.");
  });
  api.post("/sessions/:sessionId/lease", async (c) => {
    if (!config.deviceCommandsEnabled || !coordinationRepository)
      return problem(
        c,
        503,
        "device_commands_disabled",
        "Device coordination is not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const sessionId = c.req.param("sessionId");
      if (!uuid(sessionId) || principal.deviceId === "website")
        throw new SessionPolicyError("device_mismatch");
      const input = parseLeaseAcquireRequest(await jsonBody(c));
      const result = await coordinationRepository.acquireLease({
        accountId: principal.accountId,
        sessionId,
        deviceId: principal.deviceId,
        connectionId: input.connectionId,
        leaseId: crypto.randomUUID(),
        expectedSessionRevision: input.expectedSessionRevision,
        idempotencyHash: tokenHash(
          parseIdempotencyKey(c.req.header("idempotency-key")),
        ),
      });
      if (!("value" in result)) throw new SessionPolicyError(result.kind);
      return c.json(result.value, result.kind === "created" ? 201 : 200);
    });
  });
  api.post("/sessions/:sessionId/lease/heartbeat", async (c) => {
    if (!config.deviceCommandsEnabled || !coordinationRepository)
      return problem(
        c,
        503,
        "device_commands_disabled",
        "Device coordination is not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const sessionId = c.req.param("sessionId");
      if (!uuid(sessionId) || principal.deviceId === "website")
        throw new SessionPolicyError("device_mismatch");
      const input = parseLeaseMutationRequest(await jsonBody(c));
      const result = await coordinationRepository.heartbeatLease({
        accountId: principal.accountId,
        sessionId,
        deviceId: principal.deviceId,
        connectionId: input.connectionId,
        leaseId: input.leaseId,
        generation: input.generation,
        idempotencyHash: tokenHash(
          parseIdempotencyKey(c.req.header("idempotency-key")),
        ),
      });
      if (!("value" in result)) throw new SessionPolicyError(result.kind);
      return c.json(result.value);
    });
  });
  api.post("/sessions/:sessionId/lease/reconnect", async (c) => {
    if (!config.deviceCommandsEnabled || !coordinationRepository)
      return problem(
        c,
        503,
        "device_commands_disabled",
        "Device coordination is not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const sessionId = c.req.param("sessionId");
      if (!uuid(sessionId) || principal.deviceId === "website")
        throw new SessionPolicyError("device_mismatch");
      const input = parseLeaseMutationRequest(await jsonBody(c));
      const result = await coordinationRepository.reconnectLease({
        accountId: principal.accountId,
        sessionId,
        deviceId: principal.deviceId,
        connectionId: input.connectionId,
        leaseId: input.leaseId,
        generation: input.generation,
        idempotencyHash: tokenHash(
          parseIdempotencyKey(c.req.header("idempotency-key")),
        ),
      });
      if (!("value" in result)) throw new SessionPolicyError(result.kind);
      return c.json(result.value);
    });
  });
  api.post("/sessions/:sessionId/lease/takeover", async (c) => {
    if (!config.deviceTakeoverEnabled || !coordinationRepository)
      return problem(
        c,
        503,
        "device_takeover_disabled",
        "Cross-device takeover is not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const sessionId = c.req.param("sessionId");
      if (!uuid(sessionId) || principal.deviceId === "website")
        throw new SessionPolicyError("device_mismatch");
      const input = parseLeaseMutationRequest(await jsonBody(c));
      if (!input.expectedSessionRevision)
        throw new SessionPolicyError("invalid_request");
      const result = await coordinationRepository.takeoverLease({
        accountId: principal.accountId,
        sessionId,
        deviceId: principal.deviceId,
        connectionId: input.connectionId,
        leaseId: crypto.randomUUID(),
        expectedSessionRevision: input.expectedSessionRevision,
        expectedGeneration: input.generation,
        idempotencyHash: tokenHash(
          parseIdempotencyKey(c.req.header("idempotency-key")),
        ),
      });
      if (!("value" in result)) throw new SessionPolicyError(result.kind);
      return c.json(result.value);
    });
  });
  api.delete("/sessions/:sessionId/lease", async (c) => {
    if (!config.deviceCommandsEnabled || !coordinationRepository)
      return problem(
        c,
        503,
        "device_commands_disabled",
        "Device coordination is not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const sessionId = c.req.param("sessionId");
      if (!uuid(sessionId) || principal.deviceId === "website")
        throw new SessionPolicyError("device_mismatch");
      const input = parseLeaseMutationRequest(await jsonBody(c));
      const result = await coordinationRepository.releaseLease({
        accountId: principal.accountId,
        sessionId,
        deviceId: principal.deviceId,
        leaseId: input.leaseId,
        generation: input.generation,
        idempotencyHash: tokenHash(
          parseIdempotencyKey(c.req.header("idempotency-key")),
        ),
      });
      if (!("value" in result)) throw new SessionPolicyError(result.kind);
      return c.json(result.value);
    });
  });
  api.post("/sessions", async (c) => {
    if (!config.cloudSessionsEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "cloud_sessions_disabled",
        "Cloud sessions are not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const keyHash = tokenHash(
        parseIdempotencyKey(c.req.header("idempotency-key")),
      );
      const result = await sessionRepository.createSession(
        principal.accountId,
        crypto.randomUUID(),
        keyHash,
        parseCreateCloudSession(await jsonBody(c)),
      );
      if (!("value" in result))
        return problem(c, 409, result.kind, "Session could not be created.");
      return c.json(result.value, result.kind === "created" ? 201 : 200);
    });
  });
  api.get("/sessions", async (c) => {
    if (!config.cloudSessionsEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "cloud_sessions_disabled",
        "Cloud sessions are not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const limit = Number(c.req.query("limit") ?? 25);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new SessionPolicyError("invalid_request");
      const rawStatus = c.req.query("status");
      const statuses = new Set<CloudSessionStatus>([
        "created",
        "active",
        "waiting_for_user",
        "paused",
        "completed",
        "failed",
        "cancelled",
        "deleting",
      ]);
      if (rawStatus && !statuses.has(rawStatus as CloudSessionStatus))
        throw new SessionPolicyError("invalid_request");
      const page = await sessionRepository.listSessions(
        principal.accountId,
        limit,
        decodeSessionCursor(principal.accountId, c.req.query("cursor")),
        rawStatus as CloudSessionStatus | undefined,
      );
      return c.json({
        schemaVersion: 1,
        sessions: page.sessions,
        ...(page.nextCursor
          ? {
              nextCursor: encodeSessionCursor(
                principal.accountId,
                page.nextCursor,
              ),
            }
          : {}),
      });
    });
  });
  api.get("/sessions/:sessionId", async (c) => {
    if (!config.cloudSessionsEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "cloud_sessions_disabled",
        "Cloud sessions are not enabled.",
      );
    const id = c.req.param("sessionId");
    if (!uuid(id))
      return problem(c, 404, "session_not_found", "Session was not found.");
    const value = await sessionRepository.session(
      c.get("principal").accountId,
      id,
    );
    return value
      ? c.json(value)
      : problem(c, 404, "session_not_found", "Session was not found.");
  });
  api.get("/sessions/:sessionId/timeline", async (c) => {
    if (!config.cloudSessionsEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "cloud_sessions_disabled",
        "Cloud Sessions are not enabled.",
      );
    const accountId = c.get("principal").accountId;
    const session = await sessionRepository.session(
      accountId,
      c.req.param("sessionId"),
    );
    if (!session)
      return problem(c, 404, "session_not_found", "Session was not found.");
    const [checkpoint, lease] = await Promise.all([
      sessionRepository.latestCheckpoint(accountId, session.sessionId),
      coordinationRepository?.lease(accountId, session.sessionId) ?? null,
    ]);
    const events = [
      {
        schemaVersion: 1 as const,
        id: `session-created-${session.sessionId}`,
        kind: "session_created" as const,
        occurredAt: session.createdAt,
        label: "Session created",
        detail: `${session.mode.replaceAll("_", " ")} · revision 1`,
      },
      ...(checkpoint
        ? [
            {
              schemaVersion: 1 as const,
              id: `checkpoint-${checkpoint.checkpointId}`,
              kind: "checkpoint_committed" as const,
              occurredAt: checkpoint.createdAt,
              label: "Checkpoint committed",
              detail: `Portable checkpoint revision ${checkpoint.revision}`,
            },
          ]
        : []),
      ...(lease
        ? [
            {
              schemaVersion: 1 as const,
              id: `lease-${lease.leaseId}-${lease.generation}`,
              kind: "device_active" as const,
              occurredAt: lease.heartbeatAt,
              label: "Device coordination active",
              detail: `Generation ${lease.generation} · ${lease.state}`,
            },
          ]
        : []),
      {
        schemaVersion: 1 as const,
        id: `session-updated-${session.sessionId}-${session.revision}`,
        kind: "session_updated" as const,
        occurredAt: session.updatedAt,
        label: "Session status updated",
        detail: `${session.status.replaceAll("_", " ")} · revision ${session.revision}`,
      },
    ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    noStore(c);
    return c.json({ schemaVersion: 1, events, detailedTrace: "local_only" });
  });
  api.patch("/sessions/:sessionId", async (c) => {
    if (!config.cloudSessionsEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "cloud_sessions_disabled",
        "Cloud sessions are not enabled.",
      );
    return attempt(c, async () => {
      const id = c.req.param("sessionId");
      if (!uuid(id)) throw new SessionPolicyError("session_not_found");
      const result = await sessionRepository.updateSession(
        c.get("principal").accountId,
        id,
        parseExpectedRevision(c.req.header("if-match")),
        tokenHash(parseIdempotencyKey(c.req.header("idempotency-key"))),
        parseUpdateCloudSession(await jsonBody(c)),
      );
      if (result.kind === "not_found")
        throw new SessionPolicyError("session_not_found");
      if (result.kind === "revision_conflict")
        throw new SessionPolicyError("revision_conflict");
      if (!("value" in result)) throw new SessionPolicyError("invalid_request");
      return c.json(result.value);
    });
  });
  api.delete("/sessions/:sessionId", async (c) => {
    if (!config.cloudSessionsEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "cloud_sessions_disabled",
        "Cloud sessions are not enabled.",
      );
    return attempt(c, async () => {
      const id = c.req.param("sessionId");
      if (!uuid(id)) throw new SessionPolicyError("session_not_found");
      const result = await sessionRepository.deleteSession(
        c.get("principal").accountId,
        id,
        parseExpectedRevision(c.req.header("if-match")),
        tokenHash(parseIdempotencyKey(c.req.header("idempotency-key"))),
      );
      if (result.kind === "not_found")
        throw new SessionPolicyError("session_not_found");
      if (result.kind === "revision_conflict")
        throw new SessionPolicyError("revision_conflict");
      if (!("value" in result)) throw new SessionPolicyError("invalid_request");
      return c.json(result.value, 202);
    });
  });
  api.post("/sessions/:sessionId/export", async (c) => {
    if (!config.sessionExportsEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "session_exports_disabled",
        "Session exports are not enabled.",
      );
    return attempt(c, async () => {
      const sessionId = c.req.param("sessionId");
      if (!uuid(sessionId)) throw new SessionPolicyError("session_not_found");
      const result = await sessionRepository.requestExport(
        c.get("principal").accountId,
        sessionId,
        crypto.randomUUID(),
        parseExpectedRevision(c.req.header("if-match")),
        tokenHash(parseIdempotencyKey(c.req.header("idempotency-key"))),
      );
      if (result.kind === "not_found")
        throw new SessionPolicyError("session_not_found");
      if (result.kind === "revision_conflict")
        throw new SessionPolicyError("revision_conflict");
      if (!("value" in result)) throw new SessionPolicyError("invalid_request");
      return c.json(result.value, result.kind === "created" ? 202 : 200);
    });
  });
  api.get("/sessions/:sessionId/exports/:jobId", async (c) => {
    if (!config.sessionExportsEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "session_exports_disabled",
        "Session exports are not enabled.",
      );
    const sessionId = c.req.param("sessionId");
    const jobId = c.req.param("jobId");
    if (!uuid(sessionId) || !uuid(jobId))
      return problem(c, 404, "session_not_found", "Export was not found.");
    const job = await sessionRepository.exportJob(
      c.get("principal").accountId,
      sessionId,
      jobId,
    );
    return job
      ? c.json(job)
      : problem(c, 404, "session_not_found", "Export was not found.");
  });
  api.get("/sessions/:sessionId/checkpoints/latest", async (c) => {
    if (!config.checkpointRestoreEnabled || !sessionRepository)
      return problem(
        c,
        503,
        "checkpoint_restore_disabled",
        "Checkpoint restore is not enabled.",
      );
    const id = c.req.param("sessionId");
    if (!uuid(id))
      return problem(c, 404, "session_not_found", "Session was not found.");
    const value = await sessionRepository.latestCheckpoint(
      c.get("principal").accountId,
      id,
    );
    return value
      ? c.json(value)
      : problem(c, 404, "checkpoint_not_found", "Checkpoint was not found.");
  });
  api.post("/sessions/:sessionId/checkpoints/intents", async (c) => {
    if (
      !config.checkpointWritesEnabled ||
      !sessionRepository ||
      !checkpointVault
    )
      return problem(
        c,
        503,
        "checkpoint_writes_disabled",
        "Checkpoint writes are not enabled.",
      );
    return attempt(c, async () => {
      const accountId = c.get("principal").accountId;
      const sessionId = c.req.param("sessionId");
      if (!uuid(sessionId)) throw new SessionPolicyError("session_not_found");
      const input = parseCheckpointWriteRequest(await jsonBody(c));
      const idempotencyHash = tokenHash(
        parseIdempotencyKey(c.req.header("idempotency-key")),
      );
      if (input.checkpoint.sessionId !== sessionId)
        throw new SessionPolicyError("invalid_request");
      const existing = await sessionRepository.checkpoint(
        accountId,
        sessionId,
        input.checkpoint.checkpointId,
      );
      if (existing) return c.json(existing);
      const identity = {
        accountId,
        sessionId,
        checkpointId: input.checkpoint.checkpointId,
        revision: input.checkpoint.revision,
      };
      const plaintext = Buffer.from(JSON.stringify(input.checkpoint));
      const stored = await checkpointVault
        .encryptAndPut(identity, plaintext)
        .catch((error) => {
          if ((error as Error).message === "checkpoint_object_exists")
            throw new SessionPolicyError("revision_conflict");
          throw error;
        });
      const result = await sessionRepository.createCheckpointIntent(
        accountId,
        stored.objectKey,
        idempotencyHash,
        {
          schemaVersion: 1,
          sessionId,
          checkpointId: input.checkpoint.checkpointId,
          ...(input.checkpoint.parentCheckpointId
            ? { parentCheckpointId: input.checkpoint.parentCheckpointId }
            : {}),
          checkpointRevision: input.checkpoint.revision,
          sessionRevision: input.sessionRevision,
          checkpointSchemaVersion: input.checkpoint.schemaVersion,
          runtimeVersion: input.checkpoint.runtimeVersion,
          ciphertextSizeBytes: stored.ciphertextSizeBytes,
          ciphertextSha256: stored.ciphertextSha256,
        },
        plaintextSizeBucket(plaintext.byteLength),
      );
      if (!("value" in result)) {
        await checkpointVault.delete(identity).catch(() => undefined);
        if (result.kind === "not_found")
          throw new SessionPolicyError("session_not_found");
        throw new SessionPolicyError("revision_conflict");
      }
      return c.json(result.value, result.kind === "created" ? 201 : 200);
    });
  });
  api.post(
    "/sessions/:sessionId/checkpoints/:checkpointId/commit",
    async (c) => {
      if (
        !config.checkpointWritesEnabled ||
        !sessionRepository ||
        !checkpointVault
      )
        return problem(
          c,
          503,
          "checkpoint_writes_disabled",
          "Checkpoint writes are not enabled.",
        );
      return attempt(c, async () => {
        const accountId = c.get("principal").accountId;
        const sessionId = c.req.param("sessionId");
        const checkpointId = c.req.param("checkpointId");
        if (!uuid(sessionId) || !uuid(checkpointId))
          throw new SessionPolicyError("session_not_found");
        const body = parseCheckpointCommit(await jsonBody(c));
        if (body.checkpointId !== checkpointId)
          throw new SessionPolicyError("invalid_request");
        const checkpoint = await sessionRepository.checkpoint(
          accountId,
          sessionId,
          checkpointId,
        );
        if (!checkpoint) throw new SessionPolicyError("session_not_found");
        const stored = await checkpointVault.inspect({
          accountId,
          sessionId,
          checkpointId,
          revision: checkpoint.revision,
        });
        if (
          stored.ciphertextSizeBytes !== body.ciphertextSizeBytes ||
          stored.ciphertextSha256 !== body.ciphertextSha256
        )
          throw new SessionPolicyError("revision_conflict");
        const result = await sessionRepository.commitCheckpoint(
          accountId,
          sessionId,
          checkpointId,
          parseExpectedRevision(c.req.header("if-match")),
          tokenHash(parseIdempotencyKey(c.req.header("idempotency-key"))),
          stored.ciphertextSizeBytes,
          stored.ciphertextSha256,
        );
        if (result.kind === "not_found")
          throw new SessionPolicyError("session_not_found");
        if (!("value" in result))
          throw new SessionPolicyError("revision_conflict");
        return c.json(result.value);
      });
    },
  );
  api.get("/sessions/:sessionId/checkpoints/:checkpointId", async (c) => {
    if (
      !config.checkpointRestoreEnabled ||
      !sessionRepository ||
      !checkpointVault
    )
      return problem(
        c,
        503,
        "checkpoint_restore_disabled",
        "Checkpoint restore is not enabled.",
      );
    return attempt(c, async () => {
      const accountId = c.get("principal").accountId;
      const sessionId = c.req.param("sessionId");
      const checkpointId = c.req.param("checkpointId");
      if (!uuid(sessionId) || !uuid(checkpointId))
        throw new SessionPolicyError("session_not_found");
      const checkpoint = await sessionRepository.checkpoint(
        accountId,
        sessionId,
        checkpointId,
      );
      if (!checkpoint || checkpoint.state !== "committed")
        throw new SessionPolicyError("session_not_found");
      const plaintext = await checkpointVault.getAndDecrypt({
        accountId,
        sessionId,
        checkpointId,
        revision: checkpoint.revision,
      });
      return c.body(plaintext, 200, { "content-type": "application/json" });
    });
  });
  api.post("/sessions/:sessionId/commands", async (c) => {
    if (!config.deviceCommandsEnabled || !commandRepository || !commandVault)
      return problem(
        c,
        503,
        "device_commands_disabled",
        "Device commands are not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const sessionId = c.req.param("sessionId");
      if (!uuid(sessionId) || principal.deviceId === "website")
        throw new SessionPolicyError("device_mismatch");
      const input = parseIssueBrowserCommand(await jsonBody(c));
      const idempotencyHash = tokenHash(
        parseIdempotencyKey(c.req.header("idempotency-key")),
      );
      const replayed = await commandRepository.commandByIdempotency(
        principal.accountId,
        sessionId,
        idempotencyHash,
      );
      if (replayed) return c.json(replayed);
      const actionDigest = createHash("sha256")
        .update(
          canonicalBrowserCommandApprovalPayload({
            action: input.action,
            preconditions: input.preconditions,
            risk: input.risk,
            checkpointRevision: input.checkpointRevision,
          }),
        )
        .digest("hex");
      if (
        (input.risk === "sensitive_write" && !input.approval) ||
        (input.approval && input.approval.actionDigest !== actionDigest)
      )
        throw new SessionPolicyError("invalid_request");
      const commandId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + input.expiresInSeconds * 1_000,
      );
      const command = {
        schemaVersion: 1 as const,
        sessionId,
        commandId,
        leaseId: input.leaseId,
        leaseGeneration: input.leaseGeneration,
        checkpointRevision: input.checkpointRevision,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        action: input.action,
        preconditions: input.preconditions,
        risk: input.risk,
        ...(input.approval ? { approval: input.approval } : {}),
      };
      const identity = {
        accountId: principal.accountId,
        sessionId,
        commandId,
        leaseGeneration: input.leaseGeneration,
      };
      const stored = await commandVault.encryptAndPut(identity, command);
      const result = await commandRepository.createCommand({
        accountId: principal.accountId,
        deviceId: principal.deviceId,
        sessionId,
        commandId,
        leaseId: input.leaseId,
        leaseGeneration: input.leaseGeneration,
        checkpointRevision: input.checkpointRevision,
        commandKind: input.action.kind,
        risk: input.risk,
        actionDigest,
        expiresAt,
        payloadObjectKey: commandVault.objectKey(identity),
        payloadCiphertextSizeBytes: stored.ciphertextSizeBytes,
        payloadCiphertextSha256: stored.ciphertextSha256,
        idempotencyHash,
      });
      if (!("value" in result)) {
        await commandVault.delete(identity).catch(() => undefined);
        throw new SessionPolicyError(result.kind);
      }
      if (result.kind === "replayed" && result.value.commandId !== commandId)
        await commandVault.delete(identity).catch(() => undefined);
      return c.json(result.value, result.kind === "created" ? 201 : 200);
    });
  });
  api.get("/sessions/:sessionId/commands", async (c) => {
    if (!config.deviceCommandsEnabled || !commandRepository || !commandVault)
      return problem(
        c,
        503,
        "device_commands_disabled",
        "Device commands are not enabled.",
      );
    return attempt(c, async () => {
      const principal = c.get("principal");
      const sessionId = c.req.param("sessionId");
      const leaseId = c.req.query("leaseId") ?? "";
      const leaseGeneration = Number(c.req.query("generation"));
      const afterSequence = Number(c.req.query("after") ?? 0);
      const limit = Number(c.req.query("limit") ?? 25);
      const waitSeconds = Number(c.req.query("wait") ?? 0);
      if (
        !uuid(sessionId) ||
        !uuid(leaseId) ||
        principal.deviceId === "website" ||
        !Number.isSafeInteger(leaseGeneration) ||
        leaseGeneration < 1 ||
        !Number.isSafeInteger(afterSequence) ||
        afterSequence < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isSafeInteger(waitSeconds) ||
        waitSeconds < 0 ||
        waitSeconds > 25
      )
        throw new SessionPolicyError("invalid_request");
      const deadline = Date.now() + waitSeconds * 1_000;
      let records = await commandRepository.commands({
        accountId: principal.accountId,
        sessionId,
        deviceId: principal.deviceId,
        leaseId,
        leaseGeneration,
        afterSequence,
        limit,
      });
      while (records.length === 0 && Date.now() < deadline) {
        if (c.req.raw.signal.aborted) break;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(250, deadline - Date.now())),
        );
        records = await commandRepository.commands({
          accountId: principal.accountId,
          sessionId,
          deviceId: principal.deviceId,
          leaseId,
          leaseGeneration,
          afterSequence,
          limit,
        });
      }
      const delivered = [];
      for (const record of records) {
        let current = record;
        if (current.state === "pending") {
          const leased = await commandRepository.transitionCommand({
            accountId: principal.accountId,
            sessionId,
            deviceId: principal.deviceId,
            commandId: record.commandId,
            leaseId,
            leaseGeneration,
            to: "leased",
            idempotencyHash: tokenHash(`deliver-lease:${record.commandId}`),
          });
          if (!("value" in leased)) throw new SessionPolicyError(leased.kind);
          current = leased.value;
        }
        if (current.state === "leased") {
          const delivery = await commandRepository.transitionCommand({
            accountId: principal.accountId,
            sessionId,
            deviceId: principal.deviceId,
            commandId: record.commandId,
            leaseId,
            leaseGeneration,
            to: "delivered",
            idempotencyHash: tokenHash(`deliver-send:${record.commandId}`),
          });
          if (!("value" in delivery))
            throw new SessionPolicyError(delivery.kind);
          current = delivery.value;
        }
        delivered.push({
          schemaVersion: 1,
          record: current,
          command: await commandVault.getAndDecrypt({
            accountId: principal.accountId,
            sessionId,
            commandId: record.commandId,
            leaseGeneration,
          }),
        });
      }
      return c.json({ schemaVersion: 1, commands: delivered });
    });
  });
  const commandTransition = (
    path: "accept" | "start" | "result" | "cancel",
    to: "accepted" | "started" | "cancelled" | null,
  ) => {
    api.post(`/sessions/:sessionId/commands/:commandId/${path}`, async (c) => {
      if (!config.deviceCommandsEnabled || !commandRepository)
        return problem(
          c,
          503,
          "device_commands_disabled",
          "Device commands are not enabled.",
        );
      return attempt(c, async () => {
        const principal = c.get("principal");
        const sessionId = c.req.param("sessionId");
        const commandId = c.req.param("commandId");
        if (
          !uuid(sessionId) ||
          !uuid(commandId) ||
          principal.deviceId === "website"
        )
          throw new SessionPolicyError("device_mismatch");
        const input = parseCommandMutationRequest(await jsonBody(c));
        if (path === "result" && !input.outcomeCode)
          throw new SessionPolicyError("invalid_request");
        if (path !== "result" && input.outcomeCode)
          throw new SessionPolicyError("invalid_request");
        const target =
          to ??
          (input.outcomeCode === "verified"
            ? "succeeded"
            : input.outcomeCode === "not_achieved"
              ? "failed"
              : "outcome_unknown");
        const result = await commandRepository.transitionCommand({
          accountId: principal.accountId,
          sessionId,
          deviceId: principal.deviceId,
          commandId,
          leaseId: input.leaseId,
          leaseGeneration: input.leaseGeneration,
          to: target,
          ...(input.outcomeCode ? { outcomeCode: input.outcomeCode } : {}),
          idempotencyHash: tokenHash(
            parseIdempotencyKey(c.req.header("idempotency-key")),
          ),
        });
        if (!("value" in result)) throw new SessionPolicyError(result.kind);
        return c.json(result.value);
      });
    });
  };
  commandTransition("accept", "accepted");
  commandTransition("start", "started");
  commandTransition("result", null);
  commandTransition("cancel", "cancelled");
  api.get("/credentials", async (c) =>
    c.json({
      schemaVersion: 1,
      credentials: await repository.credentialStatuses(
        c.get("principal").accountId,
      ),
    }),
  );
  api.put("/credentials/:provider", async (c) => {
    if (!config.credentialWritesEnabled || !vault)
      return problem(
        c,
        503,
        "credential_writes_disabled",
        "Credential storage is not enabled.",
      );
    return attempt(c, async () => {
      const provider = providerId(c.req.param("provider"));
      const body = await jsonBody(c);
      return c.json(
        await vault.put(
          c.get("principal").accountId,
          provider,
          body?.credential,
        ),
        201,
      );
    });
  });
  api.delete("/credentials/:provider", async (c) =>
    attempt(c, async () => {
      const provider: CloudProviderId = providerId(c.req.param("provider"));
      await repository.deleteCredential(c.get("principal").accountId, provider);
      return c.body(null, 204);
    }),
  );
  api.get("/preferences", async (c) => {
    const preferences = await repository.preferences(
      c.get("principal").accountId,
    );
    return preferences ? c.json(preferences) : c.body(null, 204);
  });
  api.put("/preferences", async (c) => {
    if (!config.preferenceWritesEnabled)
      return problem(
        c,
        503,
        "preference_writes_disabled",
        "Preference sync is not enabled.",
      );
    return attempt(c, async () => {
      const preferences = parseCloudPreferences(await jsonBody(c));
      const expected = Number(c.req.header("if-match") ?? 0);
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        preferences.revision !== expected + 1
      )
        throw new ControlPolicyError("invalid_request");
      if (
        !(await repository.putPreferences(
          c.get("principal").accountId,
          expected,
          preferences,
        ))
      )
        throw new ControlPolicyError("revision_conflict");
      return c.json(preferences);
    });
  });
  api.get("/relay/usage", async (c) => {
    const accountId = c.get("principal").accountId;
    const usage = await repository.relayUsage(accountId);
    return c.json({
      schemaVersion: 1,
      periodStart: new Date().toISOString().slice(0, 7) + "-01",
      ...usage,
      concurrentStreams: relay?.concurrent(accountId) ?? 0,
      limits: { requests: 2_000, tokens: 10_000_000, concurrentStreams: 2 },
    });
  });
  api.post("/relay/chat/completions", async (c) => {
    if (!config.relayEnabled || !relay)
      return problem(c, 503, "relay_disabled", "Cloud relay is not enabled.");
    return attempt(c, async () => {
      const raw = await c.req.text();
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new ControlPolicyError("invalid_request");
      }
      const request = parseRelayRequest(
        value,
        Buffer.byteLength(raw),
        config.relayModelAllowlist,
      );
      return relay.stream(
        c.get("principal").accountId,
        request,
        c.req.raw.signal,
      );
    });
  });
  api.delete("/relay/requests/:abortScopeId", (c) =>
    relay?.cancel(c.get("principal").accountId, c.req.param("abortScopeId"))
      ? c.body(null, 204)
      : problem(
          c,
          404,
          "relay_request_not_found",
          "Relay request was not found.",
        ),
  );
  if (personalDataRepository && personalDataObjectStore) {
    api.route(
      "/personal-data",
      createPersonalDataApi({
        repository: personalDataRepository,
        objects: personalDataObjectStore,
        readsEnabled: config.personalDataReadsEnabled === true,
        writesEnabled: config.personalDataWritesEnabled === true,
        profileEnabled: config.personalDataProfileEnabled === true,
        testerSubjects: config.personalDataTesterSubjects ?? new Set(),
      }),
    );
  }
  return api;
}
