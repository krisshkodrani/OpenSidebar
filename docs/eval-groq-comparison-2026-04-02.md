# Eval Comparison: GPT-5.4-mini (OpenRouter) vs GPT OSS 120B (Groq)

Date: 2026-04-02

## Summary

| Metric | GPT-5.4-mini (OpenRouter) | GPT OSS 120B (Groq) | Delta |
|---|---|---|---|
| **Executor pass rate** | 11/29 (38%) | 13/29 (45%) | **+2 (+7%)** |
| **Planner pass rate** | 20/22 (91%) | 21/22 (95%) | **+1 (+5%)** |
| **Executor avg latency** | ~1,730ms | ~950ms | **~1.8x faster** |
| **Planner avg latency** | ~2,120ms | ~2,160ms | Comparable |

GPT OSS 120B on Groq matches or exceeds GPT-5.4-mini on both executor and planner evals, with significantly faster executor latency.

## Executor Results (29 golden cases)

### Per-case comparison

| Case | Pathology | GPT-5.4-mini | GPT OSS 120B | Notes |
|---|---|---|---|---|
| click-interception-recovery-001 | click_interception_recovery | pass (1.00/1.00) | pass (1.00/1.00) | Both correct |
| disabled-button-001 | disabled_button | **fail** (0.00/0.00) | **pass** (1.00/1.00) | Groq wins |
| disabled-button-002 | disabled_button | fail | fail | Both fail |
| escalation-repeat-001 | escalation_repeat | pass (0.50/0.50) | fail (0.50/0.50) | GPT-5.4 wins |
| escalation-repeat-002 | escalation_repeat | fail | **pass** (1.00/1.00) | Groq wins |
| find-element-loop-001 | find_element_loop | pass (1.00/1.00) | fail (0.00/0.00) | GPT-5.4 wins |
| find-element-loop-002 | find_element_loop | fail | **pass** (1.00/1.00) | Groq wins |
| ground-before-done-001 | ground_before_done | fail | fail | Both fail |
| marathon-done-001 | marathon_no_done | pass (1.00/1.00) | fail (0.00/0.00) | GPT-5.4 wins |
| marathon-done-002 | marathon_no_done | fail | **pass** (1.00/1.00) | Groq wins |
| planner-coupon-step-001 | missing_verification_step | fail | fail | Both fail |
| planner-criteria-quality-001 | contradictory_criteria | fail | fail | Both fail |
| planner-data-collection-001 | missing_data_collection | fail | fail | Both fail |
| planner-form-fill-001 | over_decomposition_form | fail | fail | Both fail |
| planner-multi-item-001 | under_decomposition | fail | fail | Both fail |
| planner-roundtrip-001 | missing_return_leg | fail | fail | Both fail |
| planner-sequencing-001 | missing_dependency | fail | fail | Both fail |
| planner-simple-task-001 | over_decomposition | fail | fail | Both fail |
| prefer-find-over-scroll-001 | prefer_find_element | fail | **pass** (0.00/0.00) | Judge override |
| premature-submit-001 | premature_submit | fail | fail | Both fail |
| react-new-elements-001 | react_to_new_elements | pass (1.00/1.00) | fail (0.00/0.00) | GPT-5.4 wins |
| scope-decoy-distraction-001 | scope_overshoot | pass (1.00/1.00) | pass (1.00/1.00) | Both correct |
| scope-overshoot-001 | scope_overshoot | fail | fail | Both fail |
| scope-overshoot-subnode-001 | scope_overshoot_subnode | pass (1.00/1.00) | pass (1.00/1.00) | Both correct |
| scope-submit-after-type-001 | scope_overshoot | pass (0.00/0.00) | pass (0.00/0.00) | Both judge-override |
| text-toolcall-001 | text_as_toolcall | pass (1.00/0.80) | pass (1.00/1.00) | Both pass |
| text-toolcall-002 | text_as_toolcall | pass (1.00/0.67) | pass (1.00/0.50) | Both pass |
| verifier-scope-leak-001 | verifier_scope_leak | fail | fail | Both fail |
| verify-action-effect-001 | verify_action_effect | pass (1.00/1.00) | pass (1.00/1.00) | Both correct |

### Executor differential

- **Groq wins (GPT-5.4 fails, Groq passes):** 5 cases — disabled-button-001, escalation-repeat-002, find-element-loop-002, marathon-done-002, prefer-find-over-scroll-001
- **GPT-5.4 wins (GPT-5.4 passes, Groq fails):** 3 cases — escalation-repeat-001, find-element-loop-001, marathon-done-001, react-new-elements-001
- **Both pass:** 8 cases
- **Both fail:** 13 cases

