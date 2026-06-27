import { describe, expect, test, vi } from "vitest";
import { KnowledgeSyncService } from "../../src/utils/knowledge-sync-service";
import { stamp, type SyncMap } from "../../src/utils/knowledge-sync";
import type { MinimalStorage } from "../../src/utils/knowledge-local-snapshot";

function memStorage(): MinimalStorage {
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
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, async json() { return body; } } as unknown as Response;
}

describe("KnowledgeSyncService (local-only / standalone)", () => {
  test("put then sync round-trips without any gateway", async () => {
    const svc = new KnowledgeSyncService({ storage: memStorage(), gatewayUrl: null });
    await svc.put("website-skills", "s1", { name: "Login flow" });
    expect(await svc.sync("website-skills")).toEqual({ s1: { name: "Login flow" } });
  });

  test("remove tombstones a key", async () => {
    const svc = new KnowledgeSyncService({ storage: memStorage(), gatewayUrl: null });
    await svc.put("profile", "name", "Kai");
    await svc.remove("profile", "name");
    expect(await svc.sync("profile")).toEqual({});
  });

  test("does not call fetch when local-only", async () => {
    const fetchImpl = vi.fn();
    const svc = new KnowledgeSyncService({
      storage: memStorage(),
      gatewayUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await svc.put("profile", "a", "x");
    await svc.sync("profile");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("KnowledgeSyncService (with OpenClaw gateway)", () => {
  test("sync pulls remote-authoritative values from the store", async () => {
    const remote: SyncMap = { a: stamp("remote-new", 9) };
    const fetchImpl = vi.fn(async () => jsonResponse(remote));
    const svc = new KnowledgeSyncService({
      storage: memStorage(),
      gatewayUrl: "http://127.0.0.1:9",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const live = await svc.sync("profile");
    expect(live).toEqual({ a: "remote-new" });
    expect(fetchImpl).toHaveBeenCalled();
  });
});
