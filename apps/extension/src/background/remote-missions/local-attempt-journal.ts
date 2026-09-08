import type { MissionAttemptV1 } from "@shared-types/remote-missions";
import type { PersistencePort } from "../environment/types";
import type { MissionAttemptJournalPort } from "./ports";

const PREFIX = "opensidebar:remoteMissionAttempt:v1:";

const valid = (value: unknown): value is MissionAttemptV1 => {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<MissionAttemptV1>;
  return (
    attempt.schemaVersion === 1 &&
    typeof attempt.missionId === "string" &&
    typeof attempt.stepId === "string" &&
    typeof attempt.attemptId === "string" &&
    Number.isSafeInteger(attempt.planRevision) &&
    typeof attempt.updatedAt === "string"
  );
};

export class LocalMissionAttemptJournal implements MissionAttemptJournalPort {
  constructor(private readonly persistence: PersistencePort) {}

  async read(missionId: string) {
    const key = `${PREFIX}${missionId}`;
    const value = (await this.persistence.local.get(key))[key];
    return valid(value) ? value : null;
  }

  async write(attempt: MissionAttemptV1) {
    await this.persistence.local.set({ [`${PREFIX}${attempt.missionId}`]: attempt });
  }

  async remove(missionId: string) {
    await this.persistence.local.remove(`${PREFIX}${missionId}`);
  }
}

