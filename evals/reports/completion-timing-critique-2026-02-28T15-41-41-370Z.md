# Completion-Timing Eval Report

Generated: 2026-02-28T15:41:41.369Z

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
| completion-correct-multistep-001 | PASS | hard | done | 1.00 | 1.00 | 1.00 | 1.00 | 952ms |
| completion-error-as-done-001 | PASS | hard | continue | 1.00 | 1.00 | 1.00 | 0.95 | 689ms |
| completion-overcontinue-confirmation-001 | PASS | easy | done | 1.00 | 1.00 | 1.00 | 1.00 | 553ms |
| completion-overcontinue-redirect-001 | PASS | medium | done | 1.00 | 1.00 | 1.00 | 1.00 | 509ms |
| completion-overcontinue-success-001 | PASS | easy | done | 1.00 | 1.00 | 1.00 | 1.00 | 398ms |
| completion-premature-error-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 1.00 | 478ms |
| completion-premature-form-001 | PASS | easy | continue | 1.00 | 1.00 | 1.00 | 1.00 | 579ms |
| completion-premature-partial-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 1.00 | 605ms |

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
2. **[LOW]** (1x) No fix needed — the agent handled this correctly. However, to reinforce this pattern, the prompt could explicitly state: 'HTTP error pages (404, 500, etc.) are navigation failures, not task completions. Always attempt recovery actions before considering done().'
3. **[LOW]** (1x) None needed — agent behavior was optimal.
4. **[LOW]** (1x) No fix needed — agent behavior was optimal.
5. **[LOW]** (1x) Plan subtasks should reflect actual success conditions, not just action completion. 'Fill password field with a secure password' should only be marked completed if the password actually meets security requirements. Consider adding a subtask 'Verify successful account creation' to prevent premature done() calls.
6. **[LOW]** (1x) No fix needed; the agent behaved correctly.
7. **[LOW]** (1x) No fix needed; the agent correctly continued acting. However, adding explicit guidance like 'Only call done() when ALL plan subtasks are marked completed' could reinforce correct behavior.
