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

test("answer-only cases accept equivalent formatting without an unrequested finalization click", () => {
  const definition = MODEL_BENCH_CASES.find(
    (entry) => entry.contract.id === "analytics.cross-dashboard-brief",
  )!;
  const initialState = scenarioEngine.initialize(definition.contract.id);
  let finalState = scenarioEngine.apply(initialState, {
    type: "workflow.advance",
    payload: { stageId: "stage-1" },
  });
  finalState = scenarioEngine.apply(finalState, {
    type: "workflow.advance",
    payload: { stageId: "stage-2" },
  });

  const validation = scenarioEngine.validate({
    definition,
    initialState,
    finalState,
    finalAnswer:
      "- Support dashboard - Open Tickets: 42\n- Marketing dashboard - Active Campaigns: 7",
  });

  assert.equal(validation.verdict, "pass");
  assert.equal(
    definition.validator.assertions.some((assertion) =>
      assertion.id.endsWith(".workflow"),
    ),
    false,
  );
});

test("formatted answer matching still rejects a missing expected clause", () => {
  const definition = MODEL_BENCH_CASES.find(
    (entry) => entry.contract.id === "analytics.cross-dashboard-brief",
  )!;
  const initialState = scenarioEngine.initialize(definition.contract.id);
  const validation = scenarioEngine.validate({
    definition,
    initialState,
    finalState: initialState,
    finalAnswer: "Support dashboard - Open Tickets: 42",
  });
  assert.equal(validation.verdict, "fail");
});

test("answer matching accepts separated conjunctive facts and light plurals", () => {
  const definition = MODEL_BENCH_CASES.find(
    (entry) => entry.contract.id === "knowledge.synthesize-two-policies",
  )!;
  const initialState = scenarioEngine.initialize(definition.contract.id);
  const validation = scenarioEngine.validate({
    definition,
    initialState,
    finalState: initialState,
    finalAnswer:
      "International travel requires approval. Any single expense over $1,000 also requires approval.",
  });
  assert.equal(validation.verdict, "pass");
});
