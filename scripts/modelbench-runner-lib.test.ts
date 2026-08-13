import assert from "node:assert/strict";
import test from "node:test";
import type { ModelSeat, ResolvedSeatV1 } from "@opensidebar/scenario-contracts";
import {
  applyOutcome,
  MODEL_BENCH_CASES,
  MODEL_BENCH_ACCEPTANCE_CASES,
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

test("provider failure retries even when no model could be resolved", async () => {
  let calls = 0;
  const attempts = await runModelBenchCase({
    definition,
    configuration,
    driver: {
      async execute() {
        calls += 1;
        return calls === 1
          ? {
              durationMs: 5,
              resolvedSeats: {},
              usageByRole: {},
              artifactRefs: [],
              failure: { kind: "provider", reason: "upstream unavailable" },
            }
          : {
              durationMs: 5,
              finalState: applyOutcome(
                scenarioEngine.initialize(definition.contract.id),
                definition.oracle,
              ),
              finalAnswer: definition.oracle.finalAnswer,
              terminalOutcome: definition.oracle.terminalOutcome,
              resolvedSeats: resolved,
              usageByRole: {},
              artifactRefs: [],
            };
      },
    },
    buildRevision: "test",
    repetition: 1,
    id: idFactory(),
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].classification, "provider_failure");
  assert.equal(attempts[1].classification, "valid_pass");
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

test("an unused requested seat does not invalidate an otherwise valid attempt", async () => {
  const attempts = await runModelBenchCase({
    definition,
    configuration: {
      ...configuration,
      seats: {
        ...configuration.seats,
        judge: { provider: "openrouter", model: "openai/judge" },
      },
    },
    driver: {
      async execute() {
        const initial = scenarioEngine.initialize(definition.contract.id);
        return {
          durationMs: 5,
          finalState: applyOutcome(initial, definition.oracle),
          finalAnswer: definition.oracle.finalAnswer,
          terminalOutcome: definition.oracle.terminalOutcome,
          resolvedSeats: resolved,
          usageByRole: { executor: { calls: 1, promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0, llmTimeMs: 1 } },
          artifactRefs: [],
        };
      },
    },
    buildRevision: "abc",
    repetition: 1,
    id: idFactory(),
  });

  assert.equal(attempts[0]?.classification, "valid_pass");
});

test("driver evidence participates in the authoritative MB-101 verdict", async () => {
  const acceptance = MODEL_BENCH_ACCEPTANCE_CASES[0]!;
  const initial = scenarioEngine.initialize(acceptance.contract.id);
  const finalState = applyOutcome(initial, acceptance.oracle);
  const run = async (driverEvidence: Record<string, boolean>) =>
    runModelBenchCase({
      definition: acceptance,
      configuration: { label: "test", provider: "openrouter", seats: {} },
      driver: {
        async execute() {
          return {
            durationMs: 5,
            finalState,
            finalAnswer: acceptance.oracle.finalAnswer,
            driverEvidence,
            resolvedSeats: {},
            usageByRole: {},
            artifactRefs: [],
          };
        },
      },
      buildRevision: "abc",
      repetition: 1,
      id: idFactory(),
    });

  const passed = await run(acceptance.oracle.driverEvidence as Record<string, boolean>);
  assert.equal(passed[0]?.classification, "valid_pass");

  const failed = await run({
    ...(acceptance.oracle.driverEvidence as Record<string, boolean>),
    spawnedTabInWorkspaceGroup: false,
  });
  assert.equal(failed[0]?.classification, "valid_model_failure");
  assert.equal(
    failed[0]?.validation?.assertions.find((item) =>
      item.id.endsWith("spawnedTabInWorkspaceGroup"),
    )?.passed,
    false,
  );
});
