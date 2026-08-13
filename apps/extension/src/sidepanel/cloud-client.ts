import type {
  CloudPreferencesV1,
  CloudRemoteWorkSettingsV1,
  CredentialStatusV1,
  ExtensionSessionV1,
  UserSettings,
} from "@shared-types";
import { uiRuntime } from "./runtime";
import {
  CLOUD_EXTENSION_SESSION_KEY,
  CloudAuthenticatedFetch,
} from "../cloud/authenticated-fetch";
import { REMOTE_MISSION_LOCAL_STATUS_KEY } from "../remote-mission-local-status";

const API_ORIGIN = "https://opensidebar.com";
const SESSION_KEY = CLOUD_EXTENSION_SESSION_KEY;
const INSTALLATION_KEY = "cloudInstallationIdV1";
const PREFERENCES_LINKED_KEY = "cloudPreferencesLinkedV1";
const PREFERENCES_SYNC_ENABLED_KEY = "cloudPreferencesSyncEnabledV1";
const TRACE_RECOVERY_KEY = "cloudTraceRecoveryKeyV1";
const PENDING_EMAIL_AUTH_KEY = "cloudPendingEmailAuthV1";

type StoredSession = Pick<
  ExtensionSessionV1,
  "accessToken" | "refreshToken" | "account" | "device"
> & { accessExpiresAt: number };

export type CloudTraceQueueStatus = {
  ok: boolean;
  paused: boolean;
  items: Array<{
    traceId: string;
    title: string;
    createdAt: string;
    ciphertextSizeBytes: number;
    state: "waiting" | "retrying";
    attempts: number;
    lastError?: string;
  }>;
};

const traceQueueMessage = (type: string, payload?: Record<string, unknown>) =>
  uiRuntime.sendMessage<CloudTraceQueueStatus>({
    type,
    source: uiRuntime.source,
    requestId: crypto.randomUUID(),
    ...(payload ? { payload } : {}),
  });

export const cloudTraceQueueStatus = () =>
  traceQueueMessage("CLOUD_TRACE_QUEUE_STATUS");
export const pauseCloudTraceQueue = (paused: boolean) =>
  traceQueueMessage("CLOUD_TRACE_QUEUE_PAUSE", { paused });
export const retryCloudTraceQueue = () =>
  traceQueueMessage("CLOUD_TRACE_QUEUE_RETRY");
export const excludeCloudTrace = (traceId: string) =>
  traceQueueMessage("CLOUD_TRACE_QUEUE_EXCLUDE", { traceId });

async function installationId() {
  const stored = await uiRuntime.storage.local.get(INSTALLATION_KEY);
  if (typeof stored[INSTALLATION_KEY] === "string")
    return stored[INSTALLATION_KEY] as string;
  const id = crypto.randomUUID();
  await uiRuntime.storage.local.set({ [INSTALLATION_KEY]: id });
  return id;
}
async function readSession() {
  return (await uiRuntime.storage.local.get(SESSION_KEY))[SESSION_KEY] as
    | StoredSession
    | undefined;
}
async function writeSession(session: ExtensionSessionV1) {
  const stored: StoredSession = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessExpiresAt: Date.now() + session.accessExpiresInSeconds * 1_000,
    account: session.account,
    device: session.device,
  };
  await uiRuntime.storage.local.set({ [SESSION_KEY]: stored });
  return stored;
}
async function responseError(response: Response) {
  const value = (await response.json().catch(() => null)) as {
    error?: { message?: string; code?: string };
  } | null;
  return new Error(
    value?.error?.message ??
      value?.error?.code ??
      `Cloud request failed (${response.status})`,
  );
}

