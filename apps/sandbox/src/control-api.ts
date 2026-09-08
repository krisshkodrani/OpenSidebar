import type {
  SandboxControlCommand,
  SandboxRun,
  ScenarioId,
} from "@sandbox-contracts";

type ApiError = Error & { status?: number };
export type SandboxSession = {
  authenticated: boolean;
  csrfToken?: string;
  email?: string;
};
let csrfToken: string | null = null;
async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch("/api/v1/playground/auth/session", {
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    authenticated?: boolean;
    csrfToken?: string;
  };
  if (!payload.authenticated || !payload.csrfToken)
    throw new Error("Sign in to use Sandbox.");
  csrfToken = payload.csrfToken;
  return csrfToken;
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const csrf =
    ["POST", "DELETE", "PATCH"].includes(method) && !path.startsWith("/auth/")
      ? await ensureCsrf()
      : null;
  const response = await fetch(`/api/v1/playground${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(method === "POST" ? { "idempotency-key": crypto.randomUUID() } : {}),
      ...(csrf ? { "x-os-csrf": csrf } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const error = new Error(
      payload?.error?.message ?? "Sandbox request failed.",
    ) as ApiError;
    error.status = response.status;
    throw error;
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export const controlApi = {
  session: async () => request<SandboxSession>("/auth/session"),
  requestCode: async (email: string) =>
    request<{ challengeId: string }>("/auth/code", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyCode: async (challengeId: string, email: string, code: string) =>
    request<void>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId, email, code }),
    }),
  listRuns: async () => (await request<{ runs: SandboxRun[] }>("/runs")).runs,
  createRun: async (scenarioId: ScenarioId) =>
    (
      await request<{ run: SandboxRun }>("/runs", {
        method: "POST",
        body: JSON.stringify({ scenarioId }),
      })
    ).run,
  command: async (runId: string, command: SandboxControlCommand) =>
    (
      await request<{ run: SandboxRun }>(
        `/runs/${encodeURIComponent(runId)}/commands`,
        { method: "POST", body: JSON.stringify(command) },
      )
    ).run,
  remove: async (runId: string) =>
    request<void>(`/runs/${encodeURIComponent(runId)}`, { method: "DELETE" }),
  launch: async (runId: string) =>
    (
      await request<{ launchUrl: string }>(
        `/runs/${encodeURIComponent(runId)}/launch`,
        { method: "POST" },
      )
    ).launchUrl,
  login: () => {
    window.location.assign("/playground?auth=1");
  },
  hostedLogin: () => {
    window.location.assign("/api/v1/playground/auth/login");
  },
  logout: async () => {
    await request<void>("/auth/logout", { method: "POST" });
    csrfToken = null;
  },
};
