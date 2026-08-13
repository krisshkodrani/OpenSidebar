export const PERSONAL_DATA_SYNC_SCHEMA_VERSION = 1 as const;

export type PersonalDataCategory = "saved_prompts" | "website_skills" | "profile";
export type PersonalDataSyncState =
  | "off"
  | "setting_up"
  | "waiting_for_approval"
  | "syncing"
  | "up_to_date"
  | "offline"
  | "conflict"
  | "needs_attention";

export interface PersonalDataCapabilitiesV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  reads: boolean;
  writes: boolean;
  profile: boolean;
  namedTester: boolean;
}

export interface PersonalDataDocumentMetadataV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  category: PersonalDataCategory;
  revision: number;
  keyEpoch: number;
  ciphertextSizeBytes: number;
  ciphertextSha256: string;
  updatedAt: string;
  updatedByDeviceId: string;
}

export interface PersonalDataDocumentEnvelopeV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  algorithm: "AES-256-GCM";
  category: PersonalDataCategory;
  revision: number;
  keyEpoch: number;
  nonce: string;
  ciphertext: string;
}

export interface PersonalDataDeviceKeyV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  deviceId: string;
  algorithm: "ECDH-P256";
  publicKeyJwk: JsonWebKey;
  keyEpoch: number;
  approvedAt?: string;
}

export interface PersonalDataApprovedDeviceV1 {
  deviceId: string;
  displayName: string;
  publicKeyJwk: JsonWebKey;
  keyEpoch: number;
  approvedAt: string;
  current: boolean;
}

export interface PersonalDataWrappedKeyV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  algorithm: "ECDH-P256+HKDF-SHA256+A256KW";
  keyEpoch: number;
  senderDeviceId: string;
  recipientDeviceId: string;
  senderEphemeralPublicKeyJwk: JsonWebKey;
  salt: string;
  wrappedPersonalDataKey: string;
}

export interface PersonalDataKeyRequestV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  id: string;
  requestingDeviceId: string;
  requestingDeviceName: string;
  verificationCode: string;
  publicKeyJwk: JsonWebKey;
  state: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  expiresAt: string;
  wrappedKey?: PersonalDataWrappedKeyV1;
}

export interface PersonalDataStatusV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  capabilities: PersonalDataCapabilitiesV1;
  keyEpoch: number;
  currentDeviceApproved: boolean;
  approvedDevices: PersonalDataApprovedDeviceV1[];
  documents: Partial<Record<PersonalDataCategory, PersonalDataDocumentMetadataV1>>;
  pendingRequestCount: number;
}

export interface LocalPersonalDataSyncPreferencesV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  accountId: string;
  preferencesEnabled: boolean;
  categories: Record<PersonalDataCategory, boolean>;
  lastSyncedRevisions: Partial<Record<PersonalDataCategory, number>>;
  lastSyncedHashes: Partial<Record<PersonalDataCategory, string>>;
  lastSuccessfulSyncAt?: string;
}

export interface PersonalDataConflictV1 {
  schemaVersion: typeof PERSONAL_DATA_SYNC_SCHEMA_VERSION;
  id: string;
  category: PersonalDataCategory;
  entityId?: string;
  localValue: unknown;
  cloudValue: unknown;
  createdAt: string;
}
