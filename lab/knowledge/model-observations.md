# Model Observations

Empirical observations about model behavior in the browser-agent context.
These are findings that would be lost without systematic recording.

Last updated: 2026-04-12

---

## GPT-5.4-mini (OpenRouter, executor/planner) [Grade: A]

- Reliable tool-call formatting, rarely produces malformed JSON
- Nondeterministic: same prompt produces different tool sequences across runs
- Handles multi-step form fills well when given explicit plan steps
- Occasionally "forgets" plan mid-execution and restarts from scratch
- Strong at reading page snapshots and identifying correct element tags

Source: 6 months of production traces, e2e-report-2026-04-09, e2e-report-2026-04-11

## Kimi K2.5 (Fireworks, E2E default) [Grade: B]

- Default E2E executor since 2026-04-08
- Comparable tool-call reliability to GPT-5.4-mini
- Faster inference on Fireworks vs OpenRouter
- Lower cost per token
- Cross-page compose tests need further validation

Source: natural-v4 E2E reports, lab/e2e-reports/natural-v4/

## Grok 4.1 Fast (OpenRouter, perception) [Grade: A]

- Stable VLM for page perception, good at identifying LOCATION/CHANGES/BLOCKERS
- Occasionally hallucinates tag IDs in AFFORDANCES section (mitigated by validatePerceptionTagIds)
- Cross-lingual pages handled well when lang hint provided
- No measurable improvement when swapped for GPT-5.4-mini in A/B test

Source: perception A/B test study, validatePerceptionTagIds implementation

## DeepSeek V3.2 (evaluated as executor) [Grade: B]

- 32/38 (84%) tool coverage
- Not a GPT-5.4-mini replacement — fails on complex multi-step tasks
- Good at simpler single-action tasks
- Reports: lab/e2e-reports/ deepseek-v3.2 subdirectory

Source: deepseek-v3.2 eval (2026-04-04)

## MiniMax M2.5/M2.7 (historical planner) [Grade: B]

- Used as planner model until 2026-03-26
- Replaced by GPT-5.4-mini:nitro after comparable results at lower latency
- Good at structured plan generation but slower

Source: model evaluation report in lab/archive/
