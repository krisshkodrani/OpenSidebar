import { describe, expect, test } from "vitest";
import {
  ChromeStorageLocalSnapshot,
  KNOWLEDGE_STORAGE_PREFIX,
  type MinimalStorage,
} from "../../src/utils/knowledge-local-snapshot";
import { ReadThroughCache, stamp } from "../../src/utils/knowledge-sync";

function memStorage(): MinimalStorage & { dump: () => Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    local: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: data[keys] };
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((k) => [k, data[k]]));
        }
        return { ...data };
      },
      async set(items) {
        Object.assign(data, items);
      },
    },
    dump: () => ({ ...data }),
  };
}

describe("ChromeStorageLocalSnapshot", () => {
  test("read returns an empty map for an unknown namespace", async () => {
    const snap = new ChromeStorageLocalSnapshot(memStorage());
    expect(await snap.read("profile")).toEqual({});
  });

  test("write then read round-trips, namespaced by key", async () => {
    const storage = memStorage();
    const snap = new ChromeStorageLocalSnapshot(storage);
    await snap.write("profile", { a: stamp("v", 1) });
    expect(await snap.read("profile")).toEqual({ a: stamp("v", 1) });
    expect(storage.dump()[`${KNOWLEDGE_STORAGE_PREFIX}profile`]).toBeDefined();
  });

  test("namespaces are isolated", async () => {
    const snap = new ChromeStorageLocalSnapshot(memStorage());
    await snap.write("profile", { a: stamp("p", 1) });
    await snap.write("skills", { b: stamp("s", 1) });
    expect(await snap.read("profile")).toEqual({ a: stamp("p", 1) });
    expect(await snap.read("skills")).toEqual({ b: stamp("s", 1) });
  });

  test("drives a ReadThroughCache offline (no store)", async () => {
    const snap = new ChromeStorageLocalSnapshot(memStorage());
    const cache = new ReadThroughCache(snap, null);
    await cache.put("profile", "name", stamp("Kai", 5));
    const merged = await cache.sync("profile");
    expect(merged.name.value).toBe("Kai");
  });
});
