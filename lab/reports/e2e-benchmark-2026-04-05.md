# E2E Benchmark Report

**Date**: 2026-04-05
**Suite**: 30 test files, 38 test cases
**Infrastructure**: State-diff verification, idempotency guard, unified VL executor (commit f7d24c2)

## Executive Summary

| Configuration | Pass rate | Duration | Tokens | Cost | Turns |
|--------------|-----------|----------|--------|------|-------|
| **Kimi K2.5 VL unified (Fireworks)** | **35/38 (92%)** | **124 min** | **5.4M** | **$3.48** | **603** |
| GPT-5.4-mini 2-call (OpenRouter, Apr 1) | 39/40 (97.5%) | ~300 min | ~12M | ~$10 | ~900 |

Kimi K2.5 in unified VL mode achieves 92% pass rate at 1/3 the cost and 2.4x faster than the GPT-5.4-mini baseline.

## Full Suite Results: Kimi K2.5 VL Unified (Fireworks)

**Provider**: Fireworks AI (`accounts/fireworks/models/kimi-k2p5`)
**Mode**: Unified VL (screenshot sent directly to executor, no separate perception call)
**All roles**: Kimi K2.5 (executor + planner + verifier)

| # | Test | Cases | Result | Duration | Notes |
|---|------|-------|--------|----------|-------|
| 1 | summarize | 1 | PASS | 46s | |
| 2 | article-research | 1 | PASS | 50s | |
| 3 | navigation-challenge | 1 | PASS | 267s | |
| 4 | dashboard | 1 | PASS | 47s | |
| 5 | edge-cases | 3 | 3/3 PASS | 38s + 28s + 144s | |
| 6 | online-shop | 6 | 5/6 PASS | 119s + 239s(r) + 80s + 92s + 301s(r) | quantity FAIL (nondeterministic) |
| 7 | online-shop-natural | 1 | PASS | 99s | |
| 8 | online-shop-boundaries | 1 | PASS | 71s | |
| 9 | sequential-tasks | 1 | PASS | 147s | |
| 10 | tab-management | 2 | 2/2 PASS | 36s + 35s | close_tab works! |
| 11 | scroll-find | 1 | PASS | 61s | |
| 12 | execute-js | 1 | PASS | 51s | |
| 13 | multi-step-form | 1 | PASS | 71s | |
| 14 | procurement-list | 1 | PASS | 61s | |
| 15 | delayed-content | 1 | PASS | 70s | |
| 16 | hover-menus | 1 | PASS | 57s | VL mode sees CSS :hover state! |
| 17 | autocomplete | 1 | PASS | 113s | |
| 18 | login | 1 | PASS | 79s | |
| 19 | kanban | 1 | PASS | 65s | |
| 20 | faq-accordion | 1 | PASS | 41s | |
| 21 | context-menu | 1 | PASS | 79s | |
| 22 | infinite-scroll | 1 | FAIL | timeout | New failure |
| 23 | keyboard-nav | 1 | PASS | 213s | |
| 24 | data-table | 1 | PASS | 53s | |
| 25 | date-picker | 1 | PASS | 2837s (retry) | Slow but passes |
| 26 | web-components | 1 | PASS | 85s | |
| 27 | modal-overlays | 1 | PASS | 135s | |
| 28 | go-back-navigation | 1 | FAIL | timeout | Model reasoning gap |
| 29 | structural-loading | 1 | PASS | 40s | |
| 30 | team-chat | 1 | PASS | 53s | |

**Totals**: 35/38 pass (92%), 3 fail, 124 min, 603 turns, 81 traces

(r) = retry x1

## Failure Analysis

| Test | Failure mode | Root cause | Other models affected |
|------|-------------|-----------|----------------------|
| online-shop: quantity | Nondeterministic timeout | Model doesn't reliably click "+" to change qty | GPT-5.4-mini, MiniMax, Qwen3 VL |
| go-back-navigation | Missing inventory data | Model navigates away without reading page data | DeepSeek V3.2, all non-GPT models |
| infinite-scroll | Timeout | New: model may struggle with scroll-to-find pattern | Needs investigation |

## Notable Passes

