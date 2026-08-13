import type {
  RemoteMissionApprovalV1,
  RemoteMissionState,
  RemoteMissionTargetSelectionV1,
} from "@shared-types/remote-missions";

export const REMOTE_MISSION_LOCAL_STATUS_KEY = "opensidebar:remoteMissionStatus:v1";

export type RemoteMissionLocalStatus = {
  missionId: string;
  state: RemoteMissionState;
  updatedAt: string;
  requesterLabel?: string;
  deviceName?: string;
  instructionSummary?: string;
  expiresAt?: string;
  targetContext?: "active_tab" | "existing_tab" | "isolated_tab";
  approval?: RemoteMissionApprovalV1;
  targetSelection?: RemoteMissionTargetSelectionV1;
  /** Acceptance-build-only local diagnostic. Never sent to cloud. */
  diagnostic?: string;
};
