# Grounding Eval Report

Generated: 2026-03-02T10:06:52.297Z
Model: openai/gpt-oss-120b

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 2 |
| Pass rate | 100.0% (2/2) |
| Failed | 0 |
| Errors | 0 |
| Avg mismatch detection | 0.000 |
| Avg observe first | 1.000 |
| Avg trap avoidance | 1.000 |
| Avg strategy novelty | 1.000 |
| Avg tool correctness | 0.000 |
| Avg composite | 0.857 |

## Per-Case Results

| Case | Status | Difficulty | Mismatch | Observe | Trap | Novelty | Tool | Composite | Latency |
|------|--------|------------|----------|---------|------|---------|------|-----------|---------|
| grounding-flailing-001 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 929ms |
| grounding-flailing-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 426ms |

## Scenario Analysis

| Scenario | Pass Rate | Avg Composite |
|----------|-----------|---------------|
| flailing | 100% (2/2) | 0.857 |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| medium | 100% (1/1) | 0.857 |
| hard | 100% (1/1) | 0.857 |

## Failed Cases

No failures.

## Prompt Recommendations

1. **[LOW]** (1x) When a click is intercepted by an overlapping element, suggest trying click_coordinates as an alternative approach. Also instruct the agent to try scrolling or reading the full page content before attempting element interactions.
2. **[LOW]** (1x) Warn the agent that inspect_hidden is a trap action and should be avoided. Encourage the agent to try variations of JavaScript execution (e.g., querying all data attributes, iterating through all elements) rather than switching to DOM inspection tools.
