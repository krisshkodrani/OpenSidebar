import type {
  BenchmarkCaseV1,
  JsonObject,
  JsonValue,
  ScenarioActionV2,
  ScenarioManifestV2,
  ScenarioStateV2,
  ScenarioTargetViewV2,
  ValidationResultV1,
} from "@opensidebar/scenario-contracts";

export type AssertionSource = "state" | "answer" | "terminal" | "events" | "driver";
export type AssertionOperator =
  | "equals"
  | "includes"
  | "includes-normalized"
  | "includes-all-normalized"
  | "excludes-all-normalized"
  | "exists"
  | "not-exists"
  | "array-includes";

export interface ValidatorAssertionSpecV1 {
  id: string;
  source: AssertionSource;
  operator: AssertionOperator;
  path?: string;
  expected: JsonValue;
  evidence: string;
}

export interface ValidatorSpecV1 {
  id: string;
  version: number;
  assertions: readonly ValidatorAssertionSpecV1[];
  allowedMutationPaths: readonly string[];
}

export interface OracleOutcomeV1 {
  actions: readonly ScenarioActionV2[];
  finalAnswer?: string;
  terminalOutcome?: string;
  driverEvidence?: JsonObject;
}

export interface NearMissV1 {
  id: string;
  description: string;
  outcome: OracleOutcomeV1;
}

export interface ScenarioDefinitionV2 {
  manifest: ScenarioManifestV2;
  createInitialState(seed: number, control?: JsonObject): ScenarioStateV2;
  reduce(state: ScenarioStateV2, action: ScenarioActionV2): ScenarioStateV2;
  projectTarget(state: ScenarioStateV2): ScenarioTargetViewV2;
}

export interface EngineCaseDefinitionV1 {
  contract: BenchmarkCaseV1;
  contentHash: string;
  control: JsonObject;
  validator: ValidatorSpecV1;
  oracle: OracleOutcomeV1;
  nearMisses: readonly NearMissV1[];
}

export interface ValidationInputV1 {
  definition: EngineCaseDefinitionV1;
  initialState: ScenarioStateV2;
  finalState: ScenarioStateV2;
  finalAnswer?: string;
  terminalOutcome?: string;
  driverEvidence?: JsonObject;
}

export interface ScenarioEngineV1 {
  scenarios: readonly ScenarioDefinitionV2[];
  cases: readonly EngineCaseDefinitionV1[];
  scenario(id: string, version?: number): ScenarioDefinitionV2;
  case(id: string, version?: number): EngineCaseDefinitionV1;
  initialize(caseId: string): ScenarioStateV2;
  apply(state: ScenarioStateV2, action: ScenarioActionV2): ScenarioStateV2;
  targetView(state: ScenarioStateV2): ScenarioTargetViewV2;
  validate(input: ValidationInputV1): ValidationResultV1;
}

export type MutableJsonObject = { [key: string]: JsonValue };
