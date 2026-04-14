import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import {
  buildQueryWithTurnMemory,
  buildWorkspaceTurnRecord,
  clearAllWorkspaceTurnMemory,
  clearWorkspaceTurnMemory,
  formatWorkspaceTurnMemoryForPrompt,
  loadWorkspaceTurnMemory,
  saveWorkspaceTurnRecord,
  turnMemoryKey,
  WorkspaceTurnMemory,
} from "../../src/background/agent/memory";
import type { TaskCompletionMessage } from "../../src/types";

describe("workspace turn memory", () => {
  const localStore: Record<string, unknown> = {};

  beforeEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
    (chrome.storage.local.get as any) = vi.fn(async (key?: string | null) => {
      if (key == null) return { ...localStore };
      return key in localStore ? { [key]: localStore[key] } : {};
    });
    (chrome.storage.local.set as any) = vi.fn(async (payload: Record<string, unknown>) => {
      Object.assign(localStore, payload);
    });
    (chrome.storage.local.remove as any) = vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete localStore[key];
      }
    });
  });

  test("save appends a turn record and load returns it", async () => {
    await saveWorkspaceTurnRecord({
      turnId: "t1",
      workspaceId: "ws-1",
      turnNumber: 1,
      userQuery: "Draft a reply",
      outcome: "completed",
      assistantSummary: "Drafted a reply in the editor.",
      completedAt: 1,
      finalUrl: "https://example.com/compose",
      nodeResults: [],
    });

    const memory = await loadWorkspaceTurnMemory("ws-1");
    expect(memory?.turns).toHaveLength(1);
    expect(memory?.turns[0].userQuery).toBe("Draft a reply");
  });

  test("load returns null for unknown workspace", async () => {
    await expect(loadWorkspaceTurnMemory("missing")).resolves.toBeNull();
  });

  test("old turns are trimmed at the cap", async () => {
    for (let i = 1; i <= 12; i++) {
      await saveWorkspaceTurnRecord({
        turnId: `t${i}`,
        workspaceId: "ws-cap",
        turnNumber: i,
        userQuery: `query ${i}`,
        outcome: "completed",
        assistantSummary: `summary ${i}`,
        completedAt: i,
        nodeResults: [],
      });
    }

    const memory = await loadWorkspaceTurnMemory("ws-cap");
    expect(memory?.turns).toHaveLength(10);
    expect(memory?.turns[0].turnNumber).toBe(3);
    expect(memory?.turns.at(-1)?.turnNumber).toBe(12);
  });

  test("clear removes only the targeted workspace memory", async () => {
    localStore[turnMemoryKey("ws-a")] = { workspaceId: "ws-a", turns: [] };
    localStore[turnMemoryKey("ws-b")] = { workspaceId: "ws-b", turns: [] };

    await clearWorkspaceTurnMemory("ws-a");

    expect(localStore[turnMemoryKey("ws-a")]).toBeUndefined();
    expect(localStore[turnMemoryKey("ws-b")]).toBeDefined();
  });

  test("global clear removes all turn-memory keys", async () => {
    localStore[turnMemoryKey("ws-a")] = { workspaceId: "ws-a", turns: [] };
    localStore[turnMemoryKey("ws-b")] = { workspaceId: "ws-b", turns: [] };
    localStore["chatMessages:ws-a"] = [];

    await clearAllWorkspaceTurnMemory();

    expect(localStore[turnMemoryKey("ws-a")]).toBeUndefined();
    expect(localStore[turnMemoryKey("ws-b")]).toBeUndefined();
    expect(localStore["chatMessages:ws-a"]).toEqual([]);
  });

  test("formatting is compact and labels prior turn outcomes", () => {
    const memory: WorkspaceTurnMemory = {
      workspaceId: "ws-1",
      createdAt: 1,
      updatedAt: 2,
      turns: [
        {
          turnId: "t1",
          workspaceId: "ws-1",
          turnNumber: 1,
          userQuery: "Accept Thursday 2 PM",
          outcome: "completed",
          assistantSummary: "Drafted a reply accepting Thursday 2 PM.",
          completedAt: 1,
          finalUrl: "https://example.com/compose",
          nodeResults: [],
        },
        {
          turnId: "t2",
          workspaceId: "ws-1",
          turnNumber: 2,
          userQuery: "Change the reply to Monday 11 AM",
          outcome: "partial",
          assistantSummary: "Updated the draft but did not verify it.",
          completedAt: 2,
          nodeResults: [],
        },
      ],
    };

    const brief = formatWorkspaceTurnMemoryForPrompt(memory);
    expect(brief).toContain("PRIOR WORKSPACE TURNS:");
    expect(brief).toContain("Turn 1");
    expect(brief).toContain("- Outcome: completed");
    expect(brief).toContain("- Outcome: partial");
    expect(buildQueryWithTurnMemory("One more change", brief)).toContain("CURRENT REQUEST:");
  });

  test("empty memory produces no prompt block", () => {
    expect(formatWorkspaceTurnMemoryForPrompt(null)).toBe("");
    expect(buildQueryWithTurnMemory("hello", "")).toBe("hello");
  });

  test("buildWorkspaceTurnRecord maps completion payload into a persisted turn", () => {
    const completion: TaskCompletionMessage["payload"] = {
      taskId: "task-1",
      status: "completed",
      totalTurnsUsed: 0,
      totalTimeMs: 10,
      summary: "Completed the draft update.",
      subtaskResults: [
        {
          description: "Rewrite draft",
          status: "completed",
          turnsUsed: 0,
          result: "Draft now suggests Monday at 11 AM.",
        },
      ],
      urlHistory: [],
    };

    const record = buildWorkspaceTurnRecord({
      workspaceId: "ws-1",
      taskId: "task-1",
      userQuery: "Change the reply",
      completion,
      completedAt: 123,
      turnNumber: 2,
      finalUrl: "https://example.com/compose",
    });

    expect(record.turnNumber).toBe(2);
    expect(record.outcome).toBe("completed");
    expect(record.nodeResults[0].description).toBe("Rewrite draft");
    expect(record.finalUrl).toBe("https://example.com/compose");
  });
});
