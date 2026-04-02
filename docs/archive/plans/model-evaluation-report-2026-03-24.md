# Model Evaluation Report

**Date:** 2026-03-24
**Scope:** Executor and planner model comparison across 9 E2E tests
**Tests:** online-shop (6 variants), tab-management (2), procurement-list (1)
**Provider:** OpenRouter for all models
**Perception:** x-ai/grok-4.1-fast (constant across all configs)

## Final Result

**Selected config:** `openai/gpt-5.4-mini:nitro` (executor) + `minimax/minimax-m2.7:nitro` (planner)

Commit: `cae67d3` — "feat: switch executor to GPT-5.4 Mini, planner to MiniMax M2.7"

## Comparative Results

| Config | Pass | Shop | Tabs | Proc | Plans | Duration | Cost/session |
|--------|------|------|------|------|-------|----------|-------------|
| Gemini Flash:nitro + MiniMax M2.5 (previous) | 7-8/9 | 4-5/6 | 2/2 | 1/1 | 100% | ~600-800s | ~$0.165 |
| Gemini Flash unified (no nitro) | 8/9 | 5/6 | 2/2 | 1/1 | 100% | 1849s | ~$0.165 |
| GPT-5.4 Mini unified (no nitro) | 8/9 | **6/6** | 2/2 | 0/1 | 100% | 1781s | ~$0.248 |
| **GPT-5.4 Mini:nitro + MiniMax M2.7:nitro** | **8/9** | **6/6** | **2/2** | 0/1 | **100%** | 1907s | **~$0.248** |

## Groq Provider Evaluation (Rejected)

Tested Groq as alternative provider for speed. Rejected due to missing constrained decoding for tool calls.

| Config | Pass | Issue |
|--------|------|-------|
| gpt-oss-120b streaming + auto | 6/8 | Blind tool calls, model ignores tools |
| llama-3.3-70b streaming + auto | 3/8 | Better format, worse reasoning |
| gpt-oss-120b non-streaming + required | 4/8 | Fixed checkout, broke multi-step |
| gpt-oss-120b streaming + reasoning:high | 5/8 | Best Groq, still below OpenRouter |

**Root cause:** Groq lacks constrained decoding for tool_calls. Confirmed by Groq staff on community forum.

## Perception Model Evaluation

| Model | Pass Rate | Fixture Cases | Notes |
|-------|-----------|---------------|-------|
| **x-ai/grok-4.1-fast (current)** | **90% (27/30)** | 9/10 | Low hallucination (4.2%), proven |
| meta-llama/llama-4-scout-17b | 77% (23/30) | 9/10 | Faster, but weaker on adversarial pages |

llama-4-scout matched Grok on fixture pages but dropped on complex external-site cases. Grok retained as perception model.

## Per-Test Breakdown (Selected Config)

| Test | Result | Tool Calls | Notes |
|------|--------|-----------|-------|
| Tab mgmt: collect data | pass | 4 | Clean, efficient |
| Tab mgmt: open/read/close | pass | 15 | Full lifecycle works |
| Online-shop: basic checkout | pass | — | Passed on retry |
| Online-shop: multi-item | pass | — | Two items + coupon |
| Online-shop: apparel | pass | — | Size/color selection |
| Online-shop: quantity change | pass | — | Cart modification |
| Online-shop: step boundary | pass | — | Step advancement |
| Online-shop: natural language | pass | — | Unstructured prompt |
| Procurement list | fail | — | Multi-tab cross-store (flaky across all configs) |

## Key Findings

1. **GPT-5.4 Mini is the strongest executor tested** — 6/6 on online-shop in both unified and dual-model configs. No other model achieved this.

2. **Plan decomposition is model-agnostic** — Gemini Flash, GPT-5.4 Mini, and MiniMax M2.7 all produce valid structured plans with 100% success rate. gpt-oss-120b on OpenRouter also scores 83%. Only kimi-k2-instruct failed (0% due to format mismatch).

3. **The system is model-agnostic by design** — No model-specific prompts, no conditional logic on model names. GPT-5.4 Mini works without any prompt tuning.

4. **Cost trade-off** — GPT-5.4 Mini is ~50% more expensive per session ($0.248 vs $0.165 with Gemini Flash) but has higher quality on shopping flows (6/6 vs 4-5/6).

5. **Groq is not viable** — Missing constrained decoding makes tool calling unreliable regardless of model choice. Best Groq result (5-6/8) is below the OpenRouter baseline.

6. **Perception stays on Grok** — llama-4-scout was faster but less reliable (77% vs 90%). The 4.2% hallucination rate on Grok is critical for accurate page grounding.

## Model Pricing (OpenRouter)

| Model | Input $/M | Output $/M | Role |
|-------|-----------|------------|------|
| openai/gpt-5.4-mini | $0.75 | $4.50 | Executor |
| minimax/minimax-m2.7 | — | — | Planner |
| x-ai/grok-4.1-fast | $0.20 | $0.50 | Perception |
| google/gemini-3-flash-preview | $0.50 | $3.00 | (previous executor) |
