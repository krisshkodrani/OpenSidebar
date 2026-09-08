import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CloudConfig } from "./config.js";
import type { ControlRepository } from "./control-repository.js";
import { keyedHash } from "./crypto.js";
import type { PlaygroundRepository } from "./repository.js";
import {
  buildHostedBrowserMcpServer,
  type HostedBrowserMcpOperations,
  type HostedBrowserMcpPrincipal,
} from "./hosted-browser-mcp.js";

type Dependencies = {
  config: CloudConfig;
  accounts: ControlRepository;
  operations: HostedBrowserMcpOperations;
  quota: Pick<PlaygroundRepository, "consumeAuthQuota">;
  fetch?: typeof fetch;
};

const expectedScopes = new Set([
  "browser.devices.read",
  "browser.tasks.create",
  "browser.tasks.read",
  "browser.tasks.continue",
  "browser.tasks.approve",
  "browser.tasks.cancel",
]);
const MAX_BEARER_TOKEN_LENGTH = 16_384;
const USER_INFO_TIMEOUT_MS = 5_000;
const MCP_SESSION_IDLE_MS = 30 * 60_000;
const MAX_MCP_SESSIONS = 1_000;
const quotaPolicies = {
  create: { windowSeconds: 3_600, limit: 30 },
  poll: { windowSeconds: 300, limit: 600 },
  mutate: { windowSeconds: 3_600, limit: 120 },
} as const;

const withAccountQuotas = (
  deps: Dependencies,
  principal: HostedBrowserMcpPrincipal,
): HostedBrowserMcpOperations => {
  const consume = async (bucket: keyof typeof quotaPolicies) => {
    const policy = quotaPolicies[bucket];
    const accountHash = keyedHash(
      deps.config.authQuotaHmacKey,
      `mcp-account:${principal.accountId}`,
    );
    try {
      await deps.quota.consumeAuthQuota(
        `mcp:${bucket}:${accountHash}`,
        policy.windowSeconds,
        policy.limit,
      );
    } catch (error) {
      if ((error as { code?: string }).code === "auth_rate_limit")
        throw new Error(`mcp_${bucket}_quota_exceeded`);
      throw error;
    }
  };
  return {
    async listDevices(value) { await consume("poll"); return deps.operations.listDevices(value); },
    async startTask(value, input) { await consume("create"); return deps.operations.startTask(value, input); },
    async getTask(value, input) { await consume("poll"); return deps.operations.getTask(value, input); },
    async continueTask(value, input) { await consume("mutate"); return deps.operations.continueTask(value, input); },
    async respondApproval(value, input) { await consume("mutate"); return deps.operations.respondApproval(value, input); },
    async cancelTask(value, input) { await consume("mutate"); return deps.operations.cancelTask(value, input); },
  };
};

const decodePayload = (token: string) => {
  const encoded = token.split(".")[1];
  if (!encoded) throw new Error("invalid_token");
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_token");
  }
};

