import { randomUUID } from "node:crypto";

const TERMINAL_STATES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
]);

const problemMessage = async (response) => {
  const body = await response.json().catch(() => null);
  return body?.error?.code ?? body?.error?.message ?? `http_${response.status}`;
};

export async function runRemoteMissionAcceptance({
  linkCode,
  coordinatorSession,
  onCoordinatorSession = () => {},
  deviceName,
  origin = "https://opensidebar.com",
  extensionOrigin = "chrome-extension://hakbnbbkiehiofnafdkcibbnkbdmjiha",
  fetchImpl = fetch,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
  timeoutMilliseconds = 10 * 60_000,
  pollMilliseconds = 5_000,
  onProgress = () => {},
}) {
  const normalizedCode = linkCode?.trim().toUpperCase();
  if (!coordinatorSession && !/^[A-Z2-9]{8}$/.test(normalizedCode ?? ""))
    throw new Error("Link the coordinator once with OPENSIDEBAR_ACCEPTANCE_LINK_CODE; later runs reuse its refresh session.");

  const api = `${origin.replace(/\/$/, "")}/api/v1`;
  const request = async (path, init = {}, token) => {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("origin", extensionOrigin);
    if (init.body) headers.set("content-type", "application/json");
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetchImpl(`${api}${path}`, { ...init, headers });
    if (!response.ok) throw new Error(await problemMessage(response));
    return response.status === 204 ? null : response.json();
  };

  const startedAt = now();
  const coordinator = coordinatorSession
    ? await request("/extension/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: coordinatorSession.refreshToken }),
      })
    : await request("/extension/auth/link", {
        method: "POST",
        body: JSON.stringify({
          code: normalizedCode,
          installationId: randomUUID(),
          displayName: "Codex acceptance coordinator",
          extensionVersion: "acceptance-1",
          connectionKind: "test_client",
        }),
      });
  await onCoordinatorSession({
    refreshToken: coordinator.refreshToken,
    deviceId: coordinator.device.id,
  });
  const accessToken = coordinator.accessToken;
  let mission = null;
  let target = null;
  {
    const deviceResponse = await request("/account/devices", {}, accessToken);
    const eligible = deviceResponse.devices.filter(
      (device) => !device.revokedAt && device.id !== coordinator.device.id,
    );
    const matching = deviceName
      ? eligible.filter((device) => device.displayName === deviceName)
      : eligible;
    if (matching.length !== 1) {
      const names = eligible.map((device) => device.displayName).join(", ") || "none";
      throw new Error(
        deviceName
          ? `Expected one linked device named ${deviceName}; found ${matching.length}. Available: ${names}`
          : `Expected exactly one linked executor device; found ${matching.length}. Available: ${names}. Set OPENSIDEBAR_ACCEPTANCE_DEVICE.`,
      );
    }
    target = matching[0];
    onProgress(`Selected ${target.displayName}.`);
    mission = await request(
      "/remote-missions",
      {
        method: "POST",
        headers: { "idempotency-key": `remote-acceptance:${randomUUID()}` },
        body: JSON.stringify({
          schemaVersion: 1,
          deviceId: target.id,
          instruction:
            "Report the heading of the selected existing page. Do not click, type, submit, download, navigate away, or change the page.",
          initialUrl: "https://example.com/",
          targetContext: "existing_tab",
          expiresInSeconds: 10 * 60,
        }),
      },
      accessToken,
    );
    onProgress(`Queued mission ${mission.missionId}.`);
    const deadline = startedAt.getTime() + timeoutMilliseconds;
    let previousState = mission.state;
    while (!TERMINAL_STATES.has(mission.state) && now().getTime() < deadline) {
      await wait(pollMilliseconds);
      mission = await request(
        `/remote-missions/${encodeURIComponent(mission.missionId)}`,
        {},
        accessToken,
      );
      if (mission.state !== previousState) {
        previousState = mission.state;
        onProgress(`Mission is ${mission.state}.`);
      }
    }
    if (!TERMINAL_STATES.has(mission.state))
      throw new Error("remote_mission_acceptance_timeout");
    const finishedAt = now();
    const encryptedResult = mission.result ?? null;
    const groundedHeading =
      mission.state === "succeeded" &&
      typeof encryptedResult?.summary === "string" &&
      encryptedResult.summary.toLowerCase().includes("example domain");
    return {
      schemaVersion: 1,
      result: groundedHeading ? "passed" : "failed",
      missionId: mission.missionId,
      terminalState: mission.state,
      resultCode: mission.resultCode ?? null,
      targetDisplayName: target.displayName,
      targetExtensionVersion: target.extensionVersion,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMilliseconds: finishedAt.getTime() - startedAt.getTime(),
      taskProfile: "fixed_read_only_heading",
      targetContext: "existing_tab",
      encryptedResult,
      visualConfirmation: groundedHeading ? "verified_by_encrypted_result" : "not_verified",
    };
  }
}
