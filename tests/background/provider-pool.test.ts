import { describe, test, expect, beforeEach } from "bun:test";
import {
  ProviderPool,
  MODEL_FAST,
  MODEL_FAST_GROQ,
  MODEL_FAST_CEREBRAS,
} from "../../src/background/llm/client";

describe("ProviderPool", () => {
  describe("priority ordering", () => {
    test("returns Cerebras when all providers are healthy", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("cerebras");
      expect(slot.model).toBe(MODEL_FAST_CEREBRAS);
    });

    test("returns Groq when no Cerebras key", () => {
      const pool = new ProviderPool("or-key", "groq-key");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("groq");
      expect(slot.model).toBe(MODEL_FAST_GROQ);
    });

    test("returns OpenRouter when only OpenRouter key", () => {
      const pool = new ProviderPool("or-key");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_FAST);
    });

    test("pool has correct number of slots", () => {
      const full = new ProviderPool("or-key", "groq-key", "cerebras-key");
      expect(full.getSlots().length).toBe(3);

      const noGroq = new ProviderPool("or-key", undefined, "cerebras-key");
      expect(noGroq.getSlots().length).toBe(2);

      const onlyOR = new ProviderPool("or-key");
      expect(onlyOR.getSlots().length).toBe(1);
    });
  });

  describe("cooldown", () => {
    test("skips cooled-down provider and returns next", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      pool.cooldown("cerebras");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("groq");
    });

    test("cascade cooldown — both Cerebras + Groq cooled → OpenRouter", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      pool.cooldown("cerebras");
      pool.cooldown("groq");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("OpenRouter is absolute fallback even when all cooled", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      pool.cooldown("cerebras");
      pool.cooldown("groq");
      pool.cooldown("openrouter");
      const slot = pool.getActive();
      // OpenRouter is always the last slot fallback
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("cooldown expiry restores provider priority", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      pool.cooldown("cerebras");

      // Manually expire the cooldown by setting cooldownUntil in the past
      const slots = pool.getSlots();
      const cerebrasSlot = slots.find(
        (s) => s.provider.providerId === "cerebras",
      )!;
      cerebrasSlot.cooldownUntil = Date.now() - 1;

      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("cerebras");
    });

    test("cooldown for unknown provider is a no-op", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      pool.cooldown("nonexistent");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("cerebras");
    });
  });

  describe("getNextFallback", () => {
    test("returns Groq as fallback after Cerebras", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      const fallback = pool.getNextFallback("cerebras");
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("groq");
    });

    test("returns OpenRouter as fallback after Groq", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      const fallback = pool.getNextFallback("groq");
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("returns null when OpenRouter is last (no more providers)", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      const fallback = pool.getNextFallback("openrouter");
      expect(fallback).toBeNull();
    });

    test("skips cooled-down intermediate providers", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      pool.cooldown("groq");
      const fallback = pool.getNextFallback("cerebras");
      // Should skip Groq (cooled) and return OpenRouter
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("returns OpenRouter fallback even when all downstream cooled", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      pool.cooldown("groq");
      pool.cooldown("openrouter");
      const fallback = pool.getNextFallback("cerebras");
      // OpenRouter is the absolute fallback (last slot)
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("returns null for unknown provider", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      const fallback = pool.getNextFallback("nonexistent");
      expect(fallback).toBeNull();
    });
  });

  describe("single provider pool", () => {
    test("works with only OpenRouter", () => {
      const pool = new ProviderPool("or-key");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_FAST);

      // No fallback available
      const fallback = pool.getNextFallback("openrouter");
      expect(fallback).toBeNull();
    });

    test("cooldown on single provider still returns it", () => {
      const pool = new ProviderPool("or-key");
      pool.cooldown("openrouter");
      // Fallback to last slot (same provider)
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });
  });

  describe("model assignment", () => {
    test("each provider slot has correct model", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      const slots = pool.getSlots();

      expect(slots[0].model).toBe(MODEL_FAST_CEREBRAS); // "gpt-oss-120b"
      expect(slots[1].model).toBe(MODEL_FAST_GROQ); // "openai/gpt-oss-120b"
      expect(slots[2].model).toBe(MODEL_FAST); // "openai/gpt-4o-mini"
    });

    test("provider URLs are correct", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      const slots = pool.getSlots();

      expect(slots[0].provider.baseUrl).toContain("cerebras.ai");
      expect(slots[1].provider.baseUrl).toContain("groq.com");
      expect(slots[2].provider.baseUrl).toContain("openrouter.ai");
    });

    test("API keys are correctly assigned", () => {
      const pool = new ProviderPool("or-key", "groq-key", "cerebras-key");
      const slots = pool.getSlots();

      expect(slots[0].provider.apiKey).toBe("cerebras-key");
      expect(slots[1].provider.apiKey).toBe("groq-key");
      expect(slots[2].provider.apiKey).toBe("or-key");
    });
  });
});
