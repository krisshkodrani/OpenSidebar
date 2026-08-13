import type {
  ScenarioActionV2,
  ScenarioStateV2,
  ScenarioTargetViewV2,
} from "@opensidebar/scenario-contracts";
import { MODEL_BENCH_CASES } from "./case-catalog.js";
import { SCENARIOS } from "./scenario-catalog.js";
import type {
  EngineCaseDefinitionV1,
  ScenarioDefinitionV2,
  ScenarioEngineV1,
  ValidationInputV1,
} from "./types.js";
import { validateCase } from "./validator.js";

function findVersioned<T>(
  values: readonly T[],
  id: string,
  version: number | undefined,
  identity: (value: T) => { id: string; version: number },
  label: string,
): T {
  const matches = values.filter((value) => {
    const key = identity(value);
    return key.id === id && (version === undefined || key.version === version);
  });
  const selected = matches.sort(
    (left, right) => identity(right).version - identity(left).version,
  )[0];
  if (!selected) throw new Error(`Unknown ${label}: ${id}${version ? `@${version}` : ""}`);
  return selected;
}

export class ScenarioEngine implements ScenarioEngineV1 {
  readonly scenarios = SCENARIOS;
  readonly cases = MODEL_BENCH_CASES;

  scenario(id: string, version?: number): ScenarioDefinitionV2 {
    return findVersioned(
      this.scenarios,
      id,
      version,
      (value) => ({ id: value.manifest.id, version: value.manifest.version }),
      "scenario",
    );
  }

  case(id: string, version?: number): EngineCaseDefinitionV1 {
    return findVersioned(
      this.cases,
      id,
      version,
      (value) => ({ id: value.contract.id, version: value.contract.version }),
      "case",
    );
  }

  initialize(caseId: string): ScenarioStateV2 {
    const definition = this.case(caseId);
    return this.scenario(
      definition.contract.scenarioId,
      definition.contract.scenarioVersion,
    ).createInitialState(definition.contract.seed, definition.control);
  }

  apply(state: ScenarioStateV2, action: ScenarioActionV2): ScenarioStateV2 {
    return this.scenario(state.scenarioId, state.scenarioVersion).reduce(state, action);
  }

  targetView(state: ScenarioStateV2): ScenarioTargetViewV2 {
    return this.scenario(state.scenarioId, state.scenarioVersion).projectTarget(state);
  }

  validate(input: ValidationInputV1) {
    return validateCase(input);
  }
}

export const scenarioEngine = new ScenarioEngine();
