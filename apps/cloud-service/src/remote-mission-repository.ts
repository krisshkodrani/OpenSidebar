import type {
  RemoteMissionState,
  RemoteMissionV1,
} from "@opensidebar/shared-types";

export type RemoteMissionMutation =
  | { kind: "created" | "updated" | "replayed"; value: RemoteMissionV1 }
  | { kind: "not_found" | "state_conflict" | "invalid_transition" };

export interface RemoteMissionRepository {
  missionByIdempotency(
    accountId: string,
    idempotencyHash: string,
  ): Promise<RemoteMissionV1 | null>;
  createMission(input: {
    accountId: string;
    missionId: string;
    deviceId: string;
    createdAt: Date;
    expiresAt: Date;
    idempotencyHash: string;
    payloadObjectKey: string;
    payloadCiphertextSizeBytes: number;
    payloadCiphertextSha256: string;
  }): Promise<RemoteMissionMutation>;
  mission(accountId: string, missionId: string): Promise<RemoteMissionV1 | null>;
  missions(input: {
    accountId: string;
    deviceId: string;
    afterSequence: number;
    limit: number;
  }): Promise<RemoteMissionV1[]>;
  activeMissions(accountId: string): Promise<RemoteMissionV1[]>;
  transition(input: {
    accountId: string;
    missionId: string;
    deviceId: string;
    from: RemoteMissionState;
    to: RemoteMissionState;
    resultCode?: RemoteMissionV1["resultCode"];
  }): Promise<RemoteMissionMutation>;
  payloadObjectKey(accountId: string, missionId: string): Promise<string | null>;
  expired(limit: number): Promise<Array<{
    accountId: string;
    deviceId: string;
    missionId: string;
  }>>;
  remove(accountId: string, missionId: string): Promise<boolean>;
}
