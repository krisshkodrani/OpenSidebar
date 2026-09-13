import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "../../../cloud-service/src/app";
import type { CloudConfig } from "../../../cloud-service/src/config";
import { ControlAuthService } from "../../../cloud-service/src/control-auth";
import { tokenHash } from "../../../cloud-service/src/crypto";
import type { PlaygroundRepository } from "../../../cloud-service/src/repository";
import { MemoryControlRepository } from "../../../cloud-service/test/memory-control-repository";
import { MemoryDeviceCoordinationRepository } from "../../../cloud-service/test/memory-device-coordination-repository";
import { MemorySessionRepository } from "../../../cloud-service/test/memory-session-repository";
import {
  closeExtension,
  launchWithExtension,
  openHelperPage,
  reloadExtension,
  type ExtensionContext,
} from "./helpers/browser";

type ApiResult<T = Record<string, unknown>> = {
  status: number;
  body: T;
};

describe("E2E: two-profile cloud device takeover", () => {
  let profileA: ExtensionContext;
  let profileB: ExtensionContext;
  let server: ServerType;
  let baseUrl: string;
  const repository = new MemoryControlRepository();
  const sessions = new MemorySessionRepository();
  const coordination = new MemoryDeviceCoordinationRepository();

  beforeAll(async () => {
    profileA = await launchWithExtension();
    profileB = await launchWithExtension();
    expect(profileB.extensionId).toBe(profileA.extensionId);
    const config: CloudConfig = {
      port: 0,
      databaseUrl: "postgresql://unused/db",
      controlDatabaseUrl: "postgresql://unused/db",
      controlOrigin: "https://opensidebar.com",
      targetOrigin: "https://play.opensidebar.com",
      cookieSecure: true,
      awsRegion: "eu-central-1",
      authQuotaHmacKey: "two-profile-e2e-auth-key",
      cloudControlEnabled: true,
      extensionAuthEnabled: true,
      credentialWritesEnabled: false,
      relayEnabled: false,
      preferenceWritesEnabled: false,
      cloudSessionsEnabled: true,
      checkpointWritesEnabled: false,
      checkpointRestoreEnabled: false,
      deviceCommandsEnabled: true,
      deviceTakeoverEnabled: true,
      temporalShadowEnabled: false,
      temporalCoordinationEnabled: false,
      extensionId: profileA.extensionId,
      extensionClientId: "two-profile-e2e-client",
      cognitoDomain: "https://auth.example.com",
      cognitoClientId: "two-profile-e2e-web-client",
      cloudTesterSubjects: new Set(["two-profile-account"]),
      relayModelAllowlist: new Set(),
    };
    const auth = new ControlAuthService(repository, config);
    const playground = {
      session: async () => null,
      health: async () => undefined,
      consumeAuthQuota: async () => undefined,
      createAuthFlow: async () => undefined,
    } as unknown as PlaygroundRepository;
    const app = createApp(playground, config, undefined, {
      repository,
      sessionRepository: sessions,
      coordinationRepository: coordination,
      auth,
    });
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("two_profile_server_address_unavailable");
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  }, 60_000);

  afterAll(async () => {
    await Promise.all([
      profileA ? closeExtension(profileA) : Promise.resolve(),
      profileB ? closeExtension(profileB) : Promise.resolve(),
    ]);
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  });

  test("profile B explicitly takes over and fences profile A", async () => {
    await repository.upsertAccount(
      "two-profile-account",
      "two-profile@example.com",
      true,
    );
    await repository.createDeviceLink(
      tokenHash("PROFILEA"),
      "two-profile-account",
      new Date(Date.now() + 60_000),
    );
    await repository.createDeviceLink(
      tokenHash("PROFILEB"),
      "two-profile-account",
      new Date(Date.now() + 60_000),
    );
    const helperA = await openHelperPage(profileA);
    const helperB = await openHelperPage(profileB);

    const link = async (
      helper: typeof helperA,
      code: string,
      installationId: string,
    ) =>
      helper.evaluate(
        async (input): Promise<ApiResult<{ accessToken: string }>> => {
          const response = await fetch(`${input.baseUrl}/extension/auth/link`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              code: input.code,
              installationId: input.installationId,
              displayName: input.displayName,
              extensionVersion: chrome.runtime.getManifest().version,
            }),
          });
          return { status: response.status, body: await response.json() };
        },
        {
          baseUrl,
          code,
          installationId,
          displayName: code === "PROFILEA" ? "Profile A" : "Profile B",
        },
      );
    const linkedA = await link(
      helperA,
      "PROFILEA",
      "28ebccff-eb08-4ca7-a917-c33d22960b8e",
    );
    const linkedB = await link(
      helperB,
      "PROFILEB",
      "44f6333d-d4f7-4247-b6cc-d5310ec42ddd",
    );
    expect(linkedA.status).toBe(201);
    expect(linkedB.status).toBe(201);

    const devices = [...repository.devices.values()];
    const deviceA = devices.find(
      (device) => device.installationId === "28ebccff-eb08-4ca7-a917-c33d22960b8e",
    )!;
    const deviceB = devices.find(
      (device) => device.installationId === "44f6333d-d4f7-4247-b6cc-d5310ec42ddd",
    )!;
    const api = async <T>(
      helper: typeof helperA,
      token: string,
      path: string,
      method: string,
      body: Record<string, unknown>,
      key: string,
    ) =>
      helper.evaluate(
        async (input): Promise<ApiResult<T>> => {
          const response = await fetch(`${input.baseUrl}${input.path}`, {
            method: input.method,
            headers: {
              authorization: `Bearer ${input.token}`,
              "content-type": "application/json",
              "idempotency-key": input.key,
            },
            body: JSON.stringify(input.body),
          });
          return {
            status: response.status,
            body: (await response.json()) as T,
          };
        },
        { baseUrl, token, path, method, body, key },
      );

    const connectionA = await api<{ connectionId: string }>(
      helperA,
      linkedA.body.accessToken,
      `/devices/${deviceA.id}/connections`,
      "POST",
      { schemaVersion: 1, transport: "long_poll" },
      "profile-a-connection-0001",
    );
    const session = await api<{ sessionId: string; revision: number }>(
      helperA,
      linkedA.body.accessToken,
      "/sessions",
      "POST",
      {
        schemaVersion: 1,
        title: "Two-profile takeover",
        mode: "cloud_checkpointed",
        runtimeVersion: "0.7.2",
      },
      "profile-a-session-0001",
    );
    const leaseA = await api<{ leaseId: string; generation: number }>(
      helperA,
      linkedA.body.accessToken,
      `/sessions/${session.body.sessionId}/lease`,
      "POST",
      {
        schemaVersion: 1,
        connectionId: connectionA.body.connectionId,
        expectedSessionRevision: session.body.revision,
      },
      "profile-a-lease-0001",
    );
    expect(leaseA.body.generation).toBe(1);

    await helperA.evaluate(() =>
      chrome.storage.local.set({ "e2e-reconnect-marker": "preserved" }),
    );
    await reloadExtension(profileA);
    const restartedHelperA = await openHelperPage(profileA);
    expect(
      await restartedHelperA.evaluate(async () =>
        (await chrome.storage.local.get("e2e-reconnect-marker"))[
          "e2e-reconnect-marker"
        ],
      ),
    ).toBe("preserved");
    const reconnectedA = await api<{ connectionId: string }>(
      restartedHelperA,
      linkedA.body.accessToken,
      `/devices/${deviceA.id}/connections`,
      "POST",
      { schemaVersion: 1, transport: "long_poll" },
      "profile-a-connection-0002",
    );
    const renewedA = await api<{ leaseId: string; generation: number }>(
      restartedHelperA,
      linkedA.body.accessToken,
      `/sessions/${session.body.sessionId}/lease/reconnect`,
      "POST",
      {
        schemaVersion: 1,
        connectionId: reconnectedA.body.connectionId,
        leaseId: leaseA.body.leaseId,
        generation: leaseA.body.generation,
      },
      "profile-a-reconnect-0001",
    );
    expect(renewedA.body).toMatchObject({
      leaseId: leaseA.body.leaseId,
      generation: 1,
    });
    const replacedConnectionHeartbeat = await api<Record<string, unknown>>(
      restartedHelperA,
      linkedA.body.accessToken,
      `/sessions/${session.body.sessionId}/lease/heartbeat`,
      "POST",
      {
        schemaVersion: 1,
        connectionId: connectionA.body.connectionId,
        leaseId: leaseA.body.leaseId,
        generation: leaseA.body.generation,
      },
      "profile-a-replaced-connection-heartbeat-0001",
    );
    expect(replacedConnectionHeartbeat.status).toBe(409);

    const connectionB = await api<{ connectionId: string }>(
      helperB,
      linkedB.body.accessToken,
      `/devices/${deviceB.id}/connections`,
      "POST",
      { schemaVersion: 1, transport: "long_poll" },
      "profile-b-connection-0001",
    );
    const takeover = await api<{
      leaseId: string;
      deviceId: string;
      generation: number;
    }>(
      helperB,
      linkedB.body.accessToken,
      `/sessions/${session.body.sessionId}/lease/takeover`,
      "POST",
      {
        schemaVersion: 1,
        connectionId: connectionB.body.connectionId,
        leaseId: leaseA.body.leaseId,
        generation: leaseA.body.generation,
        expectedSessionRevision: session.body.revision,
      },
      "profile-b-takeover-0001",
    );
    expect(takeover.status).toBe(200);
    expect(takeover.body).toMatchObject({
      deviceId: deviceB.id,
      generation: 2,
    });

    const staleHeartbeat = await api<Record<string, unknown>>(
      helperA,
      linkedA.body.accessToken,
      `/sessions/${session.body.sessionId}/lease/heartbeat`,
      "POST",
      {
        schemaVersion: 1,
        connectionId: connectionA.body.connectionId,
        leaseId: leaseA.body.leaseId,
        generation: leaseA.body.generation,
      },
      "profile-a-stale-heartbeat-0001",
    );
    expect(staleHeartbeat.status).toBe(409);

    await helperA.evaluate(() =>
      chrome.storage.local.set({ "e2e-device-journal": "profile-a" }),
    );
    expect(
      await helperB.evaluate(async () =>
        (await chrome.storage.local.get("e2e-device-journal"))[
          "e2e-device-journal"
        ],
      ),
    ).toBeUndefined();
  }, 60_000);
});
