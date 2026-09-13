import type {
  MissionAttemptV1,
  MissionEvidenceV1,
  MissionSpecV1,
  SupervisorDecisionV1,
} from "@shared-types/remote-missions";
import type {
  MissionAttemptJournalPort,
  MissionSupervisorPort,
  RemoteMissionTransportPort,
} from "./ports";

export class MemoryMissionAttemptJournal implements MissionAttemptJournalPort {
  readonly attempts = new Map<string, MissionAttemptV1>();
  async read(missionId: string) {
    return this.attempts.get(missionId) ?? null;
  }
  async write(attempt: MissionAttemptV1) {
    this.attempts.set(attempt.missionId, structuredClone(attempt));
  }
  async remove(missionId: string) {
    this.attempts.delete(missionId);
  }
}

export class MemoryRemoteMissionTransport implements RemoteMissionTransportPort {
  readonly evidence: MissionEvidenceV1[] = [];
  readonly acknowledgements: number[] = [];
  async publishEvidence(value: MissionEvidenceV1) {
    this.evidence.push(structuredClone(value));
  }
  async acknowledge(sequence: number) {
    const previous = this.acknowledgements.at(-1) ?? 0;
    if (sequence < previous) throw new Error("remote_mission_ack_regressed");
    this.acknowledgements.push(sequence);
  }
}

export class ScriptedMissionSupervisor implements MissionSupervisorPort {
  readonly received: MissionEvidenceV1[] = [];
  constructor(private readonly decisions: SupervisorDecisionV1[]) {}

  async decide(mission: MissionSpecV1, evidence: MissionEvidenceV1) {
    this.received.push(structuredClone(evidence));
    const decision = this.decisions.shift();
    if (!decision) throw new Error("scripted_supervisor_exhausted");
    if (decision.missionId !== mission.missionId)
      throw new Error("scripted_supervisor_mission_mismatch");
    return structuredClone(decision);
  }
}