| Test | Significance |
|------|-------------|
| **hover-menus** | PASS -- was the known infra failure on GPT-5.4-mini (CSS :hover needs CDP). VL mode sees the hover state in screenshots. |
| **modal-overlays** | PASS -- was a 144-turn catastrophic loop on DeepSeek V3.2 |
| **tab-management (close)** | PASS -- DeepSeek V3.2 failed this (didn't use close_tab tool) |
| **online-shop: 2-item** | PASS -- the universal hard test that most models fail |
| **online-shop: natural 2-item** | PASS (retry) -- fails on nearly every other configuration |

## Diagnostic (9-case) Results Comparison

All runs on the same 4 test files (summarize, dashboard, navigation-challenge, online-shop):

| Model | Provider | Mode | Pass | Duration | Turns | Input tok | Output tok | Total tok | Cost |
|-------|----------|------|------|----------|-------|-----------|-----------|-----------|------|
| **Kimi K2.5** | **Fireworks** | **VL unified** | **9/9** | **14 min** | **174** | **1.47M** | **26.6K** | **1.49M** | **$0.96** |
| Kimi K2.5 | Fireworks | 2-call | 8/9 | 39 min | 179 | 1.39M | 34.5K | 1.43M | $0.94 |
| GPT-5.4-mini | OpenRouter | VL unified | 7/9 | 42 min | 229 | -- | -- | -- | ~$1.80 |
| GPT-5.4-mini | OpenRouter | 2-call | 7/9 | 55 min | 320 | 2.34M | 25.9K | 2.36M | $1.87 |
| Qwen 3.6 Plus:free | OpenRouter | 2-call | 7/9 | 44 min | 175 | 1.55M | 41.4K | 1.60M | $0.00 |
| MiniMax M2.5 | Fireworks | 2-call | 7/9 | 68 min | 305 | 2.58M | 51.1K | 2.63M | $1.39 |
| DeepSeek V3.2:nitro | OpenRouter | 2-call | 8/9 | ~60 min | -- | -- | -- | -- | -- |
| Grok 4.1 Fast | OpenRouter | 2-call | 7/9 | ~63 min | -- | -- | -- | -- | -- |
| Qwen3-VL-30B Thinking | OpenRouter | 2-call | 7/9 | 62 min | -- | -- | -- | -- | -- |

## Per-Test Failure Matrix (Diagnostic 9-case)

| Test | Kimi VL | Kimi 2-call | GPT-5.4 | Qwen 3.6 | MiniMax | DeepSeek |
|------|---------|-------------|---------|----------|---------|----------|
| summarize | PASS | PASS | PASS | PASS | PASS | PASS |
| dashboard | PASS | PASS | PASS | PASS | PASS | PASS |
| nav-challenge | PASS | PASS | PASS | PASS | PASS | PASS |
| add+coupon | PASS | PASS | PASS(r) | PASS | PASS | PASS |
| 2-item | PASS | PASS | FAIL | FAIL | PASS(r) | PASS |
| accessory | PASS | PASS | PASS | PASS | PASS | PASS |
| quantity | PASS | PASS | FAIL | PASS | FAIL | FAIL |
| apparel | PASS | PASS | PASS(r) | PASS | PASS | PASS |
| natural 2-item | PASS | FAIL | PASS | FAIL | FAIL | FAIL |
| **Total** | **9/9** | **8/9** | **7/9** | **7/9** | **7/9** | **8/9** |

## Token Efficiency

| Model | Avg input/turn | Avg output/turn | Turns per passed test |
|-------|---------------|----------------|----------------------|
| Kimi K2.5 VL | 10,471 | 190 | 17 |
| Kimi K2.5 2-call | 7,779 | 193 | 22 |
| GPT-5.4-mini 2-call | 7,300 | 81 | 46 |
| Qwen 3.6 Plus:free | 8,880 | 236 | 25 |
| MiniMax M2.5 | 8,466 | 168 | 44 |

Kimi VL has higher input/turn (includes screenshot tokens ~85-765) but fewest turns per pass (17) -- decisive tool calling compensates for image overhead.

## Cost Per Successful Test Case

| Configuration | Cost/pass |
|--------------|-----------|
| Qwen 3.6 Plus:free | $0.00 |
| **Kimi K2.5 VL (Fireworks)** | **$0.10** |
| Kimi K2.5 2-call (Fireworks) | $0.12 |
| MiniMax M2.5 (Fireworks) | $0.20 |
| GPT-5.4-mini (OpenRouter) | $0.27 |

## Reproduction

### Kimi K2.5 VL unified (full suite)
```bash
npm run build
E2E_PROVIDER=fireworks E2E_USE_VL_EXECUTOR=true npm run test:e2e
```
Requires: `FIREWORKS_API_KEY` and `OPENROUTER_API_KEY` in `.env`

### GPT-5.4-mini baseline (full suite)
```bash
npm run build
npm run test:e2e
```
Requires: `OPENROUTER_API_KEY` in `.env`

### Diagnostic (9-case subset)
```bash
E2E_PROVIDER=fireworks E2E_USE_VL_EXECUTOR=true npx vitest run \
  --config tests/e2e/vitest.e2e.config.ts \
  tests/e2e/summarize.test.ts tests/e2e/dashboard.test.ts \
  tests/e2e/navigation-challenge.test.ts tests/e2e/online-shop.test.ts
```

### Model override (any model on OpenRouter)
```bash
E2E_EXECUTOR_MODEL="deepseek/deepseek-v3.2:nitro" npm run test:e2e
```
