import type { ModelPricing } from "./pricing";

export const DEFAULT_MODEL_PRICING: ModelPricing[] = [
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
    model: "openai/gpt-6-luna",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.5,
    cachedInputUsdPerMillion: 0.01,
    effectiveDate: "2026-09-28",
    sourceUrl: "https://openrouter.ai/openai/gpt-6-luna",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "typesafe/jev-1.13",
    inputUsdPerMillion: 0.042,
    outputUsdPerMillion: 0,
    effectiveDate: "2026-09-28",
    sourceUrl: "https://openrouter.ai/typesafe/jev-1.13",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    // OpenRouter catalog promotion observed 2026-08-13. The OpenAI route is
    // pinned separately by the caller, so reports retain resolved-provider
    // identity alongside this catalog estimate.
    model: "openai/gpt-5.6-luna",
    inputUsdPerMillion: 0.5,
    outputUsdPerMillion: 3,
    effectiveDate: "2026-08-13",
    sourceUrl: "https://openrouter.ai/openai/gpt-5.6-luna",
    confidence: "official",
  },
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
    // Executor seat. The GMICloud PROMO endpoint (0.24/0.96/0.048) undercuts
    // the default route (0.30/1.20/0.06), and that host measured slowest of
    // the pool.
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
    // PROMO: undiscounted list is 1.40/4.40/0.26. The catalog rate below is
    // ~51% off via the
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
    // Undiscounted (no promo).
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
    // PROMO: undiscounted list is 0.40/1.60/0.08. Alibaba is the only host,
    // at 20% off.
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