### Latency comparison (executor)

| Statistic | GPT-5.4-mini | GPT OSS 120B |
|---|---|---|
| Median | ~1,450ms | ~950ms |
| Min | ~1,100ms | ~280ms |
| Max | ~4,230ms | ~2,110ms |

## Planner Results (22 golden cases)

### Per-case comparison

| Case | Method | GPT-5.4-mini | GPT OSS 120B |
|---|---|---|---|
| planner-agent-coverage-001 | decompose | pass (0.94) | pass (0.94) |
| planner-agent-moderate-001 | decompose | pass (0.98) | pass (0.87) |
| planner-agent-simple-001 | decompose | pass (0.94) | pass (0.79) |
| planner-capability-mismatch-001 | decompose | pass (1.00) | pass (0.72) |
| planner-capability-mismatch-002 | decompose | pass (0.90) | pass (0.90) |
| planner-direct-simple-001 | decompose | **fail (0.45)** | **pass (0.84)** |
| planner-length-bias-001 | decompose | pass (0.94) | pass (0.94) |
| planner-length-bias-002 | decompose | **fail (0.45)** | **pass (0.94)** |
| planner-orchestration-001 | decompose | pass (0.98) | pass (1.00) |
| planner-orchestration-002 | decompose | pass (1.00) | pass (0.92) |
| planner-plan-antipattern-001 | decompose | pass (0.67) | **fail (0.56)** |
| planner-plan-complex-001 | decompose | pass (0.75) | pass (0.89) |
| planner-plan-coverage-001 | decompose | pass (0.70) | pass (0.72) |
| planner-plan-extreme-001 | decompose | pass (0.90) | pass (0.75) |
| planner-step-progress-001 | decompose | pass (1.00) | pass (0.80) |
| planner-step-progress-002 | decompose | pass (1.00) | pass (0.95) |
| planner-termination-001 | decompose | pass (1.00) | pass (1.00) |
| planner-termination-002 | decompose | pass (1.00) | pass (1.00) |
| planner-validate-approve-001 | validateDone | pass (1.00) | pass (1.00) |
| planner-validate-overdone-001 | validateDone | pass (1.00) | pass (1.00) |
| planner-validate-overdone-002 | validateDone | pass (1.00) | pass (1.00) |
| planner-validate-reject-001 | validateDone | pass (1.00) | pass (1.00) |

### Planner differential

- **Groq wins:** planner-direct-simple-001, planner-length-bias-002 (GPT-5.4 fails both at 0.45)
- **GPT-5.4 wins:** planner-plan-antipattern-001 (GPT-5.4 passes at 0.67, Groq fails at 0.56)
- **Score quality:** GPT-5.4-mini has higher avg composite on shared passes (0.92 vs 0.89)

### Planner avg composite scores

| Statistic | GPT-5.4-mini | GPT OSS 120B |
|---|---|---|
| Avg composite (all) | 0.89 | 0.89 |
| Avg composite (decompose only) | 0.86 | 0.87 |
| ValidateDone pass rate | 4/4 (100%) | 4/4 (100%) |

## Cost Comparison

| Role | GPT-5.4-mini (OpenRouter) | GPT OSS 120B (Groq) | Savings |
|---|---|---|---|
| Input | ~$0.40/M tokens | $0.15/M tokens | 62% |
| Output | ~$1.60/M tokens | $0.60/M tokens | 62% |

## Groq Integration Notes

- **Model ID:** `openai/gpt-oss-120b` (same on both OpenRouter and Groq direct)
- **Message format:** Groq requires `"type": "function"` on all `tool_calls` in assistant messages (OpenRouter is lenient). Fixed in runner via `sanitizeMessagesForProvider()`.
- **API compatibility:** Fully OpenAI-compatible. SSE streaming, tool_calls, tool_choice, json_object mode all work.
- **Rate limits:** Groq free tier is restrictive (6K-30K TPM). Paid plan required for agent use.

## Conclusion

GPT OSS 120B on Groq is a viable alternative to GPT-5.4-mini for both executor and planner roles:

- **Executor:** +2 net pass improvement (13 vs 11), with different failure patterns — not a strict superset but broadly comparable quality at ~1.8x speed and 62% cost savings.
- **Planner:** +1 net pass (21 vs 20), near-identical average composite scores. Slightly lower per-case scores on some complex decompositions but compensates by passing cases GPT-5.4-mini fails.
- **Speed:** Executor calls are ~1.8x faster on Groq. Planner calls are comparable (JSON mode may bottleneck).
- **Risk:** Groq has documented reliability issues (outages). Recommend keeping OpenRouter as fallback.
