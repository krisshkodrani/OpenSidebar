import { describe, test, expect } from "vitest";
import {
  ProviderPool,
  MODEL_EXECUTOR,
  MODEL_PLANNER,
  openRouterProviderPool,
} from "../../src/background/llm/client";
import type { ProviderConfig } from "../../src/background/llm/types";

const FIREWORKS_PROVIDER: ProviderConfig = {
  providerId: "fireworks",
  baseUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
  apiKey: "fw-key",
  headers: {},
};

describe("ProviderPool", () => {
  describe("priority ordering (executor)", () => {
    test("returns OpenRouter as the active provider", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_EXECUTOR);
    });

    test("pool has 1 slot", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      expect(pool.getSlots().length).toBe(1);
    });

    test("can be constructed with a non-OpenRouter provider", () => {
      const pool = new ProviderPool({
        slots: [{ provider: FIREWORKS_PROVIDER, model: MODEL_EXECUTOR }],
      });
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("fireworks");
      expect(slot.provider.apiKey).toBe("fw-key");
      expect(slot.model).toBe(MODEL_EXECUTOR);
    });

    test("requires at least one provider slot", () => {
      expect(() => new ProviderPool({ slots: [] })).toThrow(
        /at least one provider slot/,
      );
    });
  });

  describe("priority ordering (planner)", () => {
    test("returns OpenRouter with planner model", () => {
      const pool = openRouterProviderPool("or-key", MODEL_PLANNER);
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_PLANNER);
    });

    test("planner pool has 1 slot", () => {
      const pool = openRouterProviderPool("or-key", MODEL_PLANNER);
      expect(pool.getSlots().length).toBe(1);
    });
  });

  describe("cooldown", () => {
    test("cooldown on single provider still returns the configured fallback", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      pool.cooldown("openrouter");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("cooldown for unknown provider is a no-op", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      pool.cooldown("nonexistent");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
    });

    test("planner pool cooldown still returns OpenRouter", () => {
      const pool = openRouterProviderPool("or-key", MODEL_PLANNER);
      pool.cooldown("openrouter");
      const slot = pool.getActive();
      expect(slot.provider.providerId).toBe("openrouter");
      expect(slot.model).toBe(MODEL_PLANNER);
    });
  });

  describe("getNextFallback", () => {
    test("returns null for OpenRouter (no more providers)", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      const fallback = pool.getNextFallback("openrouter");
      expect(fallback).toBeNull();
    });

    test("returns null for unknown provider", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      const fallback = pool.getNextFallback("nonexistent");
      expect(fallback).toBeNull();
    });

    test("returns the next configured provider in a multi-slot pool", () => {
      const openRouterSlot = openRouterProviderPool(
        "or-key",
        MODEL_EXECUTOR,
      ).getActive();
      const pool = new ProviderPool({
        slots: [
          { provider: FIREWORKS_PROVIDER, model: MODEL_EXECUTOR },
          { provider: openRouterSlot.provider, model: openRouterSlot.model },
        ],
      });
      const fallback = pool.getNextFallback("fireworks");
      expect(fallback?.provider.providerId).toBe("openrouter");
    });
  });

  describe("disableForSession", () => {
    test("isDisabled returns true for disabled provider", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      expect(pool.isDisabled("openrouter")).toBe(false);
      pool.disableForSession("openrouter");
      expect(pool.isDisabled("openrouter")).toBe(true);
    });

    test("allDisabled returns true when all slots are disabled", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      expect(pool.allDisabled()).toBe(false);
      pool.disableForSession("openrouter");
      expect(pool.allDisabled()).toBe(true);
    });
  });

  describe("model assignment", () => {
    test("provider slot has correct model", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      const slots = pool.getSlots();
      expect(slots[0].model).toBe(MODEL_EXECUTOR);
    });

    test("provider URL is correct", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      const slots = pool.getSlots();
      expect(slots[0].provider.baseUrl).toContain("openrouter.ai");
    });

    test("API key is correctly assigned", () => {
      const pool = openRouterProviderPool("or-key", MODEL_EXECUTOR);
      const slots = pool.getSlots();
      expect(slots[0].provider.apiKey).toBe("or-key");
    });
  });
});
