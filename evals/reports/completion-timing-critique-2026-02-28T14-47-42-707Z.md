# Completion-Timing Eval Report

Generated: 2026-02-28T14:47:42.706Z

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 87.5% (7/8) |
| Failed | 1 |
| Errors | 0 |
| Avg decision correct | 0.875 |
| Avg summary quality | 0.969 |
| Avg next action quality | 1.000 |
| Avg perception usage | 0.500 |
| Avg composite | 0.881 |

## Per-Case Results

| Case | Status | Difficulty | Expected | Decision | Summary | Next Action | Composite | Latency |
|------|--------|------------|----------|----------|---------|-------------|-----------|---------|
| completion-correct-multistep-001 | PASS | hard | done | 1.00 | 1.00 | 1.00 | 1.00 | 764ms |
| completion-error-as-done-001 | PASS | hard | continue | 1.00 | 1.00 | 1.00 | 0.90 | 767ms |
| completion-overcontinue-confirmation-001 | PASS | easy | done | 1.00 | 0.75 | 1.00 | 0.95 | 530ms |
| completion-overcontinue-redirect-001 | PASS | medium | done | 1.00 | 1.00 | 1.00 | 1.00 | 609ms |
| completion-overcontinue-success-001 | FAIL | easy | done | 0.00 | 1.00 | 1.00 | 0.50 | 462ms |
| completion-premature-error-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 0.90 | 444ms |
| completion-premature-form-001 | PASS | easy | continue | 1.00 | 1.00 | 1.00 | 0.90 | 530ms |
| completion-premature-partial-001 | PASS | medium | continue | 1.00 | 1.00 | 1.00 | 0.90 | 522ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 67% (2/3) | 0.783 |
| medium | 100% (3/3) | 0.933 |
| hard | 100% (2/2) | 0.950 |

## Scenario Analysis

| Expected Action | Pass Rate | Count |
|-----------------|-----------|-------|
| done | 75% (3/4) | 4 |
| continue | 100% (4/4) | 4 |

## Failed Cases (1 total)

### completion-overcontinue-success-001 — overcontinue_success_visible

- **Status**: fail
- **Expected**: done
- **Scores**: dec=0.00 sum=1.00 next=1.00 comp=0.50
  - *(not judged)*

- **Model called**: (no tool calls)

## Prompt Recommendations

No specific recommendations — all cases passed or no judge was run.