export async function authenticateHostedMcp(
  deps: Dependencies,
  authorization: string | undefined,
): Promise<HostedBrowserMcpPrincipal> {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/)?.[1];
  const resource = `${deps.config.controlOrigin}/mcp`;
  if (
    !token ||
    token.length > MAX_BEARER_TOKEN_LENGTH ||
    !deps.config.cognitoDomain ||
    !deps.config.cognitoIssuer ||
    !deps.config.cognitoMcpClientId
  )
    throw new Error("unauthenticated");
  const response = await (deps.fetch ?? fetch)(
    new URL("/oauth2/userInfo", deps.config.cognitoDomain),
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error("unauthenticated");
  const user = await response.json() as { sub?: string; email?: string };
  const claims = decodePayload(token);
  if (
    typeof user.sub !== "string" ||
    claims.sub !== user.sub ||
    claims.client_id !== deps.config.cognitoMcpClientId ||
    claims.iss !== deps.config.cognitoIssuer ||
    claims.aud !== resource ||
    claims.token_use !== "access" ||
    typeof claims.scope !== "string"
  ) throw new Error("invalid_token");
  const account = await deps.accounts.account(user.sub);
  if (
    !account?.cloudAccess ||
    !deps.config.cloudSessionTesterSubjects.has(user.sub)
  ) throw new Error("mcp_access_not_enabled");
  const prefix = deps.config.mcpScopePrefix ?? `${deps.config.controlOrigin}/mcp/`;
  const scopes = new Set(
    claims.scope
      .split(/\s+/)
      .filter((scope): scope is string => scope.startsWith(prefix))
      .map((scope) => scope.slice(prefix.length))
      .filter((scope) => expectedScopes.has(scope)),
  );
  if (!scopes.size) throw new Error("insufficient_scope");

  const installationId = `mcp:${deps.config.cognitoMcpClientId}`;
  const existing = (await deps.accounts.listDevices(user.sub)).find(
    (device) =>
      device.installationId === installationId &&
      device.connectionKind === "codex_integration",
  );
  if (existing?.revokedAt) throw new Error("integration_revoked");
  const integration = await deps.accounts.upsertDevice(
    user.sub,
    installationId,
    "Codex",
    "hosted-mcp-v1",
    "codex_integration",
    false,
  );
  if (integration.revokedAt) throw new Error("integration_revoked");
  return { accountId: user.sub, clientId: deps.config.cognitoMcpClientId, scopes };
}

export function createHostedBrowserMcpApi(deps: Dependencies) {
  const app = new Hono();
  const sessions = new Map<string, {
    accountId: string;
    clientId: string;
    lastSeenAt: number;
    transport: WebStandardStreamableHTTPServerTransport;
  }>();
  const discardSession = async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    await session.transport.close().catch(() => undefined);
  };
  const pruneSessions = async () => {
    const expiredBefore = Date.now() - MCP_SESSION_IDLE_MS;
    for (const [sessionId, session] of sessions)
      if (session.lastSeenAt < expiredBefore) await discardSession(sessionId);
    while (sessions.size >= MAX_MCP_SESSIONS) {
      const oldest = [...sessions.entries()].sort(
        ([, left], [, right]) => left.lastSeenAt - right.lastSeenAt,
      )[0]?.[0];
      if (!oldest) break;
      await discardSession(oldest);
    }
  };
  const resource = `${deps.config.controlOrigin}/mcp`;
  const metadata = `${deps.config.controlOrigin}/.well-known/oauth-protected-resource/mcp`;
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json({
    resource,
    authorization_servers: [deps.config.cognitoIssuer],
    scopes_supported: [
      "openid",
      ...[...expectedScopes].map(
        (scope) => `${deps.config.mcpScopePrefix ?? `${deps.config.controlOrigin}/mcp/`}${scope}`,
      ),
    ],
    bearer_methods_supported: ["header"],
    resource_documentation: `${deps.config.controlOrigin}/docs/hosted-browser`,
  }));
  app.all("/mcp", async (c) => {
    let principal: HostedBrowserMcpPrincipal;
    try {
      principal = await authenticateHostedMcp(deps, c.req.header("authorization"));
    } catch {
      c.header(
        "WWW-Authenticate",
        `Bearer realm="opensidebar-mcp", resource_metadata="${metadata}"`,
      );
      return c.json({ error: "unauthorized" }, 401);
    }
    await pruneSessions();
    const requestedSessionId = c.req.header("mcp-session-id");
    if (requestedSessionId) {
      const session = sessions.get(requestedSessionId);
      if (
        !session ||
        session.accountId !== principal.accountId ||
        session.clientId !== principal.clientId
      ) return c.json({ error: "mcp_session_not_found" }, 404);
      session.lastSeenAt = Date.now();
      return session.transport.handleRequest(c.req.raw);
    }
    let transport: WebStandardStreamableHTTPServerTransport;
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, {
          accountId: principal.accountId,
          clientId: principal.clientId,
          lastSeenAt: Date.now(),
          transport,
        });
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });
    const server = buildHostedBrowserMcpServer(
      withAccountQuotas(deps, principal),
      principal,
    );
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    if (!transport.sessionId) await transport.close().catch(() => undefined);
    return response;
  });
  return app;
}
