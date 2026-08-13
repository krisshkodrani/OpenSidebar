import type { JsonObject } from "./json.js";

export const SCENARIO_SCHEMA_VERSION = 2 as const;
export const BENCHMARK_CASE_SCHEMA_VERSION = 1 as const;

export type ScenarioVisibility = "public" | "internal";
export type ScenarioFamily =
  | "retail"
  | "procurement"
  | "crm"
  | "email"
  | "collaboration"
  | "hr"
  | "records"
  | "analytics"
  | "knowledge"
  | "jobs"
  | "monitoring"
  | "durability";

export type BenchmarkPrimaryRole =
  | "executor"
  | "planner"
  | "perception"
  | "judge"
  | "orchestration"
  | "integrated";

export type BenchmarkDifficulty = "easy" | "medium" | "hard";
export type BenchmarkCharacter =
  | "realistic"
  | "diagnostic"
  | "adversarial";
export type BenchmarkSuite = "smoke-10" | "core-20" | "standard-50" | "full-100";
export type ApprovalPolicy =
  | "none"
  | "confirm-consequential"
  | "require-clarification"
  | "deny-destructive";

export interface ScenarioManifestV2 {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  id: string;
  version: number;
  family: ScenarioFamily;
  title: string;
  description: string;
  visibility: readonly ScenarioVisibility[];
  contentHash: string;
}

export interface BenchmarkCaseV1 {
  schemaVersion: typeof BENCHMARK_CASE_SCHEMA_VERSION;
  id: string;
  version: number;
  title: string;
  prompt: string;
  scenarioId: string;
  scenarioVersion: number;
  seed: number;
  difficulty: BenchmarkDifficulty;
  character: BenchmarkCharacter;
  primaryRole: BenchmarkPrimaryRole;
  capabilityTags: readonly string[];
  suites: readonly BenchmarkSuite[];
  maxTurns: number;
  timeoutMs: number;
  approvalPolicy: ApprovalPolicy;
  validatorId: string;
  roleRationale: string;
  metadata?: JsonObject;
}

export interface PublicScenarioCatalogEntryV2 {
  id: string;
  version: number;
  family: ScenarioFamily;
  title: string;
  description: string;
  suggestedTasks: readonly string[];
}
