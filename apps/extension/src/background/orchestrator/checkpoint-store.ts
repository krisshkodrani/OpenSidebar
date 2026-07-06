import { chromePersistencePort } from "../environment/chrome";
import { logger } from "../../utils";
import type { OrchestratorCheckpoint } from "./types";
import { CHECKPOINT_VERSION, isRecord, sanitizeCheckpoint } from "./sanitizers";

export const CHECKPOINTS_STORAGE_KEY = "opensidebar:orchestrator:checkpoints";
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

export async function loadOrchestratorCheckpoints(): Promise<
  Record<string, OrchestratorCheckpoint>
> {
  try {
    const stored = await chromePersistencePort.local.get(CHECKPOINTS_STORAGE_KEY);
    const raw = stored[CHECKPOINTS_STORAGE_KEY];
    if (!isRecord(raw)) return {};

    const parsed: Record<string, OrchestratorCheckpoint> = {};
    for (const [workspaceId, value] of Object.entries(raw)) {
      if (typeof workspaceId !== "string" || workspaceId.length === 0) {
        continue;
      }
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
  } catch (error) {
    logger.warn("orchestrator", "Failed to load checkpoints", { error });
    return {};
  }
}

export function isCheckpointFresh(checkpoint: OrchestratorCheckpoint): boolean {
  return Date.now() - checkpoint.savedAt <= CHECKPOINT_TTL_MS;
}

export function isCheckpointCompatible(
  checkpoint: OrchestratorCheckpoint,
): boolean {
  return checkpoint.version === CHECKPOINT_VERSION;
}

export async function saveOrchestratorCheckpoints(
  checkpoints: Record<string, OrchestratorCheckpoint>,
): Promise<void> {
  try {
    await chromePersistencePort.local.set({
      [CHECKPOINTS_STORAGE_KEY]: checkpoints,
    });
  } catch (error) {
    logger.warn("orchestrator", "Failed to save checkpoints", { error });
  }
}

export async function pruneOrchestratorCheckpoints(
  checkpoints: Record<string, OrchestratorCheckpoint>,
): Promise<Record<string, OrchestratorCheckpoint>> {
  let mutated = false;
  const kept: Record<string, OrchestratorCheckpoint> = {};

  for (const [workspaceId, checkpoint] of Object.entries(checkpoints)) {
    if (!isCheckpointCompatible(checkpoint)) {
      mutated = true;
      logger.warn("orchestrator", "Dropping incompatible checkpoint version", {
        workspaceId,
        foundVersion: checkpoint.version,
        expectedVersion: CHECKPOINT_VERSION,
      });
      continue;
    }
    if (!isCheckpointFresh(checkpoint)) {
      mutated = true;
      logger.info("orchestrator", "Dropping stale checkpoint", {
        workspaceId,
        ageMs: Date.now() - checkpoint.savedAt,
        ttlMs: CHECKPOINT_TTL_MS,
      });
      continue;
    }
    kept[workspaceId] = checkpoint;
  }

  if (mutated) {
    await saveOrchestratorCheckpoints(kept);
  }
  return kept;
}
