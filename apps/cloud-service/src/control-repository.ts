import type {
  CloudDeviceV1,
  CloudRemoteWorkSettingsV1,
  CloudPreferencesV1,
  CloudProviderId,
  CredentialStatusV1,
} from "@opensidebar/shared-types";

export type ControlAccount = {
  accountId: string;
  email: string;
  sessionEpoch: number;
  cloudAccess: boolean;
};

export type ControlPrincipal = ControlAccount & {
  deviceId: string;
  installationId: string;
};
export type RefreshPrincipal = ControlPrincipal & { refreshFamily: string };

export type DeviceSessionWrite = {
  id: string;
  accountId: string;
  deviceId: string;
  sessionEpoch: number;
  accessHash: string;
  accessExpiresAt: Date;
  refreshHash: string;
  refreshFamily: string;
  refreshExpiresAt: Date;
};

export type EncryptedCredentialRecord = {
  accountId: string;
  provider: CloudProviderId;
  ciphertext: string;
  encryptedDataKey: string;
  fingerprint: string;
  verification: "valid" | "unavailable";
  lastVerifiedAt: string;
  updatedAt: string;
};

export type RelayUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

export interface ControlRepository {
  migrate(): Promise<void>;
  health(): Promise<void>;
  cleanupExpired(): Promise<void>;
  upsertAccount(
    accountId: string,
    email: string,
    cloudAccess: boolean,
  ): Promise<ControlAccount>;
  account(accountId: string): Promise<ControlAccount | null>;
  upsertDevice(
    accountId: string,
    installationId: string,
    displayName: string,
    extensionVersion: string,
    connectionKind: CloudDeviceV1["connectionKind"],
  ): Promise<CloudDeviceV1>;
  createDeviceSession(session: DeviceSessionWrite): Promise<void>;
  accessPrincipal(accessHash: string): Promise<ControlPrincipal | null>;
  refreshPrincipal(refreshHash: string): Promise<RefreshPrincipal | null>;
  consumeRefresh(
    refreshHash: string,
    replacement: DeviceSessionWrite,
  ): Promise<ControlPrincipal | "reused" | null>;
  revokeAccessSession(accessHash: string): Promise<void>;
  listDevices(accountId: string): Promise<CloudDeviceV1[]>;
  renameDevice(
    accountId: string,
    deviceId: string,
    expectedRevision: number,
    displayName: string,
  ): Promise<CloudDeviceV1 | "revision_conflict" | null>;
  revokeDevice(accountId: string, deviceId: string): Promise<boolean>;
  remoteWorkSettings(accountId: string): Promise<CloudRemoteWorkSettingsV1>;
  putRemoteWorkSettings(
    accountId: string,
    expectedRevision: number,
    enabled: boolean,
  ): Promise<CloudRemoteWorkSettingsV1 | "revision_conflict">;
  logoutAll(accountId: string): Promise<number>;
  createDeviceLink(
    codeHash: string,
    accountId: string,
    expiresAt: Date,
  ): Promise<void>;
  consumeDeviceLink(codeHash: string): Promise<ControlAccount | null>;
  preferences(accountId: string): Promise<CloudPreferencesV1 | null>;
  putPreferences(
    accountId: string,
    expectedRevision: number,
    preferences: CloudPreferencesV1,
  ): Promise<boolean>;
  credential(
    accountId: string,
    provider: CloudProviderId,
  ): Promise<EncryptedCredentialRecord | null>;
  credentialStatuses(accountId: string): Promise<CredentialStatusV1[]>;
  putCredential(record: EncryptedCredentialRecord): Promise<void>;
  deleteCredential(accountId: string, provider: CloudProviderId): Promise<void>;
  relayUsage(accountId: string): Promise<RelayUsage>;
  recoverInterruptedRelayRequests(before: Date): Promise<number>;
  beginRelayRequest(
    accountId: string,
    requestId: string,
    provider: CloudProviderId,
    modelId: string,
    requestLimit: number,
    tokenLimit: number,
  ): Promise<RelayUsage>;
  finishRelayRequest(
    accountId: string,
    requestId: string,
    status: "completed" | "failed" | "cancelled",
    statusClass: number,
    inputTokens: number,
    outputTokens: number,
    latencyBucket: string,
  ): Promise<void>;
  close(): Promise<void>;
}
