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
      await this.storage.remove(CLOUD_EXTENSION_SESSION_KEY);
      throw new Error("cloud_session_expired");
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

  async request(path: string, init: RequestInit = {}) {
    let session = await this.readSession();
    if (!session) throw new Error("cloud_sign_in_required");
    if (session.accessExpiresAt < Date.now() + 30_000)
      session = await this.refresh(session);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${session.accessToken}`);
    if (init.body && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    let response = await this.fetch(`${this.origin}/api/v1${path}`, {
      ...init,
      headers,
    });
    if (response.status === 401) {
      session = await this.refresh(session);
      headers.set("authorization", `Bearer ${session.accessToken}`);
      response = await this.fetch(`${this.origin}/api/v1${path}`, {
        ...init,
        headers,
      });
    }
    return response;
  }
}
