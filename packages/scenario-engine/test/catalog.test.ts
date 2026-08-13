import assert from "node:assert/strict";
import test from "node:test";
import {
  checkModelBenchCatalog,
  MODEL_BENCH_CASES,
  runOracle,
  scenarioEngine,
  stableJson,
} from "../src/index.js";

test("ModelBench catalog has exactly the approved distributions", () => {
  assert.deepEqual(checkModelBenchCatalog(MODEL_BENCH_CASES), []);
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
