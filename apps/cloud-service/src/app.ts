import { timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  defaultState,
  isRestockState,
  reduceRestockState,
  scenarios,
  type RestockControlCommand,
  type SandboxRun,
  type SandboxRunResultV1,
} from "@opensidebar/sandbox-contracts";
import type { CloudConfig } from "./config.js";
import {
  createControlApi,
  type ControlApiDependencies,
} from "./control-api.js";
import { keyedHash, opaqueToken, tokenHash } from "./crypto.js";
import type { PasswordlessAuthProvider } from "./passwordless-auth.js";
import type { OwnedRun, PlaygroundRepository } from "./repository.js";
import { createTemporalShadowApi } from "./temporal-shadow-api.js";
import type { TemporalShadowOutbox } from "./temporal-shadow-outbox.js";
import { createRemoteMissionApi } from "./remote-mission-api.js";
import type { RemoteMissionRepository } from "./remote-mission-repository.js";
import type { RemoteMissionVault } from "./remote-mission-vault.js";
import { createHostedBrowserMcpApi } from "./hosted-browser-mcp-api.js";
import type { HostedBrowserMcpOperations } from "./hosted-browser-mcp.js";

type Variables = { accountId: string; email: string; csrfHash: string };
const noStore = (c: Context) => c.header("Cache-Control", "no-store");
const problem = (
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500,
  code: string,
  message: string,
) => {
  noStore(c);
  return c.json({ error: { code, message } }, status);
};
const publicRun = ({ accountId: _accountId, ...run }: OwnedRun): SandboxRun =>
  run;
const sameHash = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const restockCommand = (value: unknown): value is RestockControlCommand => {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    typeof value.type !== "string"
  )
    return false;
  const command = value as Record<string, unknown>;
  switch (command.type) {
    case "restock.setAvailability":
      return (
        command.availability === "in_stock" ||
        command.availability === "out_of_stock"
      );
    case "restock.setInventory":
      return (
        Number.isInteger(command.inventory) &&
        Number(command.inventory) >= 0 &&
        Number(command.inventory) <= 9999
      );
    case "restock.setPrice":
      return (
        Number.isInteger(command.priceCents) &&
        Number(command.priceCents) >= 0 &&
        Number(command.priceCents) <= 9_999_999
      );
    case "restock.setFeasibility":
      return [
        "feasible",
        "temporarily_blocked",
        "recoverable",
        "permanently_impossible",
      ].includes(String(command.feasibility));
    case "restock.setRelevance":
      return (
        command.relevance === "relevant" || command.relevance === "decorative"
      );
    case "restock.setVisualOnly":
      return typeof command.visualOnly === "boolean";
    case "scenario.arm":
      return (
        Number.isInteger(command.delaySeconds) &&
        Number(command.delaySeconds) >= 1 &&
        Number(command.delaySeconds) <= 3600
      );
    case "scenario.trigger":
    case "scenario.reset":
    case "scenario.stop":
      return true;
    default:
      return false;
  }
};
const runUsable = (run: OwnedRun) =>
  run.lifecycle !== "expired" && Date.parse(run.expiresAt) > Date.now();

function targetView(run: OwnedRun) {
  if (!isRestockState(run.state))
    return {
      id: run.id,
      scenarioId: run.scenarioId,
      revision: run.revision,
      state: {},
    };
  return {
    id: run.id,
    scenarioId: run.scenarioId,
    scenarioVersion: run.scenarioVersion,
    revision: run.revision,
    state: {
      product: run.state.product,
      availability: run.state.availability,
      inventory: run.state.inventory,
      priceCents: run.state.priceCents,
      decoration: run.state.decoration,
      cartQuantity: run.state.cartQuantity,
      cartSize: run.state.cartSize,
    },
  };
}

const normalizedEmail = (value: unknown) => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320
    ? email
    : null;
};
const ipPrefix = (value: string) => {
  const ip = value.split(",")[0]?.trim() ?? "unknown";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4
      ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
      : "unknown";
  }
  return ip.includes(":")
    ? `${ip.split(":").slice(0, 4).join(":")}::/56`
    : "unknown";
};

