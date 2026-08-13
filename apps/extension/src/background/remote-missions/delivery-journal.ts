import type { PersistenceStorageArea } from "../environment/types";

export const REMOTE_MISSION_DELIVERY_JOURNAL_KEY =
  "opensidebar:remoteMissionDelivery:v1";

export type RemoteMissionDeliveryJournalV1 = {
  schemaVersion: 1;
  lastSequence: number;
  active?: {
    missionId: string;
    sequence: number;
    state: "accepted" | "running";
    updatedAt: string;
  };
};

const empty = (): RemoteMissionDeliveryJournalV1 => ({
  schemaVersion: 1,
  lastSequence: 0,
});

const valid = (value: unknown): value is RemoteMissionDeliveryJournalV1 => {
  if (!value || typeof value !== "object") return false;
  const journal = value as Partial<RemoteMissionDeliveryJournalV1>;
  return (
    journal.schemaVersion === 1 &&
    Number.isSafeInteger(journal.lastSequence) &&
    Number(journal.lastSequence) >= 0
  );
};

export class LocalRemoteMissionDeliveryJournal {
  constructor(private readonly storage: PersistenceStorageArea) {}

  async read() {
    const stored = await this.storage.get(REMOTE_MISSION_DELIVERY_JOURNAL_KEY);
    const value = stored[REMOTE_MISSION_DELIVERY_JOURNAL_KEY];
    return valid(value) ? value : empty();
  }

  async write(value: RemoteMissionDeliveryJournalV1) {
    await this.storage.set({ [REMOTE_MISSION_DELIVERY_JOURNAL_KEY]: value });
  }
}
