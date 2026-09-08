import type { ExtensionSessionV1 } from "@shared-types/cloud-control";

type CloudSessionStorage = {
  get(keys?: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

export const CLOUD_EXTENSION_SESSION_KEY = "cloudExtensionSessionV1";

type StoredSession = Pick<
  ExtensionSessionV1,
  "accessToken" | "refreshToken" | "account" | "device"
> & { accessExpiresAt: number };

const REFRESH_LOCK_NAME = "opensidebar:cloud-session-refresh:v1";
const refreshesByOrigin = new Map<string, Promise<StoredSession>>();

type CrossContextLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

const crossContextLocks = () =>
  (globalThis as typeof globalThis & {
    navigator?: { locks?: CrossContextLockManager };
  }).navigator?.locks;

export class CloudAuthenticatedFetch {
  constructor(
    private readonly storage: CloudSessionStorage,
    private readonly origin = "https://opensidebar.com",
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private fetch(input: RequestInfo | URL, init?: RequestInit) {
    return (this.fetchImpl ?? globalThis.fetch)(input, init);
  }

  private async readSession() {
    return (await this.storage.get(CLOUD_EXTENSION_SESSION_KEY))[
      CLOUD_EXTENSION_SESSION_KEY
    ] as StoredSession | undefined;
  }

  private async refresh(session: StoredSession) {
    const response = await this.fetch(
      `${this.origin}/api/v1/extension/auth/refresh`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      },
    );
    if (!response.ok) {
      const sessionRejected =
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403;
      if (sessionRejected)
        await this.storage.remove(CLOUD_EXTENSION_SESSION_KEY);
      throw new Error(
        sessionRejected
          ? "cloud_session_expired"
          : "cloud_temporarily_unavailable",
      );
    }
    const value = (await response.json()) as ExtensionSessionV1;
    const stored: StoredSession = {
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      accessExpiresAt: Date.now() + value.accessExpiresInSeconds * 1_000,
      account: value.account,
      device: value.device,
    };
    await this.storage.set({ [CLOUD_EXTENSION_SESSION_KEY]: stored });
    return stored;
  }

  private async withRefreshLock(operation: () => Promise<StoredSession>) {
    const locks = crossContextLocks();
    if (locks)
      return locks.request(`${REFRESH_LOCK_NAME}:${this.origin}`, operation);

    const existing = refreshesByOrigin.get(this.origin);
    if (existing) return existing;
    const pending = operation();
    const clear = () => {
      if (refreshesByOrigin.get(this.origin) === pending)
        refreshesByOrigin.delete(this.origin);
    };
    refreshesByOrigin.set(this.origin, pending);
    void pending.then(clear, clear);
    return pending;
  }

  private coordinatedRefresh(observed: StoredSession, force = false) {
    return this.withRefreshLock(async () => {
      const current = await this.readSession();
      if (!current) throw new Error("cloud_sign_in_required");
      const refreshedElsewhere =
        current.accessToken !== observed.accessToken ||
        current.refreshToken !== observed.refreshToken;
      if (
        current.accessExpiresAt >= Date.now() + 30_000 &&
        (refreshedElsewhere || !force)
      ) return current;
      return this.refresh(current);
    });
  }

  async request(path: string, init: RequestInit = {}) {
    let session = await this.readSession();
    if (!session) throw new Error("cloud_sign_in_required");
    if (session.accessExpiresAt < Date.now() + 30_000)
      session = await this.coordinatedRefresh(session);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${session.accessToken}`);
    if (init.body && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    let response = await this.fetch(`${this.origin}/api/v1${path}`, {
      ...init,
      headers,
    });
    if (response.status === 401) {
      session = await this.coordinatedRefresh(session, true);
      headers.set("authorization", `Bearer ${session.accessToken}`);
      response = await this.fetch(`${this.origin}/api/v1${path}`, {
        ...init,
        headers,
      });
    }
    return response;
  }
}
