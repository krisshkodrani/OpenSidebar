import type {
  BenchmarkAttemptV1,
  ScenarioActionV2,
  ScenarioRunV2,
} from "@opensidebar/scenario-contracts";
import type {
  CreateScenarioRunV2,
  ScenarioStoreV2,
} from "@opensidebar/scenario-engine";

export interface ModelBenchRepository extends ScenarioStoreV2 {
  createLaunch(tokenHash: string, runId: string, ownerId: string, expiresAt: string): Promise<void>;
  consumeLaunch(tokenHash: string): Promise<string | null>;
  createTargetSession(sessionHash: string, runId: string, expiresAt: string): Promise<void>;
  targetRunId(sessionHash: string): Promise<string | null>;
  saveAttempt(attempt: BenchmarkAttemptV1, expiresAt: string): Promise<void>;
  attempt(id: string): Promise<BenchmarkAttemptV1 | null>;
  listAttempts(caseId?: string): Promise<BenchmarkAttemptV1[]>;
  cleanupExpired(now: string): Promise<{ runs: number; attempts: number }>;
}

export type {
  BenchmarkAttemptV1,
  CreateScenarioRunV2,
  ScenarioActionV2,
  ScenarioRunV2,
};
