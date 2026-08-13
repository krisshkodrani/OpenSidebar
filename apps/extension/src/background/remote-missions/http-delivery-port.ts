import type {
  DeliveredRemoteMissionV1,
  RemoteMissionApprovalDecisionV1,
  RemoteMissionV1,
  RemoteMissionResultV1,
  RemoteMissionProgressV1,
  RemoteMissionTargetDecisionV1,
} from "@shared-types/remote-missions";
import type { RemoteMissionDeliveryPort } from "./ports";

type AuthenticatedFetch = (path: string, init?: RequestInit) => Promise<Response>;

export class DisabledRemoteMissionDeliveryPort implements RemoteMissionDeliveryPort {
  readonly enabled = false;
  async poll() { return []; }
  async get() { return null; }
  async getApprovalDecision() { return null; }
  async getTargetDecision() { return null; }
  async putApprovalDecision(): Promise<void> {
    throw new Error("remote_missions_disabled");
  }
  async putTargetDecision(): Promise<void> {
    throw new Error("remote_missions_disabled");
  }
  async cancel(): Promise<RemoteMissionV1> {
    throw new Error("remote_missions_disabled");
  }
  async transition(): Promise<RemoteMissionV1> {
    throw new Error("remote_missions_disabled");
  }
  async putResult(): Promise<void> {
    throw new Error("remote_missions_disabled");
  }
  async putProgress(): Promise<void> {
    throw new Error("remote_missions_disabled");
  }
}

export class HttpRemoteMissionDeliveryPort implements RemoteMissionDeliveryPort {
  readonly enabled = true;
  constructor(private readonly fetchCloud: AuthenticatedFetch) {}

  async poll(deviceId: string, afterSequence: number) {
    const query = new URLSearchParams({
      after: String(afterSequence),
      limit: "10",
    });
    const response = await this.fetchCloud(
      `/devices/${encodeURIComponent(deviceId)}/remote-missions?${query}`,
    );
    if (!response.ok) throw new Error(`remote_mission_poll_${response.status}`);
    return ((await response.json()) as { missions: DeliveredRemoteMissionV1[] }).missions;
  }

  async get(missionId: string) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(missionId)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`remote_mission_get_${response.status}`);
    return response.json() as Promise<RemoteMissionV1>;
  }

  async getApprovalDecision(missionId: string) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(missionId)}/approval-decision`,
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`remote_mission_approval_decision_${response.status}`);
    return response.json() as Promise<RemoteMissionApprovalDecisionV1>;
  }

  async putApprovalDecision(
    missionId: string,
    decision: RemoteMissionApprovalDecisionV1,
  ) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(missionId)}/approval-decision`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `remote-mission:${missionId}:approval:${decision.approvalId}:${decision.approved}`,
        },
        body: JSON.stringify(decision),
      },
    );
    if (!response.ok)
      throw new Error(`remote_mission_approval_decision_${response.status}`);
  }

  async getTargetDecision(missionId: string) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(missionId)}/target-decision`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`remote_mission_target_decision_${response.status}`);
    return response.json() as Promise<RemoteMissionTargetDecisionV1>;
  }

  async putTargetDecision(missionId: string, decision: RemoteMissionTargetDecisionV1) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(missionId)}/target-decision`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `remote-mission:${missionId}:target:${decision.targetHandle}`,
        },
        body: JSON.stringify(decision),
      },
    );
    if (!response.ok) throw new Error(`remote_mission_target_decision_${response.status}`);
  }

  async cancel(missionId: string) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(missionId)}/cancel`,
      {
        method: "POST",
        headers: {
          "idempotency-key": `remote-mission:${missionId}:local-cancel`,
        },
      },
    );
    if (!response.ok) throw new Error(`remote_mission_cancel_${response.status}`);
    return response.json() as Promise<RemoteMissionV1>;
  }

  async transition(
    mission: RemoteMissionV1,
    to: Exclude<RemoteMissionV1["state"], "queued">,
    resultCode?: RemoteMissionV1["resultCode"],
  ) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(mission.missionId)}/transition`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `remote-mission:${mission.missionId}:${to}`,
        },
        body: JSON.stringify({ schemaVersion: 1, to, ...(resultCode ? { resultCode } : {}) }),
      },
    );
    if (response.status === 409) {
      const current = await this.get(mission.missionId);
      if (current?.state === to) return current;
    }
    if (!response.ok) throw new Error(`remote_mission_transition_${response.status}`);
    return response.json() as Promise<RemoteMissionV1>;
  }

  async putResult(mission: RemoteMissionV1, result: RemoteMissionResultV1) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(mission.missionId)}/result`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result),
      },
    );
    if (!response.ok) throw new Error(`remote_mission_result_${response.status}`);
  }

  async putProgress(mission: RemoteMissionV1, progress: RemoteMissionProgressV1) {
    const response = await this.fetchCloud(
      `/remote-missions/${encodeURIComponent(mission.missionId)}/progress`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(progress),
      },
    );
    if (!response.ok) throw new Error(`remote_mission_progress_${response.status}`);
  }
}
