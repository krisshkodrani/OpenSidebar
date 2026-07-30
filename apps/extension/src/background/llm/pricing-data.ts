import type { ModelPricing } from "./pricing";

export const DEFAULT_MODEL_PRICING: ModelPricing[] = [
  {
    providerId: "groq",
    model: "openai/gpt-oss-120b",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    cachedInputUsdPerMillion: 0.075,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://console.groq.com/docs/model/openai/gpt-oss-120b",
    confidence: "official",
  },
  {
    providerId: "groq",
    model: "openai/gpt-oss-20b",
    inputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.3,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://console.groq.com/docs/model/openai/gpt-oss-20b",
    confidence: "official",
  },
  {
    providerId: "groq",
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    inputUsdPerMillion: 0.11,
    outputUsdPerMillion: 0.34,
    effectiveDate: "2026-04-19",
    sourceUrl:
      "https://console.groq.com/docs/model/meta-llama/llama-4-scout-17b-16e-instruct",
    confidence: "official",
  },
  // ---------------------------------------------------------------------
  // OpenRouter rows record the CATALOG rate from /api/v1/models — i.e. what
  // OpenRouter bills on default routing today. Two caveats a reader needs:
  //   1. OpenRouter routes one model across many hosts at different rates, so
  //      realized cost varies with routing. The catalog rate is the default,
  //      not a ceiling — pin a provider if you need the number to hold.
  //   2. Rows marked PROMO are discounted below the undiscounted list price
  //      noted inline. Those revert without notice; re-verify before quoting
  //      a saving. As elsewhere in this table these are pure inference rates
  //      and exclude OpenRouter's 5.5% Stripe credit-purchase fee.
  // Refreshed 2026-07-26 against the live catalog.
  // ---------------------------------------------------------------------
  {
    providerId: "openrouter",
    model: "openai/gpt-oss-120b",
    inputUsdPerMillion: 0.037,
    outputUsdPerMillion: 0.17,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/openai/gpt-oss-120b",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Input rose 0.118 -> 0.15 while output fell 0.99 -> 0.90 since the
    // 2026-04-19 snapshot; at this repo's ~33:1 input:output mix that is a net
    // increase, so the old row understated cost.
    model: "minimax/minimax-m2.5",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.9,
    cachedInputUsdPerMillion: 0.05,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/minimax/minimax-m2.5",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Rates unchanged since 2026-04-19; cached input was simply never
    // recorded, so cached tokens billed at the full input rate.
    model: "google/gemini-2.5-flash-lite",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4,
    cachedInputUsdPerMillion: 0.01,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/google/gemini-2.5-flash-lite",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Rates unchanged since 2026-04-19; cached input added (see above).
    model: "google/gemini-2.5-flash",
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 0.03,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/google/gemini-2.5-flash",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Executor seat, OpenRouter-served. Same list rate as Fireworks serves
    // minimax-m3 at (0.30/1.20/0.06), so OpenRouter is not a price win on the
    // default route — only the GMICloud PROMO endpoint (0.24/0.96/0.048)
    // undercuts it, and that host measured slowest of the pool.
    model: "minimax/minimax-m3",
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.2,
    cachedInputUsdPerMillion: 0.06,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/minimax/minimax-m3",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // PROMO: undiscounted list is 1.40/4.40/0.26 — identical to the Fireworks
    // glm-5p2 row above. The catalog rate below is ~51% off via the
    // StreamLake/Novita/Baidu endpoints and will revert when the promo ends.
    model: "z-ai/glm-5.2",
    inputUsdPerMillion: 0.6818,
    outputUsdPerMillion: 2.1428,
    cachedInputUsdPerMillion: 0.1266,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/z-ai/glm-5.2",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Undiscounted (no promo): cheaper than the Fireworks kimi-k2p7-code row
    // (0.95/4.00/0.19) on every axis.
    model: "moonshotai/kimi-k2.7-code",
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 3.5,
    cachedInputUsdPerMillion: 0.15,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/moonshotai/kimi-k2.7-code",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // PROMO: undiscounted list is 0.40/1.60/0.08 (matching the Fireworks
    // qwen3p7-plus row). Alibaba is the only host, at 20% off.
    model: "qwen/qwen3.7-plus",
    inputUsdPerMillion: 0.32,
    outputUsdPerMillion: 1.28,
    cachedInputUsdPerMillion: 0.064,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/qwen/qwen3.7-plus",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "moonshotai/kimi-k2.6",
    inputUsdPerMillion: 0.646,
    outputUsdPerMillion: 2.72,
    cachedInputUsdPerMillion: 0.1088,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/moonshotai/kimi-k2.6",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "moonshotai/kimi-k2.5",
    inputUsdPerMillion: 0.57,
    outputUsdPerMillion: 2.85,
    cachedInputUsdPerMillion: 0.095,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/moonshotai/kimi-k2.5",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Listed in OPENROUTER_EXECUTOR_MODELS and genuinely servable there, so it
    // needs a row or its runs bill as unpriced. No cached-input rate published.
    model: "qwen/qwen3-vl-30b-a3b-instruct",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/qwen/qwen3-vl-30b-a3b-instruct",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "qwen/qwen3-vl-30b-a3b-thinking",
    inputUsdPerMillion: 0.13,
    outputUsdPerMillion: 1.56,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/qwen/qwen3-vl-30b-a3b-thinking",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Replaces x-ai/grok-4.1-fast in the executor set — OpenRouter retired that
    // id, so the entry was unroutable. The premium executor option.
    model: "x-ai/grok-4.5",
    inputUsdPerMillion: 2.0,
    outputUsdPerMillion: 6.0,
    cachedInputUsdPerMillion: 0.3,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/x-ai/grok-4.5",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Planner alternative for the speed-first stack: ~152 tps on its fastest
    // host against GLM 5.2's ~59, at roughly a third of the rate. Text-only,
    // which the planner seat does not mind.
    model: "minimax/minimax-m2.7",
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 1.0,
    cachedInputUsdPerMillion: 0.05,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/minimax/minimax-m2.7",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // Judge alternative for the frugal stack.
    model: "openai/gpt-oss-20b",
    inputUsdPerMillion: 0.03,
    outputUsdPerMillion: 0.14,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/openai/gpt-oss-20b",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    // Fireworks bills under the accounts/... API id. There is deliberately no
    // fireworks + "openai/gpt-oss-120b" row: that catalog-style id 404s on the
    // Fireworks endpoint, so no run can ever bill under it. (The groq and
    // openrouter rows for that id above are real — it is served there.)
    model: "accounts/fireworks/models/gpt-oss-120b",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    // Cached input is 10% of the input rate (90% discount) — Fireworks' steepest
    // cache discount in the fleet. Verified 2026-07-21 against the serverless
    // pricing table; previously omitted, so cached tokens billed at full rate.
    cachedInputUsdPerMillion: 0.015,
    effectiveDate: "2026-07-21",
    sourceUrl: "https://docs.fireworks.ai/serverless/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "qwen/qwen3-vl-30b-a3b-instruct",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "accounts/fireworks/models/kimi-k2p7-code",
    inputUsdPerMillion: 0.95,
    outputUsdPerMillion: 4.0,
    cachedInputUsdPerMillion: 0.19,
    effectiveDate: "2026-06-12",
    sourceUrl: "https://fireworks.ai/models/fireworks/kimi-k2p7-code",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "accounts/fireworks/models/kimi-k2p6",
    inputUsdPerMillion: 2.0,
    outputUsdPerMillion: 8.0,
    cachedInputUsdPerMillion: 0.3,
    effectiveDate: "2026-05-29",
    sourceUrl: "https://docs.fireworks.ai/serverless/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    // Legacy router id retained so historical traces keep their cost estimate.
    model: "accounts/fireworks/routers/kimi-k2p6-turbo",
    inputUsdPerMillion: 2.0,
    outputUsdPerMillion: 8.0,
    cachedInputUsdPerMillion: 0.3,
    effectiveDate: "2026-05-29",
    sourceUrl: "https://docs.fireworks.ai/serverless/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "accounts/fireworks/routers/kimi-k2p5-turbo",
    inputUsdPerMillion: 0.99,
    outputUsdPerMillion: 4.94,
    cachedInputUsdPerMillion: 0.16,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "accounts/fireworks/routers/kimi-k2p5",
    inputUsdPerMillion: 0.6,
    outputUsdPerMillion: 3.0,
    cachedInputUsdPerMillion: 0.1,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "accounts/fireworks/models/minimax-m2p5",
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.2,
    cachedInputUsdPerMillion: 0.03,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    // minimax-m3: unified-VL executor candidate under A/B vs kimi-k2p7-code
    // (2026-07-17). Fireworks serverless rate; prompt caching cuts effective
    // input 80% (0.30 -> 0.06), not the ~90% previously recorded here — the
    // 0.03 cached rate was wrong and understated executor cost. Corrected
    // 2026-07-21 against the serverless pricing table.
    model: "accounts/fireworks/models/minimax-m3",
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.2,
    cachedInputUsdPerMillion: 0.06,
    effectiveDate: "2026-07-21",
    sourceUrl: "https://docs.fireworks.ai/serverless/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    // qwen3p7-plus: multimodal executor candidate (eval 2026-07-17), priced
    // between minimax-m3 and kimi-k2p7-code. Fireworks serverless rate per the
    // Qwen 3.7 Plus launch + pricing pages.
    model: "accounts/fireworks/models/qwen3p7-plus",
    inputUsdPerMillion: 0.4,
    outputUsdPerMillion: 1.6,
    cachedInputUsdPerMillion: 0.08,
    effectiveDate: "2026-07-17",
    sourceUrl: "https://fireworks.ai/blog/qwen-3p7-plus",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    // GLM 5.2 — planner/writer seat. The former 0.55/2.19 rate was a
    // placeholder that understated input ~2.5x and output ~2x; every cost
    // figure including planner spend before 2026-07-21 is low by that margin.
    // Real serverless rate verified 2026-07-21; cached input is 10% of input
    // (90% discount), previously omitted so cached tokens billed at full rate.
    model: "accounts/fireworks/models/glm-5p2",
    inputUsdPerMillion: 1.4,
    outputUsdPerMillion: 4.4,
    cachedInputUsdPerMillion: 0.14,
    effectiveDate: "2026-07-21",
    sourceUrl: "https://docs.fireworks.ai/serverless/pricing",
    confidence: "official",
  },
  {
    providerId: "moonshot",
    model: "kimi-k2.6",
    inputUsdPerMillion: 0.95,
    outputUsdPerMillion: 4.0,
    cachedInputUsdPerMillion: 0.16,
    effectiveDate: "2026-04-22",
    sourceUrl: "https://platform.kimi.ai/docs/pricing/chat-k26",
    confidence: "official",
  },
  {
    providerId: "moonshot",
    model: "kimi-k2.5",
    inputUsdPerMillion: 0.6,
    outputUsdPerMillion: 3.0,
    cachedInputUsdPerMillion: 0.1,
    effectiveDate: "2026-04-22",
    sourceUrl: "https://platform.kimi.ai/docs/pricing/chat-k25",
    confidence: "official",
  },
  {
    providerId: "deepseek",
    model: "deepseek-v4-flash",
    inputUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
    cachedInputUsdPerMillion: 0.0028,
    effectiveDate: "2026-04-26",
    sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    confidence: "official",
  },
  {
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    inputUsdPerMillion: 0.435,
    outputUsdPerMillion: 0.87,
    cachedInputUsdPerMillion: 0.003625,
    effectiveDate: "2026-04-26",
    sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    confidence: "official",
  },
  {
    providerId: "cerebras",
    // gemma-4-31b executor eval (2026-07-09). Rate from the Cerebras pricing
    // page; caching discount not published, so cachedInputUsdPerMillion is
    // omitted (cost falls back to the full input rate for cached tokens).
    model: "gemma-4-31b",
    inputUsdPerMillion: 0.99,
    outputUsdPerMillion: 1.49,
    effectiveDate: "2026-07-09",
    sourceUrl: "https://cloud.cerebras.ai",
    confidence: "official",
  },
  {
    providerId: "xiaomi",
    model: "mimo-v2-omni",
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    effectiveDate: "2026-04-29",
    sourceUrl: "https://platform.xiaomimimo.com/#/docs",
    confidence: "best_effort",
  },
  {
    providerId: "xiaomi",
    model: "mimo-v2-pro",
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    effectiveDate: "2026-04-29",
    sourceUrl: "https://platform.xiaomimimo.com/#/docs",
    confidence: "best_effort",
  },
  {
    providerId: "xiaomi",
    model: "mimo-v2-flash",
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    effectiveDate: "2026-04-29",
    sourceUrl: "https://platform.xiaomimimo.com/#/docs",
    confidence: "best_effort",
  },
  {
    providerId: "openrouter",
    // Rates unchanged since 2026-04-19; cached input (10% of input) added —
    // previously omitted, so cached tokens billed at the full rate.
    model: "openai/gpt-5.4-mini",
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 4.5,
    cachedInputUsdPerMillion: 0.075,
    effectiveDate: "2026-07-26",
    sourceUrl: "https://openrouter.ai/openai/gpt-5.4-mini",
    confidence: "official",
  },
];
