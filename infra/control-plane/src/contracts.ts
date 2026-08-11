export type CloudProviderId = "openrouter" | "fireworks";

export interface EncryptedCredential {
  accountId: string;
  provider: CloudProviderId;
  ciphertext: string;
  encryptedDataKey: string;
  fingerprintSuffix: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  verification: "never" | "valid" | "invalid" | "unavailable";
}

export interface CredentialCipher {
  encrypt(
    plaintext: string,
    context: Readonly<Record<string, string>>,
  ): Promise<{ ciphertext: string; encryptedDataKey: string }>;
  decrypt(
    encrypted: Pick<EncryptedCredential, "ciphertext" | "encryptedDataKey">,
    context: Readonly<Record<string, string>>,
  ): Promise<string>;
}

export interface CredentialRepository {
  get(accountId: string, provider: CloudProviderId): Promise<EncryptedCredential | null>;
  put(value: EncryptedCredential): Promise<void>;
  delete(accountId: string, provider: CloudProviderId): Promise<void>;
}

export interface ProviderVerifier {
  verify(provider: CloudProviderId, credential: string): Promise<void>;
}

export interface SafePreferences {
  schemaVersion: 1;
  revision: number;
  providerMode: CloudProviderId;
  executorModel?: string;
  plannerModel?: string;
  writerModel?: string;
  theme: "light" | "dark" | "system";
  showSessionMetrics: boolean;
  enabledSkillPackIds?: string[];
  disabledSkillIds?: string[];
}

export interface PreferencesRepository {
  get(accountId: string): Promise<SafePreferences | null>;
  putIfRevision(
    accountId: string,
    expectedRevision: number,
    next: SafePreferences,
  ): Promise<boolean>;
}