export function createApp(
  repository: PlaygroundRepository,
  config: CloudConfig,
  passwordlessAuth?: PasswordlessAuthProvider,
  control?: Omit<ControlApiDependencies, "config" | "playgroundRepository"> & {
    remoteMissionRepository?: RemoteMissionRepository;
    remoteMissionVault?: RemoteMissionVault;
    hostedBrowserMcpOperations?: HostedBrowserMcpOperations;
  },
  temporalShadowOutbox?: TemporalShadowOutbox,
) {
  const app = new Hono<{ Variables: Variables }>();
  app.use("*", async (c, next) => {
    noStore(c);
    await next();
  });
  const regularBodyLimit = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) =>
      problem(c, 400, "body_too_large", "Request body is too large."),
  });
  const relayBodyLimit = bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) =>
      problem(c, 400, "body_too_large", "Request body is too large."),
  });
  const checkpointBodyLimit = bodyLimit({
    maxSize: 10 * 1024 * 1024,
    onError: (c) =>
      problem(c, 400, "body_too_large", "Request body is too large."),
  });
  const traceBodyLimit = bodyLimit({
    maxSize: 64 * 1024 * 1024,
    onError: (c) =>
      problem(c, 400, "body_too_large", "Encrypted trace is too large."),
  });
  app.use("/api/*", (c, next) =>
    c.req.path.match(/^\/api\/v1\/traces\/[0-9a-f-]+\/content$/) &&
    c.req.method === "PUT"
      ? traceBodyLimit(c, next)
      : c.req.path === "/api/v1/relay/chat/completions"
        ? relayBodyLimit(c, next)
        : c.req.path.endsWith("/checkpoints/intents")
          ? checkpointBodyLimit(c, next)
          : regularBodyLimit(c, next),
  );
  app.get("/health/live", (c) => c.json({ status: "ok" }));
  app.get("/health/ready", async (c) => {
    try {
      await repository.health();
      await control?.repository.health();
      await control?.sessionRepository?.health();
      return c.json({ status: "ready" });
    } catch {
      return problem(c, 500, "not_ready", "Service is not ready.");
    }
  });
  if (control)
    app.route(
      "/api/v1",
      createControlApi({
        ...control,
        config,
        playgroundRepository: repository,
      }),
    );
  if (control?.remoteMissionRepository && control.remoteMissionVault)
    app.route(
      "/api/v1",
      createRemoteMissionApi({
        config,
        accounts: control.repository,
        missions: control.remoteMissionRepository,
        vault: control.remoteMissionVault,
      }),
    );
  if (config.hostedMcpEnabled && control?.hostedBrowserMcpOperations)
    app.route("/", createHostedBrowserMcpApi({
      config,
      accounts: control.repository,
      operations: control.hostedBrowserMcpOperations,
      quota: repository,
    }));
  if (temporalShadowOutbox)
    app.route(
      "/internal/v1/temporal-shadow",
      createTemporalShadowApi(config, temporalShadowOutbox),
    );

  const authPrefix = "/api/v1/playground/auth";
  app.post(`${authPrefix}/code`, async (c) => {
    if (!passwordlessAuth)
      return problem(
        c,
        500,
        "auth_not_configured",
        "Authentication is not configured.",
      );
    if (c.req.header("origin") !== config.controlOrigin)
      return problem(
        c,
        403,
        "origin_failed",
        "Refresh Playground and try again.",
      );
    const body: { email?: string } = await c.req
      .json<{ email?: string }>()
      .catch(() => ({}));
    const email = normalizedEmail(body.email);
    if (!email)
      return problem(c, 400, "invalid_email", "Enter a valid email address.");
    const emailHash = keyedHash(config.authQuotaHmacKey, `email:${email}`);
    const addressHash = keyedHash(
      config.authQuotaHmacKey,
      `ip:${ipPrefix(c.req.header("x-forwarded-for") ?? "unknown")}`,
    );
    try {
      await repository.consumeAuthQuota(`email:${emailHash}`, 60, 1);
      await repository.consumeAuthQuota(`email:${emailHash}`, 3_600, 5);
      await repository.consumeAuthQuota(`email:${emailHash}`, 86_400, 10);
      await repository.consumeAuthQuota(`ip:${addressHash}`, 3_600, 20);
    } catch (cause) {
      if ((cause as { code?: string }).code === "auth_rate_limit")
        return problem(
          c,
          429,
          "auth_rate_limit",
          "Too many codes requested. Try again later.",
        );
      throw cause;
    }
    const providerChallenge = await passwordlessAuth.requestCode(email);
    const challengeId = opaqueToken(24);
    await repository.createEmailChallenge(
      tokenHash(challengeId),
      emailHash,
      providerChallenge,
      new Date(Date.now() + 600_000),
    );
    return c.json({ challengeId, expiresInSeconds: 600 }, 202);
  });
  app.post(`${authPrefix}/verify`, async (c) => {
    if (!passwordlessAuth)
      return problem(
        c,
        500,
        "auth_not_configured",
        "Authentication is not configured.",
      );
    if (c.req.header("origin") !== config.controlOrigin)
      return problem(
        c,
        403,
        "origin_failed",
        "Refresh Playground and try again.",
      );
    const body: { challengeId?: string; email?: string; code?: string } =
      await c.req
        .json<{ challengeId?: string; email?: string; code?: string }>()
        .catch(() => ({}));
    const challengeId =
      typeof body.challengeId === "string" ? body.challengeId : "";
    const email = normalizedEmail(body.email);
    const code =
      typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
    if (!challengeId || !email || !/^\d{6,8}$/.test(code))
      return problem(c, 400, "invalid_code", "Enter the code from your email.");
    const challengeHash = tokenHash(challengeId);
    const emailHash = keyedHash(config.authQuotaHmacKey, `email:${email}`);
    const challenge = await repository.beginEmailChallenge(
      challengeHash,
      emailHash,
    );
    if (!challenge)
      return problem(c, 400, "challenge_expired", "Request a new code.");
    let identity;
    try {
      identity = await passwordlessAuth.verifyCode(email, code, challenge);
    } catch {
      return problem(
        c,
        401,
        "invalid_code",
        "That code did not work. Try again.",
      );
    }
    if (!(await repository.consumeEmailChallenge(challengeHash)))
      return problem(c, 400, "challenge_expired", "Request a new code.");
    const session = opaqueToken();
    const csrf = opaqueToken(24);
    await repository.createSession(
      tokenHash(session),
      identity.accountId,
      identity.email,
      tokenHash(csrf),
      new Date(Date.now() + 90 * 86_400_000),
    );
    setCookie(c, "__Host-os_session", session, {
      path: "/",
      secure: config.cookieSecure,
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 90 * 86_400,
    });
    setCookie(c, "os_csrf", csrf, {
      path: "/",
      secure: config.cookieSecure,
      httpOnly: false,
      sameSite: "Strict",
      maxAge: 90 * 86_400,
    });
    return c.body(null, 204);
  });
  app.get(`${authPrefix}/login`, async (c) => {
    if (!config.cognitoDomain || !config.cognitoClientId)
      return problem(
        c,
        500,
        "auth_not_configured",
        "Authentication is not configured.",
      );
    const state = opaqueToken(24);
    const verifier = opaqueToken(48);
    const requestedReturn = c.req.query("return");
    const allowedReturns = new Set([
      "/account",
      "/settings",
      "/dashboard",
      "/dashboard/activation",
      "/sessions",
    ]);
    const returnPath =
      requestedReturn && allowedReturns.has(requestedReturn)
        ? requestedReturn
        : "/playground";
    await repository.createAuthFlow(
      tokenHash(state),
      verifier,
      returnPath,
      new Date(Date.now() + 600_000),
    );
    const authorize = new URL("/oauth2/authorize", config.cognitoDomain);
    authorize.searchParams.set("client_id", config.cognitoClientId);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", "openid email");
    authorize.searchParams.set(
      "redirect_uri",
      `${config.controlOrigin}${authPrefix}/callback`,
    );
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("code_challenge", tokenHash(verifier));
    return c.redirect(authorize.toString(), 302);
  });
  app.get(`${authPrefix}/callback`, async (c) => {
    if (!config.cognitoDomain || !config.cognitoClientId)
      return problem(
        c,
        500,
        "auth_not_configured",
        "Authentication is not configured.",
      );
    const code = c.req.query("code");
    const state = c.req.query("state");
    const flow = state
      ? await repository.consumeAuthFlow(tokenHash(state))
      : null;
    if (!code || !flow)
      return problem(c, 400, "invalid_callback", "Sign-in callback expired.");
    const tokenResponse = await fetch(
      new URL("/oauth2/token", config.cognitoDomain),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.cognitoClientId,
          code,
          code_verifier: flow.codeVerifier,
          redirect_uri: `${config.controlOrigin}${authPrefix}/callback`,
        }),
      },
    );
    if (!tokenResponse.ok)
      return problem(c, 401, "signin_failed", "Could not finish sign-in.");
    const tokens = (await tokenResponse.json()) as { access_token?: string };
    if (!tokens.access_token)
      return problem(c, 401, "signin_failed", "Could not finish sign-in.");
    const userResponse = await fetch(
      new URL("/oauth2/userInfo", config.cognitoDomain),
      { headers: { authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!userResponse.ok)
      return problem(
        c,
        401,
        "signin_failed",
        "Could not load the signed-in account.",
      );
    const user = (await userResponse.json()) as {
      sub?: string;
      email?: string;
    };
    if (!user.sub || !user.email)
      return problem(
        c,
        401,
        "signin_failed",
        "Account identity is incomplete.",
      );
    const session = opaqueToken();
    const csrf = opaqueToken(24);
    await repository.createSession(
      tokenHash(session),
      user.sub,
      user.email.toLowerCase(),
      tokenHash(csrf),
      new Date(Date.now() + 90 * 86_400_000),
    );
    setCookie(c, "__Host-os_session", session, {
      path: "/",
      secure: config.cookieSecure,
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 90 * 86_400,
    });
    setCookie(c, "os_csrf", csrf, {
      path: "/",
      secure: config.cookieSecure,
      httpOnly: false,
      sameSite: "Strict",
      maxAge: 90 * 86_400,
    });
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(flow.returnPath, 302);
  });
  app.get(`${authPrefix}/session`, async (c) => {
    if (config.developmentAccountId)
      return c.json({
        authenticated: true,
        email: config.developmentAccountId,
        csrfToken: "development",
      });
    const raw = getCookie(c, "__Host-os_session");
    const csrf = getCookie(c, "os_csrf");
    const session = raw ? await repository.session(tokenHash(raw)) : null;
    if (!session || !csrf || !sameHash(tokenHash(csrf), session.csrfHash))
      return c.json({ authenticated: false });
    return c.json({
      authenticated: true,
      email: session.email,
      csrfToken: csrf,
    });
  });

  const authenticate: MiddlewareHandler<{ Variables: Variables }> = async (
    c,
    next,
  ) => {
    if (config.developmentAccountId) {
      c.set("accountId", config.developmentAccountId);
      c.set("email", config.developmentAccountId);
      c.set("csrfHash", "");
      return next();
    }
    const raw = getCookie(c, "__Host-os_session");
    const session = raw ? await repository.session(tokenHash(raw)) : null;
    if (!session)
      return problem(c, 401, "unauthenticated", "Sign in to use Playground.");
    c.set("accountId", session.accountId);
    c.set("email", session.email);
    c.set("csrfHash", session.csrfHash);
    return next();
  };
  const mutationGuard: MiddlewareHandler<{ Variables: Variables }> = async (
    c,
    next,
  ) => {
    if (
      !["POST", "PATCH", "DELETE"].includes(c.req.method) ||
      config.developmentAccountId
    )
      return next();
    if (c.req.header("origin") !== config.controlOrigin)
      return problem(
        c,
        403,
        "origin_failed",
        "Refresh Playground and try again.",
      );
    const csrf = c.req.header("x-os-csrf");
    const csrfCookie = getCookie(c, "os_csrf");
    if (
      !csrf ||
      csrf !== csrfCookie ||
      !sameHash(tokenHash(csrf), c.get("csrfHash"))
    )
      return problem(
        c,
        403,
        "csrf_failed",
        "Refresh Playground and try again.",
      );
    return next();
  };

  const api = new Hono<{ Variables: Variables }>();
  api.use("*", authenticate, mutationGuard);
  api.post("/auth/logout", async (c) => {
    const raw = getCookie(c, "__Host-os_session");
    if (raw) await repository.revokeSession(tokenHash(raw));
    deleteCookie(c, "__Host-os_session", {
      path: "/",
      secure: config.cookieSecure,
    });
    deleteCookie(c, "os_csrf", { path: "/", secure: config.cookieSecure });
    return c.body(null, 204);
  });
  api.get("/scenarios", (c) => c.json({ scenarios }));
  api.get("/runs", async (c) =>
    c.json({
      runs: (await repository.listRuns(c.get("accountId"))).map(publicRun),
    }),
  );
  api.post("/runs", async (c) => {
    const body = await c.req
      .json<{ scenarioId?: string }>()
      .catch((): { scenarioId?: string } => ({}));
    if (body.scenarioId !== "restock-alert")
      return problem(
        c,
        400,
        "invalid_scenario",
        "The first Lightsail slice supports Restock only.",
      );
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 200)
      return problem(
        c,
        400,
        "idempotency_required",
        "Provide an Idempotency-Key.",
      );
    const keyHash = tokenHash(idempotencyKey);
    const prior = await repository.findIdempotentRun(
      c.get("accountId"),
      keyHash,
    );
    if (prior) return c.json({ run: publicRun(prior) }, 200);
    const timestamp = new Date();
    const id = `r_${opaqueToken(12)}`;
    const run: OwnedRun = {
      id,
      accountId: c.get("accountId"),
      scenarioId: "restock-alert",
      scenarioVersion: 1,
      lifecycle: "ready",
      revision: 1,
      state: defaultState("restock-alert"),
      result: null,
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
      expiresAt: new Date(timestamp.getTime() + 7_200_000).toISOString(),
    };
    try {
      await repository.createRun(run, tokenHash(c.get("accountId")), keyHash);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "concurrent_run_limit" || code === "daily_run_limit")
        return problem(c, 429, code, "Playground run allowance reached.");
      if (code === "23505") {
        const replay = await repository.findIdempotentRun(
          c.get("accountId"),
          keyHash,
        );
        if (replay) return c.json({ run: publicRun(replay) }, 200);
      }
      throw error;
    }
    return c.json({ run: publicRun(run) }, 201);
  });
  api.post("/runs/:runId/commands", async (c) => {
    const run = await repository.getRun(c.req.param("runId"));
    if (!run || run.accountId !== c.get("accountId"))
      return problem(c, 404, "run_not_found", "Run not found.");
    const command = await c.req.json<RestockControlCommand>().catch(() => null);
    if (!restockCommand(command) || !isRestockState(run.state))
      return problem(
        c,
        400,
        "invalid_command",
        "Provide a valid Restock control command.",
      );
    if (!runUsable(run))
      return problem(c, 410, "run_expired", "This run has expired.");
    const next = reduceRestockState(run.state, command);
    const updated: OwnedRun = {
      ...run,
      state: next.state,
      lifecycle: next.lifecycle ?? run.lifecycle,
      result: next.result ?? run.result,
      revision: run.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!(await repository.updateRun(updated, run.revision)))
      return problem(
        c,
        409,
        "revision_conflict",
        "Run changed. Refresh and retry.",
      );
    return c.json({ run: publicRun(updated) });
  });
  api.post("/runs/:runId/launch", async (c) => {
    const run = await repository.getRun(c.req.param("runId"));
    if (!run || run.accountId !== c.get("accountId"))
      return problem(c, 404, "run_not_found", "Run not found.");
    if (!runUsable(run))
      return problem(c, 410, "run_expired", "This run has expired.");
    const token = opaqueToken(24);
    await repository.createLaunch(
      tokenHash(token),
      run.id,
      run.accountId,
      new Date(Date.now() + 300_000),
    );
    return c.json(
      {
        launchUrl: `${config.targetOrigin}/launch/${token}`,
        expiresInSeconds: 300,
      },
      201,
    );
  });
  api.delete("/runs/:runId", async (c) =>
    (await repository.expireRun(c.get("accountId"), c.req.param("runId")))
      ? c.body(null, 204)
      : problem(c, 404, "run_not_found", "Run not found."),
  );
  app.route("/api/v1/playground", api);

  app.get("/launch/:token", async (c) => {
    const runId = await repository.consumeLaunch(
      tokenHash(c.req.param("token")),
    );
    if (!runId)
      return problem(c, 410, "launch_expired", "This launch link expired.");
    const session = opaqueToken();
    await repository.createTargetSession(
      tokenHash(session),
      runId,
      new Date(Date.now() + 7_200_000),
    );
    setCookie(c, "__Host-os_playground_target", session, {
      path: "/",
      secure: config.cookieSecure,
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 7200,
    });
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(`/run/${runId}`, 302);
  });

  const target = new Hono();
  target.use("*", async (c, next) => {
    if (
      ["POST", "PATCH", "DELETE"].includes(c.req.method) &&
      c.req.header("origin") !== config.targetOrigin
    )
      return problem(c, 403, "origin_failed", "Target origin rejected.");
    await next();
  });
  const targetRun = async (c: Context) => {
    const raw = getCookie(c, "__Host-os_playground_target");
    const runId = raw ? await repository.targetRunId(tokenHash(raw)) : null;
    const run = runId ? await repository.getRun(runId) : null;
    return run && runUsable(run) ? run : null;
  };
  target.get("/state", async (c) => {
    const run = await targetRun(c);
    return run
      ? c.json({ run: targetView(run) })
      : problem(c, 401, "target_session_required", "Open from Control Center.");
  });
  target.post("/action", async (c) => {
    const run = await targetRun(c);
    if (!run || !isRestockState(run.state))
      return problem(
        c,
        401,
        "target_session_required",
        "Open from Control Center.",
      );
    const body = await c.req
      .json<{ action?: string; quantity?: number; size?: string }>()
      .catch((): { action?: string; quantity?: number; size?: string } => ({}));
    if (
      body.action !== "restock.addToCart" ||
      run.state.availability !== "in_stock"
    )
      return problem(
        c,
        409,
        "action_unavailable",
        "This shoe is out of stock.",
      );
    const quantity = Math.floor(body.quantity ?? 0);
    const size = body.size ?? "";
    if (
      quantity < 1 ||
      quantity > Math.min(5, run.state.inventory) ||
      !/^US (7|8|9|10|11|12)$/.test(size)
    )
      return problem(
        c,
        400,
        "invalid_selection",
        "Choose an available size and quantity.",
      );
    const updated: OwnedRun = {
      ...run,
      state: { ...run.state, cartQuantity: quantity, cartSize: size },
      revision: run.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!(await repository.updateRun(updated, run.revision)))
      return problem(
        c,
        409,
        "revision_conflict",
        "Run changed. Refresh and retry.",
      );
    return c.json({ run: targetView(updated) });
  });
  target.post("/result", async (c) => {
    const run = await targetRun(c);
    if (!run || !isRestockState(run.state))
      return problem(
        c,
        401,
        "target_session_required",
        "Open from Control Center.",
      );
    const body = await c.req
      .json<Partial<SandboxRunResultV1>>()
      .catch((): Partial<SandboxRunResultV1> => ({}));
    if (
      body.schemaVersion !== 1 ||
      body.runId !== run.id ||
      !["completed", "clarification", "stopped", "failed"].includes(
        body.terminalStatus ?? "",
      ) ||
      !["accepted", "rejected", "none"].includes(
        body.completionDecision ?? "",
      ) ||
      ![
        "objective_reached",
        "permanent_blocker",
        "user_stopped",
        "agent_error",
        "unknown",
      ].includes(body.terminalReason ?? "") ||
      typeof body.emittedAt !== "string" ||
      !Number.isFinite(Date.parse(body.emittedAt))
    )
      return problem(c, 400, "invalid_result", "Result payload is invalid.");
    if (run.lifecycle === "finished" && run.result)
      return c.json({
        run: {
          ...targetView(run),
          lifecycle: run.lifecycle,
          result: run.result,
        },
      });
    const succeeded =
      body.terminalStatus === "completed" &&
      body.completionDecision === "accepted" &&
      body.terminalReason === "objective_reached" &&
      run.state.availability === "in_stock" &&
      run.state.cartQuantity > 0;
    const updated: OwnedRun = {
      ...run,
      lifecycle: "finished",
      result: succeeded ? "succeeded" : "false_success",
      revision: run.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!(await repository.updateRun(updated, run.revision)))
      return problem(
        c,
        409,
        "revision_conflict",
        "Run changed. Refresh and retry.",
      );
    return c.json({
      run: {
        ...targetView(updated),
        lifecycle: updated.lifecycle,
        result: updated.result,
      },
    });
  });
  app.route("/api/v1/target", target);
  app.onError((error, c) => {
    console.error("request failed", {
      name: error.name,
      message: error.message,
    });
    return problem(c, 500, "internal", "Request could not be completed.");
  });
  return app;
}
