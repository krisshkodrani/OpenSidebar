import { describe, expect, test } from "vitest";
import {
  PROFILE_ANALYZER_VERSION,
  PERSONAL_PROFILE_STORAGE_KEY,
  buildPersonalProfilePlannerContext,
  buildProfileDigestFromAnalyzerOutput,
  deletePersonalProfile,
  hasReadyProfileDigest,
  hashProfileNotes,
  isProfileDigestStale,
  loadPersonalizationState,
  resolveProfileFields,
  savePersonalizationState,
  type PersonalProfileStorage,
} from "../../src/utils/personal-profile";

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

function digestFor(notesMarkdown: string) {
  return buildProfileDigestFromAnalyzerOutput({
    notesHash: hashProfileNotes(notesMarkdown),
    output: {
      items: [
        {
          label: "Full name",
          value: "John Doe",
          kind: "fact",
          confidence: "high",
          sourceQuote: "My name is John Doe.",
        },
        {
          label: "Email",
          value: "john.doe@example.com",
          kind: "fact",
          confidence: "high",
          sourceQuote: "Email: john.doe@example.com",
        },
        {
          label: "Work mode",
          value: "Prefers remote-first roles",
          kind: "preference",
          confidence: "high",
        },
        {
          label: "Relocation boundary",
          value: "Do not relocate outside Europe",
          kind: "constraint",
          confidence: "high",
        },
        {
          label: "Interest themes",
          value: "Developer tools and AI evaluation",
          kind: "theme",
          confidence: "high",
        },
        {
          label: "Availability",
          value: "Availability is not specified",
          kind: "open_question",
          confidence: "high",
        },
        {
          label: "Birth date",
          value: "1990-01-01",
          kind: "sensitive",
          confidence: "high",
        },
      ],
    },
  });
}

describe("profile notes storage", () => {
  test("persists enabled markdown notes", async () => {
    const storage = createMemoryStorage();
    const notes = "# About me\nMy name is John Doe.";

    const saved = await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: notes,
      },
      storage,
    );
    const loaded = await loadPersonalizationState(storage);

    expect(storage.dump()).toHaveProperty(PERSONAL_PROFILE_STORAGE_KEY);
    expect(saved.enabled).toBe(true);
    expect(loaded.version).toBe(2);
    expect(loaded.notesMarkdown).toBe(notes);
    expect(loaded.notesHash).toBe(hashProfileNotes(notes));
  });

  test("migrates old structured profile values into markdown notes", async () => {
    const storage = createMemoryStorage();
    await storage.local.set({
      [PERSONAL_PROFILE_STORAGE_KEY]: {
        version: 1,
        enabled: true,
        updatedAt: 1,
        profile: {
          identity: { first_name: "John", last_name: "Doe" },
          contact: { email: "john.doe@example.com", location: "Berlin" },
          authorization: { work_authorized: "Authorized in Germany" },
        },
      },
    });

    const loaded = await loadPersonalizationState(storage);

    expect(loaded.version).toBe(2);
    expect(loaded.enabled).toBe(true);
    expect(loaded.notesMarkdown).toContain("# Imported from old profile");
    expect(loaded.notesMarkdown).toContain("Name: John Doe");
    expect(loaded.notesMarkdown).toContain("Email: john.doe@example.com");
    expect(loaded.notesMarkdown).toContain("Work authorization");
    expect(loaded.digest).toBeNull();
  });

  test("detects ready and stale digests by notes hash and analyzer version", async () => {
    const storage = createMemoryStorage();
    const notes = "# About me\nMy name is John Doe.";
    const state = await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: notes,
        digest: digestFor(notes),
        analyzer: {
          provider: "fireworks",
          model: "accounts/fireworks/routers/kimi-k2p6-turbo",
          analyzerVersion: PROFILE_ANALYZER_VERSION,
          analyzedAt: 1,
        },
      },
      storage,
    );

    expect(hasReadyProfileDigest(state)).toBe(true);
    expect(isProfileDigestStale(state)).toBe(false);

    const changed = await savePersonalizationState(
      { notesMarkdown: `${notes}\nRemote-first preferred.` },
      storage,
    );
    expect(hasReadyProfileDigest(changed)).toBe(false);
    expect(isProfileDigestStale(changed)).toBe(true);
  });

  test("resolves exact values from digest facts only when ready", async () => {
    const storage = createMemoryStorage();
    const notes = "# About me\nMy name is John Doe.\nEmail: john.doe@example.com";
    await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: notes,
        digest: digestFor(notes),
      },
      storage,
    );

    await expect(
      resolveProfileFields(["full_name", "email", "availability"], storage),
    ).resolves.toEqual({
      values: {
        full_name: "John Doe",
        email: "john.doe@example.com",
      },
      missing: ["availability"],
    });

    await savePersonalizationState({ enabled: false }, storage);
    await expect(resolveProfileFields(["email"], storage)).resolves.toEqual({
      values: {},
      missing: ["email"],
      disabled: true,
    });
  });

  test("planner context includes relevant digest policy without raw notes or sensitive values", async () => {
    const storage = createMemoryStorage();
    const notes =
      "# About me\nMy name is John Doe.\nI prefer remote-first roles.\nDo not relocate outside Europe.";
    const state = await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: notes,
        digest: digestFor(notes),
      },
      storage,
    );

    const context = buildPersonalProfilePlannerContext(
      "Complete this job application using my profile and remote preference",
      state,
    );

    expect(context).toContain("PROFILE DIGEST CONTEXT:");
    expect(context).toContain("Preference: Work mode");
    expect(context).toContain("Constraint: Relocation boundary");
    expect(context).toContain("Report unresolved fields");
    expect(context).not.toContain("1990-01-01");
    expect(context).not.toContain(notes);
  });

  test("delete removes profile notes and digest", async () => {
    const storage = createMemoryStorage();
    await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: "# About me\nJohn Doe",
      },
      storage,
    );

    const next = await deletePersonalProfile(storage);

    expect(next.enabled).toBe(false);
    expect(next.notesMarkdown).toBe("");
    expect(next.digest).toBeNull();
    expect(storage.dump()).not.toHaveProperty(PERSONAL_PROFILE_STORAGE_KEY);
  });
});
