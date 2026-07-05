import { describe, expect, test } from "vitest";
import {
  ReadThroughCache,
  liveValues,
  reconcile,
  stamp,
  tombstone,
  type KnowledgeStore,
  type LocalSnapshot,
  type SyncMap,
} from "../../src/utils/knowledge-sync";

function memLocal(seed: Record<string, SyncMap> = {}): LocalSnapshot & {
  data: Record<string, SyncMap>;
} {
  const data: Record<string, SyncMap> = { ...seed };
  return {
    data,
    async read(ns) {
      return { ...(data[ns] ?? {}) };
    },
    async write(ns, map) {
      data[ns] = { ...map };
    },
  };
}

function memStore(seed: Record<string, SyncMap> = {}): KnowledgeStore & {
  data: Record<string, SyncMap>;
} {
  const data: Record<string, SyncMap> = { ...seed };
  return {
    data,
    async getAll(ns) {
      return { ...(data[ns] ?? {}) };
    },
    async putItems(ns, items) {
      data[ns] = { ...(data[ns] ?? {}), ...items };
    },
  };
}

describe("reconcile (last-writer-wins)", () => {
  test("local newer than remote → local wins and is pushed", () => {
    const local: SyncMap = { a: stamp("local-new", 200) };
    const remote: SyncMap = { a: stamp("remote-old", 100) };
    const { merged, push, pull } = reconcile(local, remote);
    expect(merged.a.value).toBe("local-new");
    expect(push).toEqual(["a"]);
    expect(pull).toEqual([]);
  });

  test("remote newer than local → remote wins and is pulled", () => {
    const local: SyncMap = { a: stamp("local-old", 100) };
    const remote: SyncMap = { a: stamp("remote-new", 200) };
    const { merged, push, pull } = reconcile(local, remote);
    expect(merged.a.value).toBe("remote-new");
    expect(pull).toEqual(["a"]);
    expect(push).toEqual([]);
  });

  test("equal clocks → in sync, no transfer", () => {
    const local: SyncMap = { a: stamp("x", 100) };
    const remote: SyncMap = { a: stamp("x", 100) };
    const { push, pull } = reconcile(local, remote);
    expect(push).toEqual([]);
    expect(pull).toEqual([]);
  });

  test("missing on one side is pushed/pulled accordingly", () => {
    const local: SyncMap = { onlyLocal: stamp("L", 50) };
    const remote: SyncMap = { onlyRemote: stamp("R", 50) };
    const { merged, push, pull } = reconcile(local, remote);
    expect(push).toEqual(["onlyLocal"]);
    expect(pull).toEqual(["onlyRemote"]);
    expect(Object.keys(merged).sort()).toEqual(["onlyLocal", "onlyRemote"]);
  });

  test("a newer delete wins over an older value", () => {
    const local: SyncMap = { a: tombstone(300) };
    const remote: SyncMap = { a: stamp("stale", 200) };
    const { merged, push } = reconcile(local, remote);
    expect(merged.a.deleted).toBe(true);
    expect(push).toEqual(["a"]);
  });

  test("a newer value wins over an older delete (resurrection)", () => {
    const local: SyncMap = { a: tombstone(100) };
    const remote: SyncMap = { a: stamp("revived", 200) };
    const { merged, pull } = reconcile(local, remote);
    expect(merged.a.deleted).toBeUndefined();
    expect(merged.a.value).toBe("revived");
    expect(pull).toEqual(["a"]);
  });
});

describe("liveValues", () => {
  test("returns non-deleted values keyed by id", () => {
    const map: SyncMap = {
      a: stamp("keep", 1),
      b: tombstone(2),
    };
    expect(liveValues(map)).toEqual({ a: "keep" });
  });
});

describe("reconcile is order-independent", () => {
  test("merged result is the same regardless of arg order", () => {
    const x: SyncMap = { k: stamp("older", 1), only: stamp("o", 5) };
    const y: SyncMap = { k: stamp("newer", 9) };
    const a = reconcile(x, y).merged;
    const b = reconcile(y, x).merged;
    expect(a.k.value).toBe(b.k.value);
    expect(a.k.value).toBe("newer");
  });
});

describe("ReadThroughCache", () => {
  test("offline (no store) reads local only and never throws", async () => {
    const local = memLocal({ profile: { a: stamp("L", 1) } });
    const cache = new ReadThroughCache(local, null);
    const merged = await cache.sync("profile");
    expect(liveValues(merged)).toEqual({ a: "L" });
  });

  test("sync pulls remote-wins to local and pushes local-wins to the store", async () => {
    const local = memLocal({
      profile: { a: stamp("L-old", 1), c: stamp("L-only", 5) },
    });
    const store = memStore({
      profile: { a: stamp("R-new", 9), b: stamp("R-only", 5) },
    });
    const cache = new ReadThroughCache(local, store);

    const merged = await cache.sync("profile");

    // a: remote newer wins; b: remote-only pulled; c: local-only pushed.
    expect(liveValues(merged)).toEqual({ a: "R-new", b: "R-only", c: "L-only" });
    // Local cache now reflects the merged view.
    expect(liveValues(local.data.profile)).toEqual({
      a: "R-new",
      b: "R-only",
      c: "L-only",
    });
    // Store received the local-authoritative key only.
    expect(store.data.profile.c.value).toBe("L-only");
  });

  test("write-through updates local and the store when connected", async () => {
    const local = memLocal();
    const store = memStore();
    const cache = new ReadThroughCache(local, store);
    await cache.put("skills", "s1", stamp({ name: "Login flow" }, 10));
    expect(local.data.skills.s1.value).toEqual({ name: "Login flow" });
    expect(store.data.skills.s1.value).toEqual({ name: "Login flow" });
  });

  test("write-through offline updates local only", async () => {
    const local = memLocal();
    const cache = new ReadThroughCache(local, null);
    await cache.put("skills", "s1", stamp({ name: "Offline edit" }, 10));
    expect(local.data.skills.s1.value).toEqual({ name: "Offline edit" });
  });
});
