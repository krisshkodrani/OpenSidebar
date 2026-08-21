# ModelBench-100 Report

Generated: 2026-08-21T17:30:49.066Z
Source: attempts.json
Rankable: no
Pass@1: 45/69 (65.2%)
Coverage: 69/70 (98.6%)
Total cost: $2.697755

## By primary role

| Role | Passed/valid | Pass@1 | Valid/requested |
| --- | ---: | ---: | ---: |
| executor | 20/23 | 87.0% | 23/23 |
| integrated | 8/15 | 53.3% | 15/15 |
| judge | 0/6 | 0.0% | 6/6 |
| orchestration | 5/8 | 62.5% | 8/9 |
| perception | 6/7 | 85.7% | 7/7 |
| planner | 6/10 | 60.0% | 10/10 |

## Usage by model seat

| Seat | Calls | Prompt tokens | Completion tokens | Cached tokens | Cost | LLM time (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| executor | 971 | 10818273 | 337331 | 6830905 | $2.010862 | 4762275 |
| planner | 64 | 211349 | 125185 | 143232 | $0.683418 | 1474368 |
| judge | 33 | 18155 | 16488 | 1856 | $0.003475 | 56631 |

## By application family

| Family | Passed/valid | Pass@1 | Valid/requested |
| --- | ---: | ---: | ---: |
| analytics | 2/8 | 25.0% | 8/8 |
| collaboration | 4/7 | 57.1% | 7/8 |
| crm | 6/10 | 60.0% | 10/10 |
| email | 6/8 | 75.0% | 8/8 |
| hr | 6/8 | 75.0% | 8/8 |
| procurement | 6/8 | 75.0% | 8/8 |
| records | 7/10 | 70.0% | 10/10 |
| retail | 8/10 | 80.0% | 10/10 |

## Reliability and economics

- Invalid-run rate: 1.4%
- Retry rate: 1.4%
- Judge disagreement: 0.0%
- Median duration: 101864 ms
- p95 duration: 329202 ms
- Median LLM time: 69189 ms
- p95 LLM time: 231774 ms
- Turns / tool executions / perceptions: 942 / 652 / 0
- Replans / recoveries: 16 / 0
- Cost/requested task: $0.038539
- Cost/successful task: $0.059950

Provider, harness, validator-disagreement, and indeterminate attempts are excluded from model pass@1. Internal judge output is diagnostic; deterministic validation is authoritative.
