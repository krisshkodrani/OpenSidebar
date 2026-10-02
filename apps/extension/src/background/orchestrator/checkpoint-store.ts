import { chromePersistencePort } from "../environment/chrome";
import type { PersistenceStorageArea } from "../environment/types";
import { logger } from "../../utils";
import type { OrchestratorCheckpoint } from "./types";
import { CHECKPOINT_VERSION, isRecord, sanitizeCheckpoint } from "./sanitizers";
import { turnCheckpointKey } from "../agent/checkpoint-types";

export const CHECKPOINTS_STORAGE_KEY = "opensidebar:orchestrator:checkpoints";
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

export function isCheckpointFresh(checkpoint: OrchestratorCheckpoint): boolean {
  return Date.now() - checkpoint.savedAt <= CHECKPOINT_TTL_MS;
}

export function isCheckpointCompatible(
  checkpoint: OrchestratorCheckpoint,
): boolean {
  return checkpoint.version === CHECKPOINT_VERSION;
}

/** Owns every read-modify-write of the legacy v1 checkpoint map. */
export class OrchestratorCheckpointStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: PersistenceStorageArea = chromePersistencePort.local,
  ) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<Record<string, OrchestratorCheckpoint>> {
    const stored = await this.storage.get(CHECKPOINTS_STORAGE_KEY);
    const raw = stored[CHECKPOINTS_STORAGE_KEY];
    if (!isRecord(raw)) return {};

    const parsed: Record<string, OrchestratorCheckpoint> = {};
    for (const [workspaceId, value] of Object.entries(raw)) {
      if (!workspaceId) continue;
      const checkpoint = sanitizeCheckpoint(value);
      if (!checkpoint) {
        logger.warn("orchestrator", "Dropping malformed checkpoint", {
          workspaceId,
        });
        continue;
      }
      if (checkpoint.task.workspaceId !== workspaceId) {
        logger.warn(
          "orchestrator",
          "Dropping checkpoint with mismatched workspace",
          {
            keyWorkspaceId: workspaceId,
            taskWorkspaceId: checkpoint.task.workspaceId,
          },
        );
        continue;
      }
      parsed[workspaceId] = checkpoint;
    }
    return parsed;
  }

  private write(
    checkpoints: Record<string, OrchestratorCheckpoint>,
  ): Promise<void> {
    return this.storage.set({ [CHECKPOINTS_STORAGE_KEY]: checkpoints });
  }

  async save(checkpoint: OrchestratorCheckpoint): Promise<void> {
    try {
      await this.enqueue(async () => {
        const checkpoints = await this.read();
        checkpoints[checkpoint.task.workspaceId] = checkpoint;
        await this.write(checkpoints);
      });
    } catch (error) {
      logger.warn("orchestrator", "Failed to save checkpoint", { error });
    }
  }

  async clear(workspaceId: string, expectedTaskId: string): Promise<void> {
    try {
      await this.enqueue(async () => {
        const checkpoints = await this.read();
        const checkpoint = checkpoints[workspaceId];
        if (!checkpoint || checkpoint.task.id !== expectedTaskId) return;
        delete checkpoints[workspaceId];
        await this.write(checkpoints);
        const turnKeys = checkpoint.task.nodes.map((node) =>
          turnCheckpointKey(workspaceId, node.id),
        );
        if (turnKeys.length > 0) {
          try {
            await this.storage.remove(turnKeys);
          } catch (error) {
            logger.warn("orchestrator", "Failed to remove turn checkpoints", {
              workspaceId,
              error,
            });
          }
        }
      });
    } catch (error) {
      logger.warn("orchestrator", "Failed to clear checkpoint", {
        workspaceId,
        error,
      });
    }
  }

  async loadAndPrune(): Promise<Record<string, OrchestratorCheckpoint>> {
    try {
      return await this.enqueue(async () => {
        const checkpoints = await this.read();
        const kept: Record<string, OrchestratorCheckpoint> = {};
        let changed = false;
        for (const [workspaceId, checkpoint] of Object.entries(checkpoints)) {
          if (!isCheckpointCompatible(checkpoint)) {
            changed = true;
            logger.warn(
              "orchestrator",
              "Dropping incompatible checkpoint version",
              {
                workspaceId,
                foundVersion: checkpoint.version,
                expectedVersion: CHECKPOINT_VERSION,
              },
            );
          } else if (!isCheckpointFresh(checkpoint)) {
            changed = true;
            logger.info("orchestrator", "Dropping stale checkpoint", {
              workspaceId,
              ageMs: Date.now() - checkpoint.savedAt,
              ttlMs: CHECKPOINT_TTL_MS,
            });
          } else {
            kept[workspaceId] = checkpoint;
          }
        }
        if (changed) {
          try {
            await this.write(kept);
          } catch (error) {
            // A failed prune write must not hide valid recoverable tasks.
            logger.warn("orchestrator", "Failed to prune checkpoints", { error });
          }
        }
        return kept;
      });
    } catch (error) {
      logger.warn("orchestrator", "Failed to load checkpoints", { error });
      return {};
    }
  }
}

export const orchestratorCheckpointStore = new OrchestratorCheckpointStore();
