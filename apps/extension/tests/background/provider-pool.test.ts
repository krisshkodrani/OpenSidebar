import { describe, test, expect } from "vitest";
import {
  ProviderPool,
  MODEL_EXECUTOR,
  MODEL_PLANNER,
  PoolConfig,
} from "../../src/background/llm/client";

const EXECUTOR_CONFIG: PoolConfig = {
  openRouterModel: MODEL_EXECUTOR,
};

const PLANNER_CONFIG: PoolConfig = {
  openRouterModel: MODEL_PLANNER,
};

describe("ProviderPool", () => {
  describe("priority ordering (executor)", () => {
    test("returns OpenRouter as the active provider", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_EXECUTOR);
    });

    test("pool has 1 slot", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      expect(pool.getSlots().length).toBe(1);
    });
  });

  describe("priority ordering (planner)", () => {
    test("returns OpenRouter with planner model", () => {
      const pool = new ProviderPool("or-key", PLANNER_CONFIG);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_PLANNER);
    });

    test("planner pool has 1 slot", () => {
      const pool = new ProviderPool("or-key", PLANNER_CONFIG);
      expect(pool.getSlots().length).toBe(1);
    });
  });

  describe("cooldown", () => {
    test("cooldown on single provider still returns it (absolute fallback)", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      pool.cooldown("openrouter");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("cooldown for unknown provider is a no-op", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      pool.cooldown("nonexistent");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("planner pool cooldown still returns OpenRouter", () => {
      const pool = new ProviderPool("or-key", PLANNER_CONFIG);
      pool.cooldown("openrouter");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_PLANNER);
    });
  });

  describe("getNextFallback", () => {
    test("returns null for OpenRouter (no more providers)", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      const fallback = pool.getNextFallback("openrouter");
      expect(fallback).toBeNull();
    });

    test("returns null for unknown provider", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      const fallback = pool.getNextFallback("nonexistent");
      expect(fallback).toBeNull();
    });
  });

  describe("disableForSession", () => {
    test("isDisabled returns true for disabled provider", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      expect(pool.isDisabled("openrouter")).toBe(false);
      pool.disableForSession("openrouter");
      expect(pool.isDisabled("openrouter")).toBe(true);
    });

    test("allDisabled returns true when all slots are disabled", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      expect(pool.allDisabled()).toBe(false);
      pool.disableForSession("openrouter");
      expect(pool.allDisabled()).toBe(true);
    });
  });

  describe("model assignment", () => {
    test("provider slot has correct model", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      const slots = pool.getSlots();
      expect(slots[0].model).toBe(MODEL_EXECUTOR);
    });

    test("provider URL is correct", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      const slots = pool.getSlots();
      expect(slots[0].provider.baseUrl).toContain("openrouter.ai");
    });

    test("API key is correctly assigned", () => {
      const pool = new ProviderPool("or-key", EXECUTOR_CONFIG);
      const slots = pool.getSlots();
      expect(slots[0].provider.apiKey).toBe("or-key");
    });
  });
});
