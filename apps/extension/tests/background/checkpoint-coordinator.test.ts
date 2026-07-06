import { describe, expect, test } from "vitest";
import "../setup";
import { CheckpointCoordinator } from "../../src/background/agent/checkpoint-coordinator";
import type {
  PersistencePort,
  PersistenceStorageArea,
} from "../../src/background/environment/types";
import { turnCheckpointKey } from "../../src/background/agent/checkpoint-types";
import type { TurnCheckpoint } from "../../src/background/agent/checkpoint-types";

/** Map-backed fake PersistencePort — the seed of the Phase 5 fake-port kit. */
function createFakePersistence(): {
  port: PersistencePort;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  const area: PersistenceStorageArea = {
    async get(keys) {
      if (typeof keys === "string") {
        return store.has(keys) ? { [keys]: store.get(keys) } : {};
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of store) out[k] = v;
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
  return { port: { local: area, sync: area, session: area }, store };
}

function sampleCheckpoint(overrides: Partial<TurnCheckpoint> = {}): TurnCheckpoint {
  return {
    version: 1,
    workspaceId: "ws-1",
    nodeId: "node-1",
    savedAt: 0,
    turnCount: 3,
    maxTurns: 20,
    currentPlanIndex: 0,
    turnsOnCurrentStep: 0,
    escalationsOnCurrentStep: 0,
    guardAfterDoneRejection: false,
    history: { originalCount: 0 } as TurnCheckpoint["history"],
    planStatus: null,
    snapshotFingerprint: "fp",
    pageUrl: null,
    stepMutationLedger: [],
    sideEffectsLog: [],
    ...overrides,
  } as TurnCheckpoint;
}

describe("CheckpointCoordinator", () => {
  test("persists a checkpoint under the derived key", async () => {
    const { port, store } = createFakePersistence();
    const coordinator = new CheckpointCoordinator(port);
    const cp = sampleCheckpoint();

    await coordinator.persist("ws-1", "node-1", cp);

    expect(store.get(turnCheckpointKey("ws-1", "node-1"))).toEqual(cp);
  });

  test("load round-trips a persisted checkpoint and returns null when absent", async () => {
    const { port } = createFakePersistence();
    const coordinator = new CheckpointCoordinator(port);

    expect(await coordinator.load("ws-1", "node-1")).toBeNull();

    const cp = sampleCheckpoint({ turnCount: 7 });
    await coordinator.persist("ws-1", "node-1", cp);
    expect(await coordinator.load("ws-1", "node-1")).toEqual(cp);
  });

  test("clear removes only the target node's checkpoint", async () => {
    const { port, store } = createFakePersistence();
    const coordinator = new CheckpointCoordinator(port);
    await coordinator.persist("ws-1", "node-1", sampleCheckpoint());
    await coordinator.persist("ws-1", "node-2", sampleCheckpoint({ nodeId: "node-2" }));

    await coordinator.clear("ws-1", "node-1");

    expect(store.has(turnCheckpointKey("ws-1", "node-1"))).toBe(false);
    expect(store.has(turnCheckpointKey("ws-1", "node-2"))).toBe(true);
  });

  test("owns the mutation ledger: record then replay-lookup hits", () => {
    const { port } = createFakePersistence();
    const coordinator = new CheckpointCoordinator(port);
    const snapshot = null;

    // click_element is a mutation-sensitive tool.
    coordinator.recordMutation({
      toolName: "click_element",
      args: { id: 5 },
      result: "clicked",
      currentSnapshot: snapshot,
      planIndex: 0,
      turn: 1,
    });

    const hit = coordinator.lookupReplay("click_element", { id: 5 }, snapshot, true);
    expect(hit?.result).toBe("clicked");
    expect(coordinator.entries.length).toBe(1);
    expect(coordinator.sideEffects.length).toBe(1);
  });

  test("clearReplayState wipes ledger + ephemeral replay state", () => {
    const { port } = createFakePersistence();
    const coordinator = new CheckpointCoordinator(port);
    coordinator.recordMutation({
      toolName: "click_element",
      args: { id: 9 },
      result: "clicked",
      currentSnapshot: null,
      planIndex: 0,
      turn: 1,
    });
    expect(coordinator.entries.length).toBe(1);

    coordinator.clearReplayState();

    expect(coordinator.entries.length).toBe(0);
    expect(
      coordinator.lookupReplay("click_element", { id: 9 }, null, true),
    ).toBeNull();
  });
});
