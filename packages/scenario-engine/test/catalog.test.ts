import assert from "node:assert/strict";
import test from "node:test";
import {
  checkModelBenchCatalog,
  MODEL_BENCH_ACCEPTANCE_CASES,
  MODEL_BENCH_CASES,
  runOracle,
  scenarioEngine,
  stableJson,
} from "../src/index.js";

test("ModelBench catalog has exactly the approved distributions", () => {
  assert.deepEqual(checkModelBenchCatalog(MODEL_BENCH_CASES), []);
});

test("MB-101 is a runnable acceptance case outside the frozen Full-100 score", () => {
  const definition = MODEL_BENCH_ACCEPTANCE_CASES[0]!;
  assert.equal(definition.contract.metadata?.ordinal, 101);
  assert.deepEqual(definition.contract.suites, []);
  assert.equal(runOracle(definition).verdict, "pass");
  for (const miss of definition.nearMisses) {
    assert.equal(runOracle(definition, miss.outcome).verdict, "fail", miss.id);
  }
});

test("every gold oracle passes and every declared near miss fails", () => {
  for (const definition of MODEL_BENCH_CASES) {
    assert.equal(
      runOracle(definition).verdict,
      "pass",
      `${definition.contract.id} gold oracle`,
    );
    for (const miss of definition.nearMisses) {
      assert.equal(
        runOracle(definition, miss.outcome).verdict,
        "fail",
        `${definition.contract.id} near miss ${miss.id}`,
      );
    }
  }
});

test("case initialization is deterministic and target projection hides controls", () => {
  for (const definition of MODEL_BENCH_CASES) {
    const left = scenarioEngine.initialize(definition.contract.id);
    const right = scenarioEngine.initialize(definition.contract.id);
    assert.equal(stableJson(left), stableJson(right), definition.contract.id);
    const target = scenarioEngine.targetView(left);
    assert.equal("control" in target.data, false, definition.contract.id);
    assert.equal(JSON.stringify(target).includes("expected"), false, definition.contract.id);
  }
});

test("validator ignores JSON object key order changes inside array state", () => {
  const definition = MODEL_BENCH_CASES.find((entry) => entry.contract.id === "retail.read-visual-stock-badge")!;
  const initialState = scenarioEngine.initialize(definition.contract.id);
  const finalState = JSON.parse(JSON.stringify(initialState)) as typeof initialState;
  const publicData = finalState.data.public as Record<string, unknown>;
  const presentation = publicData.presentation as Record<string, unknown>;
  const sourceItems = presentation.items as Array<Record<string, unknown>>;
  presentation.items = sourceItems.map((item) => Object.fromEntries(Object.entries(item).reverse()));
  const validation = scenarioEngine.validate({
    definition,
    initialState,
    finalState,
    finalAnswer: definition.oracle.finalAnswer,
  });
  assert.equal(validation.verdict, "pass");
  assert.deepEqual(validation.unexpectedMutations, []);
});

test("state cases keep submitted form input separate from final benchmark state", () => {
  const cases = [
    {
      id: "retail.change-delivery-address",
      submitted: "18 Willow Street, Portland, OR 97205",
      stored: "18 Willow Street, Portland, OR 97205",
    },
    {
      id: "procurement.mark-received",
      submitted: 24,
      stored: "received",
    },
  ] as const;

  for (const entry of cases) {
    const definition = MODEL_BENCH_CASES.find(
      (candidate) => candidate.contract.id === entry.id,
    )!;
    const initialState = scenarioEngine.initialize(entry.id);
    const finalState = scenarioEngine.apply(initialState, {
      type: "case.submit",
      payload: { value: entry.submitted },
    });
    const publicData = finalState.data.public as {
      case: { status: string; value: unknown };
    };
    assert.equal(definition.contract.version, 2, entry.id);
    assert.equal(definition.contract.validatorId, `${entry.id}.v2`, entry.id);
    assert.equal(definition.validator.version, 2, entry.id);
    assert.equal(publicData.case.status, "complete", entry.id);
    assert.equal(publicData.case.value, entry.stored, entry.id);
    assert.equal(
      scenarioEngine.validate({ definition, initialState, finalState }).verdict,
      "pass",
      entry.id,
    );
  }
});

