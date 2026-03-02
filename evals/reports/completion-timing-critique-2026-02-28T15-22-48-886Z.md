# Completion-Timing Eval Report

Generated: 2026-02-28T15:22:48.885Z

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 100.0% (8/8) |
| Failed | 0 |
| Errors | 0 |
| Avg decision correct | 1.000 |
| Avg summary quality | 1.000 |
| Avg next action quality | 1.000 |
| Avg perception usage | 0.938 |
| Avg composite | 0.994 |

## Per-Case Results

| Case | Status | Difficulty | Expected | Decision | Summary | Next Action | Composite | Latency |
|------|--------|------------|----------|----------|---------|-------------|-----------|---------|
| completion-correct-multistep-001 | PASS | hard | done | 1.00 | 1.00 | 1.00 | 1.00 | 688ms |
| completion-error-as-done-001 | PASS | hard | continue | 1.00 | 1.00 | 1.00 | 0.95 | 387ms |
| completion-overcontinue-confirmation-001 | PASS | easy | done | 1.00 | 1.00 | 1.00 | 1.00 | 722ms |
| completion-overcontinue-redirect-001 | PASS | medium | done | 1.00 | 1.00 | 1.00 | 1.00 | 611ms |
| completion-overcontinue-success-001 | PASS | easy | done | 1.00 | 1.00 | 1.00 | 1.00 | 508ms |
| completion-premature-error-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 1.00 | 1073ms |
| completion-premature-form-001 | PASS | easy | continue | 1.00 | 1.00 | 1.00 | 1.00 | 1375ms |
| completion-premature-partial-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 1.00 | 556ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 100% (3/3) | 1.000 |
| medium | 100% (3/3) | 1.000 |
| hard | 100% (2/2) | 0.975 |

## Scenario Analysis

| Expected Action | Pass Rate | Count |
|-----------------|-----------|-------|
| done | 100% (4/4) | 4 |
| continue | 100% (4/4) | 4 |

## Failed Cases

No failures.

## Prompt Recommendations

1. **[MED]** (2x) No fix needed — the agent performed optimally.
2. **[LOW]** (1x) No fix needed — the agent handled this correctly. However, a prompt could explicitly instruct the agent to try alternative recovery paths (e.g., navigate directly to homepage, try a different checkout URL) if go_back() leads to another dead end.
3. **[LOW]** (1x) No fix needed — the agent behaved optimally.
4. **[LOW]** (1x) No fix needed — agent behavior was optimal.
5. **[LOW]** (1x) Consider adding guidance that plan steps should only be marked 'completed' when the action succeeded without errors, not just when the action was attempted. This would prevent misleading plan states where a step is marked complete despite a validation failure.
6. **[LOW]** (1x) No fix needed; the agent behaved correctly.
7. **[LOW]** (1x) No fix needed; the agent behaved correctly. However, ensuring the agent also presses Enter or clicks 'Apply' after typing the promo code would be worth verifying in the next step.
