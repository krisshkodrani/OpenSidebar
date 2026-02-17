import { ToolName } from "../types";

export const SKILLS_STORAGE_KEY = "opensidebar:skills:v1";

export interface SkillStep {
  objective: string;
  successCriteria: string;
  allowedTools: ToolName[];
  assumptions: string[];
}

export interface LearnedSkill {
  id: string;
  name: string;
  sourceQuery: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  uses: number;
  successfulRuns: number;
  failedRuns: number;
  consecutiveReplayFailures: number;
  avgDurationMs: number;
  avgTokens: number;
  matchTokens: string[];
  steps: SkillStep[];
  enabled: boolean;
  pinned: boolean;
}
