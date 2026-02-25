import { describe, test, expect, beforeEach } from "vitest";
import {
  ProviderPool,
  MODEL_FAST,
  MODEL_FAST_GROQ,
  MODEL_FAST_CEREBRAS,
  MODEL_SMART,
  MODEL_SMART_CEREBRAS,
  PoolConfig,
} from "../../src/background/llm/client";

const FAST_CONFIG: PoolConfig = {
  cerebrasModel: MODEL_FAST_CEREBRAS,
  groqModel: MODEL_FAST_GROQ,
  openRouterModel: MODEL_FAST,
};

const SMART_CONFIG: PoolConfig = {
  cerebrasModel: MODEL_SMART_CEREBRAS,
  openRouterModel: MODEL_SMART,
};

describe("ProviderPool", () => {
  describe("priority ordering (fast)", () => {
    test("returns Cerebras when all providers are healthy", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("cerebras");
      expect(slot.model).toBe(MODEL_FAST_CEREBRAS);
    });

    test("returns Groq when no Cerebras key", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("groq");
      expect(slot.model).toBe(MODEL_FAST_GROQ);
    });

    test("returns OpenRouter when only OpenRouter key", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_FAST);
    });

    test("pool has correct number of slots", () => {
      const full = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      expect(full.getSlots().length).toBe(3);

      const noGroq = new ProviderPool("or-key", FAST_CONFIG, undefined, "cerebras-key");
      expect(noGroq.getSlots().length).toBe(2);

      const onlyOR = new ProviderPool("or-key", FAST_CONFIG);
      expect(onlyOR.getSlots().length).toBe(1);
    });
  });

  describe("priority ordering (smart)", () => {
    test("returns Cerebras when key present", () => {
      const pool = new ProviderPool("or-key", SMART_CONFIG, undefined, "cerebras-key");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("cerebras");
      expect(slot.model).toBe(MODEL_SMART_CEREBRAS);
    });

    test("returns OpenRouter when no Cerebras key", () => {
      const pool = new ProviderPool("or-key", SMART_CONFIG);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_SMART);
    });

    test("smart pool has 2 slots max (no Groq)", () => {
      const pool = new ProviderPool("or-key", SMART_CONFIG, undefined, "cerebras-key");
      expect(pool.getSlots().length).toBe(2);
    });
  });

  describe("cooldown", () => {
    test("skips cooled-down provider and returns next", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.cooldown("cerebras");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("groq");
    });

    test("cascade cooldown — both Cerebras + Groq cooled → OpenRouter", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.cooldown("cerebras");
      pool.cooldown("groq");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("OpenRouter is absolute fallback even when all cooled", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.cooldown("cerebras");
      pool.cooldown("groq");
      pool.cooldown("openrouter");
      const slot = pool.getActive();
      // OpenRouter is always the last slot fallback
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("cooldown expiry restores provider priority", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
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
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.cooldown("nonexistent");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("cerebras");
    });

    test("smart pool cooldown falls to OpenRouter", () => {
      const pool = new ProviderPool("or-key", SMART_CONFIG, undefined, "cerebras-key");
      pool.cooldown("cerebras");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_SMART);
    });
  });

  describe("getNextFallback", () => {
    test("returns Groq as fallback after Cerebras", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      const fallback = pool.getNextFallback("cerebras");
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("groq");
    });

    test("returns OpenRouter as fallback after Groq", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      const fallback = pool.getNextFallback("groq");
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("returns null when OpenRouter is last (no more providers)", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      const fallback = pool.getNextFallback("openrouter");
      expect(fallback).toBeNull();
    });

    test("skips cooled-down intermediate providers", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.cooldown("groq");
      const fallback = pool.getNextFallback("cerebras");
      // Should skip Groq (cooled) and return OpenRouter
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("returns OpenRouter fallback even when all downstream cooled", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.cooldown("groq");
      pool.cooldown("openrouter");
      const fallback = pool.getNextFallback("cerebras");
      // OpenRouter is the absolute fallback (last slot)
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("returns null for unknown provider", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      const fallback = pool.getNextFallback("nonexistent");
      expect(fallback).toBeNull();
    });
  });

  describe("disableForSession (WI-4)", () => {
    test("disableForSession makes getActive skip that provider", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.disableForSession("cerebras");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("groq");
    });

    test("isDisabled returns true for disabled provider", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      expect(pool.isDisabled("cerebras")).toBe(false);
      pool.disableForSession("cerebras");
      expect(pool.isDisabled("cerebras")).toBe(true);
    });

    test("allDisabled returns true when all slots are disabled", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      expect(pool.allDisabled()).toBe(false);
      pool.disableForSession("cerebras");
      pool.disableForSession("groq");
      pool.disableForSession("openrouter");
      expect(pool.allDisabled()).toBe(true);
    });

    test("getNextFallback skips disabled providers", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.disableForSession("groq");
      const fallback = pool.getNextFallback("cerebras");
      // Groq disabled, should return OpenRouter (absolute fallback)
      expect(fallback).not.toBeNull();
      expect(fallback!.provider.providerId).toBe("openrouter");
    });

    test("disable cascades: Cerebras + Groq disabled → OpenRouter active", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      pool.disableForSession("cerebras");
      pool.disableForSession("groq");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(pool.allDisabled()).toBe(false);
    });
  });

  describe("single provider pool", () => {
    test("works with only OpenRouter", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_FAST);

      // No fallback available
      const fallback = pool.getNextFallback("openrouter");
      expect(fallback).toBeNull();
    });

    test("cooldown on single provider still returns it", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG);
      pool.cooldown("openrouter");
      // Fallback to last slot (same provider)
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });
  });

  describe("model assignment", () => {
    test("each provider slot has correct model", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      const slots = pool.getSlots();

      expect(slots[0].model).toBe(MODEL_FAST_CEREBRAS); // "gpt-oss-120b"
      expect(slots[1].model).toBe(MODEL_FAST_GROQ); // "openai/gpt-oss-120b"
      expect(slots[2].model).toBe(MODEL_FAST); // "openai/gpt-oss-120b"
    });

    test("provider URLs are correct", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      const slots = pool.getSlots();

      expect(slots[0].provider.baseUrl).toContain("cerebras.ai");
      expect(slots[1].provider.baseUrl).toContain("groq.com");
      expect(slots[2].provider.baseUrl).toContain("openrouter.ai");
    });

    test("API keys are correctly assigned", () => {
      const pool = new ProviderPool("or-key", FAST_CONFIG, "groq-key", "cerebras-key");
      const slots = pool.getSlots();

      expect(slots[0].provider.apiKey).toBe("cerebras-key");
      expect(slots[1].provider.apiKey).toBe("groq-key");
      expect(slots[2].provider.apiKey).toBe("or-key");
    });
  });
});
