import type { PersistenceStorageArea } from "../environment/types";
import { createVersionedStore } from "../environment/versioned-store";

type LocalCommandApproval = {
  commandId: string;
  actionDigest: string;
  expiresAt: number;
};

export class LocalCloudCommandApprovalStore {
  private readonly store;

  constructor(area: PersistenceStorageArea, commandId: string) {
    this.store = createVersionedStore<LocalCommandApproval | null>(
      area,
      `opensidebar:cloud-command-approval:v1:${commandId}`,
      { version: 1 },
    );
  }

  async grant(
    commandId: string,
    actionDigest: string,
    expiresAt: number,
  ): Promise<void> {
    await this.store.save({ commandId, actionDigest, expiresAt });
  }

  async consume(
    commandId: string,
    actionDigest: string,
    now = Date.now(),
  ): Promise<boolean> {
    let approved = false;
    await this.store.update((current) => {
      if (
        current?.commandId === commandId &&
        current.actionDigest === actionDigest &&
        current.expiresAt > now
      )
        approved = true;
      return null;
    });
    return approved;
  }
}

export class PendingCloudCommandApprovalRegistry<T extends { expiresAt: number }> {
  private readonly pending = new Map<string, T>();

  request(value: T): string {
    const approvalId = crypto.randomUUID();
    this.pending.set(approvalId, value);
    return approvalId;
  }

  decide(
    approvalId: string,
    approved: boolean,
    now = Date.now(),
  ):
    | { kind: "approved"; value: T }
    | { kind: "denied"; value: T }
    | { kind: "expired" } {
    const value = this.pending.get(approvalId);
    this.pending.delete(approvalId);
    if (!value || value.expiresAt <= now) return { kind: "expired" };
    return approved ? { kind: "approved", value } : { kind: "denied", value };
  }
}
