import { describe, test, expect, beforeEach, mock } from "bun:test";
import "../setup";
import {
  loadSavedPrompts,
  addSavedPrompt,
  updateSavedPrompt,
  deleteSavedPrompt,
} from "../../src/sidepanel/saved-prompts";

const STORAGE_KEY = "opensidebar:savedPrompts";
const SEEDED_KEY = "opensidebar:savedPromptsSeeded";

describe("Saved Prompts CRUD", () => {
  let stored: Record<string, unknown>;

  beforeEach(() => {
    stored = {};
    globalThis.chrome = globalThis.chrome || ({} as any);
    globalThis.chrome.storage = {
      local: {
        get: mock(async (keyOrKeys: string | string[]) => {
          if (Array.isArray(keyOrKeys)) {
            const result: Record<string, unknown> = {};
            for (const k of keyOrKeys) result[k] = stored[k];
            return result;
          }
          return { [keyOrKeys]: stored[keyOrKeys] };
        }),
        set: mock(async (obj: Record<string, unknown>) => {
          Object.assign(stored, obj);
        }),
      },
      session: { get: mock(async () => ({})), set: mock(async () => {}) },
      sync: { get: mock(async () => ({})), set: mock(async () => {}) },
    } as any;
  });

  test("loadSavedPrompts seeds defaults on first load", async () => {
    const prompts = await loadSavedPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0].title).toBe("Browser Navigation Challenge");
    expect(prompts[0].category).toBe("Challenges");
    // Seeded flag should be set
    expect(stored[SEEDED_KEY]).toBe(true);
  });

  test("loadSavedPrompts does not re-seed after first load", async () => {
    // First load seeds
    await loadSavedPrompts();
    const seededCount = (stored[STORAGE_KEY] as any[]).length;

    // Clear prompts but keep seeded flag
    stored[STORAGE_KEY] = [];

    // Second load should return empty (not re-seed)
    const prompts = await loadSavedPrompts();
    expect(prompts).toEqual([]);
  });

  test("addSavedPrompt creates a prompt and persists it", async () => {
    // Mark as seeded so defaults don't interfere
    stored[SEEDED_KEY] = true;

    const prompt = await addSavedPrompt("Test Title", "Test content", "Research");

    expect(prompt.title).toBe("Test Title");
    expect(prompt.content).toBe("Test content");
    expect(prompt.category).toBe("Research");
    expect(prompt.id).toBeTruthy();
    expect(prompt.createdAt).toBeGreaterThan(0);
    expect(prompt.updatedAt).toBe(prompt.createdAt);

    // Verify persistence
    const persisted = stored[STORAGE_KEY] as any[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0].title).toBe("Test Title");
  });

  test("addSavedPrompt trims whitespace", async () => {
    stored[SEEDED_KEY] = true;
    const prompt = await addSavedPrompt("  Title  ", "  Content  ", "  Cat  ");
    expect(prompt.title).toBe("Title");
    expect(prompt.content).toBe("Content");
    expect(prompt.category).toBe("Cat");
  });

  test("addSavedPrompt appends to existing prompts", async () => {
    stored[SEEDED_KEY] = true;
    await addSavedPrompt("First", "Content 1", "");
    await addSavedPrompt("Second", "Content 2", "");

    const prompts = await loadSavedPrompts();
    expect(prompts).toHaveLength(2);
    expect(prompts[0].title).toBe("First");
    expect(prompts[1].title).toBe("Second");
  });

  test("updateSavedPrompt updates fields and updatedAt", async () => {
    stored[SEEDED_KEY] = true;
    const prompt = await addSavedPrompt("Original", "Original content", "Cat");
    const originalUpdatedAt = prompt.updatedAt;

    // Small delay to ensure updatedAt changes
    await new Promise((r) => setTimeout(r, 5));

    const updated = await updateSavedPrompt(prompt.id, {
      title: "Updated",
      content: "Updated content",
    });

    const found = updated.find((p) => p.id === prompt.id)!;
    expect(found.title).toBe("Updated");
    expect(found.content).toBe("Updated content");
    expect(found.category).toBe("Cat"); // unchanged
    expect(found.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
  });

  test("updateSavedPrompt returns unchanged list for unknown id", async () => {
    stored[SEEDED_KEY] = true;
    await addSavedPrompt("Test", "Content", "");
    const result = await updateSavedPrompt("nonexistent-id", { title: "New" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Test");
  });

  test("deleteSavedPrompt removes the prompt", async () => {
    stored[SEEDED_KEY] = true;
    const p1 = await addSavedPrompt("First", "C1", "");
    await addSavedPrompt("Second", "C2", "");

    const remaining = await deleteSavedPrompt(p1.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe("Second");
  });

  test("deleteSavedPrompt with unknown id returns unchanged list", async () => {
    stored[SEEDED_KEY] = true;
    await addSavedPrompt("Test", "Content", "");
    const result = await deleteSavedPrompt("nonexistent-id");
    expect(result).toHaveLength(1);
  });
});
