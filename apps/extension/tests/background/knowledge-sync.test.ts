import { describe, expect, test } from "vitest";
import {
  liveValues,
  reconcile,
  stamp,
  tombstone,
  type SyncMap,
} from "../../src/utils/knowledge-sync";

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
