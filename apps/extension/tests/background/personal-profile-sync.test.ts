import { webcrypto } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  PROFILE_ANALYZER_VERSION,
  buildProfileDigestFromAnalyzerOutput,
  hashProfileNotes,
  loadPersonalizationState,
  savePersonalizationState,
  syncPersonalProfileDigest,
  type PersonalProfileStorage,
} from "../../src/utils/personal-profile";
import { encryptStateForStorage } from "../../src/utils/profile-crypto";
import type { KnowledgeStore, SyncMap } from "../../src/utils/knowledge-sync";

if (!globalThis.crypto?.subtle) {
  // @ts-expect-error assign Node's webcrypto for the test runtime
  globalThis.crypto = webcrypto;
}

const NOTES = "I am Kai. SSN 111-11-1111.";

function memStorage(): PersonalProfileStorage & { dump: () => Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    local: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: data[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, data[k]]));
        return { ...data };
      },
      async set(items) {
        Object.assign(data, items);
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
      },
    },
    dump: () => ({ ...data }),
  };
}

function memStore(seed: SyncMap = {}): KnowledgeStore & { data: SyncMap } {
  const data: SyncMap = { ...seed };
  return {
    data,
    async getAll() {
      return { ...data };
    },
    async putItems(_ns, items) {
      Object.assign(data, items);
    },
  };
}

function digestWith(ssn: string) {
  return buildProfileDigestFromAnalyzerOutput({
    notesHash: hashProfileNotes(NOTES),
    output: {
      items: [
        { label: "Full name", value: "Kai", kind: "fact", confidence: "high" },
        { label: "SSN", value: ssn, kind: "sensitive", confidence: "high" },
      ],
    },
  });
}

const analyzer = {
  provider: "test",
  model: "test",
  analyzerVersion: PROFILE_ANALYZER_VERSION,
  analyzedAt: Date.now(),
};

async function seedLocal(storage: PersonalProfileStorage, ssn: string) {
  return savePersonalizationState(
    { enabled: true, notesMarkdown: NOTES, digest: digestWith(ssn), analyzer },
    storage,
  );
}

describe("syncPersonalProfileDigest", () => {
  test("default-off: no store returns state unchanged", async () => {
    const storage = memStorage();
    await seedLocal(storage, "111-11-1111");
    const result = await syncPersonalProfileDigest(storage, null);
    const sensitive = result.digest!.items.find((i) => i.kind === "sensitive")!;
    expect(sensitive.value).toBe("111-11-1111");
  });

  test("pushes the digest with sensitive values as ciphertext", async () => {
    const storage = memStorage();
    await seedLocal(storage, "111-11-1111");
    const store = memStore({});
    await syncPersonalProfileDigest(storage, store);
    expect(store.data.digest).toBeDefined();
    // The secret never leaves the device in plaintext.
    expect(JSON.stringify(store.data.digest)).not.toContain("111-11-1111");
  });

  test("pulls a newer remote digest and decrypts it locally (memory follows the user)", async () => {
    const storage = memStorage();
    await seedLocal(storage, "111-11-1111");
    // Build an encrypted remote digest (same device key) with a newer clock.
    const encrypted = (await encryptStateForStorage(
      { digest: digestWith("999-99-9999") },
      storage,
    )) as { digest: unknown };
    const store = memStore({
      digest: { value: encrypted.digest, updatedAt: Date.now() + 60_000 },
    });

    await syncPersonalProfileDigest(storage, store);

    const loaded = await loadPersonalizationState(storage);
    const sensitive = loaded.digest!.items.find((i) => i.kind === "sensitive")!;
    expect(sensitive.value).toBe("999-99-9999");
  });
});
