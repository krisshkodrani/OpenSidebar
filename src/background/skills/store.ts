import { ToolName } from "../../types";
import { logger } from "../../utils";
import { TaskNode } from "../orchestrator/types";
import { LearnedSkill, SkillStep, SKILLS_STORAGE_KEY } from "../../skills/types";
const MAX_SKILLS = 200;
const MAX_SKILL_STEPS = 24;
const AUTO_DISABLE_REPLAY_FAILURES = 3;

export interface SkillMatchResult {
  skill: LearnedSkill;
  score: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenize(text: string): string[] {
  const stop = new Set([
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
  return normalizeText(text)
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t))
    .slice(0, 24);
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
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

function parseSkillStep(raw: unknown): SkillStep | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.objective !== "string" || raw.objective.trim().length === 0) {
    return null;
  }
  if (
    typeof raw.successCriteria !== "string" ||
    raw.successCriteria.trim().length === 0
  ) {
    return null;
  }
  if (!Array.isArray(raw.allowedTools)) return null;
  const allowedTools = raw.allowedTools.filter(
    (tool): tool is ToolName =>
      typeof tool === "string" && Object.values(ToolName).includes(tool as ToolName),
  );
  if (allowedTools.length === 0) return null;
  const assumptions = Array.isArray(raw.assumptions)
    ? raw.assumptions.filter((a): a is string => typeof a === "string")
    : [];
  return {
    objective: raw.objective.trim(),
    successCriteria: raw.successCriteria.trim(),
    allowedTools: unique(allowedTools),
    assumptions: unique(assumptions.map((a) => a.trim()).filter(Boolean)).slice(0, 8),
  };
}

function parseSkill(raw: unknown): LearnedSkill | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  if (typeof raw.sourceQuery !== "string" || raw.sourceQuery.length === 0) return null;
  if (typeof raw.createdAt !== "number" || typeof raw.updatedAt !== "number") return null;
  if (!Array.isArray(raw.matchTokens)) return null;
  if (!Array.isArray(raw.steps)) return null;

  const steps = raw.steps.map(parseSkillStep).filter((s): s is SkillStep => s !== null);
  if (steps.length === 0) return null;
  const matchTokens = unique(
    raw.matchTokens.filter((t): t is string => typeof t === "string").map(normalizeText),
  );
  if (matchTokens.length === 0) return null;

  return {
    id: raw.id,
    name: raw.name,
    sourceQuery: raw.sourceQuery,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastUsedAt: typeof raw.lastUsedAt === "number" ? raw.lastUsedAt : undefined,
    uses: typeof raw.uses === "number" ? Math.max(0, raw.uses) : 0,
    successfulRuns:
      typeof raw.successfulRuns === "number" ? Math.max(0, raw.successfulRuns) : 0,
    failedRuns: typeof raw.failedRuns === "number" ? Math.max(0, raw.failedRuns) : 0,
    consecutiveReplayFailures:
      typeof raw.consecutiveReplayFailures === "number"
        ? Math.max(0, raw.consecutiveReplayFailures)
        : 0,
    avgDurationMs:
      typeof raw.avgDurationMs === "number" ? Math.max(0, raw.avgDurationMs) : 0,
    avgTokens: typeof raw.avgTokens === "number" ? Math.max(0, raw.avgTokens) : 0,
    matchTokens,
    steps: steps.slice(0, MAX_SKILL_STEPS),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    pinned: typeof raw.pinned === "boolean" ? raw.pinned : false,
  };
}

function toSkillSteps(nodes: TaskNode[]): SkillStep[] {
  const completed = nodes
    .filter((node) => node.status === "completed")
    .slice(0, MAX_SKILL_STEPS);
  return completed.map((node) => ({
    objective: node.description.trim(),
    successCriteria: node.successCriteria.trim(),
    allowedTools: unique(node.allowedTools),
    assumptions: unique(node.assumptions || []).slice(0, 8),
  }));
}

function rollingAverage(prev: number, prevCount: number, nextValue: number): number {
  if (prevCount <= 0) return Math.max(0, nextValue);
  return (prev * prevCount + Math.max(0, nextValue)) / (prevCount + 1);
}

export class SkillStore {
  private async readAll(): Promise<LearnedSkill[]> {
    try {
      const result = await chrome.storage.local.get(SKILLS_STORAGE_KEY);
      const raw = result[SKILLS_STORAGE_KEY];
      if (!Array.isArray(raw)) return [];
      return raw.map(parseSkill).filter((s): s is LearnedSkill => s !== null);
    } catch (error) {
      logger.warn("skills", "Failed reading skills from storage", { error });
      return [];
    }
  }

