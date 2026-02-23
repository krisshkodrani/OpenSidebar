/**
 * DemoStore — CRUD, matching, and persistence for user-recorded demonstrations.
 *
 * Mirrors the SkillStore pattern: chrome.storage.local, tokenized matching,
 * action cleanup pipeline before save.
 */

import { DemoAction, DemoMatchResult, Demonstration } from "../../types";
import { logger } from "../../utils";

const DEMOS_STORAGE_KEY = "opensidebar:demos:v1";
const MAX_DEMOS = 100;
const MAX_ACTIONS_PER_DEMO = 200;
const MATCH_THRESHOLD = 0.4;

// --- Text tokenization (shared pattern with SkillStore) ---

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "with",
  "from",
  "by",
  "at",
  "is",
  "are",
  "be",
  "do",
  "does",
  "please",
]);

function tokenize(text: string): string[] {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
    .slice(0, 24);
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersect = 0;
  for (const token of setA) {
    if (setB.has(token)) intersect += 1;
  }
  const denom = Math.max(setA.size, setB.size);
  return denom > 0 ? intersect / denom : 0;
}

// --- URL similarity ---

function urlSimilarity(pattern: string, currentUrl: string): number {
  try {
    const a = new URL(
      pattern.startsWith("http") ? pattern : `https://${pattern}`,
    );
    const b = new URL(currentUrl);

    if (a.hostname !== b.hostname) return 0;

    // Same domain
    const aParts = a.pathname.split("/").filter(Boolean);
    const bParts = b.pathname.split("/").filter(Boolean);

    if (aParts.length === 0 && bParts.length === 0) return 1.0;

    // Count matching path segments
    let matched = 0;
    const minLen = Math.min(aParts.length, bParts.length);
    for (let i = 0; i < minLen; i++) {
      if (aParts[i] === bParts[i]) matched++;
      else break;
    }

    if (matched === aParts.length && matched === bParts.length) return 1.0;
    if (matched > 0)
      return 0.5 + 0.5 * (matched / Math.max(aParts.length, bParts.length));
    return 0.5; // Same domain, no path match
  } catch {
    return 0;
  }
}

// --- Action cleanup pipeline ---

export function cleanupActions(raw: DemoAction[]): DemoAction[] {
  let actions = [...raw];

  // 1. Merge consecutive scrolls within 500ms
  const merged: DemoAction[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === "scroll" && merged.length > 0) {
      const prev = merged[merged.length - 1];
      if (prev.type === "scroll" && a.timestamp - prev.timestamp < 500) {
        prev.scrollDelta = (prev.scrollDelta ?? 0) + (a.scrollDelta ?? 0);
        continue;
      }
    }
    merged.push({ ...a });
  }
  actions = merged;

  // 2. Deduplicate rapid clicks on same element within 300ms
  const deduped: DemoAction[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === "click" && deduped.length > 0) {
      const prev = deduped[deduped.length - 1];
      if (
        prev.type === "click" &&
        a.timestamp - prev.timestamp < 300 &&
        prev.element?.selector === a.element?.selector
      ) {
        continue; // Skip duplicate click
      }
    }
    deduped.push(a);
  }
  actions = deduped;

  // 3. Remove no-op actions
  actions = actions.filter((a) => {
    if (a.type === "scroll" && (a.scrollDelta === 0 || a.scrollDelta == null))
      return false;
    if (a.type === "type" && !a.value) return false;
    return true;
  });

  // 4. Cap action count
  if (actions.length > MAX_ACTIONS_PER_DEMO) {
    actions = actions.slice(0, MAX_ACTIONS_PER_DEMO);
  }

  return actions;
}

// --- DemoStore ---

export class DemoStore {
  private cache: Demonstration[] | null = null;

  private async load(): Promise<Demonstration[]> {
    if (this.cache) return this.cache;
    try {
      const data = await chrome.storage.local.get(DEMOS_STORAGE_KEY);
      const raw = data[DEMOS_STORAGE_KEY];
      if (Array.isArray(raw)) {
        this.cache = raw as Demonstration[];
        return this.cache;
      }
    } catch (e) {
      logger.warn("demos", "Failed to load demos", { error: e });
    }
    this.cache = [];
    return this.cache;
  }

  private async save(demos: Demonstration[]): Promise<void> {
    this.cache = demos;
    try {
      await chrome.storage.local.set({ [DEMOS_STORAGE_KEY]: demos });
    } catch (e) {
      logger.error("demos", "Failed to save demos", { error: e });
    }
  }

