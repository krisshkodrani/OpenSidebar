import type {
  CloudPreferencesV1,
  CredentialStatusV1,
  ExtensionSessionV1,
  UserSettings,
} from "@shared-types";
import { uiRuntime } from "./runtime";
import {
  CLOUD_EXTENSION_SESSION_KEY,
  CloudAuthenticatedFetch,
} from "../cloud/authenticated-fetch";

const API_ORIGIN = "https://opensidebar.com";
const SESSION_KEY = CLOUD_EXTENSION_SESSION_KEY;
const INSTALLATION_KEY = "cloudInstallationIdV1";
const PREFERENCES_LINKED_KEY = "cloudPreferencesLinkedV1";
const TRACE_RECOVERY_KEY = "cloudTraceRecoveryKeyV1";

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
}
export async function credentialStatuses() {
  const response = await cloudFetch("/credentials");
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { credentials: CredentialStatusV1[] })
    .credentials;
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
  return (
    (await uiRuntime.storage.local.get(PREFERENCES_LINKED_KEY))[
      PREFERENCES_LINKED_KEY
    ] === true
  );
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

export async function signInCloudWithPkce() {
  const domain = import.meta.env.VITE_OPENSIDEBAR_COGNITO_DOMAIN as
    | string
    | undefined;
  const clientId = import.meta.env
    .VITE_OPENSIDEBAR_COGNITO_EXTENSION_CLIENT_ID as string | undefined;
  if (
    !domain ||
    !clientId ||
    !uiRuntime.launchWebAuthFlow ||
    !uiRuntime.getIdentityRedirectUrl
  )
    throw new Error(
      "Direct sign-in is not configured in this build. Use a link code from opensidebar.com/account.",
    );
  const verifier = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const state = crypto.randomUUID();
  const redirectUri = uiRuntime.getIdentityRedirectUrl("opensidebar");
  const authorize = new URL("/oauth2/authorize", domain);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid email",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  }).toString();
  const callback = await uiRuntime.launchWebAuthFlow(
    authorize.toString(),
    true,
  );
  if (!callback) throw new Error("Sign-in was cancelled.");
  const result = new URL(callback);
  if (result.searchParams.get("state") !== state)
    throw new Error("Sign-in state did not match.");
  const code = result.searchParams.get("code");
  if (!code) throw new Error("Sign-in did not return an authorization code.");
  const response = await fetch(`${API_ORIGIN}/api/v1/extension/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      codeVerifier: verifier,
      redirectUri,
      installationId: await installationId(),
      displayName: "Chrome",
      extensionVersion: uiRuntime.getExtensionVersion?.() ?? "development",
    }),
  });
  if (!response.ok) throw await responseError(response);
  return writeSession((await response.json()) as ExtensionSessionV1);
}
