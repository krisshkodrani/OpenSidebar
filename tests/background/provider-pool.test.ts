import { describe, test, expect, beforeEach } from "vitest";
import {
  ProviderPool,
  MODEL_EXECUTOR,
  MODEL_EXECUTOR_GROQ,
  MODEL_PLANNER,
  PoolConfig,
} from "../../src/background/llm/client";

const EXECUTOR_CONFIG: PoolConfig = {
  groqModel: MODEL_EXECUTOR_GROQ,
  openRouterModel: MODEL_EXECUTOR,
};

const PLANNER_CONFIG: PoolConfig = {
  openRouterModel: MODEL_PLANNER,
};

describe("ProviderPool", () => {
  describe("priority ordering (executor)", () => {
    test("returns Groq when all providers are healthy", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("groq");
      expect(slot.model).toBe(MODEL_EXECUTOR_GROQ);
    });

    test("returns OpenRouter when only OpenRouter key", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_EXECUTOR);
    });

    test("pool has correct number of slots", () => {
      const full = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      expect(full.getSlots().length).toBe(2);

      const onlyOR = new ProviderPool("or-key", EXECUTOR_CONFIG);
      expect(onlyOR.getSlots().length).toBe(1);
    });
  });

  describe("priority ordering (planner)", () => {
    test("returns OpenRouter (planner model is OpenRouter-only)", () => {
      const pool = new ProviderPool("or-key", PLANNER_CONFIG);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_PLANNER);
    });

    test("planner pool has 1 slot (OpenRouter only)", () => {
      const pool = new ProviderPool("or-key", PLANNER_CONFIG);
      expect(pool.getSlots().length).toBe(1);
    });
  });

  describe("cooldown", () => {
    test("skips cooled-down provider and returns next", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      pool.cooldown("groq");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("OpenRouter is absolute fallback even when all cooled", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      pool.cooldown("groq");
      pool.cooldown("openrouter");
      const slot = pool.getActive();
      // OpenRouter is always the last slot fallback
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("cooldown expiry restores provider priority", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      pool.cooldown("groq");

      // Manually expire the cooldown by setting cooldownUntil in the past
      const slots = pool.getSlots();
      const groqSlot = slots.find(
        (s) => s.provider.providerId === "groq",
      )!;
      groqSlot.cooldownUntil = Date.now() - 1;

      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("groq");
    });

    test("cooldown for unknown provider is a no-op", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      pool.cooldown("nonexistent");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("groq");
    });

    test("planner pool cooldown still returns OpenRouter (single slot)", () => {
      const pool = new ProviderPool("or-key", PLANNER_CONFIG);
      pool.cooldown("openrouter");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_PLANNER);
    });
  });

  describe("getNextFallback", () => {
    test("returns OpenRouter as fallback after Groq", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      const fallback = pool.getNextFallback("groq");
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("returns null when OpenRouter is last (no more providers)", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      const fallback = pool.getNextFallback("openrouter");
      expect(fallback).toBeNull();
    });

    test("returns OpenRouter fallback even when downstream cooled", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      pool.cooldown("openrouter");
      const fallback = pool.getNextFallback("groq");
      // OpenRouter is the absolute fallback (last slot)
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("returns null for unknown provider", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      const fallback = pool.getNextFallback("nonexistent");
      expect(fallback).toBeNull();
    });
  });

  describe("disableForSession (WI-4)", () => {
    test("disableForSession makes getActive skip that provider", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      pool.disableForSession("groq");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("isDisabled returns true for disabled provider", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      expect(pool.isDisabled("groq")).toBe(false);
      pool.disableForSession("groq");
      expect(pool.isDisabled("groq")).toBe(true);
    });

    test("allDisabled returns true when all slots are disabled", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      expect(pool.allDisabled()).toBe(false);
      pool.disableForSession("groq");
      pool.disableForSession("openrouter");
      expect(pool.allDisabled()).toBe(true);
    });

    test("getNextFallback skips disabled providers", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      pool.disableForSession("openrouter");
      const fallback = pool.getNextFallback("groq");
      // OpenRouter disabled but still absolute fallback (last slot)
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("disable cascades: Groq disabled -> OpenRouter active", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      pool.disableForSession("groq");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(pool.allDisabled()).toBe(false);
    });
  });

  describe("single provider pool", () => {
    test("works with only OpenRouter", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_EXECUTOR);

      // No fallback available
      const fallback = pool.getNextFallback("openrouter");
      expect(fallback).toBeNull();
    });

    test("cooldown on single provider still returns it", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      pool.cooldown("openrouter");
      // Fallback to last slot (same provider)
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });
  });

  describe("model assignment", () => {
    test("each provider slot has correct model", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      const slots = pool.getSlots();

      expect(slots[0].model).toBe(MODEL_EXECUTOR_GROQ); // "openai/gpt-oss-120b"
      expect(slots[1].model).toBe(MODEL_EXECUTOR); // "openai/gpt-oss-120b"
    });

    test("provider URLs are correct", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      const slots = pool.getSlots();

      expect(slots[0].provider.baseUrl).toContain("groq.com");
      expect(slots[1].provider.baseUrl).toContain("openrouter.ai");
    });

    test("API keys are correctly assigned", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG, "groq-key");
      const slots = pool.getSlots();

      expect(slots[0].provider.apiKey).toBe("groq-key");
      expect(slots[1].provider.apiKey).toBe("or-key");
    });
  });
});
