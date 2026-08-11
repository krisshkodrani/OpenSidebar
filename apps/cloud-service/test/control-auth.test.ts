import assert from "node:assert/strict";
import { test } from "node:test";
import type { CloudConfig } from "../src/config.js";
import { ControlAuthError, ControlAuthService } from "../src/control-auth.js";
import { tokenHash } from "../src/crypto.js";
import { MemoryControlRepository } from "./memory-control-repository.js";

const config: CloudConfig = {
  port: 8787,
  databaseUrl: "postgresql://unused/db",
  controlDatabaseUrl: "postgresql://unused/db",
  controlOrigin: "https://opensidebar.com",
  targetOrigin: "https://play.opensidebar.com",
  cookieSecure: true,
  awsRegion: "eu-central-1",
  authQuotaHmacKey: "test",
  cloudControlEnabled: true,
  extensionAuthEnabled: true,
  credentialWritesEnabled: false,
  relayEnabled: false,
  preferenceWritesEnabled: false,
  cloudSessionsEnabled: false,
  checkpointWritesEnabled: false,
  checkpointRestoreEnabled: false,
  deviceCommandsEnabled: false,
  deviceTakeoverEnabled: false,
  temporalShadowEnabled: false,
  temporalCoordinationEnabled: false,
  extensionId: "abcdefghijklmnopabcdefghijklmnop",
  extensionClientId: "client",
  cognitoDomain: "https://auth.example.com",
  cloudTesterSubjects: new Set(["account-1"]),
  cloudSessionTesterSubjects: new Set(["account-1"]),
  cloudOperatorSubjects: new Set(),
  relayModelAllowlist: new Set(),
};

test("link sign-in issues opaque device tokens and detects refresh reuse", async () => {
  const repository = new MemoryControlRepository();
  await repository.upsertAccount("account-1", "owner@example.com", true);
  await repository.createDeviceLink(
    tokenHash("ABCDEFGH"),
    "account-1",
    new Date(Date.now() + 60_000),
  );
  const auth = new ControlAuthService(repository, config);
  const initial = await auth.link({
    code: "abcdefgh",
    installationId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
    displayName: "Chrome",
    extensionVersion: "0.7.0",
  });
  assert.notEqual(initial.accessToken, initial.refreshToken);
  assert.equal(initial.account.accountId, "account-1");
  assert.equal(
    initial.device.installationId,
    "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
  );
  const rotated = await auth.refresh(initial.refreshToken);
  assert.notEqual(rotated.refreshToken, initial.refreshToken);
  await assert.rejects(
    auth.refresh(initial.refreshToken),
    (error: unknown) =>
      error instanceof ControlAuthError && error.code === "refresh_reused",
  );
  await assert.rejects(
    auth.refresh(rotated.refreshToken),
    (error: unknown) =>
      error instanceof ControlAuthError && error.code === "refresh_reused",
  );
});

test("direct extension exchange enforces the pinned chromiumapp PKCE callback", async () => {
  const repository = new MemoryControlRepository();
  const auth = new ControlAuthService(repository, config);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    if (String(input) === "https://auth.example.com/oauth2/token") {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("code_verifier"), "verifier-value");
      assert.equal(
        body.get("redirect_uri"),
        "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/opensidebar",
      );
      return new Response(JSON.stringify({ access_token: "cognito-access" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(String(input), "https://auth.example.com/oauth2/userInfo");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer cognito-access",
    );
    return new Response(
      JSON.stringify({ sub: "account-1", email: "OWNER@EXAMPLE.COM" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const session = await auth.exchange({
      code: "authorization-code",
      codeVerifier: "verifier-value",
      redirectUri:
        "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/opensidebar",
      installationId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
      displayName: "Chrome",
      extensionVersion: "0.7.0",
    });
    assert.equal(session.account.email, "owner@example.com");
    assert.equal(calls, 2);
    await assert.rejects(
      auth.exchange({
        code: "authorization-code",
        codeVerifier: "verifier-value",
        redirectUri: "https://attacker.invalid/callback",
        installationId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
        displayName: "Chrome",
        extensionVersion: "0.7.0",
      }),
      (error: unknown) =>
        error instanceof ControlAuthError &&
        error.code === "invalid_auth_request",
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removing a tester immediately blocks refresh and device linking", async () => {
  const cloudTesterSubjects = new Set(["account-1"]);
  const activeConfig = { ...config, cloudTesterSubjects };
  const repository = new MemoryControlRepository();
  await repository.upsertAccount("account-1", "owner@example.com", true);
  await repository.createDeviceLink(
    tokenHash("ABCDEFGH"),
    "account-1",
    new Date(Date.now() + 60_000),
  );
  const auth = new ControlAuthService(repository, activeConfig);
  const initial = await auth.link({
    code: "ABCDEFGH",
    installationId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
    displayName: "Chrome",
    extensionVersion: "0.7.2",
  });
  cloudTesterSubjects.clear();
  await assert.rejects(
    auth.refresh(initial.refreshToken),
    (error: unknown) =>
      error instanceof ControlAuthError &&
      error.code === "cloud_access_not_enabled",
  );
  await repository.createDeviceLink(
    tokenHash("BCDEFGHJ"),
    "account-1",
    new Date(Date.now() + 60_000),
  );
  await assert.rejects(
    auth.link({
      code: "BCDEFGHJ",
      installationId: "50d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
      displayName: "Chrome",
      extensionVersion: "0.7.2",
    }),
    (error: unknown) =>
      error instanceof ControlAuthError &&
      error.code === "cloud_access_not_enabled",
  );
});
