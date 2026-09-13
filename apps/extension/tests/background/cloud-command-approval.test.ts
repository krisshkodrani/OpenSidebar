import { describe, expect, it } from "vitest";
import type {
  PersistenceStorageArea,
  PersistenceStorageChange,
} from "../../src/background/environment/types";
import {
  LocalCloudCommandApprovalStore,
  PendingCloudCommandApprovalRegistry,
} from "../../src/background/orchestrator/cloud-command-approval";

class MemoryStorage implements PersistenceStorageArea {
  values: Record<string, unknown> = {};
  async get(keys?: string | string[] | Record<string, unknown> | null) {
    if (typeof keys === "string") return { [keys]: this.values[keys] };
    return { ...this.values };
  }
  async set(items: Record<string, unknown>) { Object.assign(this.values, items); }
  async remove(keys: string | string[]) {
    for (const key of typeof keys === "string" ? [keys] : keys) delete this.values[key];
  }
  onChanged(_listener: (changes: Record<string, PersistenceStorageChange>) => void) {
    return () => undefined;
  }
}

describe("local cloud command approval", () => {
  it("is digest-bound, short-lived, and consumed only once", async () => {
    const storage = new MemoryStorage();
    const store = new LocalCloudCommandApprovalStore(storage, "command-1");
    await store.grant("command-1", "digest-1", 2_000);
    expect(await store.consume("command-1", "other", 1_000)).toBe(false);

    await store.grant("command-1", "digest-1", 2_000);
    expect(await store.consume("command-1", "digest-1", 2_001)).toBe(false);

    await store.grant("command-1", "digest-1", 2_000);
    expect(await store.consume("command-1", "digest-1", 1_000)).toBe(true);
    expect(await store.consume("command-1", "digest-1", 1_000)).toBe(false);
  });

  it("makes pending decisions opaque, expiring, and one-shot", () => {
    const registry = new PendingCloudCommandApprovalRegistry<{
      expiresAt: number;
      commandId: string;
    }>();
    const approvalId = registry.request({ expiresAt: 2_000, commandId: "one" });
    expect(approvalId).not.toContain("one");
    expect(registry.decide(approvalId, true, 1_000)).toEqual({
      kind: "approved",
      value: { expiresAt: 2_000, commandId: "one" },
    });
    expect(registry.decide(approvalId, true, 1_000)).toEqual({ kind: "expired" });

    const expired = registry.request({ expiresAt: 2_000, commandId: "two" });
    expect(registry.decide(expired, false, 2_000)).toEqual({ kind: "expired" });
  });
});
