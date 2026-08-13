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
