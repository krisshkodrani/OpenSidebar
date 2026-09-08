import { describe, expect, it } from "vitest";
import type { PersonalDataKeyStore } from "../../src/background/personal-data-sync/key-store";
import {
  createAndStorePersonalDataKey,
  decryptPersonalData,
  encryptPersonalData,
  ensureDeviceIdentity,
  loadPersonalDataKey,
  unwrapPersonalDataKeyFromDevice,
  wrapPersonalDataKeyForDevice,
} from "../../src/background/personal-data-sync/crypto";

class MemoryKeyStore implements PersonalDataKeyStore {
  values = new Map<string, unknown>();
  async get<T>(id: string) { return (this.values.get(id) as T | undefined) ?? null; }
  async set<T>(id: string, value: T) { this.values.set(id, value); }
  async remove(id: string) { this.values.delete(id); }
}

describe("personal-data E2EE", () => {
  it("round-trips category content and authenticates account metadata", async () => {
    const store = new MemoryKeyStore();
    const key = await createAndStorePersonalDataKey(store, "account-a");
    const envelope = await encryptPersonalData({ accountId: "account-a", category: "saved_prompts",
      revision: 1, keyEpoch: 1, value: [{ id: "p1", content: "private sentinel" }], key });

    expect(JSON.stringify(envelope)).not.toContain("private sentinel");
    await expect(decryptPersonalData({ accountId: "account-a", envelope, key })).resolves.toEqual([
      { id: "p1", content: "private sentinel" },
    ]);
    await expect(decryptPersonalData({ accountId: "account-b", envelope, key })).rejects.toThrow();
    await expect(decryptPersonalData({ accountId: "account-a", envelope: { ...envelope, keyEpoch: 2 }, key })).rejects.toThrow();
    expect(await loadPersonalDataKey(store, "account-a")).toBeTruthy();
  });

  it("transfers the personal-data key only through the recipient device key", async () => {
    const sender = new MemoryKeyStore();
    const recipient = new MemoryKeyStore();
    const wrong = new MemoryKeyStore();
    const key = await createAndStorePersonalDataKey(sender, "account-a");
    const recipientIdentity = await ensureDeviceIdentity(recipient, "account-a");
    await ensureDeviceIdentity(wrong, "account-a");
    const wrapped = await wrapPersonalDataKeyForDevice({ key,
      recipientPublicKeyJwk: recipientIdentity.publicKeyJwk, senderDeviceId: "sender",
      recipientDeviceId: "recipient", keyEpoch: 3 });

    const received = await unwrapPersonalDataKeyFromDevice(recipient, "account-a", wrapped);
    const envelope = await encryptPersonalData({ accountId: "account-a", category: "website_skills",
      revision: 2, keyEpoch: 3, value: [{ id: "s1" }], key });
    await expect(decryptPersonalData({ accountId: "account-a", envelope, key: received })).resolves.toEqual([{ id: "s1" }]);
    await expect(unwrapPersonalDataKeyFromDevice(wrong, "account-a", wrapped)).rejects.toThrow();
  });
});