test("CRM account-impact triage matches the workflow controls exposed by the target", () => {
  const definition = MODEL_BENCH_CASES.find(
    (entry) => entry.contract.id === "crm.triage-account-impact",
  )!;
  let state = scenarioEngine.initialize(definition.contract.id);
  const initialTarget = scenarioEngine.targetView(state);
  const initialPublic = initialTarget.data as {
    interaction: { requiresValue: boolean; submitLabel: string };
    workflow: Array<{
      id: string;
      evidence: Array<{ label: string; value: string }>;
    }>;
  };

  assert.equal(definition.contract.version, 2);
  assert.equal(definition.contract.validatorId, `${definition.contract.id}.v2`);
  assert.equal(definition.validator.version, 2);
  assert.match(definition.contract.prompt, /displayed High priority is appropriate/);
  assert.doesNotMatch(definition.contract.prompt, /add .*summary/i);
  assert.equal(initialPublic.interaction.requiresValue, false);
  assert.equal(initialPublic.interaction.submitLabel, "Triage account impact");
  assert.deepEqual(
    initialPublic.workflow.at(-1)?.evidence,
    [
      { label: "Record", value: "T-4312" },
      { label: "Current priority", value: "High" },
    ],
  );

  for (const stage of initialPublic.workflow) {
    state = scenarioEngine.apply(state, {
      type: "workflow.advance",
      payload: { stageId: stage.id },
    });
  }
  state = scenarioEngine.apply(state, {
    type: "case.submit",
    payload: { decision: "apply" },
  });

  assert.equal(
    scenarioEngine.validate({
      definition,
      initialState: scenarioEngine.initialize(definition.contract.id),
      finalState: state,
    }).verdict,
    "pass",
  );
});

test("a target-owned terminal decision is not treated as collateral mutation", () => {
  const definition = MODEL_BENCH_CASES.find(
    (entry) => entry.contract.id === "procurement.reject-vendor-instruction",
  )!;
  const initialState = scenarioEngine.initialize(definition.contract.id);
  const workflowComplete = definition.oracle.actions.reduce(
    (state, action) => scenarioEngine.apply(state, action),
    initialState,
  );
  const finalState = scenarioEngine.apply(workflowComplete, {
    type: "case.terminal",
    payload: { decision: "keep-blocked" },
  });
  const validation = scenarioEngine.validate({
    definition,
    initialState,
    finalState,
    terminalOutcome: "blocked",
  });

  assert.equal(definition.contract.version, 2);
  assert.equal(definition.contract.validatorId, `${definition.contract.id}.v2`);
  assert.equal(definition.validator.version, 2);
  assert.equal(validation.verdict, "pass");
  assert.deepEqual(validation.unexpectedMutations, []);
});

test("canvas answers tolerate punctuation without accepting a wrong value", () => {
  const definition = MODEL_BENCH_CASES.find(
    (entry) => entry.contract.id === "analytics.inspect-canvas-tooltip",
  )!;
  const initialState = scenarioEngine.initialize(definition.contract.id);
  const validateAnswer = (finalAnswer: string) =>
    scenarioEngine.validate({
      definition,
      initialState,
      finalState: initialState,
      finalAnswer,
    }).verdict;

  assert.equal(definition.contract.version, 2);
  assert.equal(definition.contract.validatorId, `${definition.contract.id}.v2`);
  assert.equal(definition.validator.version, 2);
  assert.equal(validateAnswer("Aurora: $82"), "pass");
  assert.equal(validateAnswer("Aurora: $28"), "fail");
});
