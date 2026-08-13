import type {
  DeliveredRemoteMissionV1,
  RemoteMissionApprovalDecisionV1,
  MissionAttemptV1,
  MissionEvidenceV1,
  MissionSpecV1,
  SupervisorDecisionV1,
  RemoteMissionV1,
  RemoteMissionResultV1,
  RemoteMissionProgressV1,
  RemoteMissionStatusV1,
  RemoteMissionTargetDecisionV1,
} from "@shared-types/remote-missions";

export interface MissionSupervisorPort {
  decide(
    mission: MissionSpecV1,
    evidence: MissionEvidenceV1,
    options?: { signal?: AbortSignal },
  ): Promise<SupervisorDecisionV1>;
}

export interface MissionAttemptJournalPort {
  read(missionId: string): Promise<MissionAttemptV1 | null>;
  write(attempt: MissionAttemptV1): Promise<void>;
  remove(missionId: string): Promise<void>;
}

export interface RemoteMissionTransportPort {
  publishEvidence(evidence: MissionEvidenceV1): Promise<void>;
  acknowledge(sequence: number): Promise<void>;
}

export interface RemoteMissionDeliveryPort {
  readonly enabled: boolean;
  poll(deviceId: string, afterSequence: number): Promise<DeliveredRemoteMissionV1[]>;
  get(missionId: string): Promise<RemoteMissionStatusV1 | null>;
  getApprovalDecision(
    missionId: string,
  ): Promise<RemoteMissionApprovalDecisionV1 | null>;
  putApprovalDecision(
    missionId: string,
    decision: RemoteMissionApprovalDecisionV1,
  ): Promise<void>;
  getTargetDecision(missionId: string): Promise<RemoteMissionTargetDecisionV1 | null>;
  putTargetDecision(
    missionId: string,
    decision: RemoteMissionTargetDecisionV1,
  ): Promise<void>;
  cancel(missionId: string): Promise<RemoteMissionV1>;
  transition(
    mission: RemoteMissionV1,
    to: Exclude<RemoteMissionV1["state"], "queued">,
    resultCode?: RemoteMissionV1["resultCode"],
  ): Promise<RemoteMissionV1>;
  putResult(mission: RemoteMissionV1, result: RemoteMissionResultV1): Promise<void>;
  putProgress(
    mission: RemoteMissionV1,
    progress: RemoteMissionProgressV1,
  ): Promise<void>;
}
