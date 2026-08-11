import assert from "node:assert/strict";
import test from "node:test";
import { RESTOCK_DEFAULT_STATE, reduceRestockState } from "../src/index.js";

test("an armed feasible restock becomes available only when triggered", () => {
  const armed = reduceRestockState(RESTOCK_DEFAULT_STATE, { type: "scenario.arm", delaySeconds: 30 });
  assert.equal(armed.state.availability, "out_of_stock");
  assert.equal(armed.lifecycle, "armed");
  const triggered = reduceRestockState(armed.state, { type: "scenario.trigger" });
  assert.equal(triggered.state.availability, "in_stock");
  assert.equal(triggered.lifecycle, "active");
  // State transition alone is not an agent result: the target must observe it
  // and Watch must later report an evidence-bearing completion signal.
  assert.equal(triggered.result, undefined);
});

test("an impossible restock remains unavailable for Watch to remain quiet", () => {
  const impossible = reduceRestockState(RESTOCK_DEFAULT_STATE, { type: "restock.setFeasibility", feasibility: "permanently_impossible" });
  const triggered = reduceRestockState(impossible.state, { type: "scenario.trigger" });
  assert.equal(triggered.state.availability, "out_of_stock");
  assert.equal(triggered.lifecycle, "active");
  assert.equal(triggered.result, "quiet_correct");
});

test("reset removes an armed future transition", () => {
  const armed = reduceRestockState(RESTOCK_DEFAULT_STATE, { type: "scenario.arm", delaySeconds: 60 });
  const reset = reduceRestockState(armed.state, { type: "scenario.reset" });
  assert.deepEqual(reset.state, RESTOCK_DEFAULT_STATE);
  assert.equal(reset.lifecycle, "ready");
});

test("a decorative trigger changes the page without restocking", () => {
  const configured = reduceRestockState(RESTOCK_DEFAULT_STATE, { type: "restock.setRelevance", relevance: "decorative" });
  const triggered = reduceRestockState(configured.state, { type: "scenario.trigger" });
  assert.equal(triggered.state.availability, "out_of_stock");
  assert.equal(triggered.state.decoration, "featured");
  assert.equal(triggered.result, "irrelevant_change_ignored");
});
