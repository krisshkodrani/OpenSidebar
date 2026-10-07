import assert from "node:assert/strict";
import test from "node:test";
import { McpOAuthService, createMcpOAuthApi } from "../src/mcp-oauth.js";
import { tokenHash, opaqueToken } from "../src/crypto.js";
import type { McpGrant, McpOAuthStore } from "../src/mcp-oauth-store.js";

class MemoryStore implements McpOAuthStore {
  rows = new Map<string, McpGrant>();
  async put(g: McpGrant) {
    this.rows.set(g.hash, g);
  }
  async get(h: string) {
    return this.rows.get(h) ?? null;
  }
  async exchange(
    h: string,
    valid: (g: McpGrant) => boolean,
    issue: (g: McpGrant) => McpGrant[],
  ) {
    const g = this.rows.get(h);
    if (!g || !valid(g) || g.revokedAt || g.expiresAt.getTime() <= Date.now())
      return false;
    if (g.usedAt) {
      await this.revoke(h, g.clientId);
      return false;
    }
    g.usedAt = new Date();
    for (const n of issue(g)) this.rows.set(n.hash, n);
    return true;
  }
  async revoke(h: string, c: string) {
    const g = this.rows.get(h);
    if (g?.clientId === c)
      for (const n of this.rows.values())
        if (n.family === g.family) n.revokedAt = new Date();
  }
}
function world() {
  const store = new MemoryStore();
  let epoch = 1,
    revoked = false,
    signedIn = true;
  const verifier = opaqueToken(48),
    session = opaqueToken(),
    csrf = opaqueToken();
  const account = {
    accountId: "a",
    email: "owner@example.test",
    cloudAccess: true,
    sessionEpoch: epoch,
  };
  const device = {
    id: "d",
    installationId: "mcp:codex",
    connectionKind: "codex_integration",
  };
  const service = new McpOAuthService({
    store,
    config: {
      controlOrigin: "https://opensidebar.com",
      cognitoMcpClientId: "codex",
      cloudSessionTesterSubjects: new Set(["a"]),
      authQuotaHmacKey: "test",
    } as never,
    accounts: {
      upsertDevice: async () => device,
      account: async () => ({ ...account, sessionEpoch: epoch }),
      listDevices: async () => [
        {
          ...device,
          ...(revoked ? { revokedAt: new Date().toISOString() } : {}),
        },
      ],
    } as never,
    web: {
      session: async (h: string) =>
        signedIn && h === tokenHash(session)
          ? { accountId: "a", email: account.email, csrfHash: tokenHash(csrf) }
          : null,
      consumeAuthQuota: async () => {},
    } as never,
  });
  const params = new URLSearchParams({
    client_id: "codex",
    redirect_uri: "http://localhost:1455/auth/callback/3MqMAmAkMrwa",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: tokenHash(verifier),
    state: opaqueToken(),
    scope: service.scopes.join(" "),
    resource: service.resource,
  });
  async function code() {
    return new URL(await service.authorize("a", params)).searchParams.get(
      "code",
    )!;
  }
  const exchange = (code: string) =>
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "codex",
      redirect_uri: params.get("redirect_uri")!,
      resource: service.resource,
      code_verifier: verifier,
    });
  return {
    service,
    store,
    params,
    code,
    exchange,
    csrf,
    session,
    setRevoked: () => {
      revoked = true;
    },
    setEpoch: () => {
      epoch++;
    },
    signOut: () => {
      signedIn = false;
    },
  };
}
test("existing website session reaches consent without login; consent requires CSRF", async () => {
  const w = world(),
    app = createMcpOAuthApi(w.service);
  const start = await app.request(
    `https://opensidebar.com/oauth/authorize?${w.params}`,
  );
  assert.equal(start.status, 302);
  assert.match(start.headers.get("location")!, /^\/app\/connect\/codex\?/);
  const headers = {
    cookie: `__Host-os_session=${w.session}; os_csrf=${w.csrf}`,
    origin: "https://opensidebar.com",
    "content-type": "application/json",
  };
  const details = await app.request(
    `https://opensidebar.com/api/v1/mcp/consent?${w.params}`,
    { headers },
  );
  assert.equal(details.status, 200);
  assert.equal((await details.json()).email, "owner@example.test");
  const body = JSON.stringify({
    query: w.params.toString(),
    decision: "allow",
  });
  assert.equal(
    (
      await app.request("https://opensidebar.com/api/v1/mcp/consent", {
        method: "POST",
        headers,
        body,
      })
    ).status,
    403,
  );
  const allowed = await app.request(
    "https://opensidebar.com/api/v1/mcp/consent",
    { method: "POST", headers: { ...headers, "x-os-csrf": w.csrf }, body },
  );
  assert.equal(allowed.status, 200);
  const url = new URL((await allowed.json()).redirect);
  assert.equal(url.searchParams.get("iss"), "https://opensidebar.com");
  w.signOut();
  assert.equal(
    (
      await app.request(
        `https://opensidebar.com/api/v1/mcp/consent?${w.params}`,
        { headers },
      )
    ).status,
    401,
  );
});
test("rejects foreign callbacks, scope expansion, duplicate parameters and plain PKCE", () => {
  const w = world();
  for (const [k, v] of [
    ["redirect_uri", "https://evil.test"],
    ["scope", "admin"],
    ["code_challenge_method", "plain"],
    ["resource", "https://other.test"],
  ]) {
    const p = new URLSearchParams(w.params);
    p.set(k, v);
    assert.throws(() => w.service.parse(p));
  }
  const dup = new URLSearchParams(w.params);
  dup.append("resource", w.service.resource);
  assert.throws(() => w.service.parse(dup));
});
test("PKCE and resource binding; code scope cannot expand at exchange", async () => {
  const w = world(),
    c = await w.code(),
    p = w.exchange(c);
  p.set("code_verifier", opaqueToken(48));
  await assert.rejects(w.service.exchange(p));
  p.set("code_verifier", w.exchange(c).get("code_verifier")!);
  p.set("resource", "https://other.test");
  await assert.rejects(w.service.exchange(p));
  p.set("resource", w.service.resource);
  p.set("scope", "admin");
  const tokens = await w.service.exchange(p);
  assert.equal(tokens.scope, w.service.scopes.join(" "));
  assert.equal(
    (await w.service.authenticate(tokens.access_token)).accountId,
    "a",
  );
  await assert.rejects(w.service.exchange(p));
  await assert.rejects(w.service.authenticate(tokens.access_token));
});
test("refresh rotates and replay revokes the family; expiry and integration revocation are enforced", async () => {
  const w = world(),
    first = await w.service.exchange(w.exchange(await w.code()));
  const refresh = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: first.refresh_token,
    client_id: "codex",
    resource: w.service.resource,
  });
  const next = await w.service.exchange(refresh);
  assert.notEqual(first.refresh_token, next.refresh_token);
  await assert.rejects(w.service.exchange(refresh));
  await assert.rejects(w.service.authenticate(next.access_token));
  for (const mode of ["revoke", "epoch", "expiry"]) {
    const x = world(),
      t = await x.service.exchange(x.exchange(await x.code()));
    if (mode === "revoke") x.setRevoked();
    if (mode === "epoch") x.setEpoch();
    if (mode === "expiry")
      (await x.store.get(tokenHash(t.access_token)))!.expiresAt = new Date(0);
    await assert.rejects(x.service.authenticate(t.access_token));
  }
});
test("cancel returns an OAuth denial and does not mint credentials", async () => {
  const w = world(),
    app = createMcpOAuthApi(w.service);
  const r = await app.request("https://opensidebar.com/api/v1/mcp/consent", {
    method: "POST",
    headers: {
      cookie: `__Host-os_session=${w.session}; os_csrf=${w.csrf}`,
      origin: "https://opensidebar.com",
      "x-os-csrf": w.csrf,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: w.params.toString(), decision: "deny" }),
  });
  assert.equal(
    new URL((await r.json()).redirect).searchParams.get("error"),
    "access_denied",
  );
  assert.equal(w.store.rows.size, 0);
});
