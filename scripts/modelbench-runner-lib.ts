import type {
  AttemptClassification,
  BenchmarkAttemptV1,
  JsonObject,
  ModelSeat,
  RequestedSeatV1,
  ResolvedSeatV1,
  RoleUsageV1,
  ScenarioStateV2,
} from "@opensidebar/scenario-contracts";
import {
  scenarioEngine,
  type EngineCaseDefinitionV1,
} from "@opensidebar/scenario-engine";

export interface ModelBenchRunConfiguration {
  label: string;
  provider: string;
  seats: Partial<Record<ModelSeat, RequestedSeatV1>>;
  perceptionMode?: string;
}

export interface ModelBenchDriverInput {
  definition: EngineCaseDefinitionV1;
  configuration: ModelBenchRunConfiguration;
  attemptId: string;
  repetition: number;
}

export interface ModelBenchDriverResult {
  durationMs: number;
  finalState?: ScenarioStateV2;
  finalAnswer?: string;
  terminalOutcome?: string;
  resolvedSeats: Partial<Record<ModelSeat, ResolvedSeatV1>>;
  usageByRole: Partial<Record<ModelSeat, RoleUsageV1>>;
  telemetry?: BenchmarkAttemptV1["telemetry"];
  artifactRefs: readonly string[];
  failure?: {
    kind: "provider" | "harness" | "indeterminate";
    reason: string;
  };
  diagnostics?: JsonObject;
}

export interface ModelBenchDriver {
  execute(input: ModelBenchDriverInput): Promise<ModelBenchDriverResult>;
  close?(): Promise<void>;
}

export interface RunCaseOptions {
  definition: EngineCaseDefinitionV1;
  configuration: ModelBenchRunConfiguration;
  driver: ModelBenchDriver;
  buildRevision: string;
  repetition: number;
  now?: () => Date;
  id?: () => string;
}

function seatMismatch(
  requested: Partial<Record<ModelSeat, RequestedSeatV1>>,
  resolved: Partial<Record<ModelSeat, ResolvedSeatV1>>,
): string[] {
  const mismatches: string[] = [];
  for (const [seat, wanted] of Object.entries(requested) as Array<
    [ModelSeat, RequestedSeatV1]
  >) {
    const actual = resolved[seat];
    if (!actual) {
      mismatches.push(`${seat}: no resolved model recorded`);
      continue;
    }
    if (actual.resolvedModel !== wanted.model) {
      mismatches.push(
        `${seat}: requested ${wanted.model}, resolved ${actual.resolvedModel}`,
      );
    }
    if (
      wanted.providerPin &&
      actual.resolvedProvider.toLocaleLowerCase() !==
        wanted.providerPin.toLocaleLowerCase()
    ) {
      mismatches.push(
        `${seat}: provider pin ${wanted.providerPin}, resolved ${actual.resolvedProvider}`,
      );
    }
  }
  return mismatches;
}

function classificationFor(
  result: ModelBenchDriverResult,
  validationPassed: boolean | null,
  modelMismatch: boolean,
): AttemptClassification {
  if (result.failure?.kind === "provider") return "provider_failure";
  if (result.failure?.kind === "harness") return "harness_failure";
  if (modelMismatch) return "indeterminate";
  if (result.failure) return "indeterminate";
  return validationPassed ? "valid_pass" : "valid_model_failure";
}

function scoreEligible(classification: AttemptClassification): boolean {
  return (
    classification === "valid_pass" ||
    classification === "valid_model_failure"
  );
}

function retryable(classification: AttemptClassification): boolean {
  return (
    classification === "provider_failure" ||
    classification === "harness_failure"
  );
}

export async function runModelBenchCase(
  options: RunCaseOptions,
): Promise<BenchmarkAttemptV1[]> {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? (() => crypto.randomUUID());
  const attempts: BenchmarkAttemptV1[] = [];
  let retryOfAttemptId: string | undefined;
  for (let tryIndex = 0; tryIndex < 2; tryIndex += 1) {
    const attemptId = id();
    const startedAt = now().toISOString();
    const result = await options.driver.execute({
      definition: options.definition,
      configuration: options.configuration,
      attemptId,
      repetition: options.repetition,
    });
    const mismatches = seatMismatch(
      options.configuration.seats,
      result.resolvedSeats,
    );
    const validation = result.finalState
      ? scenarioEngine.validate({
          definition: options.definition,
          initialState: scenarioEngine.initialize(options.definition.contract.id),
          finalState: result.finalState,
          finalAnswer: result.finalAnswer,
          terminalOutcome: result.terminalOutcome,
        })
      : null;
    const classification = classificationFor(
      result,
      validation?.verdict === "pass",
      mismatches.length > 0,
    );
    const attempt: BenchmarkAttemptV1 = {
      schemaVersion: 1,
      attemptId,
      caseId: options.definition.contract.id,
      caseVersion: options.definition.contract.version,
      caseContentHash: options.definition.contentHash,
      buildRevision: options.buildRevision,
      startedAt,
      durationMs: result.durationMs,
      classification,
      scoreEligible: scoreEligible(classification),
      requestedSeats: options.configuration.seats,
      resolvedSeats: result.resolvedSeats,
      usageByRole: result.usageByRole,
      ...(result.telemetry ? { telemetry: result.telemetry } : {}),
      validation,
      ...(retryOfAttemptId ? { retryOfAttemptId } : {}),
      artifactRefs: result.artifactRefs,
    };
    attempts.push(attempt);
    if (!retryable(classification) || tryIndex === 1) break;
    retryOfAttemptId = attempt.attemptId;
  }
  return attempts;
}

export interface RunSuiteOptions {
  definitions: readonly EngineCaseDefinitionV1[];
  configurations: readonly ModelBenchRunConfiguration[];
  driver: ModelBenchDriver;
  buildRevision: string;
  repeat: number;
  onAttempt?: (attempt: BenchmarkAttemptV1) => void | Promise<void>;
}

export async function runModelBenchSuite(
  options: RunSuiteOptions,
): Promise<BenchmarkAttemptV1[]> {
  const attempts: BenchmarkAttemptV1[] = [];
  for (const configuration of options.configurations) {
    for (let repetition = 1; repetition <= options.repeat; repetition += 1) {
      for (const definition of options.definitions) {
        const caseAttempts = await runModelBenchCase({
          definition,
          configuration,
          driver: options.driver,
          buildRevision: options.buildRevision,
          repetition,
        });
        for (const attempt of caseAttempts) {
          attempts.push(attempt);
          await options.onAttempt?.(attempt);
        }
      }
    }
  }
  return attempts;
}
