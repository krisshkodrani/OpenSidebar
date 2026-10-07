import type { RemoteMissionLocalStatus } from "../../remote-mission-local-status";
import type { RemoteMissionDeliveryPort } from "./ports";

export interface RemoteMissionLocalStatusPort {
  read(): Promise<RemoteMissionLocalStatus | undefined>;
  write(status: RemoteMissionLocalStatus): Promise<void>;
}

export class RemoteMissionLocalControls {
  constructor(
    private readonly transport: RemoteMissionDeliveryPort,
    private readonly statuses: RemoteMissionLocalStatusPort,
    private readonly poll: () => Promise<void>,
    private readonly stopLocally?: (missionId: string) => Promise<void>,
  ) {}

  async cancel(missionId: string) {
    if (!this.transport.enabled) throw new Error("remote_missions_disabled");
    const status = await this.statuses.read();
    if (!status || status.missionId !== missionId)
      throw new Error("remote_mission_not_active");
    await this.stopLocally?.(missionId);
    // Local execution is already stopped. Network reconciliation may be retried later.
    await this.statuses.write({ ...status, state: "cancelled", updatedAt: new Date().toISOString() });
    const cancelled = await this.transport.cancel(missionId).catch((error: unknown) => {
      if (!this.stopLocally) throw error;
      return { state: "cancelled" as const };
    });
    await this.statuses.write({
      ...status,
      state: cancelled.state,
      updatedAt: new Date().toISOString(),
    });
  }

  async deny(missionId: string) {
    if (!this.transport.enabled) throw new Error("remote_missions_disabled");
    const status = await this.statuses.read();
    const approval = status?.approval;
    if (
      !status ||
      status.missionId !== missionId ||
      status.state !== "approval_required" ||
      !approval?.actionDigest ||
      new Date(approval.expiresAt).getTime() <= Date.now()
    ) throw new Error("remote_mission_approval_not_active");
    // A local denial wins even if a remote approval has already reached the server.
    if (this.stopLocally) await this.cancel(missionId);
    try {
      await this.transport.putApprovalDecision(missionId, {
      schemaVersion: 1,
      missionId,
      approvalId: approval.approvalId,
      actionDigest: approval.actionDigest,
      approved: false,
      decidedAt: new Date().toISOString(),
    });
    } catch (error) {
      if (!this.stopLocally) throw error;
    }
    await this.poll();
  }
}
