import type {
  BrowserCommandRisk,
  BrowserCommandState,
  DeviceCommandOutcomeCode,
  DeviceCommandRecordV1,
} from "@opensidebar/shared-types";

export type CommandMutation =
  | {
      kind: "created" | "updated" | "replayed";
      value: DeviceCommandRecordV1;
    }
  | {
      kind:
        | "not_found"
        | "lease_conflict"
        | "generation_conflict"
        | "state_conflict"
        | "invalid_transition";
    };

export interface DeviceCommandRepository {
  commandByIdempotency(
    accountId: string,
    sessionId: string,
    idempotencyHash: string,
  ): Promise<DeviceCommandRecordV1 | null>;
  createCommand(input: {
    accountId: string;
    deviceId: string;
    sessionId: string;
    commandId: string;
    leaseId: string;
    leaseGeneration: number;
    checkpointRevision: number;
    commandKind: string;
    risk: BrowserCommandRisk;
    actionDigest: string;
    payloadObjectKey?: string;
    payloadCiphertextSizeBytes?: number;
    payloadCiphertextSha256?: string;
    expiresAt: Date;
    idempotencyHash: string;
  }): Promise<CommandMutation>;
  commands(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    leaseId: string;
    leaseGeneration: number;
    afterSequence: number;
    limit: number;
  }): Promise<DeviceCommandRecordV1[]>;
  transitionCommand(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    commandId: string;
    leaseId: string;
    leaseGeneration: number;
    to: BrowserCommandState;
    outcomeCode?: DeviceCommandOutcomeCode;
    idempotencyHash: string;
  }): Promise<CommandMutation>;
}