  async listDemos(): Promise<Demonstration[]> {
    const demos = await this.load();
    return [...demos].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveDemonstration(params: {
    name: string;
    description?: string;
    goal?: string;
    preconditions?: string[];
    outcomeSignal?: string;
    actions: DemoAction[];
    url: string;
  }): Promise<Demonstration> {
    const demos = await this.load();

    // Extract URL pattern (origin + first path segment)
    let urlPattern: string;
    try {
      const u = new URL(params.url);
      const firstSegment = u.pathname.split("/").filter(Boolean)[0];
      urlPattern = firstSegment ? `${u.origin}/${firstSegment}` : u.origin;
    } catch {
      urlPattern = params.url;
    }

    const cleanActions = cleanupActions(params.actions);
    // Tokenize name + description + goal for matching
    const matchSource = [params.name, params.description, params.goal]
      .filter(Boolean)
      .join(" ");
    const filteredPreconditions = params.preconditions?.filter((p) => p.trim());

    const demo: Demonstration = {
      id: crypto.randomUUID(),
      name: params.name,
      description: params.description,
      goal: params.goal?.trim() || undefined,
      preconditions:
        filteredPreconditions && filteredPreconditions.length > 0
          ? filteredPreconditions
          : undefined,
      outcomeSignal: params.outcomeSignal?.trim() || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      actions: cleanActions,
      urlPattern,
      matchTokens: tokenize(matchSource),
      uses: 0,
      enabled: true,
    };

    demos.push(demo);

    // Enforce max demos
    if (demos.length > MAX_DEMOS) {
      // Remove oldest, least-used demos
      demos.sort((a, b) => {
        const scoreA = a.uses + (a.enabled ? 1 : 0);
        const scoreB = b.uses + (b.enabled ? 1 : 0);
        return scoreA - scoreB;
      });
      demos.splice(0, demos.length - MAX_DEMOS);
    }

    await this.save(demos);
    logger.info("demos", "Saved demonstration", {
      id: demo.id,
      name: demo.name,
      actionCount: cleanActions.length,
      urlPattern,
    });

    return demo;
  }

  async deleteDemonstration(id: string): Promise<boolean> {
    const demos = await this.load();
    const idx = demos.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    demos.splice(idx, 1);
    await this.save(demos);
    return true;
  }

  async updateDemo(
    id: string,
    updates: Partial<
      Pick<
        Demonstration,
        | "name"
        | "description"
        | "goal"
        | "preconditions"
        | "outcomeSignal"
        | "enabled"
      >
    >,
  ): Promise<Demonstration | null> {
    const demos = await this.load();
    const demo = demos.find((d) => d.id === id);
    if (!demo) return null;

    if (updates.name !== undefined) demo.name = updates.name;
    if (updates.description !== undefined)
      demo.description = updates.description;
    if (updates.goal !== undefined) demo.goal = updates.goal;
    if (updates.preconditions !== undefined)
      demo.preconditions = updates.preconditions;
    if (updates.outcomeSignal !== undefined)
      demo.outcomeSignal = updates.outcomeSignal;
    if (updates.enabled !== undefined) demo.enabled = updates.enabled;
    demo.updatedAt = Date.now();

    // Recompute matchTokens if name/description/goal changed
    if (
      updates.name !== undefined ||
      updates.description !== undefined ||
      updates.goal !== undefined
    ) {
      const matchSource = [demo.name, demo.description, demo.goal]
        .filter(Boolean)
        .join(" ");
      demo.matchTokens = tokenize(matchSource);
    }

    await this.save(demos);
    return demo;
  }

  async matchDemo(
    query: string,
    currentUrl: string,
  ): Promise<DemoMatchResult | null> {
    const demos = await this.load();
    const queryTokens = tokenize(query);

    let best: DemoMatchResult | null = null;

    for (const demo of demos) {
      if (!demo.enabled) continue;

      const urlScore = urlSimilarity(demo.urlPattern, currentUrl);
      if (urlScore === 0) continue; // Wrong domain — skip entirely

      const tokenScore = overlapScore(queryTokens, demo.matchTokens);

      // Goal-aware scoring when goal is present
      let combined: number;
      if (demo.goal) {
        const goalTokens = tokenize(demo.goal);
        const goalScore = overlapScore(queryTokens, goalTokens);
        combined = 0.45 * urlScore + 0.3 * tokenScore + 0.25 * goalScore;
      } else {
        combined = 0.6 * urlScore + 0.4 * tokenScore;
      }

      if (combined >= MATCH_THRESHOLD && (!best || combined > best.score)) {
        best = { demo, score: combined };
      }
    }

    return best;
  }

  async recordDemoUsage(id: string): Promise<void> {
    const demos = await this.load();
    const demo = demos.find((d) => d.id === id);
    if (!demo) return;
    demo.uses++;
    demo.updatedAt = Date.now();
    await this.save(demos);
  }

  async clearAll(): Promise<void> {
    this.cache = [];
    await this.save([]);
  }

  /**
   * Compact one-liner-per-demo catalog for the system prompt's cached prefix.
   * Format: `- "Name" — Goal (domain.com, N steps)`
   * Returns empty string when no enabled demos exist.
   */
  async getCatalogSummary(): Promise<string> {
    const demos = await this.load();
    const enabled = demos.filter((d) => d.enabled);
    if (enabled.length === 0) return "";

    const lines = enabled.map((d) => {
      const goal = d.goal ? ` — ${d.goal}` : "";
      let domain = "";
      try {
        domain = new URL(
          d.urlPattern.startsWith("http")
            ? d.urlPattern
            : `https://${d.urlPattern}`,
        ).hostname;
      } catch {
        domain = d.urlPattern;
      }
      return `- "${d.name}"${goal} (${domain}, ${d.actions.length} steps)`;
    });

    return lines.join("\n");
  }

  /**
   * Find a demo by name (exact or substring) or fall back to token-overlap search.
   * Used by the `recall_demo` tool for agent-initiated retrieval.
   */
  async findByQuery(query: string): Promise<Demonstration | null> {
    const demos = await this.load();
    const enabled = demos.filter((d) => d.enabled);
    if (enabled.length === 0) return null;

    const q = query.toLowerCase().trim();

    // 1. Exact name match (case-insensitive)
    const exact = enabled.find((d) => d.name.toLowerCase() === q);
    if (exact) return exact;

    // 2. Substring name match
    const substring = enabled.find((d) => d.name.toLowerCase().includes(q));
    if (substring) return substring;

    // 3. Token overlap scoring (same as matchDemo but without URL filter)
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return null;

    let best: { demo: Demonstration; score: number } | null = null;
    for (const demo of enabled) {
      const tokenScore = overlapScore(queryTokens, demo.matchTokens);
      const goalScore = demo.goal
        ? overlapScore(queryTokens, tokenize(demo.goal))
        : 0;
      const score = demo.goal
        ? 0.6 * tokenScore + 0.4 * goalScore
        : tokenScore;

      if (score > 0.2 && (!best || score > best.score)) {
        best = { demo, score };
      }
    }

    return best?.demo ?? null;
  }
}

// --- Demo formatting for injection into system prompt ---

export function formatDemoForContext(demo: Demonstration): string {
  const lines: string[] = [];
  lines.push(`## Reference Demonstration: "${demo.name}"`);

  if (demo.goal) {
    lines.push(`Goal: ${demo.goal}`);
  }
  if (demo.preconditions && demo.preconditions.length > 0) {
    lines.push("Preconditions:");
    for (const p of demo.preconditions) {
      lines.push(`- ${p}`);
    }
  }
  if (demo.outcomeSignal) {
    lines.push(`Outcome: ${demo.outcomeSignal}`);
  }

  lines.push("");
  lines.push(
    "Adapt these steps to the current page — element IDs and positions may differ.",
  );
  if (demo.preconditions && demo.preconditions.length > 0) {
    lines.push("If preconditions are NOT met, skip this demonstration.");
  }
  if (demo.outcomeSignal) {
    lines.push("Verify the outcome after completing the steps.");
  }
  lines.push("");

  let tokenEstimate = 80; // Header overhead
  const MAX_TOKENS = 500;

  for (let i = 0; i < demo.actions.length; i++) {
    const a = demo.actions[i];
    let step: string;

    switch (a.type) {
      case "click":
        step = `${i + 1}. Click "${a.element?.text || "element"}"${a.element?.attributes?.type ? ` (${a.element.tagName} type=${a.element.attributes.type})` : ` (${a.element?.tagName || "element"})`}`;
        break;
      case "type":
        step = `${i + 1}. Type "${a.value?.slice(0, 40) || ""}" in ${a.element?.attributes?.placeholder || a.element?.attributes?.["aria-label"] || a.element?.text || a.element?.tagName || "input"}`;
        break;
      case "scroll":
        step = `${i + 1}. Scroll ${(a.scrollDelta ?? 0) > 0 ? "down" : "up"} ${Math.abs(a.scrollDelta ?? 0)}px`;
        break;
      case "select":
        step = `${i + 1}. Select "${a.value}" from ${a.element?.text || a.element?.tagName || "dropdown"}`;
        break;
      case "press_key":
        step = `${i + 1}. Press ${a.value ? `${a.value}+` : ""}${a.key}`;
        break;
      case "navigate":
        step = `${i + 1}. Navigate to ${a.url}`;
        break;
      case "drag":
        step = `${i + 1}. Drag "${a.sourceElement?.text || "element"}" (${a.sourceElement?.tagName || "element"}) onto "${a.element?.text || "element"}" (${a.element?.tagName || "element"})`;
        break;
      case "annotate":
        step = `${i + 1}. [Note] ${a.value || ""}`;
        break;
      default:
        continue;
    }

    const stepTokens = Math.ceil(step.length / 4);
    if (tokenEstimate + stepTokens > MAX_TOKENS) {
      lines.push(`... (${demo.actions.length - i} more steps)`);
      break;
    }

    lines.push(step);
    tokenEstimate += stepTokens;
  }

  return lines.join("\n");
}
