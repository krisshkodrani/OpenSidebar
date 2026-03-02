# Grounding Eval Report

Generated: 2026-03-01T18:24:11.983Z
Model: openai/gpt-oss-120b

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 50.0% (4/8) |
| Failed | 4 |
| Errors | 0 |
| Avg mismatch detection | 0.000 |
| Avg observe first | 0.250 |
| Avg trap avoidance | 0.875 |
| Avg strategy novelty | 1.000 |
| Avg tool correctness | 0.375 |
| Avg composite | 0.580 |

## Per-Case Results

| Case | Status | Difficulty | Mismatch | Observe | Trap | Novelty | Tool | Composite | Latency |
|------|--------|------------|----------|---------|------|---------|------|-----------|---------|
| grounding-blind-001 | FAIL | easy | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.50 | 823ms |
| grounding-blind-002 | FAIL | medium | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.50 | 852ms |
| grounding-flailing-001 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 606ms |
| grounding-flailing-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 480ms |
| grounding-mismatch-001 | FAIL | hard | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.35 | 1217ms |
| grounding-mismatch-002 | FAIL | medium | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0.15 | 533ms |
| grounding-noise-001 | PASS | medium | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.64 | 828ms |
| grounding-noise-002 | PASS | hard | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.64 | 573ms |

## Scenario Analysis

| Scenario | Pass Rate | Avg Composite |
|----------|-----------|---------------|
| blind_first_action | 0% (0/2) | 0.500 |
| decoy_noise | 100% (2/2) | 0.643 |
| flailing | 100% (2/2) | 0.929 |
| instruction_mismatch | 0% (0/2) | 0.250 |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 0% (0/1) | 0.500 |
| medium | 50% (2/4) | 0.573 |
| hard | 67% (2/3) | 0.617 |

## Failed Cases (4 total)

### grounding-blind-001 — blind_first_action

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.50
  - *(not judged)*

- **Agent called**: type_text({"id":194,"pressEnter":false,"text":"XNJGFD"})
- **Expected tool**: read_page (or: inspect_hidden, find_element, read_element)

### grounding-blind-002 — blind_first_action

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.50
  - *(not judged)*

- **Agent called**: type_text({"id":32,"pressEnter":false,"text":"john.doe@example.com"})
- **Expected tool**: read_page (or: find_element, read_element)

### grounding-mismatch-001 — instruction_mismatch

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.35
  - *(not judged)*

- **Agent called**: create_tab({"url":"https://serene-frangipane-7fd25b.netlify.app/step3?version=1"})
- **Expected tool**: clarify (or: read_page)

### grounding-mismatch-002 — instruction_mismatch

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=0.00 nov=1.00 tool=0.00 comp=0.15
  - *(not judged)*

- **Agent called**: click_element({"id":16})
- **Expected tool**: clarify (or: read_page)

## Prompt Recommendations

No specific recommendations — all cases passed or no judge was run.
