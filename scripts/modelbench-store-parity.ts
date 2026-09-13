import type { BenchmarkSuite } from "@opensidebar/scenario-contracts";
import {
  MODEL_BENCH_CASES,
  scenarioEngine,
  stableJson,
  type EngineCaseDefinitionV1,
  type ScenarioStoreV2,
} from "@opensidebar/scenario-engine";

export interface StoreParityMismatch {
  caseId: string;
  stage: "initial" | "final-state" | "verdict";
  local: string;
  remote: string;
}

export async function compareScenarioStores(input: {
  local: ScenarioStoreV2;
  remote: ScenarioStoreV2;
  definitions?: readonly EngineCaseDefinitionV1[];
  id?: () => string;
}): Promise<StoreParityMismatch[]> {
  const definitions = input.definitions ?? MODEL_BENCH_CASES;
  const id = input.id ?? (() => crypto.randomUUID());
  const mismatches: StoreParityMismatch[] = [];
  const createdAt = "2026-08-13T12:00:00.000Z";
  const expiresAt = "2026-08-13T14:00:00.000Z";
  for (const definition of definitions) {
    const suffix = id();
    let local = await input.local.create({
      id: `parity-local-${suffix}`,
      ownerId: "modelbench-parity",
      caseId: definition.contract.id,
      createdAt,
      expiresAt,
    });
    let remote = await input.remote.create({
      id: `parity-remote-${suffix}`,
      ownerId: "modelbench-parity",
      caseId: definition.contract.id,
      createdAt,
      expiresAt,
    });
    const localInitial = stableJson(local.state);
    const remoteInitial = stableJson(remote.state);
    if (localInitial !== remoteInitial) {
      mismatches.push({
        caseId: definition.contract.id,
        stage: "initial",
        local: localInitial,
        remote: remoteInitial,
      });
      continue;
    }
    for (const action of definition.oracle.actions) {
      local = await input.local.apply(local.id, local.revision, action, createdAt);
      remote = await input.remote.apply(remote.id, remote.revision, action, createdAt);
    }
    const localState = stableJson(local.state);
    const remoteState = stableJson(remote.state);
    if (localState !== remoteState) {
      mismatches.push({
        caseId: definition.contract.id,
        stage: "final-state",
        local: localState,
        remote: remoteState,
      });
      continue;
    }
    const initialState = scenarioEngine.initialize(definition.contract.id);
    const localValidation = scenarioEngine.validate({
      definition,
      initialState,
      finalState: local.state,
      finalAnswer: definition.oracle.finalAnswer,
      terminalOutcome: definition.oracle.terminalOutcome,
    });
    const remoteValidation = scenarioEngine.validate({
      definition,
      initialState,
      finalState: remote.state,
      finalAnswer: definition.oracle.finalAnswer,
      terminalOutcome: definition.oracle.terminalOutcome,
    });
    if (localValidation.verdict !== remoteValidation.verdict) {
      mismatches.push({
        caseId: definition.contract.id,
        stage: "verdict",
        local: stableJson(localValidation),
        remote: stableJson(remoteValidation),
      });
    }
  }
  return mismatches;
}

export function definitionsForSuite(suite: BenchmarkSuite): EngineCaseDefinitionV1[] {
  return MODEL_BENCH_CASES.filter((definition) =>
    definition.contract.suites.includes(suite),
  );
}
