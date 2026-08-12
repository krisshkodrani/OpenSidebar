import type {
  CloudAccountV1,
  CloudDeviceV1,
  ExtensionSessionV1,
} from "@opensidebar/shared-types";
import type { CloudConfig } from "./config.js";
import { opaqueToken, tokenHash } from "./crypto.js";
import type {
  ControlAccount,
  ControlPrincipal,
  ControlRepository,
  DeviceSessionWrite,
} from "./control-repository.js";

const ACCESS_SECONDS = 15 * 60;
const REFRESH_SECONDS = 90 * 86_400;
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
const bounded = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.trim().length <= max
    ? value.trim()
    : null;
const accountView = (account: ControlAccount): CloudAccountV1 => ({
  schemaVersion: 1,
  accountId: account.accountId,
  email: account.email,
  cloudAccess: account.cloudAccess,
  sessionEpoch: account.sessionEpoch,
});

export class ControlAuthError extends Error {
  constructor(
    readonly code:
      | "invalid_auth_request"
      | "signin_failed"
      | "cloud_access_not_enabled"
      | "invalid_refresh"
      | "refresh_reused",
  ) {
    super(code);
  }
}

export class ControlAuthService {
  constructor(
    private readonly repository: ControlRepository,
    private readonly config: CloudConfig,
  ) {}
  private sessionWrite(
    principal: Pick<
      ControlPrincipal,
      "accountId" | "deviceId" | "sessionEpoch"
    >,
    family = `rf_${opaqueToken(12)}`,
  ) {
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    const now = Date.now();
    const value: DeviceSessionWrite = {
      id: `ds_${opaqueToken(12)}`,
      accountId: principal.accountId,
      deviceId: principal.deviceId,
      sessionEpoch: principal.sessionEpoch,
      accessHash: tokenHash(accessToken),
      accessExpiresAt: new Date(now + ACCESS_SECONDS * 1000),
      refreshHash: tokenHash(refreshToken),
      refreshFamily: family,
      refreshExpiresAt: new Date(now + REFRESH_SECONDS * 1000),
    };
    return { accessToken, refreshToken, value };
  }
  private async response(
    account: ControlAccount,
    device: CloudDeviceV1,
    family?: string,
  ): Promise<ExtensionSessionV1> {
    const issued = this.sessionWrite(
      {
        accountId: account.accountId,
        deviceId: device.id,
        sessionEpoch: account.sessionEpoch,
      },
      family,
    );
    await this.repository.createDeviceSession(issued.value);
    return {
      schemaVersion: 1,
      accessToken: issued.accessToken,
      accessExpiresInSeconds: ACCESS_SECONDS,
      refreshToken: issued.refreshToken,
      refreshExpiresInSeconds: REFRESH_SECONDS,
      account: accountView(account),
      device,
    };
  }
  async passwordless(
    identity: { accountId: string; email: string },
    body: Record<string, unknown>,
  ): Promise<ExtensionSessionV1> {
    const installationId = uuid(body.installationId),
      displayName = bounded(body.displayName, 80),
      extensionVersion = bounded(body.extensionVersion, 32);
    if (!installationId || !displayName || !extensionVersion)
      throw new ControlAuthError("invalid_auth_request");
    if (!this.config.cloudTesterSubjects.has(identity.accountId))
      throw new ControlAuthError("cloud_access_not_enabled");
    const account = await this.repository.upsertAccount(
      identity.accountId,
      identity.email.toLowerCase(),
      true,
    );
    const device = await this.repository.upsertDevice(
      account.accountId,
      installationId,
      displayName,
      extensionVersion,
    );
    return this.response(account, device);
  }
  async exchange(body: Record<string, unknown>): Promise<ExtensionSessionV1> {
    if (
      !this.config.extensionClientId ||
      !this.config.cognitoDomain ||
      !this.config.extensionId
    )
      throw new ControlAuthError("signin_failed");
    const code = bounded(body.code, 4096),
      verifier = bounded(body.codeVerifier, 256),
      installationId = uuid(body.installationId),
      displayName = bounded(body.displayName, 80),
      extensionVersion = bounded(body.extensionVersion, 32);
    const redirectUri = `https://${this.config.extensionId}.chromiumapp.org/opensidebar`;
    if (
      !code ||
      !verifier ||
      !installationId ||
      !displayName ||
      !extensionVersion ||
      body.redirectUri !== redirectUri
    )
      throw new ControlAuthError("invalid_auth_request");
    const tokenResponse = await fetch(
      new URL("/oauth2/token", this.config.cognitoDomain),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.config.extensionClientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!tokenResponse.ok) throw new ControlAuthError("signin_failed");
    const tokens = (await tokenResponse.json()) as { access_token?: string };
    if (!tokens.access_token) throw new ControlAuthError("signin_failed");
    const userResponse = await fetch(
      new URL("/oauth2/userInfo", this.config.cognitoDomain),
      {
        headers: { authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!userResponse.ok) throw new ControlAuthError("signin_failed");
    const user = (await userResponse.json()) as {
      sub?: string;
      email?: string;
    };
    if (!user.sub || !user.email) throw new ControlAuthError("signin_failed");
    const allowed = this.config.cloudTesterSubjects.has(user.sub);
    const account = await this.repository.upsertAccount(
      user.sub,
      user.email.toLowerCase(),
      allowed,
    );
    if (!account.cloudAccess)
      throw new ControlAuthError("cloud_access_not_enabled");
    const device = await this.repository.upsertDevice(
      account.accountId,
      installationId,
      displayName,
      extensionVersion,
    );
    return this.response(account, device);
  }
  async link(body: Record<string, unknown>): Promise<ExtensionSessionV1> {
    const code = bounded(body.code, 16)?.toUpperCase(),
      installationId = uuid(body.installationId),
      displayName = bounded(body.displayName, 80),
      extensionVersion = bounded(body.extensionVersion, 32);
    if (!code || !installationId || !displayName || !extensionVersion)
      throw new ControlAuthError("invalid_auth_request");
    const account = await this.repository.consumeDeviceLink(tokenHash(code));
    if (!account) throw new ControlAuthError("signin_failed");
    if (!this.config.cloudTesterSubjects.has(account.accountId))
      throw new ControlAuthError("cloud_access_not_enabled");
    const device = await this.repository.upsertDevice(
      account.accountId,
      installationId,
      displayName,
      extensionVersion,
    );
    return this.response(account, device);
  }
  async refresh(refreshToken: unknown): Promise<ExtensionSessionV1> {
    if (typeof refreshToken !== "string" || refreshToken.length > 256)
      throw new ControlAuthError("invalid_refresh");
    const hash = tokenHash(refreshToken);
    const principal = await this.repository.refreshPrincipal(hash);
    if (!principal) throw new ControlAuthError("invalid_refresh");
    if (!this.config.cloudTesterSubjects.has(principal.accountId))
      throw new ControlAuthError("cloud_access_not_enabled");
    const issued = this.sessionWrite(principal, principal.refreshFamily);
    const consumed = await this.repository.consumeRefresh(hash, issued.value);
    if (consumed === "reused") throw new ControlAuthError("refresh_reused");
    if (!consumed) throw new ControlAuthError("invalid_refresh");
    const devices = await this.repository.listDevices(principal.accountId);
    const device = devices.find((item) => item.id === principal.deviceId);
    if (!device) throw new ControlAuthError("invalid_refresh");
    return {
      schemaVersion: 1,
      accessToken: issued.accessToken,
      accessExpiresInSeconds: ACCESS_SECONDS,
      refreshToken: issued.refreshToken,
      refreshExpiresInSeconds: REFRESH_SECONDS,
      account: accountView(principal),
      device,
    };
  }
}
