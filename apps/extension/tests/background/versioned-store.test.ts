import { describe, expect, test, vi } from "vitest";
import "../setup";
import { createVersionedStore } from "../../src/background/environment/versioned-store";
import { createFakeStorageArea } from "../fakes/persistence";

interface Profile {
  name: string;
  theme: string;
}

describe("createVersionedStore", () => {
  test("save wraps in a versioned envelope; load unwraps it", async () => {
    const area = createFakeStorageArea();
    const store = createVersionedStore<Profile>(area, "profile", { version: 2 });

    expect(await store.load()).toBeUndefined();
    await store.save({ name: "Alex", theme: "dark" });

    expect(area.store.get("profile")).toEqual({
      __version: 2,
      value: { name: "Alex", theme: "dark" },
    });
    expect(await store.load()).toEqual({ name: "Alex", theme: "dark" });
  });

  test("update read-modify-writes and returns the new value", async () => {
    const area = createFakeStorageArea();
    const store = createVersionedStore<Profile>(area, "profile", { version: 1 });
    await store.save({ name: "Alex", theme: "dark" });

    const next = await store.update((current) => ({
      name: current?.name ?? "?",
      theme: "light",
    }));

    expect(next).toEqual({ name: "Alex", theme: "light" });
    expect(await store.load()).toEqual({ name: "Alex", theme: "light" });
  });

  test("migrate runs for a lower stored version", async () => {
    const area = createFakeStorageArea();
    // Seed a v1 envelope directly.
    await area.set({ profile: { __version: 1, value: { fullName: "Alex" } } });

    const store = createVersionedStore<Profile>(area, "profile", {
      version: 2,
      migrate: (raw, from) => {
        expect(from).toBe(1);
        const legacy = raw as { fullName: string };
        return { name: legacy.fullName, theme: "dark" };
      },
    });

    expect(await store.load()).toEqual({ name: "Alex", theme: "dark" });
  });

  test("migrate runs for un-versioned legacy data (no envelope)", async () => {
    const area = createFakeStorageArea();
    await area.set({ profile: { name: "Legacy", theme: "dark" } });

    const store = createVersionedStore<Profile>(area, "profile", {
      version: 1,
      migrate: (raw, from) => {
        expect(from).toBeUndefined();
        return raw as Profile;
      },
    });

    expect(await store.load()).toEqual({ name: "Legacy", theme: "dark" });
  });

  test("without migrate, a stale version reads as absent", async () => {
    const area = createFakeStorageArea();
    await area.set({ profile: { __version: 1, value: { name: "Old" } } });
    const store = createVersionedStore<Profile>(area, "profile", { version: 2 });
    expect(await store.load()).toBeUndefined();
  });

  test("remove deletes the key", async () => {
    const area = createFakeStorageArea();
    const store = createVersionedStore<Profile>(area, "profile", { version: 1 });
    await store.save({ name: "Alex", theme: "dark" });
    await store.remove();
    expect(area.store.has("profile")).toBe(false);
    expect(await store.load()).toBeUndefined();
  });

  test("onChanged fires with the decoded new value for this key only", async () => {
    const area = createFakeStorageArea();
    const store = createVersionedStore<Profile>(area, "profile", { version: 1 });
    const seen: (Profile | undefined)[] = [];
    const unsubscribe = store.onChanged((v) => seen.push(v));

    await store.save({ name: "Alex", theme: "dark" });
    await area.set({ unrelated: 1 }); // different key — ignored
    unsubscribe();
    await store.save({ name: "Bo", theme: "light" }); // after unsubscribe — ignored

    expect(seen).toEqual([{ name: "Alex", theme: "dark" }]);
  });

  test("onChanged unsubscribe is idempotent and callable", () => {
    const area = createFakeStorageArea();
    const store = createVersionedStore<Profile>(area, "profile", { version: 1 });
    const listener = vi.fn();
    const unsubscribe = store.onChanged(listener);
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });
});
