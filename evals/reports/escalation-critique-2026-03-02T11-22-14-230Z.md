# Escalation Eval Report

Generated: 2026-03-02T11:22:14.229Z
Planner model: deepseek-v3.2

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 6 |
| Pass rate | 100.0% (6/6) |
| Failed | 0 |
| Errors | 0 |
| Avg escalation triggered | 1.000 |
| Avg reason quality | 1.000 |
| Avg tool match | 1.000 |
| Avg args match | 0.583 |
| Avg investigation quality | 0.833 |
| Avg composite | 0.942 |

## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
| escalation-complex-001 | PASS | hard | 1.00 | 1.00 | 1.00 | 0.90 | 10774ms |
| escalation-hidden-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 1.00 | 7513ms |
| escalation-hidden-002 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.95 | 11066ms |
| escalation-scroll-001 | PASS | easy | 1.00 | 1.00 | 1.00 | 1.00 | 15288ms |
| escalation-stuck-click-001 | PASS | easy | 1.00 | 1.00 | 0.00 | 0.90 | 13276ms |
| escalation-wrong-input-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.90 | 17444ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 100% (2/2) | 0.950 |
| medium | 100% (3/3) | 0.950 |
| hard | 100% (1/1) | 0.900 |

## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | 100% (6/6) |
| Phase 2: Recovery tool match | 100% (6/6) |

## Failed Cases

No failures.

## Prompt Recommendations

No specific recommendations — all cases passed or no judge was run.
