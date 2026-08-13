import assert from "node:assert/strict";
import test from "node:test";
import type { ModelSeat, ResolvedSeatV1 } from "@opensidebar/scenario-contracts";
import {
  applyOutcome,
  MODEL_BENCH_CASES,
  scenarioEngine,
} from "@opensidebar/scenario-engine";
import {
  runModelBenchCase,
  type ModelBenchDriver,
  type ModelBenchRunConfiguration,
} from "./modelbench-runner-lib.js";

const definition = MODEL_BENCH_CASES[0]!;
const configuration: ModelBenchRunConfiguration = {
  label: "test",
  provider: "openrouter",
  seats: {
    executor: {
      provider: "openrouter",
      providerPin: "openai",
      model: "openai/executor",
    },
  },
};
const resolved: Partial<Record<ModelSeat, ResolvedSeatV1>> = {
  executor: {
    provider: "openrouter",
    providerPin: "openai",
    model: "openai/executor",
    resolvedProvider: "openai",
    resolvedModel: "openai/executor",
  },
};

function idFactory() {
  let index = 0;
  return () => `attempt-${++index}`;
}

test("valid model failure is scored and never retried", async () => {
  let calls = 0;
  const driver: ModelBenchDriver = {
    async execute() {
      calls += 1;
      return {
        durationMs: 100,
        finalState: scenarioEngine.initialize(definition.contract.id),
        resolvedSeats: resolved,
        usageByRole: {},
        artifactRefs: [],
      };
    },
  };
  const attempts = await runModelBenchCase({
    definition,
    configuration,
    driver,
    buildRevision: "abc",
    repetition: 1,
    id: idFactory(),
  });
  assert.equal(calls, 1);
  assert.equal(attempts[0]?.classification, "valid_model_failure");
  assert.equal(attempts[0]?.scoreEligible, true);
});

test("one provider failure is preserved and retried once", async () => {
  let calls = 0;
  const driver: ModelBenchDriver = {
    async execute() {
      calls += 1;
      if (calls === 1) {
        return {
          durationMs: 100,
          resolvedSeats: resolved,
          usageByRole: {},
          artifactRefs: [],
          failure: { kind: "provider", reason: "rate limited" },
        };
      }
      const initial = scenarioEngine.initialize(definition.contract.id);
      return {
        durationMs: 100,
        finalState: applyOutcome(initial, definition.oracle),
        finalAnswer: definition.oracle.finalAnswer,
        terminalOutcome: definition.oracle.terminalOutcome,
        resolvedSeats: resolved,
        usageByRole: {},
        artifactRefs: [],
      };
    },
  };
  const attempts = await runModelBenchCase({
    definition,
    configuration,
    driver,
    buildRevision: "abc",
    repetition: 1,
    id: idFactory(),
  });
  assert.equal(calls, 2);
  assert.equal(attempts[0]?.classification, "provider_failure");
  assert.equal(attempts[1]?.classification, "valid_pass");
  assert.equal(attempts[1]?.retryOfAttemptId, attempts[0]?.attemptId);
});

test("resolved seat mismatch is ineligible and not retried", async () => {
  const driver: ModelBenchDriver = {
    async execute() {
      const initial = scenarioEngine.initialize(definition.contract.id);
      return {
        durationMs: 100,
        finalState: applyOutcome(initial, definition.oracle),
        resolvedSeats: {
          executor: {
            ...resolved.executor!,
            resolvedModel: "different-model",
          },
        },
        usageByRole: {},
        artifactRefs: [],
      };
    },
  };
  const attempts = await runModelBenchCase({
    definition,
    configuration,
    driver,
    buildRevision: "abc",
    repetition: 1,
    id: idFactory(),
  });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.classification, "indeterminate");
  assert.equal(attempts[0]?.scoreEligible, false);
});
