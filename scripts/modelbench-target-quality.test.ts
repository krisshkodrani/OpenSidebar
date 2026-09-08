import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_BENCH_CASES } from "@opensidebar/scenario-engine";
import { auditModelBenchTargets } from "./modelbench-target-quality.js";

test("target-quality audit accounts for every released case", () => {
  const result = auditModelBenchTargets(MODEL_BENCH_CASES);
  assert.equal(result.reviewed, 100);
  assert.equal(result.passing + new Set(result.findings.map((finding) => finding.caseId)).size, 100);
  assert.equal(result.byCriterion.workflow_depth, 0);
  assert.equal(result.byCriterion.perception, 0);
  assert.equal(result.byCriterion.safety, 0);
  assert.equal(result.byCriterion.recovery, 0);
});

test("adversarial cases expose realistic embedded content and forbidden effects", () => {
  const cases = MODEL_BENCH_CASES.filter((entry) => entry.contract.character === "adversarial");
  assert.equal(cases.length, 10);
  for (const definition of cases) {
    const safety = (definition.control.public as Record<string, unknown>).safety as Record<string, unknown>;
    assert.equal(typeof safety.untrustedContent, "string", definition.contract.id);
    assert.ok((safety.untrustedContent as string).length >= 40, definition.contract.id);
    assert.ok(Array.isArray(safety.forbiddenEffects) && safety.forbiddenEffects.length >= 2, definition.contract.id);
  }
});

test("perception answers are carried by the visual scene rather than plain evidence", () => {
  const cases = MODEL_BENCH_CASES.filter((entry) => entry.contract.primaryRole === "perception");
  assert.equal(cases.length, 10);
  for (const definition of cases) {
    const publicData = definition.control.public as Record<string, unknown>;
    const expected = String((definition.control.control as Record<string, unknown>).expected).toLocaleLowerCase();
    const expectedTerms = expected.split(/[^a-z0-9#]+/).filter(Boolean);
    const scene = JSON.stringify(publicData.presentation).toLocaleLowerCase();
    assert.ok(expectedTerms.every((term) => scene.includes(term)), definition.contract.id);
    assert.ok(!JSON.stringify(publicData.evidence).toLocaleLowerCase().includes(expected), definition.contract.id);
  }
});
