# Model & Provider Benchmark Reference

Standing reference for executor model comparisons. Updated after each benchmark run.

## Recommended Configurations

| Use case | Configuration | Pass rate | Cost/session | Latency |
|----------|--------------|-----------|-------------|---------|
| **Best reliability** | GPT-5.4-mini 2-call (OpenRouter) | 97.5% | ~$10 | ~300 min |
| **Best value** | Kimi K2.5 VL unified (Fireworks) | 92% | ~$3.50 | ~124 min |
| **Free tier** | Qwen 3.6 Plus:free (OpenRouter) | ~78% | $0 | ~44 min (9-case) |
| **Budget option** | DeepSeek V3.2:nitro (OpenRouter) | 84% | ~$1.50 | ~180 min |

## Provider Setup

| Provider | API key env var | Settings field | providerMode |
|----------|----------------|---------------|-------------|
| OpenRouter | `OPENROUTER_API_KEY` | `openRouterApiKey` | `"openrouter"` (default) |
| OpenAI | -- | `openaiApiKey` | `"openai-groq"` |
| Groq | `GROQ_API_KEY` | `groqApiKey` | `"openrouter-groq"` or `"openai-groq"` |
| Fireworks | `FIREWORKS_API_KEY` | `fireworksApiKey` | `"fireworks"` |

## Models Tested

### Tier 1: Production-ready (>90% pass rate)

| Model | Provider | Pass rate (full) | Pass rate (diag) | Cost/M (in/out) | Vision | Tool calling |
|-------|----------|-----------------|-----------------|-----------------|--------|-------------|
| GPT-5.4-mini:nitro | OpenRouter | 39/40 (97.5%) | 7-9/9 | $0.75/$4.50 | Yes | Excellent |
| **Kimi K2.5** | **Fireworks** | **35/38 (92%)** | **9/9** | **$0.60/$3.00** | **Yes** | **Excellent** |

### Tier 2: Viable alternatives (78-89% pass rate)

| Model | Provider | Pass rate (diag) | Cost/M (in/out) | Vision | Tool calling |
|-------|----------|-----------------|-----------------|--------|-------------|
| DeepSeek V3.2:nitro | OpenRouter | 8/9 | $0.26/$0.38 | No | Good |
| Qwen 3.6 Plus:free | OpenRouter | 7/9 | $0.00/$0.00 | No | Good |
| Grok 4.1 Fast | OpenRouter | 7/9 | $0.20/$0.50 | Yes | Good |
| MiniMax M2.5 | Fireworks | 7/9 | ~$0.50/$2.00 | No | Fair |
| Qwen3-VL-30B Thinking | OpenRouter | 7/9 | $0.13/$1.56 | Yes | Good |

### Architecture Modes

| Mode | Description | Calls/turn | Best with |
|------|-------------|-----------|-----------|
| **2-call** (default) | Perception VLM + Executor LLM | 2 | Any model (text-only OK) |
| **VL unified** | Screenshot to executor directly | 1 | Vision models (GPT-5.4, Kimi K2.5) |

VL unified mode reduces latency 40-70% by eliminating the perception call. Requires `useVLExecutor: true` in settings.

## Token Efficiency Reference

From 9-case diagnostic runs with actual trace data:

| Model | Provider | Turns | Input tok | Output tok | Total | Cost | Turns/pass |
|-------|----------|-------|-----------|-----------|-------|------|-----------|
| Kimi K2.5 VL | Fireworks | 174 | 1.47M | 26.6K | 1.49M | $0.96 | 17 |
| Kimi K2.5 2-call | Fireworks | 179 | 1.39M | 34.5K | 1.43M | $0.94 | 22 |
| Qwen 3.6 Plus:free | OpenRouter | 175 | 1.55M | 41.4K | 1.60M | $0.00 | 25 |
| GPT-5.4-mini 2-call | OpenRouter | 320 | 2.34M | 25.9K | 2.36M | $1.87 | 46 |
| MiniMax M2.5 | Fireworks | 305 | 2.58M | 51.1K | 2.63M | $1.39 | 44 |

Lower turns/pass = more efficient decision making.

## Known Test Weaknesses (Cross-Model)

Tests that fail across multiple models regardless of configuration:

| Test | Failure pattern | Models affected |
|------|----------------|----------------|
| online-shop: natural 2-item | Timeout / wrong items | All except GPT (intermittent) |
| online-shop: quantity x3 | Nondeterministic | All models (intermittent) |
| go-back-navigation | Misses page data before navigating | All non-GPT models |
| hover-menus | CSS :hover needs CDP | GPT-5.4-mini (text-only). Kimi VL passes! |

## How to Run Benchmarks

### Full suite (40 cases)
```bash
npm run build && npm run test:e2e
```

### Diagnostic (9 cases, ~15-60 min)
```bash
npx vitest run --config tests/e2e/vitest.e2e.config.ts \
  tests/e2e/summarize.test.ts tests/e2e/dashboard.test.ts \
  tests/e2e/navigation-challenge.test.ts tests/e2e/online-shop.test.ts
```

### With specific provider/model
```bash
# Fireworks + Kimi K2.5 in VL mode
E2E_PROVIDER=fireworks E2E_USE_VL_EXECUTOR=true npm run test:e2e

# Any OpenRouter model
E2E_EXECUTOR_MODEL="deepseek/deepseek-v3.2:nitro" npm run test:e2e

# Temperature override
E2E_TEMPERATURE=0.5 npm run test:e2e
```

### Environment variables

| Variable | Values | Default |
|----------|--------|---------|
| `E2E_PROVIDER` | `openrouter`, `fireworks`, `openrouter-groq`, `openai-groq` | `openrouter` |
| `E2E_EXECUTOR_MODEL` | Any model ID | Provider default |
| `E2E_USE_VL_EXECUTOR` | `true` | Not set (2-call mode) |
| `E2E_TEMPERATURE` | `0.0` - `2.0` | `0.0` |

## Benchmark History

| Date | Report | Scope | Key finding |
|------|--------|-------|-------------|
| 2026-04-01 | `e2e_reports/SUMMARY.md` | GPT-5.4-mini full suite | 39/40 (97.5%) baseline |
| 2026-04-03 | `e2e_reports/deepseek-v3.2/SUMMARY.md` | DeepSeek V3.2 full suite | 32/38 (84%), state-diff fix helped |
| 2026-04-05 | `docs/e2e-benchmark-2026-04-05.md` | Multi-model comparison | Kimi K2.5 VL: 35/38 (92%) at 1/3 cost |
