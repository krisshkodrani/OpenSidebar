import { webcrypto } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  PERSONAL_PROFILE_STORAGE_KEY,
  PROFILE_ANALYZER_VERSION,
  buildPersonalProfilePlannerContext,
  buildProfileDigestFromAnalyzerOutput,
  deletePersonalProfile,
  hashProfileNotes,
  loadPersonalizationState,
  savePersonalizationState,
  type PersonalProfileStorage,
  type PersonalizationState,
} from "../../src/utils/personal-profile";
import { PROFILE_CEK_STORAGE_KEY } from "../../src/utils/profile-crypto";

// Ensure WebCrypto SubtleCrypto exists in the test environment.
if (!globalThis.crypto?.subtle) {
  // @ts-expect-error assign Node's webcrypto for the test runtime
  globalThis.crypto = webcrypto;
}

const NOTES = "I am John Doe. My SSN is 123-45-6789.";
const SSN = "123-45-6789";

function createMemoryStorage(): PersonalProfileStorage & {
  dump: () => Record<string, unknown>;
} {
  const data: Record<string, unknown> = {};
  return {
    local: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: data[keys] };
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, data[key]]));
        }
        return { ...data };
      },
      async set(items) {
        Object.assign(data, items);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          delete data[key];
        }
      },
    },
    dump: () => ({ ...data }),
  };
}

function lockdownDigest() {
  return buildProfileDigestFromAnalyzerOutput({
    notesHash: hashProfileNotes(NOTES),
    output: {
      items: [
        { label: "Full name", value: "John Doe", kind: "fact", confidence: "high" },
        {
          label: "SSN",
          value: SSN,
          kind: "sensitive",
          confidence: "high",
          sourceQuote: `My SSN is ${SSN}.`,
        },
      ],
    },
  });
}

function readyState(): PersonalizationState {
  return {
    version: 2,
    enabled: true,
    notesMarkdown: NOTES,
    notesHash: hashProfileNotes(NOTES),
    digest: lockdownDigest(),
    updatedAt: Date.now(),
    analyzer: {
      provider: "test",
      model: "test",
      analyzerVersion: PROFILE_ANALYZER_VERSION,
      analyzedAt: Date.now(),
    },
  };
}

describe("M1 sensitive gate", () => {
  test("sensitive items are excluded from planner context without consent", () => {
    const context = buildPersonalProfilePlannerContext("what is my ssn", readyState());
    expect(context).not.toContain(SSN);
  });

  test("sensitive items surface only with explicit per-task consent", () => {
    const context = buildPersonalProfilePlannerContext("what is my ssn", readyState(), {
      allowSensitive: true,
    });
    expect(context).toContain(SSN);
    expect(context).toContain("user-authorized for THIS task only");
  });
});

describe("M1 encryption at rest", () => {
  test("sensitive fields are ciphertext on disk, plaintext in memory", async () => {
    const storage = createMemoryStorage();
    const returned = await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: NOTES,
        digest: lockdownDigest(),
        analyzer: readyState().analyzer,
      },
      storage,
    );

    // In-memory return value is plaintext for callers.
    const returnedSensitive = returned.digest!.items.find((i) => i.kind === "sensitive")!;
    expect(returnedSensitive.value).toBe(SSN);

    // Stored blob never contains the plaintext secret.
    const dump = storage.dump();
    expect(JSON.stringify(dump[PERSONAL_PROFILE_STORAGE_KEY])).not.toContain(SSN);

    const stored = dump[PERSONAL_PROFILE_STORAGE_KEY] as {
      notesMarkdown: string;
      digest: { items: Array<{ kind: string; value: string; sourceQuote?: string }> };
    };
    const storedSensitive = stored.digest.items.find((i) => i.kind === "sensitive")!;
    expect(storedSensitive.value.startsWith("enc:v1:")).toBe(true);
    expect(storedSensitive.sourceQuote?.startsWith("enc:v1:")).toBe(true);

    // The raw source notes (which contain the secret verbatim) are encrypted too.
    expect(stored.notesMarkdown.startsWith("enc:v1:")).toBe(true);

    // Non-sensitive items stay plaintext.
    const storedFact = stored.digest.items.find((i) => i.kind === "fact")!;
    expect(storedFact.value).toBe("John Doe");

    // Key is persisted under its own non-synced key.
    expect(typeof dump[PROFILE_CEK_STORAGE_KEY]).toBe("string");
  });

  test("round-trips through storage", async () => {
    const storage = createMemoryStorage();
    await savePersonalizationState(
      { enabled: true, notesMarkdown: NOTES, digest: lockdownDigest(), analyzer: readyState().analyzer },
      storage,
    );
    const loaded = await loadPersonalizationState(storage);
    const sensitive = loaded.digest!.items.find((i) => i.kind === "sensitive")!;
    expect(sensitive.value).toBe(SSN);
    expect(loaded.notesMarkdown).toBe(NOTES);
  });

  test("deletePersonalProfile removes both the profile and the key", async () => {
    const storage = createMemoryStorage();
    await savePersonalizationState(
      { enabled: true, notesMarkdown: NOTES, digest: lockdownDigest(), analyzer: readyState().analyzer },
      storage,
    );
    await deletePersonalProfile(storage);
    const dump = storage.dump();
    expect(dump[PERSONAL_PROFILE_STORAGE_KEY]).toBeUndefined();
    expect(dump[PROFILE_CEK_STORAGE_KEY]).toBeUndefined();
  });
});
