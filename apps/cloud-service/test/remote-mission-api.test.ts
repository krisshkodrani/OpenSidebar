import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type {
  RemoteMissionState,
  RemoteMissionV1,
} from "@opensidebar/shared-types";
import { createRemoteMissionApi } from "../src/remote-mission-api.js";
import { tokenHash } from "../src/crypto.js";

const deviceId = "123e4567-e89b-42d3-a456-426614174000";
const otherDeviceId = "123e4567-e89b-42d3-a456-426614174099";

function world() {
  const records = new Map<string, RemoteMissionV1>();
  const payloads = new Map<string, unknown>();
  const principal = {
    accountId: "account-1",
    email: "owner@example.test",
    sessionEpoch: 1,
    cloudAccess: true,
    deviceId,
    installationId: "install-1",
  };
  const accounts = {
    async accessPrincipal(hash: string) {
      return hash === tokenHash("token") ? principal : null;
    },
    async listDevices() {
      return [
        {
          schemaVersion: 1 as const,
          id: deviceId,
          installationId: "install-1",
          displayName: "Laptop",
          extensionVersion: "0.7.3",
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        },
      ];
    },
  };
  const missions = {
    async missionByIdempotency() {
      return null;
    },
    async createMission(input: {
      missionId: string;
      deviceId: string;
      createdAt: Date;
      expiresAt: Date;
    }) {
      const mission: RemoteMissionV1 = {
        schemaVersion: 1,
        missionId: input.missionId,
        deviceId: input.deviceId,
        sequence: records.size + 1,
        state: "queued",
        createdAt: input.createdAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      };
      records.set(mission.missionId, mission);
      return { kind: "created" as const, value: mission };
    },
    async mission(_accountId: string, missionId: string) {
      return records.get(missionId) ?? null;
    },
    async missions(input: { deviceId: string; afterSequence: number }) {
      return [...records.values()].filter(
        (value) =>
          value.deviceId === input.deviceId &&
          value.sequence > input.afterSequence,
      );
    },
    async transition(input: {
      missionId: string;
      from: RemoteMissionState;
      to: RemoteMissionState;
      resultCode?: RemoteMissionV1["resultCode"];
    }) {
      const current = records.get(input.missionId);
      if (!current || current.state !== input.from)
        return { kind: "state_conflict" as const };
      const value = {
        ...current,
        state: input.to,
        ...(input.resultCode ? { resultCode: input.resultCode } : {}),
      };
      records.set(input.missionId, value);
      return { kind: "updated" as const, value };
    },
    async payloadObjectKey() {
      return "unused";
    },
  };
  const vault = {
    objectKey: (identity: { missionId: string }) => identity.missionId,
    async encryptAndPut(
      identity: { missionId: string },
      payload: unknown,
    ) {
      payloads.set(identity.missionId, payload);
      return { ciphertextSizeBytes: 100, ciphertextSha256: "a".repeat(64) };
    },
    async getAndDecrypt(identity: { missionId: string }) {
      return payloads.get(identity.missionId)!;
    },
    async delete(identity: { missionId: string }) {
      payloads.delete(identity.missionId);
    },
  };
  const app = new Hono();
  app.route(
    "/api/v1",
    createRemoteMissionApi({
      config: {
        remoteMissionsEnabled: true,
        cloudSessionTesterSubjects: new Set(["account-1"]),
      } as never,
      accounts: accounts as never,
      missions,
      vault: vault as never,
    }),
  );
  return { app, records };
}

const auth = { authorization: "Bearer token" };

test("creates metadata-only mission and selected device receives payload", async () => {
  const { app } = world();
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "create-1",
    },
    body: JSON.stringify({
      schemaVersion: 1,
      deviceId,
      instruction: "Summarize this dashboard",
    }),
  });
  assert.equal(created.status, 201);
  const metadata = (await created.json()) as Record<string, unknown>;
  assert.equal(metadata.instruction, undefined);

  const delivery = await app.request(
    `/api/v1/devices/${deviceId}/remote-missions`,
    { headers: auth },
  );
  assert.equal(delivery.status, 200);
  assert.equal(
    (await delivery.text()).includes("Summarize this dashboard"),
    true,
  );
});

test("rejects delivery to a different authenticated device", async () => {
  const { app } = world();
  const response = await app.request(
    `/api/v1/devices/${otherDeviceId}/remote-missions`,
    { headers: auth },
  );
  assert.equal(response.status, 403);
});

test("selected device advances the monotonic lifecycle", async () => {
  const { app } = world();
  const created = await app.request("/api/v1/remote-missions", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "create-2",
    },
    body: JSON.stringify({ schemaVersion: 1, deviceId, instruction: "Read" }),
  });
  const mission = (await created.json()) as RemoteMissionV1;
  const accepted = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/transition`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, to: "accepted" }),
    },
  );
  assert.equal(accepted.status, 200);
  assert.equal(((await accepted.json()) as RemoteMissionV1).state, "accepted");

  const invalid = await app.request(
    `/api/v1/remote-missions/${mission.missionId}/transition`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, to: "succeeded", resultCode: "completed" }),
    },
  );
  assert.equal(invalid.status, 400);
});
