import { describe, test, expect, beforeEach } from "vitest";
import "../setup";
import { ToolResultCache } from "../../src/background/agent/tool-cache";
import type { CacheType } from "../../src/background/agent/tool-cache";
import { ToolName } from "../../src/types";

describe("ToolResultCache", () => {
  let cache: ToolResultCache;

  beforeEach(() => {
    cache = new ToolResultCache(4); // small capacity for eviction tests
  });

  describe("key()", () => {
    test("produces deterministic keys", () => {
      const k1 = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "hello" });
      const k2 = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "hello" });
      expect(k1).toBe(k2);
    });

    test("different args produce different keys", () => {
      const k1 = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "a" });
      const k2 = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "b" });
      expect(k1).not.toBe(k2);
    });

    test("different tools produce different keys", () => {
      const k1 = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "a" });
      const k2 = ToolResultCache.key(ToolName.READ_ELEMENT, { text: "a" });
      expect(k1).not.toBe(k2);
    });
  });

  describe("basic get/set", () => {
    test("returns null on miss", () => {
      const key = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "x" });
      expect(cache.get(key, "fp1")).toBeNull();
    });

    test("returns cached result on hit", () => {
      const key = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "x" });
      cache.set(key, "Found element [5]", "fp1", "dom");
      expect(cache.get(key, "fp1")).toBe("Found element [5]");
    });
  });

  describe("DOM fingerprint invalidation", () => {
    test("DOM entry misses when fingerprint changes", () => {
      const key = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "x" });
      cache.set(key, "result", "fp1", "dom");
      expect(cache.get(key, "fp1")).toBe("result");
      expect(cache.get(key, "fp2")).toBeNull(); // fingerprint changed
    });

    test("memory entry hits regardless of fingerprint", () => {
      const key = ToolResultCache.key(ToolName.RECALL_DEMO, { query: "q" });
      cache.set(key, "result", "fp1", "memory");
      expect(cache.get(key, "fp2")).toBe("result");
    });

    test("static entry hits regardless of fingerprint", () => {
      const key = ToolResultCache.key(ToolName.GET_COOKIES, { domain: "x" });
      cache.set(key, "result", "fp1", "static");
      expect(cache.get(key, "fp999")).toBe("result");
    });
  });

  describe("invalidateDom()", () => {
    test("clears only DOM entries", () => {
      const domKey = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "a" });
      const memKey = ToolResultCache.key(ToolName.RECALL_DEMO, { query: "b" });
      const staticKey = ToolResultCache.key(ToolName.GET_COOKIES, {});

      cache.set(domKey, "dom-result", "fp1", "dom");
      cache.set(memKey, "mem-result", "fp1", "memory");
      cache.set(staticKey, "static-result", "fp1", "static");

      cache.invalidateDom();

      expect(cache.get(domKey, "fp1")).toBeNull();
      expect(cache.get(memKey, "fp1")).toBe("mem-result");
      expect(cache.get(staticKey, "fp1")).toBe("static-result");
    });
  });

  describe("invalidateMemory()", () => {
    test("clears only memory entries", () => {
      const domKey = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "a" });
      const memKey = ToolResultCache.key(ToolName.RECALL_DEMO, { query: "b" });
      const staticKey = ToolResultCache.key(ToolName.GET_COOKIES, {});

      cache.set(domKey, "dom-result", "fp1", "dom");
      cache.set(memKey, "mem-result", "fp1", "memory");
      cache.set(staticKey, "static-result", "fp1", "static");

      cache.invalidateMemory();

      expect(cache.get(domKey, "fp1")).toBe("dom-result");
      expect(cache.get(memKey, "fp1")).toBeNull();
      expect(cache.get(staticKey, "fp1")).toBe("static-result");
    });
  });

  describe("error rejection", () => {
    test("does not cache results starting with 'Error:'", () => {
      const key = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "x" });
      cache.set(key, "Error: Element not found", "fp1", "dom");
      expect(cache.get(key, "fp1")).toBeNull();
      expect(cache.size).toBe(0);
    });
  });

  describe("FIFO eviction", () => {
    test("evicts oldest entry when at capacity", () => {
      // capacity is 4
      const keys = Array.from({ length: 5 }, (_, i) =>
        ToolResultCache.key(ToolName.FIND_ELEMENT, { text: `item${i}` }),
      );

      for (let i = 0; i < 5; i++) {
        cache.set(keys[i], `result${i}`, "fp1", "dom");
      }

      // First entry should have been evicted
      expect(cache.get(keys[0], "fp1")).toBeNull();
      // Remaining 4 should be present
      for (let i = 1; i < 5; i++) {
        expect(cache.get(keys[i], "fp1")).toBe(`result${i}`);
      }
      expect(cache.size).toBe(4);
    });

    test("updating existing key does not trigger eviction", () => {
      const keys = Array.from({ length: 4 }, (_, i) =>
        ToolResultCache.key(ToolName.FIND_ELEMENT, { text: `item${i}` }),
      );
      for (let i = 0; i < 4; i++) {
        cache.set(keys[i], `result${i}`, "fp1", "dom");
      }

      // Update first key — should NOT evict anything
      cache.set(keys[0], "updated", "fp1", "dom");

      expect(cache.size).toBe(4);
      expect(cache.get(keys[0], "fp1")).toBe("updated");
      expect(cache.get(keys[3], "fp1")).toBe("result3");
    });
  });

  describe("stats tracking", () => {
    test("tracks hits and misses", () => {
      const key = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "x" });
      cache.get(key, "fp1"); // miss
      cache.set(key, "result", "fp1", "dom");
      cache.get(key, "fp1"); // hit
      cache.get(key, "fp2"); // miss (fingerprint changed)

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
    });

    test("tracks invalidations", () => {
      cache.set(ToolResultCache.key(ToolName.FIND_ELEMENT, { a: 1 }), "r1", "fp", "dom");
      cache.set(ToolResultCache.key(ToolName.FIND_ELEMENT, { a: 2 }), "r2", "fp", "dom");
      cache.invalidateDom();

      const stats = cache.getStats();
      expect(stats.invalidations).toBe(2);
    });

    test("tracks evictions", () => {
      // Fill to capacity (4) + 1
      for (let i = 0; i < 5; i++) {
        cache.set(
          ToolResultCache.key(ToolName.FIND_ELEMENT, { i }),
          `r${i}`,
          "fp",
          "dom",
        );
      }
      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe("clear()", () => {
    test("removes all entries and counts as invalidations", () => {
      cache.set(ToolResultCache.key(ToolName.FIND_ELEMENT, { a: 1 }), "r1", "fp", "dom");
      cache.set(ToolResultCache.key(ToolName.RECALL_DEMO, { q: "x" }), "r2", "fp", "memory");
      cache.set(ToolResultCache.key(ToolName.GET_COOKIES, {}), "r3", "fp", "static");

      cache.clear();

      expect(cache.size).toBe(0);
      const stats = cache.getStats();
      expect(stats.invalidations).toBe(3);
    });
  });

  describe("isolation between cache types", () => {
    test("invalidateDom does not affect memory or static, and vice versa", () => {
      const domKey = ToolResultCache.key(ToolName.FIND_ELEMENT, { text: "a" });
      const memKey = ToolResultCache.key(ToolName.RECALL_DEMO, { query: "b" });
      const staticKey = ToolResultCache.key(ToolName.GET_COOKIES, {});

      cache.set(domKey, "dom", "fp1", "dom");
      cache.set(memKey, "mem", "fp1", "memory");
      cache.set(staticKey, "static", "fp1", "static");

      // Invalidate DOM
      cache.invalidateDom();
      expect(cache.size).toBe(2);

      // Re-add DOM, invalidate memory
      cache.set(domKey, "dom2", "fp2", "dom");
      cache.invalidateMemory();
      expect(cache.get(domKey, "fp2")).toBe("dom2");
      expect(cache.get(memKey, "fp1")).toBeNull();
      expect(cache.get(staticKey, "fp1")).toBe("static");
    });
  });
});
