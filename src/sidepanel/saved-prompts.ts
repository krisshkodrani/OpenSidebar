import { SavedPrompt } from "../types";

const STORAGE_KEY = "opensidebar:savedPrompts";
const SEEDED_KEY = "opensidebar:savedPromptsSeeded";

const DEFAULT_PROMPTS: Omit<SavedPrompt, "id" | "createdAt" | "updatedAt">[] = [
  {
    title: "Browser Navigation Challenge",
    content:
      "You are on Step 1 of the 30-step Browser Navigation Challenge. For each step:\n" +
      "1. Use update_plan to track which step you're on and what needs to happen\n" +
      "2. Dismiss any modals/popups blocking the page (click Close/Dismiss/Accept buttons)\n" +
      "3. Find and reveal the hidden code (look for \"Reveal Code\" buttons, delayed reveals, hidden DOM elements)\n" +
      "4. Enter the code in the input field and click Submit Code\n" +
      "5. Verify the URL changed to the next step before continuing\n" +
      "If stuck for 5+ actions, take_screenshot and try execute_js to inspect hidden elements. Complete all 30 steps to win.",
    category: "Challenges",
  },
  {
    title: "Summarize this page",
    content:
      "Read the current page and provide a concise summary of the main content. Return the summary via done().",
    category: "Research",
  },
  {
    title: "Extract all links",
    content:
      "Read the current page and collect every link with its text and URL. Return a formatted list via done().",
    category: "Research",
  },
  {
    title: "Fill out this form",
    content:
      "Fill out the form on this page using reasonable placeholder values. For each field, pick a realistic value based on the label. Do not submit until all fields are filled.",
    category: "Forms",
  },
];

export async function loadSavedPrompts(): Promise<SavedPrompt[]> {
  const result = await chrome.storage.local.get([STORAGE_KEY, SEEDED_KEY]);
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
    await chrome.storage.local.set({
      [STORAGE_KEY]: seeded,
      [SEEDED_KEY]: true,
    });
    return seeded;
  }

  return prompts;
}

function persist(prompts: SavedPrompt[]): Promise<void> {
  return chrome.storage.local.set({ [STORAGE_KEY]: prompts });
}

export async function addSavedPrompt(
  title: string,
  content: string,
  category: string,
): Promise<SavedPrompt> {
  const prompts = await loadSavedPrompts();
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
  const prompts = await loadSavedPrompts();
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
