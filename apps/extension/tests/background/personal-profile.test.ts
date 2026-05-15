import { describe, expect, test } from "vitest";
import {
  buildPersonalProfilePlannerContext,
  deletePersonalProfile,
  EMPTY_PERSONAL_PROFILE,
  loadPersonalizationState,
  PERSONAL_PROFILE_STORAGE_KEY,
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

describe("personal profile storage", () => {
  test("persists one enabled local profile", async () => {
    const storage = createMemoryStorage();

    const saved = await savePersonalizationState(
      {
        enabled: true,
        profile: {
          ...EMPTY_PERSONAL_PROFILE,
          identity: {
            ...EMPTY_PERSONAL_PROFILE.identity,
            first_name: "John",
            last_name: "Doe",
          },
          contact: {
            ...EMPTY_PERSONAL_PROFILE.contact,
            email: "john.doe@example.com",
          },
        },
      },
      storage,
    );
    const loaded = await loadPersonalizationState(storage);

    expect(storage.dump()).toHaveProperty(PERSONAL_PROFILE_STORAGE_KEY);
    expect(saved.enabled).toBe(true);
    expect(loaded.profile.identity.first_name).toBe("John");
    expect(loaded.profile.contact.email).toBe("john.doe@example.com");
  });

  test("resolves exact fields and aliases only when enabled", async () => {
    const storage = createMemoryStorage();
    await savePersonalizationState(
      {
        enabled: true,
        profile: {
          ...EMPTY_PERSONAL_PROFILE,
          identity: {
            ...EMPTY_PERSONAL_PROFILE.identity,
            first_name: "John",
            last_name: "Doe",
          },
          contact: {
            ...EMPTY_PERSONAL_PROFILE.contact,
            email: "john.doe@example.com",
            location: "New York, NY",
          },
        },
      },
      storage,
    );

    await expect(
      resolveProfileFields(["full_name", "email", "missing.path"], storage),
    ).resolves.toEqual({
      values: {
        full_name: "John Doe",
        email: "john.doe@example.com",
      },
      missing: ["missing.path"],
    });

    await savePersonalizationState(
      {
        enabled: false,
        profile: (await loadPersonalizationState(storage)).profile,
      },
      storage,
    );
    await expect(resolveProfileFields(["email"], storage)).resolves.toEqual({
      values: {},
      missing: ["email"],
      disabled: true,
    });
  });

  test("planner context is a non-sensitive availability hint", async () => {
    const storage = createMemoryStorage();
    const state = await savePersonalizationState(
      {
        enabled: true,
        profile: {
          ...EMPTY_PERSONAL_PROFILE,
          identity: {
            ...EMPTY_PERSONAL_PROFILE.identity,
            first_name: "John",
          },
        },
      },
      storage,
    );

    const context = buildPersonalProfilePlannerContext(
      "Help me complete this application form",
      state,
    );

    expect(context).toContain("local saved profile is enabled");
    expect(context).toContain("get_profile_fields");
    expect(context).not.toContain("John");
    expect(buildPersonalProfilePlannerContext("Summarize this page", state)).toBe(
      "",
    );
  });

  test("delete removes the local profile", async () => {
    const storage = createMemoryStorage();
    await savePersonalizationState(
      {
        enabled: true,
        profile: {
          ...EMPTY_PERSONAL_PROFILE,
          contact: {
            ...EMPTY_PERSONAL_PROFILE.contact,
            email: "john.doe@example.com",
          },
        },
      },
      storage,
    );

    const next = await deletePersonalProfile(storage);

    expect(next.enabled).toBe(false);
    expect(storage.dump()).not.toHaveProperty(PERSONAL_PROFILE_STORAGE_KEY);
  });
});