  private async writeAll(skills: LearnedSkill[]): Promise<void> {
    await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: skills.slice(0, MAX_SKILLS) });
  }

  async listSkills(): Promise<LearnedSkill[]> {
    const skills = await this.readAll();
    return skills.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async clearSkills(): Promise<void> {
    await this.writeAll([]);
  }

  async matchSkill(
    query: string,
    options?: { pinnedOnly?: boolean },
  ): Promise<SkillMatchResult | null> {
    const skills = await this.readAll();
    if (skills.length === 0) return null;
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return null;
    const pinnedOnly = options?.pinnedOnly === true;

    let best: SkillMatchResult | null = null;
    for (const skill of skills) {
      if (!skill.enabled) continue;
      if (pinnedOnly && !skill.pinned) continue;
      const score = overlapScore(qTokens, skill.matchTokens);
      if (score < 0.35) continue;
      if (!best || score > best.score) {
        best = { skill, score };
      }
    }
    return best;
  }

  async recordSkillSelection(skillId: string): Promise<void> {
    const skills = await this.readAll();
    const now = Date.now();
    const updated = skills.map((skill) =>
      skill.id === skillId
        ? { ...skill, uses: skill.uses + 1, lastUsedAt: now, updatedAt: now }
        : skill,
    );
    await this.writeAll(updated);
  }

  async recordSkillOutcome(
    skillId: string,
    success: boolean,
    durationMs: number,
    totalTokens: number,
  ): Promise<void> {
    const skills = await this.readAll();
    const updated = skills.map((skill) => {
      if (skill.id !== skillId) return skill;
      const outcomeCount = skill.successfulRuns + skill.failedRuns;
      const nextConsecutiveReplayFailures = success
        ? 0
        : skill.consecutiveReplayFailures + 1;
      return {
        ...skill,
        successfulRuns: skill.successfulRuns + (success ? 1 : 0),
        failedRuns: skill.failedRuns + (success ? 0 : 1),
        consecutiveReplayFailures: nextConsecutiveReplayFailures,
        enabled:
          !success && nextConsecutiveReplayFailures >= AUTO_DISABLE_REPLAY_FAILURES
            ? false
            : skill.enabled,
        avgDurationMs: rollingAverage(skill.avgDurationMs, outcomeCount, durationMs),
        avgTokens: rollingAverage(skill.avgTokens, outcomeCount, totalTokens),
        updatedAt: Date.now(),
      };
    });
    await this.writeAll(updated);
  }

  async updateSkillFlags(
    skillId: string,
    updates: { enabled?: boolean; pinned?: boolean },
  ): Promise<LearnedSkill | null> {
    const skills = await this.readAll();
    let updatedSkill: LearnedSkill | null = null;
    const updated = skills.map((skill) => {
      if (skill.id !== skillId) return skill;
      updatedSkill = {
        ...skill,
        enabled:
          typeof updates.enabled === "boolean" ? updates.enabled : skill.enabled,
        pinned: typeof updates.pinned === "boolean" ? updates.pinned : skill.pinned,
        updatedAt: Date.now(),
      };
      return updatedSkill;
    });
    await this.writeAll(updated);
    return updatedSkill;
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    const skills = await this.readAll();
    const next = skills.filter((skill) => skill.id !== skillId);
    if (next.length === skills.length) return false;
    await this.writeAll(next);
    return true;
  }

  async learnFromTask(params: {
    query: string;
    nodes: TaskNode[];
    totalDurationMs: number;
    totalTokens: number;
  }): Promise<LearnedSkill | null> {
    const steps = toSkillSteps(params.nodes);
    if (steps.length === 0) return null;

    const matchTokens = unique(tokenize(params.query));
    if (matchTokens.length === 0) return null;

    const now = Date.now();
    const name = params.query.trim().slice(0, 120) || "Learned skill";
    const skills = await this.readAll();
    const existing = skills.find(
      (skill) =>
        normalizeText(skill.sourceQuery) === normalizeText(params.query) &&
        overlapScore(skill.matchTokens, matchTokens) >= 0.8,
    );

    if (existing) {
      const outcomeCount = existing.successfulRuns + existing.failedRuns;
      const updatedSkill: LearnedSkill = {
        ...existing,
        name,
        sourceQuery: params.query.trim(),
        steps,
        matchTokens,
        updatedAt: now,
        successfulRuns: existing.successfulRuns + 1,
        avgDurationMs: rollingAverage(
          existing.avgDurationMs,
          outcomeCount,
          params.totalDurationMs,
        ),
        avgTokens: rollingAverage(existing.avgTokens, outcomeCount, params.totalTokens),
      };
      await this.writeAll(
        skills.map((skill) => (skill.id === existing.id ? updatedSkill : skill)),
      );
      return updatedSkill;
    }

    const created: LearnedSkill = {
      id: crypto.randomUUID(),
      name,
      sourceQuery: params.query.trim(),
      createdAt: now,
      updatedAt: now,
      uses: 0,
      successfulRuns: 1,
      failedRuns: 0,
      avgDurationMs: Math.max(0, params.totalDurationMs),
      avgTokens: Math.max(0, params.totalTokens),
      matchTokens,
      steps,
      enabled: true,
      pinned: false,
      consecutiveReplayFailures: 0,
    };
    await this.writeAll([created, ...skills]);
    return created;
  }
}
