import type { ScenarioStateV2, ValidationResultV1 } from "@opensidebar/scenario-contracts";
import { scenarioEngine } from "./engine.js";
import type { EngineCaseDefinitionV1, OracleOutcomeV1 } from "./types.js";

export function applyOutcome(
  initialState: ScenarioStateV2,
  outcome: OracleOutcomeV1,
): ScenarioStateV2 {
  return outcome.actions.reduce(
    (state, action) => scenarioEngine.apply(state, action),
    initialState,
  );
}

export function runOracle(
  definition: EngineCaseDefinitionV1,
  outcome: OracleOutcomeV1 = definition.oracle,
): ValidationResultV1 {
  const initialState = scenarioEngine.initialize(definition.contract.id);
  const finalState = applyOutcome(initialState, outcome);
  return scenarioEngine.validate({
    definition,
    initialState,
    finalState,
    finalAnswer: outcome.finalAnswer,
    terminalOutcome: outcome.terminalOutcome,
  });
}
