import { describe, expect, it } from "vitest";
import { DeviceAttemptJournal } from "../../src/background/orchestrator/device-attempt-journal";
import type { BrowserCommandV1 } from "@shared-types/cloud-sessions";
import type {
  PersistenceStorageArea,
  PersistenceStorageChange,
} from "../../src/background/environment/types";

class MemoryArea implements PersistenceStorageArea {
  values: Record<string, unknown> = {};
  async get(keys?: string | string[] | Record<string, unknown> | null) {
    if (typeof keys === "string") return { [keys]: this.values[keys] };
    return { ...this.values };
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.values, items);
  }
  async remove(keys: string | string[]) {
    for (const key of typeof keys === "string" ? [keys] : keys)
      delete this.values[key];
  }
  onChanged(
    _listener: (changes: Record<string, PersistenceStorageChange>) => void,
  ) {
    return () => undefined;
  }
}

const command = (): BrowserCommandV1 => ({
  schemaVersion: 1,
  sessionId: crypto.randomUUID(),
  commandId: crypto.randomUUID(),
  leaseId: crypto.randomUUID(),
  leaseGeneration: 1,
  checkpointRevision: 2,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  action: { kind: "click", arguments: {} },
  preconditions: [],
  risk: "reversible_write",
});

describe("device attempt journal", () => {
  it("never authorizes a second dispatch after started", async () => {
    const value = command();
    const area = new MemoryArea();
    const journal = new DeviceAttemptJournal(area, value.sessionId);
    expect(await journal.reconcile(value, "a".repeat(64))).toBe("accept_new");
    await journal.accepted(value, crypto.randomUUID(), "a".repeat(64));
    expect(await journal.reconcile(value, "a".repeat(64))).toBe(
      "resume_before_start",
    );
    await journal.started(value.commandId);
    expect(await journal.reconcile(value, "a".repeat(64))).toBe("observe_only");
    await journal.terminal(value.commandId, "unknown");
    expect(await journal.reconcile(value, "a".repeat(64))).toBe(
      "replay_terminal",
    );
  });

  it("rejects digest, generation, and checkpoint mismatches", async () => {
    const value = command();
    const journal = new DeviceAttemptJournal(new MemoryArea(), value.sessionId);
    await journal.accepted(value, crypto.randomUUID(), "a".repeat(64));
    expect(await journal.reconcile(value, "b".repeat(64))).toBe("conflict");
    expect(
      await journal.reconcile({ ...value, leaseGeneration: 2 }, "a".repeat(64)),
    ).toBe("conflict");
    expect(
      await journal.reconcile(
        { ...value, checkpointRevision: 3 },
        "a".repeat(64),
      ),
    ).toBe("conflict");
  });
});
