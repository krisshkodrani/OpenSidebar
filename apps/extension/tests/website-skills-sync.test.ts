import { describe, expect, test } from "vitest";
import {
  WEBSITE_SKILLS_STORAGE_KEY,
  syncUserWebsiteSkills,
  type WebsiteSkillsStorageArea,
} from "../src/utils/website-skills";
import type { KnowledgeStore, SyncMap } from "../src/utils/knowledge-sync";
import type { UserWebsiteSkill } from "../src/types";

function skill(id: string, updatedAt: number, name = "Skill"): UserWebsiteSkill {
  return {
    id,
    name,
    origin: "https://x.test",
    pathPattern: "/",
    workflowSteps: [],
    requiredEvidence: [],
    enabled: true,
    updatedAt,
    createdAt: updatedAt,
  } as UserWebsiteSkill;
}

function memStorage(seedSkills: UserWebsiteSkill[] = []): WebsiteSkillsStorageArea & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = {
    [WEBSITE_SKILLS_STORAGE_KEY]: seedSkills,
  };
  return {
    data,
    async get(keys) {
      if (typeof keys === "string") return { [keys]: data[keys] };
      return { ...data };
    },
    async set(items) {
      Object.assign(data, items);
    },
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

describe("syncUserWebsiteSkills", () => {
  test("default-off: no store returns local skills unchanged", async () => {
    const storage = memStorage([skill("a", 100)]);
    const result = await syncUserWebsiteSkills(storage, null);
    expect(result.map((s) => s.id)).toEqual(["a"]);
  });

  test("pushes local-authoritative skills to the store", async () => {
    const storage = memStorage([skill("a", 100)]);
    const store = memStore({});
    await syncUserWebsiteSkills(storage, store);
    expect(store.data.a).toBeDefined();
    expect((store.data.a.value as UserWebsiteSkill).id).toBe("a");
  });

  test("pulls remote-authoritative skills into local storage", async () => {
    const storage = memStorage([skill("a", 100, "Local")]);
    const store = memStore({
      a: { value: skill("a", 200, "Remote"), updatedAt: 200 },
    });
    const result = await syncUserWebsiteSkills(storage, store);
    expect(result.find((s) => s.id === "a")?.name).toBe("Remote");
    const persisted = (storage.data[WEBSITE_SKILLS_STORAGE_KEY] as UserWebsiteSkill[]) ?? [];
    expect(persisted.find((s) => s.id === "a")?.name).toBe("Remote");
  });
});
