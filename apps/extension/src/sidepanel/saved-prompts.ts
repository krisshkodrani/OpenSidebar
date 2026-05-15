import { SavedPrompt } from "../types";
import { getPromptTemplate } from "../prompts";
import { uiRuntime } from "./runtime";

const STORAGE_KEY = "opensidebar:savedPrompts";
const SEEDED_KEY = "opensidebar:savedPromptsSeeded";
const VERSION_KEY = "opensidebar:savedPromptsVersion";
const CURRENT_PROMPTS_VERSION = 3;

const DEFAULT_PROMPTS: Omit<SavedPrompt, "id" | "createdAt" | "updatedAt">[] = [
  {
    title: "Summarize this page",
    content: getPromptTemplate("ui.saved_prompt.summarize_page"),
    category: "Research",
  },
  {
    title: "Extract all links",
    content: getPromptTemplate("ui.saved_prompt.extract_links"),
    category: "Research",
  },
  {
    title: "Fill out this form",
    content: getPromptTemplate("ui.saved_prompt.fill_form"),
    category: "Forms",
  },
];

export async function loadSavedPrompts(): Promise<SavedPrompt[]> {
  const result = await uiRuntime.storage.local.get([
    STORAGE_KEY,
    SEEDED_KEY,
    VERSION_KEY,
  ]);
  const prompts = (result[STORAGE_KEY] as SavedPrompt[]) || [];

  // Seed defaults on first ever load
  if (!result[SEEDED_KEY] && prompts.length === 0) {
    const now = Date.now();
    const seeded = DEFAULT_PROMPTS.map((d) => ({
      ...d,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }));
    await uiRuntime.storage.local.set({
      [STORAGE_KEY]: seeded,
      [SEEDED_KEY]: true,
      [VERSION_KEY]: CURRENT_PROMPTS_VERSION,
    });
    return seeded;
  }

  const currentVersion =
    typeof result[VERSION_KEY] === "number"
      ? (result[VERSION_KEY] as number)
      : 1;

  if (result[SEEDED_KEY] && currentVersion < CURRENT_PROMPTS_VERSION) {
    let next = [...prompts];

    // v2 -> v3: Remove challenge prompts (no longer part of product)
    if (currentVersion < 3) {
      next = next.filter((p) => p.title !== "Browser Navigation Challenge");
    }

    await uiRuntime.storage.local.set({
      [STORAGE_KEY]: next,
      [VERSION_KEY]: CURRENT_PROMPTS_VERSION,
    });
    return next;
  }

  return prompts;
}

function persist(prompts: SavedPrompt[]): Promise<void> {
  return uiRuntime.storage.local.set({ [STORAGE_KEY]: prompts });
}

export async function addSavedPrompt(
  title: string,
  content: string,
  category: string,
): Promise<SavedPrompt> {
  const prompts = [...(await loadSavedPrompts())];
  const now = Date.now();
  const prompt: SavedPrompt = {
    id: crypto.randomUUID(),
    title: title.trim(),
    content: content.trim(),
    category: category.trim(),
    createdAt: now,
    updatedAt: now,
  };
  prompts.push(prompt);
  await persist(prompts);
  return prompt;
}

export async function updateSavedPrompt(
  id: string,
  updates: Partial<Pick<SavedPrompt, "title" | "content" | "category">>,
): Promise<SavedPrompt[]> {
  const prompts = (await loadSavedPrompts()).map((prompt) => ({ ...prompt }));
  const idx = prompts.findIndex((p) => p.id === id);
  if (idx === -1) return prompts;
  const p = prompts[idx];
  if (updates.title !== undefined) p.title = updates.title.trim();
  if (updates.content !== undefined) p.content = updates.content.trim();
  if (updates.category !== undefined) p.category = updates.category.trim();
  p.updatedAt = Date.now();
  await persist(prompts);
  return prompts;
}

export async function deleteSavedPrompt(id: string): Promise<SavedPrompt[]> {
  const prompts = await loadSavedPrompts();
  const filtered = prompts.filter((p) => p.id !== id);
  await persist(filtered);
  return filtered;
}
