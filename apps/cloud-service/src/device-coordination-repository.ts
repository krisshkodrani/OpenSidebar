import type {
  CloudDeviceConnectionV1,
  SessionLeaseV1,
} from "@opensidebar/shared-types";

export type CoordinationMutation<T> =
  | { kind: "created" | "updated" | "replayed"; value: T }
  | {
      kind:
        | "not_found"
        | "revision_conflict"
        | "lease_conflict"
        | "generation_conflict"
        | "device_mismatch";
    };

export interface DeviceCoordinationRepository {
  createConnection(
    accountId: string,
    deviceId: string,
    connectionId: string,
    transport: "sse" | "long_poll",
    expiresAt: Date,
    idempotencyHash: string,
  ): Promise<CoordinationMutation<CloudDeviceConnectionV1>>;
  connection(
    accountId: string,
    deviceId: string,
    connectionId: string,
  ): Promise<CloudDeviceConnectionV1 | null>;
  acquireLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    expectedSessionRevision: number;
    idempotencyHash: string;
  }): Promise<CoordinationMutation<SessionLeaseV1>>;
  heartbeatLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }): Promise<CoordinationMutation<SessionLeaseV1>>;
  reconnectLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }): Promise<CoordinationMutation<SessionLeaseV1>>;
  takeoverLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    expectedSessionRevision: number;
    expectedGeneration: number;
    idempotencyHash: string;
  }): Promise<CoordinationMutation<SessionLeaseV1>>;
  releaseLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }): Promise<CoordinationMutation<SessionLeaseV1>>;
  lease(accountId: string, sessionId: string): Promise<SessionLeaseV1 | null>;
}
