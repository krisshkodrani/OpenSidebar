import type { ProviderConfig } from "./types";

const API_ORIGIN = "https://opensidebar.com";
const SESSION_KEY = "cloudExtensionSessionV1";
type StoredSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
};

async function session(): Promise<StoredSession> {
  const value = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY] as
    | StoredSession
    | undefined;
  if (!value)
    throw new Error(
      "OpenSidebar Cloud session is missing. Sign in again from Settings.",
    );
  return value;
}
async function refreshed(current: StoredSession, signal?: AbortSignal) {
  const response = await fetch(`${API_ORIGIN}/api/v1/extension/auth/refresh`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (!response.ok) {
    await chrome.storage.local.remove(SESSION_KEY);
    throw new Error(
      "OpenSidebar Cloud session expired. Sign in again from Settings.",
    );
  }
  const next = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    accessExpiresInSeconds: number;
    account: unknown;
    device: unknown;
  };
  const stored = {
    ...next,
    accessExpiresAt: Date.now() + next.accessExpiresInSeconds * 1_000,
  };
  await chrome.storage.local.set({ [SESSION_KEY]: stored });
  return stored;
}

export async function cloudRelayFetch(
  payload: Record<string, unknown>,
  providerId: ProviderConfig["providerId"],
  seat: "executor" | "planner" | "writer" | "judge",
  signal?: AbortSignal,
) {
  if (providerId !== "openrouter")
    throw new Error(
      `Provider ${providerId} is not available through OpenSidebar Cloud.`,
    );
  signal?.throwIfAborted();
  let auth = await session();
  signal?.throwIfAborted();
  if (auth.accessExpiresAt < Date.now() + 30_000)
    auth = await refreshed(auth, signal);
  signal?.throwIfAborted();
  const request = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    abortScopeId: crypto.randomUUID(),
    provider: providerId,
    modelId: payload.model,
    seat,
    messages: payload.messages,
    tools: payload.tools,
    temperature: payload.temperature,
    maxTokens: payload.max_tokens,
    stop: payload.stop,
    responseFormat: payload.response_format,
    toolChoice: payload.tool_choice,
    ...(providerId === "openrouter" &&
    payload.provider &&
    (payload.provider as { only?: string[] }).only
      ? { providerRouting: payload.provider }
      : {}),
  };
  signal?.addEventListener(
    "abort",
    () => {
      void fetch(
        `${API_ORIGIN}/api/v1/relay/requests/${encodeURIComponent(request.abortScopeId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${auth.accessToken}` },
        },
      ).catch(() => {
        // The streaming request is already cancelled locally. Server cleanup
        // also recovers interrupted records after a process restart.
      });
    },
    { once: true },
  );
  const send = (accessToken: string) =>
    fetch(`${API_ORIGIN}/api/v1/relay/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
  let response = await send(auth.accessToken);
  if (response.status === 401) {
    auth = await refreshed(auth, signal);
    response = await send(auth.accessToken);
  }
  return response;
}

/** Metadata needs the vaulted OpenRouter key; the key never leaves the server. */
export async function cloudEndpointMetadataFetch(
  model: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  let auth = await session();
  signal?.throwIfAborted();
  if (auth.accessExpiresAt < Date.now() + 30_000)
    auth = await refreshed(auth, signal);
  const send = () => {
    signal?.throwIfAborted();
    return fetch(
      `${API_ORIGIN}/api/v1/relay/openrouter/models/${model.split("/").map(encodeURIComponent).join("/")}/endpoints`,
      {
        signal,
        headers: { authorization: `Bearer ${auth.accessToken}` },
      },
    );
  };
  let response = await send();
  if (response.status === 401) {
    auth = await refreshed(auth, signal);
    response = await send();
  }
  return response;
}
