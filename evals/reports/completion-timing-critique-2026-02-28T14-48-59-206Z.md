# Completion-Timing Eval Report

Generated: 2026-02-28T14:48:59.206Z

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 100.0% (8/8) |
| Failed | 0 |
| Errors | 0 |
| Avg decision correct | 0.875 |
| Avg summary quality | 0.969 |
| Avg next action quality | 1.000 |
| Avg perception usage | 0.500 |
| Avg composite | 0.881 |

## Per-Case Results

| Case | Status | Difficulty | Expected | Decision | Summary | Next Action | Composite | Latency |
|------|--------|------------|----------|----------|---------|-------------|-----------|---------|
| completion-correct-multistep-001 | PASS | hard | done | 1.00 | 1.00 | 1.00 | 1.00 | 613ms |
| completion-error-as-done-001 | PASS | hard | continue | 1.00 | 1.00 | 1.00 | 0.90 | 471ms |
| completion-overcontinue-confirmation-001 | PASS | easy | done | 1.00 | 0.75 | 1.00 | 0.95 | 608ms |
| completion-overcontinue-redirect-001 | PASS | medium | done | 1.00 | 1.00 | 1.00 | 1.00 | 485ms |
| completion-overcontinue-success-001 | PASS | easy | done | 0.00 | 1.00 | 1.00 | 0.50 | 414ms |
| completion-premature-error-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 0.90 | 449ms |
| completion-premature-form-001 | PASS | easy | continue | 1.00 | 1.00 | 1.00 | 0.90 | 455ms |
| completion-premature-partial-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 0.90 | 450ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 100% (3/3) | 0.783 |
| medium | 100% (3/3) | 0.933 |
| hard | 100% (2/2) | 0.950 |

## Scenario Analysis

| Expected Action | Pass Rate | Count |
|-----------------|-----------|-------|
| done | 100% (4/4) | 4 |
| continue | 100% (4/4) | 4 |

## Failed Cases

No failures.

## Prompt Recommendations

1. **[HIGH]** (3x) No fix needed — the agent performed optimally.
2. **[LOW]** (1x) No fix needed — the agent handled this correctly. However, the agent could also try navigating directly to an alternative checkout URL or clicking 'Go to Homepage' to find another path to checkout.
3. **[LOW]** (1x) None needed — agent behavior is exemplary.
4. **[LOW]** (1x) Consider adding guidance that plan step completion should be verified against actual page state outcomes, not just whether the action was attempted. A step like 'Submit the registration form' should only be marked complete if the submission succeeded.
5. **[LOW]** (1x) No fix needed; the agent behaved correctly.
6. **[LOW]** (1x) No fix needed; the agent correctly continued acting. However, adding explicit guidance like 'Only call done() when ALL plan subtasks are marked completed' could reinforce correct behavior.
