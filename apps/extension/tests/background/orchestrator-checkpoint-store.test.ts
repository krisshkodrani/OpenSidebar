import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  CHECKPOINT_TTL_MS,
  OrchestratorCheckpointStore,
  isCheckpointCompatible,
  isCheckpointFresh,
} from "../../src/background/orchestrator/checkpoint-store";
import { emptySessionMetrics } from "../../src/background/orchestrator/sanitizers";
import { turnCheckpointKey } from "../../src/background/agent/checkpoint-types";
import type { PersistenceStorageArea } from "../../src/background/environment/types";
import type {
  OrchestratorCheckpoint,
  OrchestratorTask,
  TaskNode,
} from "../../src/background/orchestrator/types";

function checkpoint(
  value: Partial<OrchestratorCheckpoint>,
): OrchestratorCheckpoint {
  return {
    version: 1,
    savedAt: Date.now(),
    task: { workspaceId: "workspace-a" },
    ...value,
  } as OrchestratorCheckpoint;
}

describe("orchestrator checkpoint store", () => {
  test("checks checkpoint version and freshness", () => {
    expect(isCheckpointCompatible(checkpoint({ version: 1 }))).toBe(true);
    expect(isCheckpointCompatible(checkpoint({ version: 0 as 1 }))).toBe(false);

    expect(isCheckpointFresh(checkpoint({ savedAt: Date.now() }))).toBe(true);
    expect(
      isCheckpointFresh(
        checkpoint({ savedAt: Date.now() - CHECKPOINT_TTL_MS - 1 }),
      ),
    ).toBe(false);
  });

  function task(workspaceId: string, id: string): OrchestratorTask {
    return {
      id,
      workspaceId,
      rootTabId: 1,
      query: "Read the page",
      status: "running",
      createdAt: Date.now(),
      nodes: [],
      plannerReflexionLog: [],
      maxWorkers: 1,
      maxReplans: 3,
      replansUsed: 0,
      horizonExpansions: 0,
      currentIndex: 0,
      sessionMetrics: emptySessionMetrics(),
      budget: {
        maxSessionTimeMs: 60_000,
        maxTotalTokens: 100_000,
        maxTotalCostUsd: 1,
      },
    };
  }

  function checkpointFor(
    workspaceId: string,
    id: string,
  ): OrchestratorCheckpoint {
    return { version: 1, savedAt: Date.now(), task: task(workspaceId, id) };
  }

  function delayedStorage(): PersistenceStorageArea {
    const values: Record<string, unknown> = {};
    return {
      async get(keys) {
        if (typeof keys !== "string")
          throw new Error("Expected one storage key");
        await new Promise((resolve) => setTimeout(resolve, 2));
        return { [keys]: structuredClone(values[keys]) };
      },
      async set(items) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        Object.assign(values, structuredClone(items));
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys])
          delete values[key];
      },
      onChanged: () => () => undefined,
    };
  }

  test("serializes overlapping workspace saves without losing either task", async () => {
    const store = new OrchestratorCheckpointStore(delayedStorage());
    await Promise.all([
      store.save(checkpointFor("workspace-a", "task-a")),
      store.save(checkpointFor("workspace-b", "task-b")),
    ]);
    const restored = await store.loadAndPrune();
    expect(Object.keys(restored).sort()).toEqual([
      "workspace-a",
      "workspace-b",
    ]);
    expect(restored["workspace-a"].task.id).toBe("task-a");
    expect(restored["workspace-b"].task.id).toBe("task-b");
  });

  test("orders save then clear and protects a successor from an old clear", async () => {
    const store = new OrchestratorCheckpointStore(delayedStorage());
    await Promise.all([
      store.save(checkpointFor("workspace-a", "task-old")),
      store.clear("workspace-a", "task-old"),
    ]);
    expect(await store.loadAndPrune()).toEqual({});

    await store.save(checkpointFor("workspace-a", "task-new"));
    await store.clear("workspace-a", "task-old");
    expect((await store.loadAndPrune())["workspace-a"].task.id).toBe(
      "task-new",
    );
  });

  test("waits for old turn-key cleanup before clearing completes", async () => {
    const base = delayedStorage();
    let signalRemoval!: () => void;
    let releaseRemoval!: () => void;
    const removalStarted = new Promise<void>((resolve) => { signalRemoval = resolve; });
    const removalGate = new Promise<void>((resolve) => { releaseRemoval = resolve; });
    const storage: PersistenceStorageArea = {
      ...base,
      async remove(keys) {
        signalRemoval();
        await removalGate;
        await base.remove(keys);
      },
    };
    const store = new OrchestratorCheckpointStore(storage);
    const old = checkpointFor("workspace-a", "task-old");
    old.task.nodes = [{
      id: "shared-node",
      role: "executor",
      description: "Read the page",
      successCriteria: "Page content read",
      allowedTools: [ToolName.READ_PAGE],
      dependencies: [],
      assumptions: [],
      handoffArtifacts: [],
      reflexionLog: [],
      handoffDepth: 0,
      status: "pending",
      retries: 0,
    } satisfies TaskNode];
    const key = turnCheckpointKey("workspace-a", "shared-node");
    await store.save(old);
    await storage.set({ [key]: "old" });

    let cleared = false;
    const clearing = store.clear("workspace-a", "task-old").then(() => {
      cleared = true;
    });
    await removalStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleared).toBe(false);
    releaseRemoval();
    await clearing;
    expect((await storage.get(key))[key]).toBeUndefined();

    await store.save(checkpointFor("workspace-a", "task-new"));
    await storage.set({ [key]: "new" });
    expect((await storage.get(key))[key]).toBe("new");
  });

  test("keeps compatible v1 checkpoints while pruning stale entries", async () => {
    const storage = delayedStorage();
    const store = new OrchestratorCheckpointStore(storage);
    await store.save(checkpointFor("workspace-a", "task-current"));
    await store.save({
      ...checkpointFor("workspace-b", "task-stale"),
      savedAt: Date.now() - CHECKPOINT_TTL_MS - 1,
    });
    const restored = await store.loadAndPrune();
    expect(Object.keys(restored)).toEqual(["workspace-a"]);
    expect(restored["workspace-a"].version).toBe(1);
  });

  test("returns valid recovery entries when a prune write fails", async () => {
    const base = delayedStorage();
    let failWrites = false;
    const storage: PersistenceStorageArea = {
      ...base,
      set(items) {
        if (failWrites) return Promise.reject(new Error("storage unavailable"));
        return base.set(items);
      },
    };
    const store = new OrchestratorCheckpointStore(storage);
    await store.save(checkpointFor("workspace-a", "task-current"));
    await store.save({
      ...checkpointFor("workspace-b", "task-stale"),
      savedAt: Date.now() - CHECKPOINT_TTL_MS - 1,
    });
    failWrites = true;

    const restored = await store.loadAndPrune();
    expect(Object.keys(restored)).toEqual(["workspace-a"]);
  });
});
