import { describe, expect, test, vi } from "vitest";
import type { RemoteMissionLocalStatus } from "../../src/remote-mission-local-status";
import { RemoteMissionLocalControls } from "../../src/background/remote-missions/local-controls";
import type { RemoteMissionDeliveryPort } from "../../src/background/remote-missions/ports";

const missionId = "123e4567-e89b-42d3-a456-426614174001";
const active = (): RemoteMissionLocalStatus => ({
  missionId,
  state: "running",
  updatedAt: new Date().toISOString(),
  instructionSummary: "Review the prepared update",
});

const transport = () => ({
  enabled: true,
  poll: vi.fn(),
  get: vi.fn(),
  getApprovalDecision: vi.fn(),
  getTargetDecision: vi.fn(),
  getSupervisorDecision: vi.fn(),
  putApprovalDecision: vi.fn(),
  putTargetDecision: vi.fn(),
  putSupervisorDecision: vi.fn(),
  cancel: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    missionId,
    deviceId: "device-1",
    state: "cancelled",
    sequence: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resultCode: "cancelled",
  }),
  transition: vi.fn(),
  putResult: vi.fn(),
  putProgress: vi.fn(),
}) satisfies RemoteMissionDeliveryPort;

describe("remote mission local controls", () => {
  test("cancels through the authenticated transport and preserves bounded context", async () => {
    const cloud = transport();
    const write = vi.fn();
    const controls = new RemoteMissionLocalControls(
      cloud,
      { read: async () => active(), write },
      vi.fn(),
    );
    await controls.cancel(missionId);
    expect(cloud.cancel).toHaveBeenCalledWith(missionId);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      missionId,
      state: "cancelled",
      instructionSummary: "Review the prepared update",
    }));
  });

  test("denies only the exact unexpired digest then polls immediately", async () => {
    const cloud = transport();
    const poll = vi.fn();
    const controls = new RemoteMissionLocalControls(
      cloud,
      {
        read: async () => ({
          ...active(),
          state: "approval_required",
          approval: {
            approvalId: "approval-1",
            question: "Submit?",
            actionDigest: "digest-1",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
        write: vi.fn(),
      },
      poll,
    );
    await controls.deny(missionId);
    expect(cloud.putApprovalDecision).toHaveBeenCalledWith(
      missionId,
      expect.objectContaining({
        approvalId: "approval-1",
        actionDigest: "digest-1",
        approved: false,
      }),
    );
    expect(poll).toHaveBeenCalledOnce();
  });

  test("refuses expired or mismatched local control requests", async () => {
    const cloud = transport();
    const controls = new RemoteMissionLocalControls(
      cloud,
      {
        read: async () => ({
          ...active(),
          state: "approval_required",
          approval: {
            approvalId: "approval-1",
            question: "Submit?",
            actionDigest: "digest-1",
            expiresAt: new Date(Date.now() - 1).toISOString(),
          },
        }),
        write: vi.fn(),
      },
      vi.fn(),
    );
    await expect(controls.deny(missionId)).rejects.toThrow(
      "remote_mission_approval_not_active",
    );
    await expect(controls.cancel("another-mission")).rejects.toThrow(
      "remote_mission_not_active",
    );
    expect(cloud.putApprovalDecision).not.toHaveBeenCalled();
    expect(cloud.cancel).not.toHaveBeenCalled();
  });
});
