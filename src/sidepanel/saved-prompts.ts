import { SavedPrompt } from "../types";

const STORAGE_KEY = "opensidebar:savedPrompts";
const SEEDED_KEY = "opensidebar:savedPromptsSeeded";
const VERSION_KEY = "opensidebar:savedPromptsVersion";
const CURRENT_PROMPTS_VERSION = 2;

const CHALLENGE_TITLE = "Browser Navigation Challenge";
const CHALLENGE_CATEGORY = "Challenges";

const LEGACY_CHALLENGE_PROMPT =
  "You are on Step 1 of the 30-step Browser Navigation Challenge. For each step:\n" +
  "1. Track which step you're on and what needs to happen\n" +
  "2. Dismiss any modals/popups blocking the page (click Close/Dismiss/Accept buttons)\n" +
  '3. Find and reveal the hidden code (look for "Reveal Code" buttons, delayed reveals, hidden DOM elements)\n' +
  "4. Enter the code in the input field and click Submit Code\n" +
  "5. Verify the URL changed to the next step before continuing\n" +
  "If stuck for 5+ actions, take_screenshot and try execute_js to inspect hidden elements. Complete all 30 steps to win.";

const CHALLENGE_SPEED_PROMPT =
  "Speed run objective: Complete all 30 challenge tasks in under 20 minutes with maximum reliability.\n\n" +
  "Execution policy:\n" +
  "1) First, discover and list all 30 task IDs/URLs in a checklist.\n" +
  "2) Solve tasks in a deterministic order (1->30) unless a task is blocked; if blocked, skip and return later.\n" +
  "3) For each task:\n" +
  "   - read state quickly\n" +
  "   - execute minimal required actions\n" +
  "   - verify success immediately\n" +
  "   - mark checklist item complete\n" +
  "4) Retry policy:\n" +
  "   - max 2 retries per tactic\n" +
  "   - then switch tactic (alternate element, keyboard path, navigation reset)\n" +
  "   - if still blocked, defer task and continue\n" +
  "5) Efficiency rules:\n" +
  "   - minimize tool calls and page reloads\n" +
  "   - avoid repetitive actions\n" +
  "   - reuse successful interaction patterns across similar tasks\n" +
  "6) Progress report every 3 tasks:\n" +
  "   - completed/30\n" +
  "   - current task\n" +
  "   - elapsed time\n" +
  "   - estimated tokens/cost\n" +
  "7) Completion criteria:\n" +
  "   - only finish when all 30 tasks are verified complete.\n" +
  "8) Final output:\n" +
  "   - completion table for all 30 tasks\n" +
  "   - total time\n" +
  "   - total tokens and cost\n" +
  "   - failed/slow tasks and root causes.\n" +
  "Start now with task discovery and show the 30-item checklist first.";

const DEFAULT_PROMPTS: Omit<SavedPrompt, "id" | "createdAt" | "updatedAt">[] = [
  {
    title: CHALLENGE_TITLE,
    content: CHALLENGE_SPEED_PROMPT,
    category: CHALLENGE_CATEGORY,
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
  const result = await chrome.storage.local.get([
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
    await chrome.storage.local.set({
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
    const now = Date.now();
    const next = [...prompts];
    let changed = false;

    const challengeIdx = next.findIndex((p) => p.title === CHALLENGE_TITLE);
    if (challengeIdx >= 0) {
      const existing = next[challengeIdx];
      if (existing.content === LEGACY_CHALLENGE_PROMPT) {
        next[challengeIdx] = {
          ...existing,
          content: CHALLENGE_SPEED_PROMPT,
          category: CHALLENGE_CATEGORY,
          updatedAt: now,
        };
        changed = true;
      }
    } else {
      next.unshift({
        id: crypto.randomUUID(),
        title: CHALLENGE_TITLE,
        content: CHALLENGE_SPEED_PROMPT,
        category: CHALLENGE_CATEGORY,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }

    if (changed) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: next,
        [VERSION_KEY]: CURRENT_PROMPTS_VERSION,
      });
      return next;
    }

    await chrome.storage.local.set({ [VERSION_KEY]: CURRENT_PROMPTS_VERSION });
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
