import type { SubtaskResult, TaskCompletionMessage } from "../../types/messages";

export interface WorkspaceTurnRecord {
  turnId: string;
  workspaceId: string;
  turnNumber: number;
  userQuery: string;
  outcome: "completed" | "partial" | "failed" | "stopped";
  assistantSummary: string;
  finalUrl?: string | null;
  completedAt: number;
  nodeResults: Array<{
    description: string;
    status: "completed" | "failed" | "skipped";
    result: string;
  }>;
}

export interface WorkspaceTurnMemory {
  workspaceId: string;
  turns: WorkspaceTurnRecord[];
  createdAt: number;
  updatedAt: number;
}

const TURN_MEMORY_PREFIX = "agent_turn_memory:";
const MAX_TURNS_PER_WORKSPACE = 10;
const MAX_PROMPT_TURNS = 4;

export function turnMemoryKey(workspaceId: string): string {
  return `${TURN_MEMORY_PREFIX}${workspaceId}`;
}

export async function loadWorkspaceTurnMemory(
  workspaceId: string,
): Promise<WorkspaceTurnMemory | null> {
  const key = turnMemoryKey(workspaceId);
  const result = await chrome.storage.local.get(key);
  const raw = result[key];
  if (!raw || typeof raw !== "object") return null;
  const memory = raw as WorkspaceTurnMemory;
  if (!Array.isArray(memory.turns)) return null;
  return memory;
}

export async function saveWorkspaceTurnRecord(
  record: WorkspaceTurnRecord,
): Promise<void> {
  const key = turnMemoryKey(record.workspaceId);
  const existing = await loadWorkspaceTurnMemory(record.workspaceId);
  const turns = [...(existing?.turns ?? []), record];
  const trimmedTurns =
    turns.length > MAX_TURNS_PER_WORKSPACE
      ? turns.slice(-MAX_TURNS_PER_WORKSPACE)
      : turns;
  const now = Date.now();
  const memory: WorkspaceTurnMemory = {
    workspaceId: record.workspaceId,
    turns: trimmedTurns,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await chrome.storage.local.set({ [key]: memory });
}

export async function clearWorkspaceTurnMemory(
  workspaceId: string,
): Promise<void> {
  await chrome.storage.local.remove(turnMemoryKey(workspaceId));
}

export async function clearAllWorkspaceTurnMemory(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(TURN_MEMORY_PREFIX));
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys);
  }
}

export function formatWorkspaceTurnMemoryForPrompt(
  memory: WorkspaceTurnMemory | null,
): string {
  if (!memory || memory.turns.length === 0) return "";
  const turns = memory.turns.slice(-MAX_PROMPT_TURNS);
  const sections = ["PRIOR WORKSPACE TURNS:"];
  for (const turn of turns) {
    sections.push(
      "",
      `Turn ${turn.turnNumber}`,
      `- User request: ${truncateLine(turn.userQuery, 240)}`,
      `- Outcome: ${turn.outcome}`,
      `- Result: ${truncateLine(turn.assistantSummary || summarizeSubtaskResults(turn.nodeResults), 280)}`,
    );
    if (turn.finalUrl) {
      sections.push(`- Final URL: ${truncateLine(turn.finalUrl, 200)}`);
    }
  }
  return sections.join("\n");
}

export function buildQueryWithTurnMemory(
  query: string,
  memoryBrief: string,
): string {
  if (!memoryBrief) return query;
  return `${memoryBrief}\n\nCURRENT REQUEST:\n${query}`;
}

export function buildWorkspaceTurnRecord(input: {
  workspaceId: string;
  taskId: string;
  userQuery: string;
  completion: TaskCompletionMessage["payload"];
  completedAt: number;
  turnNumber: number;
  finalUrl?: string | null;
}): WorkspaceTurnRecord {
  return {
    turnId: input.taskId,
    workspaceId: input.workspaceId,
    turnNumber: input.turnNumber,
    userQuery: input.userQuery,
    outcome: input.completion.status,
    assistantSummary: input.completion.summary,
    finalUrl: input.finalUrl ?? null,
    completedAt: input.completedAt,
    nodeResults: input.completion.subtaskResults.map(normalizeSubtaskResult),
  };
}

function normalizeSubtaskResult(result: SubtaskResult): WorkspaceTurnRecord["nodeResults"][number] {
  return {
    description: result.description,
    status: result.status,
    result: result.result,
  };
}

function summarizeSubtaskResults(
  results: WorkspaceTurnRecord["nodeResults"],
): string {
  if (results.length === 0) return "No recorded result.";
  return results
    .slice(0, 2)
    .map((item) => `${item.status}: ${truncateLine(item.description, 80)}`)
    .join("; ");
}

function truncateLine(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}
