import { describe, expect, test } from "vitest";
import "../setup";
import { createFakeStorageArea } from "../fakes/persistence";
import {
  createTrustedCorpusStoreOnArea,
  TRUSTED_CORPUS_STORAGE_KEY,
  type TrustedCorpusStore,
  type TrustedCorpusUpsert,
} from "../../src/background/memory/trusted-corpus";

function fixedProvenance() {
  return { source: "user_input" as const, capturedAt: 1 };
}

function makeStore(): {
  store: TrustedCorpusStore;
  area: ReturnType<typeof createFakeStorageArea>;
} {
  const area = createFakeStorageArea();
  let t = 100;
  let n = 0;
  const store = createTrustedCorpusStoreOnArea(area, {
    now: () => ++t,
    newId: () => `id-${++n}`,
  });
  return { store, area };
}

const profileFact: TrustedCorpusUpsert = {
  kind: "personal_profile_fact",
  claimKey: "fact:full-name:abc",
  scope: {},
  value: "Sam Rivera",
  encrypted: false,
  provenance: fixedProvenance(),
  confidence: "high",
};

describe("trusted-corpus store", () => {
  test("load is empty when the key is absent", async () => {
    const { store } = makeStore();
    expect(await store.load()).toEqual([]);
  });

  test("upsert inserts a new entry with id + timestamps and stores a versioned envelope", async () => {
    const { store, area } = makeStore();
    const e = await store.upsert(profileFact);
    expect(e).toMatchObject({
      id: "id-1",
      kind: "personal_profile_fact",
      claimKey: "fact:full-name:abc",
      value: "Sam Rivera",
      version: 1,
      createdAt: 101,
      updatedAt: 101,
    });
    // persisted as a versioned envelope under the corpus key
    const stored = area.store.get(TRUSTED_CORPUS_STORAGE_KEY) as {
      __version: number;
      value: unknown[];
    };
    expect(stored.__version).toBe(1);
    expect(stored.value).toHaveLength(1);
  });

  test("upsert dedups by (kind, scope, claimKey): updates in place, preserves createdAt", async () => {
    const { store } = makeStore();
    const first = await store.upsert(profileFact);
    const second = await store.upsert({
      ...profileFact,
      value: "Samuel Rivera",
      confidence: "medium",
    });
    expect(second.id).toBe(first.id); // same identity → same row
    expect(second.createdAt).toBe(first.createdAt); // preserved
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt); // bumped
    expect(second.value).toBe("Samuel Rivera");
    expect(await store.load()).toHaveLength(1);
  });

  test("scope is part of identity: same claimKey on different origins are distinct", async () => {
    const { store } = makeStore();
    await store.upsert({
      kind: "website_skill",
      claimKey: "skill:checkout",
      scope: { origin: "https://a.test", pathPattern: "/checkout" },
      value: { steps: [] },
      encrypted: false,
      provenance: fixedProvenance(),
      confidence: "high",
    });
    await store.upsert({
      kind: "website_skill",
      claimKey: "skill:checkout",
      scope: { origin: "https://b.test", pathPattern: "/checkout" },
      value: { steps: [] },
      encrypted: false,
      provenance: fixedProvenance(),
      confidence: "high",
    });
    expect(await store.load()).toHaveLength(2);
    expect(await store.listByOrigin("https://a.test")).toHaveLength(1);
  });

  test("get / listByKind / remove", async () => {
    const { store } = makeStore();
    const e = await store.upsert(profileFact);
    expect(await store.get("personal_profile_fact", "fact:full-name:abc")).toMatchObject({
      id: e.id,
    });
    expect(await store.get("personal_profile_fact", "missing")).toBeNull();
    expect(await store.listByKind("personal_profile_fact")).toHaveLength(1);
    expect(await store.listByKind("website_skill")).toHaveLength(0);
    await store.remove(e.id);
    expect(await store.load()).toEqual([]);
  });

  test("onChanged fires with decoded entries on an external write", async () => {
    const { store, area } = makeStore();
    const seen: number[] = [];
    const unsub = store.onChanged((entries) => seen.push(entries.length));
    await area.set({
      [TRUSTED_CORPUS_STORAGE_KEY]: {
        __version: 1,
        value: [{ id: "x" }, { id: "y" }],
      },
    });
    expect(seen).toEqual([2]);
    unsub();
  });
});
