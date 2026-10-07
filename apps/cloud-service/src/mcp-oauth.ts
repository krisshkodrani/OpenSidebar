import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import type { CloudConfig } from "./config.js";
import type { ControlRepository } from "./control-repository.js";
import type { PlaygroundRepository } from "./repository.js";
import { keyedHash, opaqueToken, tokenHash } from "./crypto.js";
import type { McpOAuthStore } from "./mcp-oauth-store.js";
import type { HostedBrowserMcpPrincipal } from "./hosted-browser-mcp.js";

export const mcpScopes = [
  "devices.read",
  "tasks.create",
  "tasks.interact",
  "tasks.read",
  "tasks.continue",
  "tasks.approve",
  "tasks.cancel",
].map((s) => `browser.${s}`);
const callback = "http://localhost:1455/auth/callback/3MqMAmAkMrwa";
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const pkcePattern = /^[A-Za-z0-9._~-]{43,128}$/;
type Deps = {
  config: CloudConfig;
  accounts: ControlRepository;
  web: PlaygroundRepository;
  store: McpOAuthStore;
};
export class McpOAuthService {
  readonly issuer: string;
  readonly resource: string;
  readonly scopes: string[];
  constructor(readonly deps: Deps) {
    this.issuer = deps.config.controlOrigin;
    this.resource = `${this.issuer}/mcp`;
    this.scopes = mcpScopes.map((s) => `${this.resource}/${s}`);
  }
  parse(params: URLSearchParams) {
    for (const key of params.keys())
      if (params.getAll(key).length !== 1) throw new Error("invalid_request");
    const clientId = params.get("client_id"),
      redirectUri = params.get("redirect_uri");
    const challenge = params.get("code_challenge") ?? "",
      state = params.get("state") ?? "";
    const scopes = [
      ...new Set((params.get("scope") ?? "").split(/\s+/).filter(Boolean)),
    ];
    if (
      !clientId ||
      clientId !== this.deps.config.cognitoMcpClientId ||
      redirectUri !== callback ||
      params.get("response_type") !== "code" ||
      params.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      !state ||
      state.length > 512 ||
      params.get("resource") !== this.resource ||
      !scopes.length ||
      scopes.some((s) => s !== "openid" && !this.scopes.includes(s)) ||
      !scopes.some((s) => this.scopes.includes(s))
    )
      throw new Error("invalid_request");
    return { clientId, redirectUri, challenge, state, scopes };
  }
  async eligible(accountId: string, deviceId?: string, epoch?: number) {
    const account = await this.deps.accounts.account(accountId);
    if (
      !account?.cloudAccess ||
      !this.deps.config.cloudSessionTesterSubjects.has(accountId) ||
      (epoch !== undefined && account.sessionEpoch !== epoch)
    )
      throw new Error("access_denied");
    const devices = await this.deps.accounts.listDevices(accountId);
    const device = deviceId
      ? devices.find((d) => d.id === deviceId)
      : devices.find(
          (d) =>
            d.installationId === `mcp:${this.deps.config.cognitoMcpClientId}` &&
            d.connectionKind === "codex_integration",
        );
    if (
      device?.revokedAt ||
      (deviceId && (!device || device.connectionKind !== "codex_integration"))
    )
      throw new Error("access_denied");
    return { account, device };
  }
  async authorize(accountId: string, params: URLSearchParams) {
    const request = this.parse(params);
    const { account, device: prior } = await this.eligible(accountId);
    const device =
      prior ??
      (await this.deps.accounts.upsertDevice(
        accountId,
        `mcp:${request.clientId}`,
        "Codex",
        "hosted-mcp-v1",
        "codex_integration",
        false,
      ));
    if (device.revokedAt) throw new Error("access_denied");
    const code = opaqueToken();
    await this.deps.store.put({
      hash: tokenHash(code),
      kind: "code",
      family: opaqueToken(),
      accountId,
      deviceId: device.id,
      epoch: account.sessionEpoch,
      clientId: request.clientId,
      resource: this.resource,
      scopes: request.scopes,
      redirectUri: request.redirectUri,
      challenge: request.challenge,
      expiresAt: new Date(Date.now() + 120_000),
      familyExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
    const url = new URL(request.redirectUri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", request.state);
    url.searchParams.set("iss", this.issuer);
    return url.toString();
  }
  async exchange(params: URLSearchParams) {
    for (const key of params.keys())
      if (params.getAll(key).length !== 1) throw new Error("invalid_request");
    const kind = params.get("grant_type");
    if (kind !== "authorization_code" && kind !== "refresh_token")
      throw new Error("unsupported_grant_type");
    const raw =
      params.get(kind === "authorization_code" ? "code" : "refresh_token") ??
      "";
    if (!tokenPattern.test(raw)) throw new Error("invalid_grant");
    const previous = await this.deps.store.get(tokenHash(raw));
    if (!previous) throw new Error("invalid_grant");
    await this.eligible(previous.accountId, previous.deviceId, previous.epoch);
    const access = `osm_${opaqueToken()}`,
      refresh = opaqueToken();
    let grantedScopes: string[] = [];
    const ok = await this.deps.store.exchange(
      tokenHash(raw),
      (g) => {
        if (
          g.clientId !== params.get("client_id") ||
          g.resource !== params.get("resource") ||
          g.familyExpiresAt.getTime() <= Date.now()
        )
          return false;
        if (kind === "authorization_code") {
          const verifier = params.get("code_verifier") ?? "";
          return (
            g.kind === "code" &&
            g.redirectUri === params.get("redirect_uri") &&
            pkcePattern.test(verifier) &&
            tokenHash(verifier) === g.challenge
          );
        }
        const requested = params.get("scope")?.split(/\s+/).filter(Boolean);
        return (
          g.kind === "refresh" &&
          (!requested ||
            (requested.length > 0 &&
              requested.every((s) => g.scopes.includes(s))))
        );
      },
      (g) => {
        grantedScopes =
          kind === "refresh_token" && params.has("scope")
            ? params.get("scope")!.split(/\s+/).filter(Boolean)
            : g.scopes;
        const common = {
          ...g,
          challenge: undefined,
          redirectUri: undefined,
          usedAt: undefined,
          revokedAt: undefined,
          scopes: grantedScopes,
        };
        return [
          {
            ...common,
            hash: tokenHash(access),
            kind: "access",
            expiresAt: new Date(
              Math.min(Date.now() + 900_000, g.familyExpiresAt.getTime()),
            ),
          },
          {
            ...common,
            hash: tokenHash(refresh),
            kind: "refresh",
            expiresAt: g.familyExpiresAt,
          },
        ];
      },
    );
    if (!ok) throw new Error("invalid_grant");
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.max(
        0,
        Math.min(
          900,
          Math.floor((previous.familyExpiresAt.getTime() - Date.now()) / 1000),
        ),
      ),
      refresh_token: refresh,
      scope: grantedScopes.join(" "),
    };
  }
  async authenticate(token: string): Promise<HostedBrowserMcpPrincipal> {
    const g = await this.deps.store.get(tokenHash(token));
    if (
      !g ||
      g.kind !== "access" ||
      g.revokedAt ||
      g.usedAt ||
      g.expiresAt.getTime() <= Date.now() ||
      g.resource !== this.resource ||
      g.clientId !== this.deps.config.cognitoMcpClientId
    )
      throw new Error("invalid_token");
    await this.eligible(g.accountId, g.deviceId, g.epoch);
    const current = await this.deps.accounts.upsertDevice(
      g.accountId,
      `mcp:${g.clientId}`,
      "Codex",
      "hosted-mcp-v1",
      "codex_integration",
      false,
    );
    if (current.revokedAt) throw new Error("invalid_token");
    return {
      accountId: g.accountId,
      clientId: g.clientId,
      scopes: new Set(
        g.scopes
          .filter((s) => this.scopes.includes(s))
          .map((s) => s.slice(this.resource.length + 1)),
      ),
    };
  }
}

export function createMcpOAuthApi(service: McpOAuthService) {
  const { config, web, store } = service.deps;
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 16_384 }));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  const quota = async (c: {
    req: { header(name: string): string | undefined };
  }) => {
    const key = keyedHash(
      config.authQuotaHmacKey,
      `mcp-oauth:${c.req.header("x-forwarded-for") ?? "unknown"}`,
    );
    await web.consumeAuthQuota(key, 300, 60);
  };
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer: service.issuer,
      authorization_endpoint: `${service.issuer}/oauth/authorize`,
      token_endpoint: `${service.issuer}/oauth/token`,
      revocation_endpoint: `${service.issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["openid", ...service.scopes],
      authorization_response_iss_parameter_supported: true,
    }),
  );
  app.get("/oauth/authorize", async (c) => {
    try {
      await quota(c);
      service.parse(
        c.req.query() ? new URL(c.req.url).searchParams : new URLSearchParams(),
      );
      return c.redirect(
        `/app/connect/codex?${new URL(c.req.url).searchParams}`,
        302,
      );
    } catch {
      return c.json(
        {
          error: "invalid_request",
          error_description:
            "Invalid or expired connection request. Restart connection from your MCP client.",
        },
        400,
      );
    }
  });
  app.get("/api/v1/mcp/consent", async (c) => {
    const raw = getCookie(c, "__Host-os_session");
    const session = raw ? await web.session(tokenHash(raw)) : null;
    if (!session) return c.json({ error: "unauthenticated" }, 401);
    try {
      const request = service.parse(new URL(c.req.url).searchParams);
      await service.eligible(session.accountId);
      return c.json({
        clientName: "Codex",
        email: session.email,
        scopes: request.scopes
          .filter((s) => s !== "openid")
          .map((s) => s.slice(service.resource.length + 1)),
        redirectUri: request.redirectUri,
      });
    } catch {
      return c.json(
        {
          error: "access_denied",
          message:
            "This request is invalid, access is not enabled, or the integration was revoked. Your browser session is unchanged.",
        },
        403,
      );
    }
  });
  app.post("/api/v1/mcp/consent", async (c) => {
    const raw = getCookie(c, "__Host-os_session"),
      csrf = getCookie(c, "os_csrf");
    const session = raw ? await web.session(tokenHash(raw)) : null;
    if (!session) return c.json({ error: "unauthenticated" }, 401);
    if (
      c.req.header("origin") !== config.controlOrigin ||
      !csrf ||
      c.req.header("x-os-csrf") !== csrf ||
      tokenHash(csrf) !== session.csrfHash
    )
      return c.json({ error: "csrf_failed" }, 403);
    try {
      await quota(c);
      const body = await c.req.json<{ query: string; decision: string }>();
      if (typeof body.query !== "string" || body.query.length > 8192)
        throw new Error("invalid_request");
      const params = new URLSearchParams(body.query),
        request = service.parse(params);
      if (body.decision === "deny") {
        const url = new URL(request.redirectUri);
        url.searchParams.set("error", "access_denied");
        url.searchParams.set("state", request.state);
        url.searchParams.set("iss", service.issuer);
        return c.json({ redirect: url.toString() });
      }
      if (body.decision !== "allow") throw new Error("invalid_request");
      return c.json({
        redirect: await service.authorize(session.accountId, params),
      });
    } catch {
      return c.json(
        {
          error: "access_denied",
          message:
            "Could not authorize this connection. Restart it from Codex; your website session is unchanged.",
        },
        400,
      );
    }
  });
  app.post("/oauth/token", async (c) => {
    try {
      await quota(c);
      return c.json(
        await service.exchange(new URLSearchParams(await c.req.text())),
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_grant";
      return c.json(
        {
          error: [
            "invalid_request",
            "unsupported_grant_type",
            "invalid_grant",
          ].includes(code)
            ? code
            : "invalid_grant",
        },
        400,
      );
    }
  });
  app.post("/oauth/revoke", async (c) => {
    await quota(c);
    const p = new URLSearchParams(await c.req.text());
    await store.revoke(
      tokenHash(p.get("token") ?? ""),
      p.get("client_id") ?? "",
    );
    return c.body(null, 200);
  });
  return app;
}
