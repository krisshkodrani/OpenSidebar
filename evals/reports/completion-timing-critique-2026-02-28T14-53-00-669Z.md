# Completion-Timing Eval Report

Generated: 2026-02-28T14:53:00.668Z

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 100.0% (8/8) |
| Failed | 0 |
| Errors | 0 |
| Avg decision correct | 1.000 |
| Avg summary quality | 0.969 |
| Avg next action quality | 1.000 |
| Avg perception usage | 0.938 |
| Avg composite | 0.987 |

## Per-Case Results

| Case | Status | Difficulty | Expected | Decision | Summary | Next Action | Composite | Latency |
|------|--------|------------|----------|----------|---------|-------------|-----------|---------|
| completion-correct-multistep-001 | PASS | hard | done | 1.00 | 1.00 | 1.00 | 1.00 | 793ms |
| completion-error-as-done-001 | PASS | hard | continue | 1.00 | 1.00 | 1.00 | 0.95 | 2043ms |
| completion-overcontinue-confirmation-001 | PASS | easy | done | 1.00 | 0.75 | 1.00 | 0.95 | 525ms |
| completion-overcontinue-redirect-001 | PASS | medium | done | 1.00 | 1.00 | 1.00 | 1.00 | 1188ms |
| completion-overcontinue-success-001 | PASS | easy | done | 1.00 | 1.00 | 1.00 | 1.00 | 2047ms |
| completion-premature-error-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 1.00 | 856ms |
| completion-premature-form-001 | PASS | easy | continue | 1.00 | 1.00 | 1.00 | 1.00 | 834ms |
| completion-premature-partial-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 1.00 | 653ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 100% (3/3) | 0.983 |
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
2. **[LOW]** (1x) No fix needed — the agent handled this correctly. However, to reinforce this behavior, the prompt could explicitly state: 'A 404 or error page does not mean the task is complete; attempt recovery actions like go_back() or navigating to an alternative URL.'
3. **[LOW]** (1x) None needed — the agent behaved optimally.
4. **[LOW]** (1x) Plan subtasks should reflect actual success conditions, not just action completion. 'Fill password field with a secure password' should only be marked completed if the password actually meets security requirements. Consider adding a subtask 'Verify successful account creation' to prevent premature done() calls.
5. **[LOW]** (1x) No fix needed; the agent behaved correctly.
6. **[LOW]** (1x) No fix needed; the agent correctly continued working through pending subtasks.
