import type {
  CloudAccountV1,
  CloudDeviceV1,
  CloudPreferencesV1,
  CloudRemoteWorkSettingsV1,
  CredentialStatusV1,
  UsageSnapshotV1,
  CloudDashboardSummaryV1,
  CloudActivationStatusV1,
  CloudSessionTimelineEventV1,
  CloudTraceV1,
  TraceUsageV1,
} from "@opensidebar/shared-types";
import { controlApi } from "./control-api";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const session = await controlApi.session();
  if (!session.authenticated)
    throw new Error("Sign in to manage your OpenSidebar account.");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (!["GET", "HEAD"].includes(method) && session.csrfToken)
    headers.set("x-os-csrf", session.csrfToken);
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    throw new Error(
      body?.error?.message ?? body?.error?.code ?? "Account request failed.",
    );
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export const accountApi = {
  dashboard: () => request<CloudDashboardSummaryV1>("/dashboard/summary"),
  activation: () => request<CloudActivationStatusV1>("/dashboard/activation"),
  sessionTimeline: (sessionId: string) =>
    request<{
      schemaVersion: 1;
      events: CloudSessionTimelineEventV1[];
      detailedTrace: "local_only";
    }>(`/sessions/${encodeURIComponent(sessionId)}/timeline`),
  account: () => request<CloudAccountV1>("/account"),
  devices: async () =>
    (await request<{ devices: CloudDeviceV1[] }>("/account/devices")).devices,
  credentials: async () =>
    (await request<{ credentials: CredentialStatusV1[] }>("/credentials"))
      .credentials,
  usage: () => request<UsageSnapshotV1>("/relay/usage"),
  preferences: () => request<CloudPreferencesV1 | null>("/preferences"),
  remoteWork: () => request<CloudRemoteWorkSettingsV1>("/account/remote-work"),
  saveRemoteWork: (enabled: boolean, expectedRevision: number) =>
    request<CloudRemoteWorkSettingsV1>("/account/remote-work", {
      method: "PUT",
      headers: { "if-match": String(expectedRevision) },
      body: JSON.stringify({ enabled }),
    }),
  savePreferences: (value: CloudPreferencesV1, expectedRevision: number) =>
    request<CloudPreferencesV1>("/preferences", {
      method: "PUT",
      headers: { "if-match": String(expectedRevision) },
      body: JSON.stringify(value),
    }),
  linkCode: () =>
    request<{ code: string; expiresInSeconds: number }>(
      "/account/device-links",
      { method: "POST" },
    ),
  revokeDevice: (id: string) =>
    request<void>(`/account/devices/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  renameDevice: (device: CloudDeviceV1, displayName: string) =>
    request<CloudDeviceV1>(`/account/devices/${encodeURIComponent(device.id)}`, {
      method: "PUT",
      headers: { "if-match": String(device.displayNameRevision) },
      body: JSON.stringify({ displayName }),
    }),
  logoutAll: () => request<void>("/account/logout-all", { method: "POST" }),
  deleteCredential: (provider: string) =>
    request<void>(`/credentials/${encodeURIComponent(provider)}`, {
      method: "DELETE",
    }),
  saveCredential: (provider: string, credential: string) =>
    request<CredentialStatusV1>(
      `/credentials/${encodeURIComponent(provider)}`,
      {
        method: "PUT",
        body: JSON.stringify({ credential }),
      },
    ),
  traces: async () =>
    (await request<{ schemaVersion: 1; traces: CloudTraceV1[] }>("/traces"))
      .traces,
  traceUsage: () => request<TraceUsageV1>("/traces/usage"),
  deleteTrace: (traceId: string) =>
    request<void>(`/traces/${encodeURIComponent(traceId)}`, {
      method: "DELETE",
    }),
  downloadTrace: async (traceId: string) => {
    const session = await controlApi.session();
    if (!session.authenticated)
      throw new Error("Sign in to open cloud traces.");
    const response = await fetch(
      `/api/v1/traces/${encodeURIComponent(traceId)}/content`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? "Cloud trace download failed.");
    }
    return new Uint8Array(await response.arrayBuffer());
  },
};
