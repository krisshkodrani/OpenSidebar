import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_BENCH_CASES } from "@opensidebar/scenario-engine";
import { auditModelBenchTargets } from "./modelbench-target-quality.js";

test("target-quality audit accounts for every released case", () => {
  const result = auditModelBenchTargets(MODEL_BENCH_CASES);
  assert.equal(result.reviewed, 100);
  assert.equal(result.passing + new Set(result.findings.map((finding) => finding.caseId)).size, 100);
  assert.ok(result.findings.some((finding) => finding.criterion === "workflow_depth"));
  assert.equal(result.byCriterion.perception, 0);
  assert.ok(result.findings.some((finding) => finding.criterion === "recovery"));
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
