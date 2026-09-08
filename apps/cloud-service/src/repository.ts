import type { SandboxRun } from "@opensidebar/sandbox-contracts";

export type OwnedRun = SandboxRun & { accountId: string };
export type SessionRecord = {
  accountId: string;
  email: string;
  csrfHash: string;
};
export type AuthFlow = { codeVerifier: string; returnPath: string };
export type StoredEmailChallenge = {
  mode: "signup" | "signin";
  providerSession?: string;
  accountId?: string;
};

export interface PlaygroundRepository {
  health(): Promise<void>;
  cleanupExpired(): Promise<void>;
  session(sessionHash: string): Promise<SessionRecord | null>;
  revokeSession(sessionHash: string): Promise<void>;
  createAuthFlow(
    stateHash: string,
    codeVerifier: string,
    returnPath: string,
    expiresAt: Date,
  ): Promise<void>;
  consumeAuthFlow(stateHash: string): Promise<AuthFlow | null>;
  consumeAuthQuota(
    subjectHash: string,
    windowSeconds: number,
    limit: number,
  ): Promise<void>;
  createEmailChallenge(
    challengeHash: string,
    emailHash: string,
    challenge: StoredEmailChallenge,
    expiresAt: Date,
  ): Promise<void>;
  beginEmailChallenge(
    challengeHash: string,
    emailHash: string,
  ): Promise<StoredEmailChallenge | null>;
  consumeEmailChallenge(challengeHash: string): Promise<boolean>;
  createSession(
    sessionHash: string,
    accountId: string,
    email: string,
    csrfHash: string,
    expiresAt: Date,
  ): Promise<void>;
  listRuns(accountId: string): Promise<OwnedRun[]>;
  findIdempotentRun(
    accountId: string,
    keyHash: string,
  ): Promise<OwnedRun | null>;
  createRun(
    run: OwnedRun,
    quotaSubjectHash: string,
    keyHash: string,
  ): Promise<void>;
  getRun(runId: string): Promise<OwnedRun | null>;
  updateRun(run: OwnedRun, expectedRevision: number): Promise<boolean>;
  expireRun(accountId: string, runId: string): Promise<boolean>;
  createLaunch(
    tokenHash: string,
    runId: string,
    accountId: string,
    expiresAt: Date,
  ): Promise<void>;
  consumeLaunch(tokenHash: string): Promise<string | null>;
  createTargetSession(
    sessionHash: string,
    runId: string,
    expiresAt: Date,
  ): Promise<void>;
  targetRunId(sessionHash: string): Promise<string | null>;
  close(): Promise<void>;
}
