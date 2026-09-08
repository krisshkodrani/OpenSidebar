import type { PortableCheckpointV1 } from "@shared-types/cloud-sessions";
import {
  migratePortableCheckpoint,
  validatePortableCheckpoint,
} from "@shared-types/portable-checkpoint-policy";
import type { PersistenceStorageArea } from "./types";

const PREFIX = "opensidebar:portable-checkpoint:v1:";
const key = (sessionId: string, checkpointId: string) => `${PREFIX}${sessionId}:${checkpointId}`;

export interface PortableCheckpointLocalPort {
  save(checkpoint: PortableCheckpointV1): Promise<void>;
  load(sessionId: string, checkpointId: string): Promise<PortableCheckpointV1 | null>;
  delete(sessionId: string, checkpointId: string): Promise<void>;
}

export class StoragePortableCheckpointLocalPort implements PortableCheckpointLocalPort {
  constructor(private readonly storage: PersistenceStorageArea) {}

  async save(checkpoint: PortableCheckpointV1) {
    const validation = validatePortableCheckpoint(checkpoint);
    if (!validation.valid) throw new Error(`portable_checkpoint_${validation.code}`);
    await this.storage.set({ [key(checkpoint.sessionId, checkpoint.checkpointId)]: validation.value });
  }

  async load(sessionId: string, checkpointId: string) {
    const stored = (await this.storage.get(key(sessionId, checkpointId)))[key(sessionId, checkpointId)];
    if (stored === undefined) return null;
    const validation = migratePortableCheckpoint(stored);
    if (!validation.valid) throw new Error("portable_checkpoint_local_corrupt");
    if (validation.value.sessionId !== sessionId || validation.value.checkpointId !== checkpointId)
      throw new Error("portable_checkpoint_local_identity_mismatch");
    return validation.value;
  }

  async delete(sessionId: string, checkpointId: string) {
    await this.storage.remove(key(sessionId, checkpointId));
  }
}
