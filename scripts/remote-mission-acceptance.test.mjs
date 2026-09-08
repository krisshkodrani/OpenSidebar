import assert from "node:assert/strict";
import test from "node:test";
import { runRemoteMissionAcceptance } from "./remote-mission-acceptance-lib.mjs";

const response = (status, body) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("runs against the active tab and records encrypted grounded evidence", async () => {
  const requests = [];
  let statusReads = 0;
  const report = await runRemoteMissionAcceptance({
    linkCode: "ABCDEFGH",
    wait: async () => undefined,
    now: (() => {
      let value = Date.parse("2026-08-12T12:00:00.000Z");
      return () => new Date((value += 1_000));
    })(),
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const path = new URL(url).pathname;
      if (path.endsWith("/extension/auth/link"))
        return response(201, {
          accessToken: "secret-token",
          refreshToken: "refresh-token",
          device: { id: "coordinator" },
        });
      if (path.endsWith("/account/devices") && init.method !== "DELETE")
        return response(200, {
          devices: [
            { id: "coordinator", displayName: "Remote acceptance coordinator" },
            { id: "executor", displayName: "Work laptop", extensionVersion: "0.7.4" },
          ],
        });
      if (path.endsWith("/remote-missions") && init.method === "POST") {
        const body = JSON.parse(init.body);
        assert.equal(body.deviceId, "executor");
        assert.equal(body.initialUrl, "https://example.com/");
        assert.equal(body.targetContext, "existing_tab");
        assert.match(body.instruction, /Do not click/);
        return response(201, { missionId: "mission-1", state: "queued" });
      }
      if (path.endsWith("/remote-missions/mission-1") && init.method !== "DELETE") {
        statusReads += 1;
        return response(200, {
          missionId: "mission-1",
          state: statusReads === 1 ? "running" : "succeeded",
          resultCode: statusReads === 1 ? undefined : "completed",
          result: statusReads === 1 ? undefined : {
            schemaVersion: 1,
            missionId: "mission-1",
            outcome: "completed",
            createdAt: "2026-08-12T12:00:02.000Z",
            summary: "The visible page heading is Example Domain.",
          },
        });
      }
      return response(404, { error: { code: "not_found" } });
    },
  });

  assert.equal(report.result, "passed");
  assert.equal(report.targetDisplayName, "Work laptop");
  assert.equal(report.visualConfirmation, "verified_by_encrypted_result");
  assert.match(report.encryptedResult.summary, /Example Domain/);
  assert.equal(JSON.stringify(report).includes("secret-token"), false);
  assert.equal(requests.some(({ init }) => init.method === "DELETE"), false);
});

test("refuses ambiguous device selection without revoking the reusable coordinator", async () => {
  await assert.rejects(
    runRemoteMissionAcceptance({
      linkCode: "ABCDEFGH",
      fetchImpl: async (url, init) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/extension/auth/link"))
          return response(201, {
            accessToken: "token",
            refreshToken: "refresh",
            device: { id: "coordinator" },
          });
        if (path.endsWith("/account/devices") && init.method !== "DELETE")
          return response(200, {
            devices: [
              { id: "coordinator", displayName: "Coordinator" },
              { id: "one", displayName: "One" },
              { id: "two", displayName: "Two" },
            ],
          });
        return response(404, { error: { code: "not_found" } });
      },
    }),
    /Expected exactly one linked executor device/,
  );
});

test("reuses and rotates a cached coordinator session without another link code", async () => {
  let refreshed = false;
  await assert.rejects(
    runRemoteMissionAcceptance({
      coordinatorSession: { refreshToken: "old-refresh", deviceId: "coordinator" },
      deviceName: "missing",
      onCoordinatorSession(session) {
        assert.equal(session.refreshToken, "new-refresh");
      },
      fetchImpl: async (url, init) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/extension/auth/refresh")) {
          refreshed = true;
          assert.equal(JSON.parse(init.body).refreshToken, "old-refresh");
          return response(200, {
            accessToken: "new-access",
            refreshToken: "new-refresh",
            device: { id: "coordinator" },
          });
        }
        if (path.endsWith("/account/devices"))
          return response(200, { devices: [{ id: "executor", displayName: "Other" }] });
        return response(404, { error: { code: "not_found" } });
      },
    }),
    /Expected one linked device named missing/,
  );
  assert.equal(refreshed, true);
});
