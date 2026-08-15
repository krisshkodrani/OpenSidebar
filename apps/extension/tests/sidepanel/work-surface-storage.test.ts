import { describe, expect, test, vi } from "vitest";
import type { UiRuntimeStorageArea } from "../../src/sidepanel/runtime";
import { archiveWorkItem, migrateLegacyWorkSurfaceState, readWorkHistory, WORK_SURFACE_HISTORY_LIMIT, WORK_SURFACE_MIGRATION_KEY, workSurfaceHistoryKey } from "../../src/sidepanel/work-surface-storage";
import type { WorkItemRecordV1 } from "@shared-types/work-surface";

function memoryStorage(initial: Record<string, unknown> = {}): UiRuntimeStorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (keys) => {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys as string];
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
    }),
    set: vi.fn(async (items) => { Object.assign(data, items); }),
    remove: vi.fn(async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }),
  };
}

const item = (index: number): WorkItemRecordV1 => ({
  schemaVersion: 1, workItemId: `item-${index}`, workspaceId: "ws", kind: "task", origin: "local", phase: "terminal", attention: "none", objective: `Task ${index}`, createdAt: new Date(index).toISOString(), updatedAt: new Date(index).toISOString(), revision: 1, allowedCommands: [], events: [], outcome: "completed", terminalAt: new Date(index).toISOString(),
});

describe("work surface persistence", () => {
  test("one-time migration removes only obsolete UI state", async () => {
    const storage = memoryStorage({ "chatMessages:ws": [], "agentState:ws": {}, "opensidebar:composerDraft:v1:a:ws:task": {}, "opensidebar:remoteMissionStatus:v1": {}, "opensidebar:workspaces": [{ id: "ws" }], "opensidebar:userSettings": { theme: "dark" } });
    await expect(migrateLegacyWorkSurfaceState(storage)).resolves.toBe(true);
    expect(storage.data[WORK_SURFACE_MIGRATION_KEY]).toBe(true);
    expect(storage.data["opensidebar:workspaces"]).toBeDefined();
    expect(storage.data["opensidebar:userSettings"]).toBeDefined();
    expect(Object.keys(storage.data)).not.toContain("chatMessages:ws");
    await expect(migrateLegacyWorkSurfaceState(storage)).resolves.toBe(false);
  });

  test("history is deduplicated and capped per workspace", async () => {
    const key = workSurfaceHistoryKey("ws");
    const storage = memoryStorage({ [key]: Array.from({ length: 50 }, (_, index) => item(index)) });
    await archiveWorkItem(storage, "ws", { ...item(10), updatedAt: new Date(100).toISOString() });
    const history = await readWorkHistory(storage, "ws");
    expect(history).toHaveLength(WORK_SURFACE_HISTORY_LIMIT);
    expect(history[0].workItemId).toBe("item-10");
    expect(history.filter((entry) => entry.workItemId === "item-10")).toHaveLength(1);
  });
});
