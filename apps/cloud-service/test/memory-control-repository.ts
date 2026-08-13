import type {
  CloudDeviceV1,
  CloudPreferencesV1,
  CloudProviderId,
  CredentialStatusV1,
} from "@opensidebar/shared-types";
import type {
  ControlAccount,
  ControlPrincipal,
  ControlRepository,
  DeviceSessionWrite,
  EncryptedCredentialRecord,
  RefreshPrincipal,
  RelayUsage,
} from "../src/control-repository.js";

export class MemoryControlRepository implements ControlRepository {
  accounts = new Map<string, ControlAccount>();
  devices = new Map<string, CloudDeviceV1 & { accountId: string }>();
  sessions = new Map<
    string,
    DeviceSessionWrite & { rotated: boolean; revoked: boolean }
  >();
  links = new Map<string, string>();
  preferenceValues = new Map<string, CloudPreferencesV1>();
  credentials = new Map<string, EncryptedCredentialRecord>();
  requests = new Map<
    string,
    { status: string; statusClass?: number; updatedAt?: Date }
  >();
  usage: RelayUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  remoteWork = new Map<string, { enabled: boolean; revision: number; updatedAt: string }>();
  async migrate() {}
  async health() {}
  async cleanupExpired() {}
  async close() {}
  async upsertAccount(accountId: string, email: string, cloudAccess: boolean) {
    const prior = this.accounts.get(accountId);
    const value = {
      accountId,
      email,
      sessionEpoch: prior?.sessionEpoch ?? 0,
      cloudAccess: prior?.cloudAccess || cloudAccess || false,
    };
    this.accounts.set(accountId, value);
    return value;
  }
  async account(accountId: string) {
    return this.accounts.get(accountId) ?? null;
  }
  async upsertDevice(
    accountId: string,
    installationId: string,
    displayName: string,
    extensionVersion: string,
    connectionKind: CloudDeviceV1["connectionKind"] = "browser_extension",
    revive = true,
  ) {
    const found = [...this.devices.values()].find(
      (item) =>
        item.accountId === accountId && item.installationId === installationId,
    );
    const value = {
      schemaVersion: 1 as const,
      id: found?.id ?? `dev_${this.devices.size + 1}`,
      accountId,
      installationId,
      displayName: found?.displayName ?? displayName,
      displayNameRevision: found?.displayNameRevision ?? 1,
      extensionVersion,
      connectionKind,
      capabilities: found?.capabilities ?? [],
      availability: (!revive && found?.revokedAt ? "revoked" : "online") as "online" | "revoked",
      createdAt: found?.createdAt ?? new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      ...(!revive && found?.revokedAt ? { revokedAt: found.revokedAt } : {}),
    };
    this.devices.set(value.id, value);
    return value;
  }
  async markRemoteMissionReady(accountId: string, deviceId: string) {
    const device = this.devices.get(deviceId);
    if (
      !device ||
      device.accountId !== accountId ||
      device.connectionKind !== "browser_extension" ||
      device.revokedAt
    ) return false;
    device.capabilities = ["remote_browser_tasks_v1"];
    device.availability = "online";
    device.lastSeenAt = new Date().toISOString();
    return true;
  }
  async createDeviceSession(session: DeviceSessionWrite) {
    this.sessions.set(session.refreshHash, {
      ...session,
      rotated: false,
      revoked: false,
    });
  }
  private principal(value: DeviceSessionWrite) {
    const account = this.accounts.get(value.accountId),
      device = this.devices.get(value.deviceId);
    return account && device
      ? {
          ...account,
          deviceId: device.id,
          installationId: device.installationId,
        }
      : null;
  }
  async accessPrincipal(accessHash: string) {
    const value = [...this.sessions.values()].find(
      (item) =>
        item.accessHash === accessHash &&
        !item.revoked &&
        item.accessExpiresAt > new Date(),
    );
    return value ? this.principal(value) : null;
  }
  async refreshPrincipal(
    refreshHash: string,
  ): Promise<RefreshPrincipal | null> {
    const value = this.sessions.get(refreshHash);
    const principal = value ? this.principal(value) : null;
    return value && principal && value.refreshExpiresAt > new Date()
      ? { ...principal, refreshFamily: value.refreshFamily }
      : null;
  }
  async consumeRefresh(
    refreshHash: string,
    replacement: DeviceSessionWrite,
  ): Promise<ControlPrincipal | "reused" | null> {
    const value = this.sessions.get(refreshHash);
    if (!value) return null;
    if (value.rotated || value.revoked) {
      for (const item of this.sessions.values())
        if (item.refreshFamily === value.refreshFamily) item.revoked = true;
      return "reused";
    }
    const principal = this.principal(value);
    if (!principal) return null;
    value.rotated = true;
    value.revoked = true;
    await this.createDeviceSession(replacement);
    return principal;
  }
  async revokeAccessSession(accessHash: string) {
    const value = [...this.sessions.values()].find(
      (item) => item.accessHash === accessHash,
    );
    if (value) value.revoked = true;
  }
  async listDevices(accountId: string) {
    return [...this.devices.values()]
      .filter((item) => item.accountId === accountId)
      .map(({ accountId: _accountId, ...item }) => item);
  }
  async renameDevice(
    accountId: string,
    deviceId: string,
    expectedRevision: number,
    displayName: string,
  ) {
    const value = this.devices.get(deviceId);
    if (!value || value.accountId !== accountId || value.revokedAt) return null;
    if (value.displayNameRevision !== expectedRevision)
      return "revision_conflict" as const;
    value.displayName = displayName;
    value.displayNameRevision += 1;
    const { accountId: _accountId, ...device } = value;
    return device;
  }
  async revokeDevice(accountId: string, deviceId: string) {
    const value = this.devices.get(deviceId);
    if (!value || value.accountId !== accountId) return false;
    value.revokedAt = new Date().toISOString();
    value.availability = "revoked";
    for (const session of this.sessions.values())
      if (session.deviceId === deviceId) session.revoked = true;
    return true;
  }
  async remoteWorkSettings(accountId: string) {
    const value = this.remoteWork.get(accountId) ?? {
      enabled: false,
      revision: 1,
      updatedAt: new Date().toISOString(),
    };
    this.remoteWork.set(accountId, value);
    return { schemaVersion: 1 as const, ...value };
  }
  async putRemoteWorkSettings(accountId: string, expectedRevision: number, enabled: boolean) {
    const current = await this.remoteWorkSettings(accountId);
    if (current.revision !== expectedRevision) return "revision_conflict" as const;
    const value = { enabled, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    this.remoteWork.set(accountId, value);
    return { schemaVersion: 1 as const, ...value };
  }
  async logoutAll(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account) return 0;
    account.sessionEpoch += 1;
    for (const item of this.sessions.values())
      if (item.accountId === accountId) item.revoked = true;
    return account.sessionEpoch;
  }
  async createDeviceLink(hash: string, accountId: string, _expiresAt: Date) {
    this.links.set(hash, accountId);
  }
  async consumeDeviceLink(hash: string) {
    const id = this.links.get(hash);
    this.links.delete(hash);
    return id ? (this.accounts.get(id) ?? null) : null;
  }
  async preferences(accountId: string) {
    return this.preferenceValues.get(accountId) ?? null;
  }
  async putPreferences(
    accountId: string,
    expected: number,
    value: CloudPreferencesV1,
  ) {
    const current = this.preferenceValues.get(accountId);
    if ((current?.revision ?? 0) !== expected) return false;
    this.preferenceValues.set(accountId, value);
    return true;
  }
  private credentialKey(accountId: string, provider: CloudProviderId) {
    return `${accountId}:${provider}`;
  }
  async credential(accountId: string, provider: CloudProviderId) {
    return (
      this.credentials.get(this.credentialKey(accountId, provider)) ?? null
    );
  }
  async credentialStatuses(accountId: string): Promise<CredentialStatusV1[]> {
    return (["openrouter", "fireworks"] as const).map((provider) => {
      const item = this.credentials.get(
        this.credentialKey(accountId, provider),
      );
      return item
        ? {
            schemaVersion: 1,
            provider,
            configured: true,
            fingerprint: item.fingerprint,
            lastVerifiedAt: item.lastVerifiedAt,
            verification: item.verification,
          }
        : {
            schemaVersion: 1,
            provider,
            configured: false,
            verification: "never",
          };
    });
  }
  async putCredential(value: EncryptedCredentialRecord) {
    this.credentials.set(
      this.credentialKey(value.accountId, value.provider),
      value,
    );
  }
  async deleteCredential(accountId: string, provider: CloudProviderId) {
    this.credentials.delete(this.credentialKey(accountId, provider));
  }
  async relayUsage() {
    return { ...this.usage };
  }
  async recoverInterruptedRelayRequests(before: Date) {
    let recovered = 0;
    for (const request of this.requests.values()) {
      if (
        request.status !== "active" ||
        (request.updatedAt?.getTime() ?? 0) >= before.getTime()
      )
        continue;
      request.status = "failed";
      recovered += 1;
    }
    return recovered;
  }
  async beginRelayRequest(
    accountId: string,
    requestId: string,
    _provider: CloudProviderId,
    _model: string,
    requestLimit: number,
    tokenLimit: number,
  ) {
    const key = `${accountId}:${requestId}`;
    if (this.requests.has(key))
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    if (
      this.usage.requests >= requestLimit ||
      this.usage.inputTokens + this.usage.outputTokens >= tokenLimit
    )
      throw Object.assign(new Error("quota"), { code: "relay_quota" });
    this.requests.set(key, { status: "active", updatedAt: new Date() });
    this.usage.requests += 1;
    return { ...this.usage };
  }
  async finishRelayRequest(
    accountId: string,
    requestId: string,
    status: "completed" | "failed" | "cancelled",
    statusClass: number,
    input: number,
    output: number,
  ) {
    const value = this.requests.get(`${accountId}:${requestId}`);
    if (value) {
      value.status = status;
      value.statusClass = statusClass;
    }
    this.usage.inputTokens += input;
    this.usage.outputTokens += output;
  }
}
