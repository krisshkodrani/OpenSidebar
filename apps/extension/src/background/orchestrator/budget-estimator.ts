export interface BudgetEnvelope {
  maxSessionTimeMs: number;
  maxTotalTokens: number;
  maxTotalCostUsd: number;
}

export interface BudgetObservation {
  tokens: number;
  timeMs: number;
  costUsd: number;
}

export interface BudgetEstimate {
  tokensPerNode: number;
  timeMsPerNode: number;
  costUsdPerNode: number;
  samples: number;
}

const DEFAULT_ESTIMATE: Omit<BudgetEstimate, "samples"> = {
  tokensPerNode: 12_000,
  timeMsPerNode: 90_000,
  costUsdPerNode: 0.18,
};

const ALPHA = 0.25;

export class BudgetEstimator {
  private estimate: BudgetEstimate = {
    ...DEFAULT_ESTIMATE,
    samples: 0,
  };

  getEstimate(): BudgetEstimate {
    return { ...this.estimate };
  }

  recordObservation(observation: BudgetObservation): void {
    const tokens = Math.max(0, observation.tokens);
    const timeMs = Math.max(0, observation.timeMs);
    const costUsd = Math.max(0, observation.costUsd);
    const hasSignal = tokens > 0 || timeMs > 0 || costUsd > 0;
    if (!hasSignal) return;

    const current = this.estimate;
    this.estimate = {
      tokensPerNode: Math.max(
        1,
        current.tokensPerNode * (1 - ALPHA) + tokens * ALPHA,
      ),
      timeMsPerNode: Math.max(
        1,
        current.timeMsPerNode * (1 - ALPHA) + timeMs * ALPHA,
      ),
      costUsdPerNode: Math.max(
        0.000001,
        current.costUsdPerNode * (1 - ALPHA) + costUsd * ALPHA,
      ),
      samples: current.samples + 1,
    };
  }

  estimateCapacity(envelope: BudgetEnvelope): {
    maxNodesByTokens: number;
    maxNodesByTime: number;
    maxNodesByCost: number;
    maxNodesOverall: number;
  } {
    const e = this.estimate;
    const maxNodesByTokens = Math.floor(
      envelope.maxTotalTokens / e.tokensPerNode,
    );
    const maxNodesByTime = Math.floor(
      envelope.maxSessionTimeMs / e.timeMsPerNode,
    );
    const maxNodesByCost = Math.floor(
      envelope.maxTotalCostUsd / e.costUsdPerNode,
    );
    return {
      maxNodesByTokens,
      maxNodesByTime,
      maxNodesByCost,
      maxNodesOverall: Math.max(
        0,
        Math.min(maxNodesByTokens, maxNodesByTime, maxNodesByCost),
      ),
    };
  }
}
