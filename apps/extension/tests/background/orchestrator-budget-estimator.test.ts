import { describe, expect, test } from "vitest";
import {
  BudgetEstimator,
  type BudgetEnvelope,
} from "../../src/background/orchestrator/budget-estimator";

describe("BudgetEstimator", () => {
  test("uses default estimate before observations", () => {
    const estimator = new BudgetEstimator();
    const estimate = estimator.getEstimate();

    expect(estimate.samples).toBe(0);
    expect(estimate.tokensPerNode).toBe(12000);
    expect(estimate.timeMsPerNode).toBe(90000);
    expect(estimate.costUsdPerNode).toBe(0.18);
  });

  test("updates estimate with EMA when observations arrive", () => {
    const estimator = new BudgetEstimator();
    estimator.recordObservation({
      tokens: 20000,
      timeMs: 120000,
      costUsd: 0.3,
    });
    const estimate = estimator.getEstimate();

    expect(estimate.samples).toBe(1);
    expect(estimate.tokensPerNode).toBeCloseTo(14000, 5);
    expect(estimate.timeMsPerNode).toBeCloseTo(97500, 5);
    expect(estimate.costUsdPerNode).toBeCloseTo(0.21, 6);
  });

  test("computes capacity from current estimate and budget envelope", () => {
    const estimator = new BudgetEstimator();
    estimator.recordObservation({
      tokens: 20000,
      timeMs: 120000,
      costUsd: 0.3,
    });
    const budget: BudgetEnvelope = {
      maxTotalTokens: 75000,
      maxSessionTimeMs: 12 * 60 * 1000,
      maxTotalCostUsd: 1.5,
    };

    const capacity = estimator.estimateCapacity(budget);
    expect(capacity.maxNodesByTokens).toBe(5);
    expect(capacity.maxNodesByTime).toBe(7);
    expect(capacity.maxNodesByCost).toBe(7);
    expect(capacity.maxNodesOverall).toBe(5);
  });
});
