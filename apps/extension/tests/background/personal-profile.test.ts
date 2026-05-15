import { describe, expect, test } from "vitest";
import {
  PROFILE_ANALYZER_VERSION,
  PROFILE_NOTES_MAX_CHARS,
  PERSONAL_PROFILE_STORAGE_KEY,
  buildPersonalProfilePlannerContext,
  buildProfileDigestFromAnalyzerOutput,
  buildProfileAnalyzerSystemPrompt,
  deleteProfileDigestItem,
  deletePersonalProfile,
  hasReadyProfileDigest,
  hashProfileNotes,
  isProfileDigestStale,
  loadPersonalizationState,
  resolveProfileFields,
  savePersonalizationState,
  updateProfileDigestItem,
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

  test("editing a digest item reconciles notes and keeps the digest ready", async () => {
    const storage = createMemoryStorage();
    const notes = "# About me\nI prefer remote-first roles.";
    const state = await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: notes,
        digest: digestFor(notes),
      },
      storage,
    );
    const item = state.digest?.items.find(
      (candidate) => candidate.label === "Work mode",
    );
    expect(item).toBeDefined();

    const updated = await updateProfileDigestItem(
      item!.id,
      {
        label: "Work mode",
        value: "Only remote roles",
        kind: "constraint",
      },
      storage,
    );

    const replacement = updated.digest?.items.find(
      (candidate) => candidate.value === "Only remote roles",
    );
    expect(updated.notesMarkdown).toContain("# Digest review corrections");
    expect(updated.notesMarkdown).toContain("Replace digest item");
    expect(updated.notesMarkdown).toContain("Only remote roles");
    expect(updated.notesHash).toBe(hashProfileNotes(updated.notesMarkdown));
    expect(updated.digest?.notesHash).toBe(updated.notesHash);
    expect(hasReadyProfileDigest(updated)).toBe(true);
    expect(replacement?.kind).toBe("constraint");
    expect(replacement?.confidence).toBe("high");
    expect(replacement?.sourceQuote).toBeUndefined();
  });

  test("deleting a digest item removes it from runtime resolution and records a correction", async () => {
    const storage = createMemoryStorage();
    const notes = "# Contact\nEmail: john.doe@example.com";
    const state = await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: notes,
        digest: digestFor(notes),
      },
      storage,
    );
    const emailItem = state.digest?.items.find(
      (candidate) => candidate.label === "Email",
    );
    expect(emailItem).toBeDefined();

    const updated = await deleteProfileDigestItem(emailItem!.id, storage);

    expect(updated.notesMarkdown).toContain("Do not include or use digest item");
    expect(updated.notesMarkdown).toContain("john.doe@example.com");
    expect(updated.digest?.items.some((item) => item.id === emailItem!.id)).toBe(
      false,
    );
    expect(updated.digest?.notesHash).toBe(updated.notesHash);
    await expect(resolveProfileFields(["email"], storage)).resolves.toEqual({
      values: {},
      missing: ["email"],
    });
  });

  test("digest item edits reject empty fields and over-limit notes", async () => {
    const storage = createMemoryStorage();
    const notes = "# About me\nMy name is John Doe.";
    const state = await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: notes,
        digest: digestFor(notes),
      },
      storage,
    );
    const nameItem = state.digest?.items.find(
      (candidate) => candidate.label === "Full name",
    );
    expect(nameItem).toBeDefined();

    await expect(
      updateProfileDigestItem(
        nameItem!.id,
        { label: " ", value: "Jane Doe", kind: "fact" },
        storage,
      ),
    ).rejects.toThrow("Digest item label and value are required");

    const longNotes = "x".repeat(PROFILE_NOTES_MAX_CHARS);
    const longState = await savePersonalizationState(
      {
        enabled: true,
        notesMarkdown: longNotes,
        digest: digestFor(longNotes),
      },
      storage,
    );
    const longNameItem = longState.digest?.items.find(
      (candidate) => candidate.label === "Full name",
    );
    expect(longNameItem).toBeDefined();
    await expect(
      deleteProfileDigestItem(longNameItem!.id, storage),
    ).rejects.toThrow("Profile Notes must be");
  });

  test("analyzer prompt prioritizes digest review corrections", () => {
    const prompt = buildProfileAnalyzerSystemPrompt();

    expect(prompt).toContain("opensidebar:digest-review:start");
    expect(prompt).toContain("user-reviewed corrections");
    expect(prompt).toContain("Do not include or use digest item");
    expect(prompt).toContain("Replace digest item");
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
