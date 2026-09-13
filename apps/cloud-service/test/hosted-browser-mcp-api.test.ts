import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticateHostedMcp,
  createHostedBrowserMcpApi,
} from "../src/hosted-browser-mcp-api.js";

const token = (claims: Record<string, unknown>) =>
  `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

function world(revoked = false) {
  const quotas: string[] = [];
  const devices: Array<Record<string, unknown>> = revoked
    ? [{
        id: "dev_codex",
        installationId: "mcp:mcp-client",
        connectionKind: "codex_integration",
        revokedAt: new Date().toISOString(),
      }]
    : [];
  const accounts = {
    async account(accountId: string) {
      return accountId === "account-1"
        ? { accountId, email: "owner@example.test", sessionEpoch: 1, cloudAccess: true }
        : null;
    },
    async listDevices() { return devices; },
    async upsertDevice(
      _accountId: string,
      installationId: string,
      displayName: string,
      extensionVersion: string,
      connectionKind: string,
    ) {
      const prior = devices.find((device) => device.installationId === installationId);
      if (prior) return prior;
      const value = {
        schemaVersion: 1,
        id: "dev_codex",
        installationId,
        displayName,
        displayNameRevision: 1,
        extensionVersion,
        connectionKind,
        availability: "online",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      devices.push(value);
      return value;
    },
  };
  const config = {
    controlOrigin: "https://opensidebar.com",
    authQuotaHmacKey: "test-mcp-quota-key",
    cognitoDomain: "https://auth.opensidebar.test",
    cognitoIssuer: "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_TEST",
    cognitoMcpClientId: "mcp-client",
    mcpScopePrefix: "opensidebar/",
    cloudSessionTesterSubjects: new Set(["account-1"]),
  };
  const fetchUser = async () => new Response(JSON.stringify({
    sub: "account-1",
    email: "owner@example.test",
  }), { status: 200, headers: { "content-type": "application/json" } });
  const quota = {
    async consumeAuthQuota(subject: string) { quotas.push(subject); },
  };
  return { accounts, config, fetchUser, devices, quota, quotas };
}

test("validates the dedicated MCP client and maps only MCP scopes", async () => {
  const state = world();
  const accessToken = token({
    sub: "account-1",
    client_id: "mcp-client",
    iss: state.config.cognitoIssuer,
    aud: `${state.config.controlOrigin}/mcp`,
    token_use: "access",
    scope: "openid opensidebar/browser.devices.read opensidebar/browser.tasks.read unrelated",
  });
  const principal = await authenticateHostedMcp({
    config: state.config as never,
    accounts: state.accounts as never,
    operations: {} as never,
    quota: state.quota as never,
    fetch: state.fetchUser,
  }, `Bearer ${accessToken}`);
  assert.deepEqual([...principal.scopes], ["browser.devices.read", "browser.tasks.read"]);
  assert.equal(state.devices[0]?.connectionKind, "codex_integration");
});

test("rejects extension-client tokens and locally revoked integrations", async () => {
  for (const [state, clientId, message] of [
    [world(), "extension-client", "invalid_token"],
    [world(true), "mcp-client", "integration_revoked"],
  ] as const) {
    const accessToken = token({
      sub: "account-1",
      client_id: clientId,
      iss: state.config.cognitoIssuer,
      aud: `${state.config.controlOrigin}/mcp`,
      token_use: "access",
      scope: "opensidebar/browser.devices.read",
    });
    await assert.rejects(
      () => authenticateHostedMcp({
        config: state.config as never,
        accounts: state.accounts as never,
        operations: {} as never,
        quota: state.quota as never,
        fetch: state.fetchUser,
      }, `Bearer ${accessToken}`),
      new RegExp(message),
    );
  }
});

test("publishes protected-resource metadata and rejects cookie-only MCP requests", async () => {
  const state = world();
  const app = createHostedBrowserMcpApi({
    config: state.config as never,
    accounts: state.accounts as never,
    operations: {} as never,
    quota: state.quota as never,
    fetch: state.fetchUser,
  });
  const metadata = await app.request("/.well-known/oauth-protected-resource/mcp");
  assert.equal(metadata.status, 200);
  assert.deepEqual((await metadata.json() as { authorization_servers: string[] }).authorization_servers, [
    state.config.cognitoIssuer,
  ]);
  const unauthorized = await app.request("/mcp", {
    method: "POST",
    headers: { cookie: "opensidebar_session=website-session" },
  });
  assert.equal(unauthorized.status, 401);
  assert.match(
    unauthorized.headers.get("www-authenticate") ?? "",
    /oauth-protected-resource\/mcp/,
  );
});

test("serves an authenticated Streamable HTTP initialize response", async () => {
  const state = world();
  const app = createHostedBrowserMcpApi({
    config: state.config as never,
    accounts: state.accounts as never,
    operations: {
      async listDevices() { return { devices: [] }; },
      async startTask() { return {}; },
      async getTask() { return {}; },
      async continueTask() { return {}; },
      async respondApproval() { return {}; },
      async cancelTask() { return {}; },
    },
    quota: state.quota as never,
    fetch: state.fetchUser,
  });
  const accessToken = token({
    sub: "account-1",
    client_id: "mcp-client",
    iss: state.config.cognitoIssuer,
    aud: `${state.config.controlOrigin}/mcp`,
    token_use: "access",
    scope: [
      "opensidebar/browser.devices.read",
      "opensidebar/browser.tasks.create",
      "opensidebar/browser.tasks.read",
    ].join(" "),
  });
  const response = await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex-like", version: "1.0.0" },
      },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { result?: { serverInfo?: { name?: string } } };
  assert.equal(body.result?.serverInfo?.name, "opensidebar");
  const sessionId = response.headers.get("mcp-session-id") ?? "";
  assert.match(sessionId, /^[0-9a-f-]{36}$/);
  const closed = await app.request("/mcp", {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "mcp-protocol-version": "2025-06-18",
      "mcp-session-id": sessionId,
    },
  });
  assert.equal(closed.status, 200);
});

test("enforces separate per-account creation, polling, and mutation quotas", async () => {
  const state = world();
  const app = createHostedBrowserMcpApi({
    config: state.config as never,
    accounts: state.accounts as never,
    operations: {
      async listDevices() { return { devices: [] }; },
      async startTask() { return { missionId: crypto.randomUUID() }; },
      async getTask() { return {}; },
      async continueTask() { return {}; },
      async respondApproval() { return {}; },
      async cancelTask() { return {}; },
    },
    quota: state.quota as never,
    fetch: state.fetchUser,
  });
  const accessToken = token({
    sub: "account-1",
    client_id: "mcp-client",
    iss: state.config.cognitoIssuer,
    aud: `${state.config.controlOrigin}/mcp`,
    token_use: "access",
    scope: [
      "opensidebar/browser.devices.read",
      "opensidebar/browser.tasks.create",
      "opensidebar/browser.tasks.read",
      "opensidebar/browser.tasks.cancel",
    ].join(" "),
  });
  const initialized = await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex-like", version: "1.0.0" },
      },
    }),
  });
  const sessionId = initialized.headers.get("mcp-session-id");
  assert.ok(sessionId);
  const ready = await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.equal(ready.status, 202);
  const call = (name: string, args: Record<string, unknown>) => app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: args } }),
  });
  const responses = [
    await call("browser_list_devices", {}),
    await call("browser_start_task", { requestId: "request-1", objective: "Read", successCriteria: ["Return heading"] }),
    await call("browser_cancel_task", { missionId: crypto.randomUUID() }),
  ];
  const bodies: string[] = [];
  for (const response of responses) {
    bodies.push(await response.text());
    assert.equal(response.status, 200, bodies.at(-1));
  }
  assert.equal(state.quotas.some((value) => value.startsWith("mcp:poll:")), true, bodies.join("\n"));
  assert.equal(state.quotas.some((value) => value.startsWith("mcp:create:")), true);
  assert.equal(state.quotas.some((value) => value.startsWith("mcp:mutate:")), true);
  assert.equal(state.quotas.some((value) => value.includes("account-1")), false);
  const closed = await app.request("/mcp", {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "mcp-protocol-version": "2025-06-18",
      "mcp-session-id": sessionId,
    },
  });
  assert.equal(closed.status, 200);
});
