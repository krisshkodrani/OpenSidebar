export const DEFAULT_TOKEN_WARNING_RATIO = 0.8;

export function getTokenBudgetWarning(input: {
  totalTokens: number;
  maxTotalTokens: number;
  warningRatio?: number;
}): { ratio: number; threshold: number } | null {
  const { totalTokens, maxTotalTokens } = input;
  const threshold = input.warningRatio ?? DEFAULT_TOKEN_WARNING_RATIO;
  if (
    !Number.isFinite(totalTokens) ||
    !Number.isFinite(maxTotalTokens) ||
    !Number.isFinite(threshold) ||
    maxTotalTokens <= 0 ||
    threshold <= 0 ||
    threshold > 1
  ) {
    return null;
  }
  const ratio = totalTokens / maxTotalTokens;
  return ratio >= threshold ? { ratio, threshold } : null;
}
