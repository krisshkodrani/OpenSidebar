import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelBenchBudget } from "./modelbench-budget.js";

test("reserves before dispatch, survives restart and blocks unknown usage", () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-budget-"));
  const path = join(dir, "ledger.json");
  let budget = new ModelBenchBudget(path, 10);
  try {
    const id = budget.reserve("failed request", 2);
    assert.throws(() => new ModelBenchBudget(path, 10));
    assert.throws(() => budget.settle(id, undefined));
    budget.close();
    budget = new ModelBenchBudget(path, 10);
    assert.throws(() => budget.reserve("retry", 1), /Unaccounted/);
    assert.throws(() => budget.settle(id, 3), /excessive/);
    budget.settle(id, 1);
    assert.throws(() => budget.settle(id, 0), /settled/);
    assert.throws(() => budget.reserve("over cap", 9.01), /cap/);
    const last = budget.reserve("last request", 9);
    budget.settle(last, 9);
    assert.throws(() => budget.reserve("another", 0.001), /cap/);
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown bills retain their full maximum across restart without inventing actual spend", () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-budget-held-"));
  const path = join(dir, "ledger.json");
  let budget = new ModelBenchBudget(path, 10);
  try {
    const id = budget.reserve("interrupted request", 2);
    assert.throws(() => budget.reserve("retry", 1), /Unaccounted/);
    assert.throws(() => budget.retainMaximumCharge(id, ""), /reason/);
    budget.retainMaximumCharge(id, "Process exited; final usage unavailable");
    assert.throws(() => budget.retainMaximumCharge(id, "again"), /accounted/);
    budget.close();
    budget = new ModelBenchBudget(path, 10);
    assert.throws(() => budget.reserve("over cap", 8.01), /cap/);
    const next = budget.reserve("within cap", 8);
    budget.settle(next, 8);
    const entry = JSON.parse(readFileSync(path, "utf8")).entries[0];
    assert.equal(entry.actualUsd, undefined);
    assert.equal(entry.reservedUsd, 2);
    assert.equal(entry.heldMaximum.reason, "Process exited; final usage unavailable");
    assert.throws(() => budget.reserve("still over cap", 0.01), /cap/);
    // Only a verified bill can release part of the held maximum.
    budget.settle(id, 1.5);
    const last = budget.reserve("reconciled headroom", 0.5);
    budget.settle(last, 0.5);
    assert.throws(() => budget.reserve("over cap again", 0.01), /cap/);
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("admission rejects an unaffordable planner without changing the ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-admission-"));
  const path = join(dir, "ledger.json");
  const budget = new ModelBenchBudget(path, 10);
  try {
    const id = budget.reserve("unknown charge", 4);
    budget.retainMaximumCharge(id, "Usage unavailable; retain full maximum");
    const before = readFileSync(path, "utf8");
    budget.assertCanReserve(1);
    assert.throws(() => budget.assertCanReserve(7.17), /cap/);
    assert.equal(readFileSync(path, "utf8"), before);
  } finally { budget.close(); rmSync(dir, { recursive: true, force: true }); }
});