export async function linkCloudAccount(code: string) {
  const response = await fetch(`${API_ORIGIN}/api/v1/extension/auth/link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      installationId: await installationId(),
      displayName: navigator.userAgent.includes("Chrome")
        ? "Chrome"
        : "Browser",
      extensionVersion: uiRuntime.getExtensionVersion?.() ?? "development",
    }),
  });
  if (!response.ok) throw await responseError(response);
  return writeSession((await response.json()) as ExtensionSessionV1);
}

const extensionDevice = async () => ({
  installationId: await installationId(),
  displayName: "Chrome",
  extensionVersion: uiRuntime.getExtensionVersion?.() ?? "development",
});

export async function requestCloudEmailCode(email: string) {
  const response = await fetch(`${API_ORIGIN}/api/v1/extension/auth/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw await responseError(response);
  const challenge = (await response.json()) as {
    challengeId: string;
    expiresInSeconds: number;
  };
  await uiRuntime.storage.local.set({
    [PENDING_EMAIL_AUTH_KEY]: {
      email: email.trim().toLowerCase(),
      challengeId: challenge.challengeId,
      expiresAt: Date.now() + challenge.expiresInSeconds * 1_000,
    },
  });
  return challenge;
}

export async function pendingCloudEmailAuth() {
  const value = (await uiRuntime.storage.local.get(PENDING_EMAIL_AUTH_KEY))[
    PENDING_EMAIL_AUTH_KEY
  ] as
    | { email?: unknown; challengeId?: unknown; expiresAt?: unknown }
    | undefined;
  if (
    !value ||
    typeof value.email !== "string" ||
    typeof value.challengeId !== "string" ||
    typeof value.expiresAt !== "number" ||
    value.expiresAt <= Date.now()
  ) {
    await uiRuntime.storage.local.remove(PENDING_EMAIL_AUTH_KEY);
    return null;
  }
  return value as { email: string; challengeId: string; expiresAt: number };
}

export async function clearPendingCloudEmailAuth() {
  await uiRuntime.storage.local.remove(PENDING_EMAIL_AUTH_KEY);
}

export async function verifyCloudEmailCode(
  email: string,
  code: string,
  challengeId: string,
) {
  const response = await fetch(`${API_ORIGIN}/api/v1/extension/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      code,
      challengeId,
      ...(await extensionDevice()),
    }),
  });
  if (!response.ok) throw await responseError(response);
  const session = await writeSession(
    (await response.json()) as ExtensionSessionV1,
  );
  await uiRuntime.storage.local.remove(PENDING_EMAIL_AUTH_KEY);
  return session;
}

const authenticatedCloud = new CloudAuthenticatedFetch(
  uiRuntime.storage.local,
  API_ORIGIN,
);
export async function cloudFetch(path: string, init: RequestInit = {}) {
  try {
    return await authenticatedCloud.request(path, init);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "cloud_sign_in_required" ||
        error.message === "cloud_session_expired")
    )
      throw new Error("Sign in to OpenSidebar first.");
    throw error;
  }
}

export async function cloudSession() {
  return readSession();
}
export async function cloudTraceRecoveryKey() {
  const stored = await uiRuntime.storage.local.get(TRACE_RECOVERY_KEY);
  return typeof stored[TRACE_RECOVERY_KEY] === "string"
    ? (stored[TRACE_RECOVERY_KEY] as string)
    : null;
}
export async function signOutCloud() {
  const session = await readSession();
  if (session)
    await cloudFetch("/extension/auth/logout", { method: "POST" }).catch(
      () => undefined,
    );
  await uiRuntime.storage.local.remove(SESSION_KEY);
  await uiRuntime.storage.local.remove(PREFERENCES_LINKED_KEY);
  await uiRuntime.storage.local.remove(REMOTE_MISSION_LOCAL_STATUS_KEY);
}
export async function renameCloudDevice(displayName: string) {
  const session = await readSession();
  if (!session) throw new Error("Sign in to OpenSidebar first.");
  const response = await cloudFetch(`/account/devices/${encodeURIComponent(session.device.id)}`, {
    method: "PUT",
    headers: { "if-match": String(session.device.displayNameRevision ?? 1) },
    body: JSON.stringify({ displayName }),
  });
  if (!response.ok) throw await responseError(response);
  const device = (await response.json()) as ExtensionSessionV1["device"];
  await uiRuntime.storage.local.set({
    [SESSION_KEY]: { ...session, device },
  });
  return device;
}
export async function credentialStatuses() {
  const response = await cloudFetch("/credentials");
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { credentials: CredentialStatusV1[] })
    .credentials;
}
export async function remoteWorkStatus() {
  const response = await cloudFetch("/account/remote-work");
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<CloudRemoteWorkSettingsV1>;
}
export async function disableRemoteWork(expectedRevision: number) {
  const response = await cloudFetch("/account/remote-work", {
    method: "PUT",
    headers: { "if-match": String(expectedRevision) },
    body: JSON.stringify({ enabled: false }),
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<CloudRemoteWorkSettingsV1>;
}
export async function uploadCredential(
  provider: "openrouter" | "fireworks",
  credential: string,
) {
  const response = await cloudFetch(`/credentials/${provider}`, {
    method: "PUT",
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<CredentialStatusV1>;
}
export async function cloudPreferences() {
  const response = await cloudFetch("/preferences");
  if (response.status === 204) return null;
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<CloudPreferencesV1>;
}
export async function cloudPreferencesLinked() {
  const stored = await uiRuntime.storage.local.get([
    PREFERENCES_LINKED_KEY,
    PREFERENCES_SYNC_ENABLED_KEY,
  ]);
  return (
    stored[PREFERENCES_LINKED_KEY] === true &&
    stored[PREFERENCES_SYNC_ENABLED_KEY] !== false
  );
}
export async function cloudPreferenceSyncEnabled() {
  return (
    (await uiRuntime.storage.local.get(PREFERENCES_SYNC_ENABLED_KEY))[
      PREFERENCES_SYNC_ENABLED_KEY
    ] !== false
  );
}
export async function setCloudPreferenceSyncEnabled(enabled: boolean) {
  await uiRuntime.storage.local.set({ [PREFERENCES_SYNC_ENABLED_KEY]: enabled });
}
export async function importCloudPreferences() {
  const value = await cloudPreferences();
  if (value)
    await uiRuntime.storage.local.set({ [PREFERENCES_LINKED_KEY]: true });
  return value;
}
export async function syncCloudPreferences(settings: UserSettings) {
  let current = await cloudPreferences();
  const makeValue = (revision: number): CloudPreferencesV1 => ({
    schemaVersion: 1,
    revision,
    inferenceMode: settings.inferenceMode ?? "local",
    providerMode:
      settings.providerMode === "fireworks" ? "fireworks" : "openrouter",
    executorModel: settings.executorModel,
    plannerModel: settings.plannerModel,
    writerModel: settings.writerModel,
    maxTurns: settings.maxTurns,
    theme: settings.theme,
    showSessionMetrics: settings.showSessionMetrics,
    showMessageDetailsByDefault: settings.showMessageDetailsByDefault,
    laneTopologyMode: settings.laneTopologyMode,
    enabledSkillPackIds: settings.enabledSkillPackIds,
    disabledSkillIds: settings.disabledSkillIds,
    useNitro: settings.useNitro,
    temperature: settings.temperature,
    perceptionMode: settings.perceptionMode,
    maxImagePromptTokenEstimate: settings.maxImagePromptTokenEstimate,
    presenceMode: settings.presenceMode,
    presenceHideDuringCapture: settings.presenceHideDuringCapture,
  });
  let value = makeValue((current?.revision ?? 0) + 1);
  let response = await cloudFetch("/preferences", {
    method: "PUT",
    headers: { "if-match": String(value.revision - 1) },
    body: JSON.stringify(value),
  });
  if (response.status === 409) {
    current = await cloudPreferences();
    value = makeValue((current?.revision ?? 0) + 1);
    response = await cloudFetch("/preferences", {
      method: "PUT",
      headers: { "if-match": String(value.revision - 1) },
      body: JSON.stringify(value),
    });
  }
  if (!response.ok) throw await responseError(response);
  const saved = (await response.json()) as CloudPreferencesV1;
  await uiRuntime.storage.local.set({ [PREFERENCES_LINKED_KEY]: true });
  return saved;
}
